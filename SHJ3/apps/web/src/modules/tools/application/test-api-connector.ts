/**
 * "Test connection" — B3 step 4 sub-tab C / B5 tab 3's `Test connection` button.
 *
 * **Honestly not implemented — not a fake success.** This is deliberate, not an
 * oversight, and mirrors exactly how `ConnectAndDiscoverMcpServer` treats the
 * real MCP handshake: real, visibly-not-yet-functional, never a silent success.
 *
 * ## Why this cannot make a real HTTP call today
 *
 * `docs/api.md` §5.6: "Test connection. Issues the configured request with a
 * synthetic argument set; returns status, latency and a **redacted** sample
 * response body." Doing that for real needs an outbound-HTTP-calling adapter
 * that resolves credentials per `ApiConnectorRow.authMode` (an `ApiKey` header,
 * an `OAuth2ClientCredentials` token exchange, or none) from
 * `credentialSecretRef`, builds a synthetic request against `urlTemplate`, and
 * safely sandboxes the call (timeout, redirect policy, response-size cap,
 * redaction before persisting the sample). No such port or adapter exists
 * anywhere in this module — deliberately out of scope for this wave's design (a
 * real, safely-sandboxed generic outbound HTTP caller with per-auth-mode
 * credential resolution is substantial, separate infrastructure work, the same
 * class of gap as the MCP discovery call's honestly-failing `apps/ai` endpoint).
 *
 * `ApiConnectorRepository.recordTestResult`'s own doc comment describes exactly
 * what a real implementation would call afterwards — this use case deliberately
 * never calls it, because there is no real probe result to record. Faking one
 * (even a plausible-looking `{ok:true}`) would violate this project's explicit
 * "no fake canned responses" instruction, and would let a `testState: 'Tested'`
 * badge lie about a connector nobody has actually verified end-to-end.
 *
 * Still returns `connector` — the current, unmodified row — so a caller can
 * render the connector's configuration alongside the not-implemented reason,
 * never a partial or invented probe outcome.
 */

import type { ApiConnectorRepository, ApiConnectorRow } from "../ports/api-connector-repository.js";

export interface TestApiConnectorInput {
  readonly id: string;
  readonly now: Date;
}

export interface TestApiConnectorResult {
  readonly ok: false;
  readonly reason: "tools.test_execution_not_implemented";
  readonly connector: ApiConnectorRow;
}

export interface TestApiConnectorDeps {
  readonly connectors: ApiConnectorRepository;
}

export class TestApiConnector {
  constructor(private readonly deps: TestApiConnectorDeps) {}

  async execute(input: TestApiConnectorInput): Promise<TestApiConnectorResult> {
    const connector = await this.deps.connectors.get(input.id);
    if (!connector) {
      throw new Error(
        `Cannot test API connector "${input.id}": no such connector. Testing acts on an existing registration, never a deletion.`,
      );
    }
    return { ok: false, reason: "tools.test_execution_not_implemented", connector };
  }
}
