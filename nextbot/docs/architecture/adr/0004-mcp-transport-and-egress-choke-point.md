# ADR-0004 — MCP transport handling and the single egress choke point

**Status:** Accepted · 2026-08-15
**Context refs:** FR-MCP-01/02/05/08/12, FR-SEC-02/05/06, FR-AGT-10, NFR-3, NFR-4

## 1. Context

Connectors declare one of two transports (spec §6.1 `Connector.transport`):
`StreamableHTTP` (a cloud-reachable MCP server) or `StdioViaGateway` (an on-prem, stdio-launched MCP
server behind the tenant's firewall, reached through a Gateway Agent that dials outbound over HTTPS,
FR-MCP-12).

Independently, several requirements demand that tool calls be interceptable at a single point:
FR-SEC-06 (runtime-enforced permission checks before the MCP server is reached), FR-SEC-02
(credentials never leave the vault boundary), FR-MCP-08 (per-tool circuit breaker), FR-AGT-10
(per-tenant tool-egress allowlist), FR-MCP-06 (complete tool-call audit), FR-SEC-05 (residency).

## 2. Decision

**All MCP egress goes through the `mcp-egress` module of the Gateway Plane. The Data Plane has no
outbound network egress and no MCP client at all.**

The Data Plane emits a transport-agnostic `ToolInvocation { runId, tenantId, toolId, args,
idempotencyKey }`. It names no URL, credential, header, or transport. The Gateway resolves the
connector, transport, credential, and policy. This is not defence-in-depth theatre — it is what makes
the two transports interchangeable to the runtime and keeps the number of places a credential can be
decrypted at exactly one.

**Per-invocation pipeline in `mcp-egress`, in order:**

1. Resolve tool → connector → transport → environment.
2. **PEP re-check** against the cached PolicyBundle (channel/role/task/segment → Allow/Deny/
   Require-Approval) plus the tenant's tool-egress allowlist. Deny is terminal and audited. This
   re-check exists because the runtime's decision was made at tool-selection time and policy may have
   changed, and because a runtime bug must not be able to produce an unpermissioned call.
3. Circuit-breaker gate: a tripped tool/connector is rejected here even if permissioned (FR-MCP-08).
4. Idempotency claim (ADR-0005) — at-most-once for the underlying mutation.
5. Credential decrypt (in-memory only, never logged, never persisted) and injection per
   `auth_method` (OAuth2 / API key / bearer / custom header / mTLS).
6. Dispatch on transport (§3).
7. Response: validate against the tool's output schema, PII-mask per the context matrix, record
   latency/status, persist the `ToolCall` record, emit the OTel span, feed the breaker's health
   window.

### 3. Transport dispatch

**`StreamableHTTP`** — the official `@modelcontextprotocol/sdk` client over Streamable HTTP, with a
per-connector client pool (persistent sessions where the server supports them), per-connector
concurrency cap (bulkhead: one slow backend cannot exhaust the shared pool), and per-connector
timeout. Egress leaves the region's cell only to the connector's own host.

**`StdioViaGateway`** — the Gateway Agent runs inside the tenant's network, launches and supervises
the stdio MCP server as a child process, and holds an **outbound-initiated, persistent, mutually
authenticated connection** to the Gateway Plane's `tunnel-terminator`. NextBot never dials into the
tenant's network; no inbound firewall rule is ever required, which is the entire point of the
component. A `ToolInvocation` for such a connector is multiplexed as a framed request over that
connection, and the Gateway Agent speaks stdio JSON-RPC to the local process. `list_tools`
(FR-MCP-02) travels the same path, so discovery and invocation share one code path and cannot drift.

Heartbeat: the agent heartbeats on the same connection. On a missed-heartbeat window (default 5 min)
the terminator flips every connector routed through that agent to `Offline` and fails pending calls
with the FR-MCP-12 message "Gateway Agent unreachable — check on-prem connectivity." Reconnection is
exponential-backoff from the agent side, and a reconnecting agent must re-authenticate; a revoked
agent's reconnect is refused.

**Transport is invisible above `mcp-egress`.** The only places transport appears elsewhere are
display concerns: the "via Gateway Agent" label and tunnel status in the Admin Console (FR-MCP-12).

## 4. Alternatives considered

**MCP client inside the Data Plane.** Rejected: it would put credentials, egress allowlists, and the
breaker inside the fleet that scales widest and runs model-influenced code, and it would give the
Data Plane general outbound internet access. It also makes FR-SEC-06's "enforced by the runtime
before reaching the MCP server" a same-process assertion with no independent enforcement point.

**Run a per-tenant sidecar/pod for on-prem tunnels.** Rejected: no requirement forces per-tenant
compute, and it multiplies the fleet by tenant count.

**Let the Gateway Agent connect straight to the Data Plane.** Rejected: it would duplicate policy,
audit, credential handling, and breaker logic on a second path — the exact drift this ADR exists to
prevent.

**Inbound VPN/PrivateLink instead of a reverse tunnel.** Rejected as the default: it requires the
tenant to open network paths and coordinate with their network team, which contradicts the success
metric of "< 1 business day to integrate a templated backend". A tenant may still front their MCP
server with PrivateLink and register it as `StreamableHTTP`; that path is unaffected.

## 5. Consequences

- One choke point means one bottleneck: `mcp-egress` must sustain 500 tool calls/s per large tenant
  (NFR-3). It is horizontally scalable and stateless apart from pooled connections; breaker and
  quota state live in Redis so any replica sees the same view.
- Tunnel-terminating replicas are sticky per Gateway Agent connection; a rolling deploy must drain
  gracefully and agents must reconnect transparently (accepted; ties to ADR-0002's drain window).
- Tool discovery, sandbox test execution (FR-MCP-09), health probes (FR-MCP-08), and human-agent
  manual tool invocation (FR-ESC-02) all route through this same module — no second client anywhere.
- `nexus-qa` check: no import of an MCP SDK outside `apps/gateway/src/mcp-egress/**`.
