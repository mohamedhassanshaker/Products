/* ============================================================
   NextBot Wireframes — Portal B.3A: MCP Agent Tool Configuration
   ============================================================ */
(function () {
  var S = [];

  function sc(id, title, critical, prd, trigger, blurb, type, data, specRows, notes) {
    S.push({
      id: id, portal: "CFG", title: title, critical: critical, prd: prd,
      trigger: trigger, blurb: blurb, type: type, data: data || {},
      specRows: specRows || [], notes: notes || []
    });
  }

  sc("B.3A.1", "Agent Tool Registry", true, ["MCP-02", "MCP-03", "AI-02", "AI-03"],
    "Console > Agent Tool Config > Registry",
    "The platform admin's unified view of every tool the AI agent can call: visibility toggles, priority weights, capability groups and health.",
    "table",
    {
      filter: ["Search tools", "Connector: All", "RW: All", "Tier: All", "Priority: All", "Status: Active"],
      cols: ["Tool", "Source connector", "Type", "Approval tier", "Priority", "Group", "Health", "Visible"],
      rows: [
        ["get_account_balance", "Billing-Payments", "Read", { pill: "g", t: "Tier 1" }, "80", "Account Info", { pill: "g", t: "99.6% · 142ms" }, true],
        ["list_transactions", "Billing-Payments", "Read", { pill: "g", t: "Tier 1" }, "75", "Account Info", { pill: "g", t: "98.7% · 176ms" }, true],
        ["create_ticket", "Ticketing", "Write", { pill: "a", t: "Tier 2" }, "70", "Support Cases", { pill: "g", t: "96.4% · 230ms" }, true],
        ["issue_refund", "Billing-Payments", "Write", { pill: "r", t: "Tier 3" }, "55", "Payments", { pill: "r", t: "88.5% · 510ms" }, true],
        ["get_employee_info", "HR Portal", "Read", { pill: "g", t: "Tier 1" }, "30", "HR Self-Service", { pill: "g", t: "97.6% · 198ms" }, false],
        ["get_documents", "Knowledge Base", "Read", { pill: "g", t: "Tier 1" }, "65", "Knowledge", { pill: "g", t: "99.1% · 120ms" }, true]
      ],
      bulk: "Enable/Disable · Assign group · Change tier · Change priority"
    },
    [
      ["Unified tool list", "Every enabled tool: name, source connector, backend type, description, schemas, read/write, tier, priority weight, status."],
      ["Search & filter", "Full-text search + filters: connector, type, tier, priority, usage, error rate."],
      ["Agent visibility toggle", "“Visible to AI Agent” OFF → exists but never selected by orchestration core."],
      ["Priority weight", "Numeric 1–100 influencing tool-selection reasoning. Drag-to-reorder within capability groups."],
      ["Tool grouping", "Named capability groups (e.g., “Order Management”, “Billing”) usable in C.1.1 Capability & Tool Catalog."],
      ["Health summary", "Last call, 24h success rate, avg latency, error count. Red highlight > 5% error rate."],
      ["Bulk actions", "Enable/disable, assign group, change tier, change priority."]
    ]
  );

  sc("B.3A.2", "MCP Server Enrollment", true, ["MCP-01", "MCP-10", "MCP-11", "GEN-01"],
    "Console > Agent Tool Config > Enroll Server",
    "Enroll any MCP server so its tools become callable by the AI agent — from template, URL, Gateway Agent or registry.",
    "wizard",
    {
      steps: [
        { name: "Source", source: [
          { t: "a) Template library", d: "Zendesk, Salesforce, SAP, Jira SM, Freshdesk, HubSpot, NetSuite, ServiceNow, Stripe, Twilio, custom HRIS…" },
          { t: "b) Streamable HTTP URL", d: "https://…/mcp — any standards-compliant MCP server" },
          { t: "c) Gateway Agent", d: "On-prem Gateway Agent (B.12) → locally-spawned stdio server" },
          { t: "d) Registry / marketplace", d: "Search a public or private MCP server directory (if configured)" }
        ], sel: 1 },
        { name: "Connect & Authenticate", fields: [
          { label: "URL / transport", ph: "https://…/mcp · Streamable HTTP" },
          { label: "Auth method", sel: true, ph: "OAuth2 (redirect → consent → vault)" },
          { label: "API key (alt)", mask: true },
          { label: "Test connection", pill: "g", pt: "✓ Connected — handshake OK" }
        ] },
        { name: "Discover Tools", discover: true, tools: [
          { n: "get_account_balance", d: "Fetch account balance by ID", rw: "Read", on: true },
          { n: "list_transactions", d: "List recent transactions", rw: "Read", on: true },
          { n: "issue_refund", d: "Issue refund against invoice", rw: "Write", on: true },
          { n: "export_ledger", d: "Export full ledger", rw: "Write", on: false }
        ] },
        { name: "Configure Each Tool", note: "Per-tool: display name, description override, approval tier, priority weight, capability group, channel + task/scope guidance, rate limits.", tbl: { cols: ["Tool", "Display", "Tier", "Weight", "Group", "Rate limit"], rows: [["get_account_balance", "Check Balance", "Tier 1", "80", "Account Info", "300/min"], ["list_transactions", "Transactions", "Tier 1", "75", "Account Info", "120/min"], ["issue_refund", "Refund", "Tier 2", "55", "Payments", "20/min"]] } },
        { name: "Set Selection Guidance", note: "Optional: assign capabilities + priority weights so the agent prefers specific tools. If skipped, the AI selects autonomously from descriptions + schemas.", tbl: { cols: ["Capability", "Preferred tools"], rows: [["account_balance", "get_account_balance (w80)"], ["transaction_history", "list_transactions (w75)"], ["payment_refund", "issue_refund (w55)"]] } },
        { name: "Test", test: { tool: "get_account_balance", args: '{ "accountId": "acc_4821" }', result: '{ "balance": 12480.5, "currency": "USD", "ts": "2026-08-15T10:31:00Z" }', e2e: true } },
        { name: "Review & Activate", activate: true, summary: ["URL: https://…/mcp", "Auth: OAuth2 · vaulted", "3 tools enrolled · 1 ignored", "Tiers: 2× T1, 1× T2", "Selection guidance: 3 capabilities"] }
      ]
    },
    [
      ["1 — Source", "Template library · Streamable HTTP URL · Gateway Agent stdio · registry/marketplace."],
      ["2 — Connect & Authenticate", "URL + transport; OAuth2 inline flow (redirect → consent → vault), API key masked, mTLS, custom header. Test connection."],
      ["3 — Discover Tools", "list_tools → checklist with schema preview + read/write auto-classification. Check tools to enroll."],
      ["4 — Configure Each Tool", "Display name, description override, approval tier (T1/T2/T3), priority weight, capability group, channel/task/scope guidance, rate limits."],
      ["5 — Set Selection Guidance", "Assign capabilities + priority weights so the agent prefers specific tools — or rely on autonomous selection."],
      ["6 — Test", "Sandbox execution + end-to-end simulation (message → goal → tool selection → payload from schema → response)."],
      ["7 — Review & Activate", "Summary (URL, auth, tool count, tiers, guidance) → Activate."]
    ]
  );

  sc("B.3A.3", "Tool Composition / Multi-Tool Workflows", true, ["AI-03"],
    "Console > Agent Tool Config > Workflows",
    "Define explicit multi-step tool chains with branching, cross-backend data passing, fallback and full simulation.",
    "workflow",
    {
      wf: [
        { n: "Order Refund", trig: "User requests a refund over $500", steps: 4, backends: "CRM · ERP · Billing · Ticketing", st: "Active" },
        { n: "New Hire Onboarding", trig: "HR requests new-hire setup", steps: 3, backends: "HRIS · Identity", st: "Active" },
        { n: "Account Closure", trig: "User requests account deletion", steps: 3, backends: "Billing · CRM", st: "Draft" }
      ],
      demo: [
        { kind: "tool", nt: "Step 1 · Tool", name: "crm.get_customer_profile", cls: "tool", tag: "T1", note: "check account tier" },
        { kind: "cond", nt: "Branch", name: "IF order.status = delivered", cls: "cond" },
        { kind: "tool", nt: "Step 2 · Tool", name: "erp.get_order_status", cls: "tool", tag: "T1", note: "verify order exists" },
        { kind: "tool", nt: "Step 3 · Tool", name: "billing.issue_refund", cls: "tool", tag: "T3", note: "requires human approval" },
        { kind: "tool", nt: "Step 4 · Tool", name: "ticketing.create_ticket", cls: "tool", tag: "T2", note: "log the refund case" }
      ],
      mapping: ["crm.get_customer_profile.creditTier → billing.issue_refund.priority", "erp.get_order_status.amount → billing.issue_refund.amount"]
    },
    [
      ["Workflow list", "Name, trigger condition(s), steps count, connectors involved, status (Active/Draft)."],
      ["Workflow builder", "Visual step editor with branching; each step: tool, output→input field mapping, branch conditions."],
      ["Example", "Order Refund: get_customer_profile → get_order_status → IF delivered → issue_refund (T3) → create_ticket."],
      ["Cross-backend data passing", "Visual field mapping with schema type-checking."],
      ["Fallback / error handling", "Per step: retry, skip, escalate to human, or alternative tool."],
      ["Test", "Simulate full workflow with sample inputs — step-by-step execution."]
    ]
  );

  sc("B.3A.4", "MCP Server Health & Monitoring", true, ["MCP-08", "RP-02"],
    "Console > Agent Tool Config > Health",
    "Centralized health across all enrolled MCP servers and tools, with alert config, latency percentiles and circuit breakers.",
    "health",
    {
      servers: [
        { n: "Billing-Payments", url: "https://…/mcp", st: "Online", up: "99.9%", avg: "142ms", calls: "8,410" },
        { n: "Ticketing", url: "via gateway · gw-ticketing-01", st: "Degraded", up: "98.2%", avg: "310ms", calls: "2,130" },
        { n: "CRM Suite", url: "https://…/mcp", st: "Online", up: "99.7%", avg: "180ms", calls: "4,512" },
        { n: "HR Portal", url: "via gateway · gw-hr-01", st: "Offline", up: "—", avg: "—", calls: "0" }
      ],
      tools: [
        { t: "get_account_balance", sr: "99.6%", p: "95ms / 142ms / 260ms", errs: "12", trend: [10, 12, 9, 11, 13, 12, 14] },
        { t: "list_transactions", sr: "98.7%", p: "120ms / 176ms / 300ms", errs: "31", trend: [8, 9, 7, 10, 9, 11, 10] },
        { t: "issue_refund", sr: "88.5%", p: "300ms / 510ms / 900ms", errs: "42", trend: [3, 4, 5, 6, 4, 5, 6] },
        { t: "get_documents", sr: "99.1%", p: "80ms / 120ms / 200ms", errs: "9", trend: [15, 16, 14, 17, 15, 18, 16] }
      ],
      cb: ["issue_refund — tripped at 09:02 (5 consecutive failures) · Reset"],
      alerts: ["Alert rule: latency > 500ms → email + Slack (issue_refund)", "Alert rule: offline > 5 min → email (HR Portal)"]
    },
    [
      ["Server status grid", "Card per server: name, URL/gateway, status, 30d uptime, avg response, 24h calls. Click → B.3.2."],
      ["Tool-level health", "Success rate, p50/p95/p99 latency, error count, last error, call-volume sparkline. Sort by error rate."],
      ["Alert configuration", "Thresholds (latency / error rate / offline) → email, Slack webhook, in-app."],
      ["Circuit breaker", "Tripped tools/servers shown; Reset re-enables after investigation."]
    ]
  );

  sc("B.3A.5", "Tool Schema Inspector", true, ["MCP-02"],
    "Console > Agent Tool Config > Schema",
    "Interactive schema tree, try-it form, version diff detection, and a preview of how the AI sees the tool.",
    "schema",
    {
      name: "issue_refund",
      json: `{
  "name": "issue_refund",
  "description": "Issue a refund against a billing invoice.",
  "input": {
    "type": "object",
    "required": ["invoiceId", "amount"],
    "properties": {
      "invoiceId":  { "type": "string", "pattern": "^INV-\\d{4}$" },
      "amount":     { "type": "number", "minimum": 0.01, "maximum": 5000 },
      "reason":     { "type": "string", "enum": ["duplicate", "cancelled", "adjustment"] },
      "notifyCustomer": { "type": "boolean", "default": true }
    }
  },
  "output": {
    "type": "object",
    "properties": {
      "refundId": { "type": "string" },
      "status":   { "type": "string", "enum": ["accepted", "pending_approval"] }
    }
  }
}`,
      diff: "v2 → v3: +notifyCustomer (boolean, default true) · +reason.enum.adjustment — no breaking changes for configured payload guidance",
      aiView: "Description override: “Issue a refund to a customer. Amount must not exceed $5,000.”"
    },
    [
      ["Input schema", "Interactive collapsible JSON tree: name, type, required, description, constraints."],
      ["Output schema", "Same tree for the response schema."],
      ["Try it", "Auto-generated form from input schema → call tool → raw JSON + mapping to output schema."],
      ["Version history", "Detect schema changes on re-discovery; diff added/removed/type changes; warn on breaking changes."],
      ["AI agent view", "Preview description + schema used in tool-selection reasoning; edit description override."]
    ]
  );

  window.NEXTBOT_SCREENS = window.NEXTBOT_SCREENS || [];
  Array.prototype.push.apply(window.NEXTBOT_SCREENS, S);
})();