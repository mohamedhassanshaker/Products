/* ============================================================
   NextBot Wireframes — Portal B (continued): Conversations → Security
   ============================================================ */
(function () {
  var S = [];

  function sc(id, title, critical, prd, trigger, blurb, type, data, specRows, notes) {
    S.push({
      id: id, portal: "B", title: title, critical: critical, prd: prd,
      trigger: trigger, blurb: blurb, type: type, data: data || {},
      specRows: specRows || [], notes: notes || []
    });
  }

  /* ---------- B.4 Conversation Management ---------- */

  sc("B.4.1", "Conversation List", true, ["AI-06", "RP-01"],
    "Console > Conversations",
    "Searchable list of all conversations with status, recognized goal, duration and resolution outcome.",
    "table",
    {
      filter: ["Channel: All", "Status: All", "Date range", "Recognized task: All", "Language: All"],
      cols: ["Conversation", "Channel", "Customer", "Last message", "Status", "Goal", "Resolution", ""],
      rows: [
        [{ m: "conv_88412", s: "Started 09:04" }, "Web Widget", "m.hassan**", "Please refund invoice #4521", { pill: "a", t: "Escalated" }, "Refund request", "Human", [{ link: "Open" }]],
        [{ m: "conv_88410", s: "Started 08:57" }, "WhatsApp", "+1 555 *** 1234", "Where is my order?", { pill: "g", t: "Resolved" }, "Order status", "AI", [{ link: "Open" }]],
        [{ m: "conv_88396", s: "Started 08:41" }, "WhatsApp", "+971 50 *** 882", "I want to submit a complaint", { pill: "a", t: "Escalated" }, "Complaint", "Human", [{ link: "Open" }]],
        [{ m: "conv_88371", s: "Started 08:22" }, "Web Widget", "s.khan**", "Track my case NB-2026-04571", { pill: "g", t: "Resolved" }, "Case tracking", "AI", [{ link: "Open" }]]
      ],
      bulk: "Export · Tag · Archive"
    },
    [
      ["Filter bar", "Channel, status, date range, recognized task, backend, language."],
      ["Table", "ID, channel icon, customer identifier, last message preview, status, recognized goal, duration, resolution (AI/Human/Abandoned)."],
      ["Bulk actions", "Export, tag, archive."]
    ]
  );

  sc("B.4.2", "Conversation Detail / Trace Viewer", true, ["RP-08", "MCP-06", "MCP-07"],
    "Conversations > conv_88412",
    "The most information-dense screen: transcript with reasoning blocks, tool-call timeline, context panel and raw event log.",
    "trace",
    {
      left: [
        { kind: "msg", who: "Customer", text: "Please refund invoice #4521, I was charged twice." },
        { kind: "ai", who: "AI", text: "I can help with that. Let me verify the invoice and your account first.", conf: 0.94, goal: "payment_refund" },
        { kind: "tool", who: "AI", tool: "billing.get_account_balance", ok: true, lat: "142ms" },
        { kind: "tool", who: "AI", tool: "billing.list_transactions", ok: true, lat: "176ms" },
        { kind: "ai", who: "AI", text: "I found a duplicate charge on invoice #4521. Shall I initiate a refund of $120.00?", conf: 0.9, goal: "payment_refund", ref: "billing.list_transactions" },
        { kind: "msg", who: "Customer", text: "Yes, please." },
        { kind: "tool", who: "AI", tool: "billing.issue_refund", ok: false, err: "Needs Tier 3 approval — escalated to human" },
        { kind: "msg", who: "System", text: "Connecting you with a support agent…" }
      ],
      mid: [
        { tool: "get_account_balance", be: "Billing-Payments", ok: true, lat: "142ms", args: '{"accountId":"acc_4821"}' },
        { tool: "list_transactions", be: "Billing-Payments", ok: true, lat: "176ms", args: '{"accountId":"acc_4821","limit":10}' },
        { tool: "issue_refund", be: "Billing-Payments", ok: false, lat: "510ms", args: '{"invoiceId":"4521","amount":120}' }
      ],
      right: {
        cust: { name: "M. Hassan", id: "usr_2201", verified: true },
        meta: [["Channel", "Web Widget"], ["Language", "en"], ["Session vars", "8"], ["Confidence trend", "0.94 → 0.90"]],
        escal: "ESC-0142 · Billing Support queue"
      },
      replay: true
    },
    [
      ["Left: Transcript", "Full timeline with sender labels; per-AI-message reasoning expandable (recognized goal + chosen tool + constructed payload); inline tool-call cards (name, backend, JSON, latency, status)."],
      ["Center: Tool Call Timeline", "Every MCP call: args/output JSON, latency, status. Click → highlights conversation message."],
      ["Right: Context Panel", "Customer info, linked accounts, channel metadata, session vars, escalation history, A2A task links."],
      ["Bottom: Raw Event Log", "Collapsible JSON of every event — filterable, searchable."],
      ["AI confidence gauge", "Per-message colored bar (green >0.85, amber 0.60–0.85, red <0.60) + trend sparkline. Confidence refers to the recognized goal and tool-selection reasoning."],
      ["Replay", "“Replay in Test Console” → opens E.1.5 with inputs pre-loaded."]
    ]
  );

  /* ---------- B.5 Escalation Management ---------- */

  sc("B.5.1", "Escalation Queue", true, ["ESC-01", "ESC-03"],
    "Console > Escalations",
    "SLA-aware queue of escalations awaiting human pickup with Take Over / Reassign / Return to Bot.",
    "queue",
    {
      cols: ["Conversation", "Channel", "Customer", "Goal", "Reason", "Wait", "Queue", ""],
      rows: [
        ["conv_88412", "Web Widget", "m.hassan**", "Refund request", "Tool failure (T3)", "3m", "Billing Support", [{ btn: "Take Over" }, { link: "Reassign" }]],
        ["conv_88396", "WhatsApp", "+971 50 *** 882", "Complaint", "Customer request", "8m", "Support", [{ btn: "Take Over" }, { link: "Reassign" }]],
        ["conv_88350", "Web Widget", "s.khan**", "HR inquiry", "Sensitive topic", "14m", "HR", [{ btn: "Take Over" }, { link: "Reassign" }]]
      ]
    },
    [
      ["Queue list", "Conversation, channel, customer, recognized goal, reason (low confidence / tool failure / request / sensitive), wait time, backend queue."],
      ["Priority sorting", "SLA-aware: longest wait first + priority overrides."],
      ["Actions", "“Take Over” (B.5.2), “Reassign”, “Return to Bot” (ESC-04)."]
    ]
  );

  sc("B.5.2", "Live Agent Takeover Panel", true, ["ESC-02", "ESC-01", "AI-08"],
    "Escalations > Take Over",
    "The agent's working screen: live conversation with AI draft suggestions, context summary, manual tool calls and actions bar.",
    "trace",
    {
      left: [
        { kind: "tool", who: "AI", tool: "billing.issue_refund", ok: false, err: "Needs Tier 3 approval" },
        { kind: "msg", who: "System", text: "Connecting you with a support agent…" },
        { kind: "msg", who: "Agent", text: "Hi M., I can see the duplicate charge. I'll process the refund now.", agent: true },
        { kind: "draft", who: "AI draft", text: "Could you confirm your billing address for the refund?", editable: true }
      ],
      mid: [],
      right: {
        cust: { name: "M. Hassan", id: "usr_2201", verified: true },
        summary: "Goal payment_refund · confidence 0.90 · 2 tool calls made · 1 failed (T3)",
        tools: [
          { t: "billing.issue_refund", tier: "T3" },
          { t: "billing.list_transactions", tier: "T1" },
          { t: "ticketing.create_ticket", tier: "T2" }
        ],
        actions: ["Resolve & Close", "Transfer to queue", "Return to Bot", "Create Case"]
      },
      replay: false
    },
    [
      ["Conversation panel", "Live thread; AI-generated draft reply as editable suggestion (AI-08); tool-call context cards inline."],
      ["Context panel", "AI summary, recognized goal + extracted parameters, tool calls made, confidence badge, customer info, linked accounts."],
      ["Tool panel", "Manual MCP tool calls with permissions — from Agent Tool Registry (B.3A.1)."],
      ["Actions bar", "“Resolve & Close”, “Transfer to [queue]”, “Return to Bot”, “Create Case”."]
    ]
  );

  sc("B.5.3", "Escalation Routing Config", true, ["ESC-03"],
    "Console > Escalations > Routing",
    "Map escalation rules and backend queues; default fallback destination.",
    "table",
    {
      cols: ["IF goal", "IF channel", "→ Route to", ""],
      rows: [
        ["Refund request", "All", "Billing Support queue (Zendesk group: billing)", [{ link: "Edit" }]],
        ["Complaint", "All", "Support queue", [{ link: "Edit" }]],
        ["HR inquiry", "All", "HR queue (Jira SM: hr-services)", [{ link: "Edit" }]]
      ],
      fallback: "Default destination: General Support queue",
      actionBtn: "+ Add Rule"
    },
    [
      ["Rules table", "IF recognized goal = X AND channel = Y → route to queue Z."],
      ["Backend queue mapping", "Map NextBot destinations to backend queues/groups (Zendesk group, Jira SM queue)."],
      ["Fallback rule", "Default destination when no rule matches."]
    ]
  );

  /* ---------- B.6 A2A ---------- */

  sc("B.6.1", "Agent Card Editor", false, ["A2A-01"],
    "Console > A2A > Agent Card",
    "Publish the platform's agent card: capabilities, auth, and publishing targets.",
    "tabs",
    {
      tabs: [
        { name: "Card Preview", json: `{
  "agentId": "nextbot@nextbot.example",
  "capabilities": ["task_completion", "tool_execution"],
  "auth": { "scheme": "oauth2", "audience": "https://nextbot.example" },
  "supportedTaskTypes": ["refund", "ticket_lookup", "hr_request"]
}` },
        { name: "Capabilities", fields: [
          { label: "Task completion", toggle: true, t: "On" },
          { label: "Tool execution", toggle: true, t: "On" },
          { label: "Conversation handoff", toggle: true, t: "Off" }
        ] },
        { name: "Publishing Targets", fields: [
          { label: "Self-hosted well-known URI", toggle: true, t: "Always on" },
          { label: "Private registry", ph: "URL + credentials" },
          { label: "Public marketplace", ph: "URL + credentials (SEC-07 trust config)" }
        ] }
      ]
    },
    [
      ["Card preview", "JSON of published agent card (capabilities, auth, task types)."],
      ["Capabilities toggle", "Which NextBot capabilities external agents may invoke."],
      ["Publishing targets", "Self-hosted well-known URI (always on), private registry, public marketplace (behind SEC-07)."]
    ]
  );

  sc("B.6.2", "Trusted Agents List", false, ["A2A-05", "SEC-07"],
    "Console > A2A > Trusted Agents",
    "Registered external agents with trust levels and credential rotation.",
    "table",
    {
      filter: ["Search agents", "Trust: All"],
      cols: ["Agent", "Identity URI", "Auth", "Trust level", "Last activity", "Status", ""],
      rows: [
        ["billing-partner-agent", "https://partner.example/agent.json", "OAuth2", { pill: "g", t: "Full" }, "3 min ago", { pill: "g", t: "Active" }, [{ link: "Edit" }, { link: "Revoke" }]],
        ["hr-portal-agent", "https://hr.example/.well-known/agent.json", "API key", { pill: "a", t: "Restricted" }, "1 h ago", { pill: "g", t: "Active" }, [{ link: "Edit" }, { link: "Revoke" }]]
      ],
      actionBtn: "+ Add Agent"
    },
    [
      ["Table", "Agent name, identity URI, auth (OAuth2/API key), trust level (full/restricted), last activity, status."],
      ["Actions", "“Add Agent”, “Edit Permissions”, “Revoke Trust”, “Rotate Credentials”."]
    ]
  );

  sc("B.6.3", "A2A Task Monitor", false, ["A2A-04", "A2A-06", "RP-05"],
    "Console > A2A > Tasks",
    "Inbound/outbound A2A tasks with full payloads and status history.",
    "table",
    {
      filter: ["Direction: All", "Status: All"],
      cols: ["Task ID", "Direction", "Agent", "Status", "Linked conversation", "Updated", ""],
      rows: [
        ["t_8841", "Inbound", "billing-partner-agent", { pill: "g", t: "Completed" }, "conv_88412", "09:02", [{ link: "Detail" }]],
        ["t_8839", "Outbound", "hr-portal-agent", { pill: "a", t: "Input-required" }, "conv_88350", "08:55", [{ link: "Detail" }]],
        ["t_8832", "Inbound", "billing-partner-agent", { pill: "g", t: "Working" }, "conv_88321", "08:30", [{ link: "Detail" }]]
      ]
    },
    [
      ["Task list", "Task ID, direction, requesting/target agent, status, linked conversation, timestamps."],
      ["Task detail", "Full payload, status history timeline, linked MCP calls, result payload."]
    ]
  );

  /* ---------- B.7 Reporting ---------- */

  sc("B.7.1", "Channel Performance Report", true, ["RP-01", "RP-04"],
    "Reports > Channel Performance",
    "Volume, resolution, handling time, abandonment and AI deflection by channel.",
    "report",
    {
      filters: ["Date range: Last 30 days", "Channels: All", "Language: All"],
      kpis: [
        { t: "Conversations", v: "31,840", s: "<span class='trend-up'>▲ 8%</span> MoM" },
        { t: "Resolution rate", v: "82.1%", s: "<span class='trend-up'>▲ 3.4 pt</span>" },
        { t: "Avg handling time", v: "4m 12s", s: "<span class='trend-dn'>▼ 18s</span>" },
        { t: "Abandonment rate", v: "6.8%", s: "steady" }
      ],
      charts: [
        { title: "Volume over time", sub: "Conversations per day", bars: [40, 55, 48, 62, 58, 70, 82, 76, 90, 85, 96, 108], stacked: false },
        { title: "AI deflection by channel", sub: "% resolved by AI vs. escalated", bars: [[78, 22], [84, 16], [61, 39], [72, 28]], labels: ["Web", "WhatsApp", "Voice", "Email"], stacked: true }
      ]
    },
    [
      ["Filters", "Date range, channels, language."],
      ["Metrics", "Volume, resolution rate, avg handling time, abandonment, CSAT."],
      ["AI deflection by channel", "Bar chart: AI-resolved % vs escalated %; drill-down to escalation-driving goals/tasks."],
      ["Visualization", "Line chart (volume over time), bar chart (by channel), table with drill-down."]
    ]
  );

  sc("B.7.2", "Tool Call Analytics", true, ["RP-02"],
    "Reports > Tool Call Analytics",
    "Tool-call volume, success, latency percentiles and error breakdown.",
    "report",
    {
      filters: ["Date range: Last 30 days", "Backend: All", "Tool: All", "Outcome: All"],
      kpis: [
        { t: "Total calls", v: "1.24M", s: "<span class='trend-up'>▲ 12%</span>" },
        { t: "Success rate", v: "98.1%", s: "target ≥ 99%" },
        { t: "p95 latency", v: "340ms", s: "<span class='trend-dn'>▼ 22ms</span>" },
        { t: "Failed calls", v: "23,580", s: "1.9% of total" }
      ],
      charts: [
        { title: "Call volume trend", sub: "Tool calls per day", bars: [88, 92, 85, 98, 104, 110, 102, 118, 112, 124, 121, 132], stacked: false },
        { title: "Latency distribution (p50 / p95 / p99)", sub: "By tool", bars: [[142, 260, 400], [176, 340, 510], [230, 420, 640], [510, 900, 1300]], labels: ["get_account_balance", "list_transactions", "create_ticket", "issue_refund"], stacked: false }
      ]
    },
    [
      ["Filters", "Date range, backend, tool, outcome."],
      ["Metrics", "Call volume, success rate, avg latency (p50/p95/p99), error breakdown."],
      ["Per-tool detail", "Latency histogram, error breakdown, volume trend, top-calling goals/tasks."],
      ["Visualization", "Heatmap (tools × time), latency distribution, error rate trend."]
    ]
  );

  sc("B.7.3", "Goal / Capability Coverage Report", true, ["RP-03"],
    "Reports > Goal Coverage",
    "AI-resolved % per recognized goal/capability with escalation gap analysis and suggested improvements.",
    "report",
    {
      filters: ["Date range: Last 30 days"],
      charts: [],
      tbl: {
        cols: ["Goal / capability", "Occurrences", "AI-resolved", "Escalated", "Esc. target", "Avg confidence"],
        rows: [
          ["Order status", "8,412", "94.2%", "5.8%", "—", "0.91"],
          ["Refund request", "1,288", "61.0%", "39.0%", "Billing-Payments", "0.78"],
          ["Complaint", "642", "45.2%", "54.8%", "Support queue", "0.71"],
          ["Case tracking", "4,210", "96.8%", "3.2%", "—", "0.93"]
        ]
      },
      gaps: ["Refund request → 39% escalation. Suggest: add Tier 2 approval path + better tool description (B.3A.5).", "Complaint → 55% escalation. Suggest: dedicated complaint playbook (C.1.2) + sentiment guardrail."]
    },
    [
      ["Table", "Goal/capability, occurrences, AI-resolved %, escalated %, escalation target backend, avg confidence."],
      ["Gap analysis", "Heatmap goals × channels; highlight > 30% escalation; top reasons + suggested improvements (new tools, better descriptions, playbooks)."]
    ]
  );

  sc("B.7.4", "AI Cost Report", true, ["RP-07", "AI-12"],
    "Reports > AI Cost",
    "Token/credit consumption, per goal/capability/tool and per-backend breakdown, budget controls.",
    "report",
    {
      filters: ["Date range: This month"],
      kpis: [
        { t: "Total AI credits", v: "12,440", s: "≈ $124.40" },
        { t: "Cost per resolved conv", v: "$0.031", s: "<span class='trend-dn'>▼ $0.004</span>" },
        { t: "Budget utilization", v: "62%", s: "monthly cap $200" }
      ],
      charts: [
        { title: "Burn-rate projection", sub: "Credits per day vs. cap", bars: [280, 310, 300, 340, 360, 355, 380, 420, 410, 445, 470, 500], stacked: false, cap: true },
        { title: "Cost by backend", sub: "AI reasoning tokens consumed per backend", donut: [["Billing", 34], ["CRM", 28], ["Ticketing", 22], ["Other", 16]] }
      ],
      budget: "Monthly cap $200 · alerts at 80% / 90% / 100% · auto-throttle when exceeded"
    },
    [
      ["Metrics", "Total credits/tokens, cost per resolved conversation, by channel, by backend, budget utilization gauge."],
      ["Breakdown", "Cost per goal/capability/tool, per backend; burn-rate projection."],
      ["Budget controls", "Monthly cap, alert thresholds (80/90/100%), auto-throttle policy, alert history."]
    ]
  );

  sc("B.7.5", "SLA Compliance Report", false, ["RP-06", "TCK-07"],
    "Reports > SLA Compliance",
    "Passthrough metrics from the connected ticketing system.",
    "report",
    {
      filters: ["Ticketing source: Zendesk"],
      kpis: [
        { t: "SLA breach rate", v: "4.2%", s: "<span class='trend-up'>▲ 0.6 pt</span>" },
        { t: "Avg first response", v: "22m", s: "SLA: 1h" },
        { t: "Avg resolution", v: "8h 14m", s: "SLA: 24h" }
      ],
      charts: [
        { title: "Breach rate by priority", sub: "Passthrough from ticketing system", bars: [[1, 4], [3, 6], [9, 4], [14, 2]], labels: ["P1", "P2", "P3", "P4"], stacked: true }
      ]
    },
    [
      ["Data source", "Pulled from connected ticketing system (passthrough, not native)."],
      ["Metrics", "SLA breach rate, avg first response, avg resolution — by priority level."]
    ]
  );

  sc("B.7.6", "A2A Task Report", false, ["RP-05"],
    "Reports > A2A Tasks",
    "Inbound/outbound A2A volume, completion and failure reasons.",
    "report",
    {
      filters: ["Date range: Last 30 days"],
      kpis: [
        { t: "Task volume", v: "1,204", s: "642 inbound · 562 outbound" },
        { t: "Completion rate", v: "93.8%", s: "<span class='trend-up'>▲ 1.2 pt</span>" },
        { t: "Avg duration", v: "41s", s: "per task" }
      ],
      charts: [
        { title: "Inbound vs. outbound", sub: "Task volume per week", bars: [120, 135, 128, 150], stacked: false }
      ]
    },
    [
      ["Metrics", "Inbound/outbound volume, completion rate, avg duration, failure reasons."]
    ]
  );

  /* ---------- B.8 Settings & Security ---------- */

  sc("B.8.1", "User & Role Management", true, ["ADM-02", "SEC-03"],
    "Settings > Users & Roles",
    "User table, granular role editor with module permissions, SSO and MFA enforcement.",
    "tabs",
    {
      tabs: [
        { name: "Users", tbl: { cols: ["Name", "Email", "Roles", "Last login", "MFA", ""], rows: [["A. Rahman", "a.rahman@…", "Admin", "Aug 15, 09:01", "On", [{ btn: "Edit" }]], ["S. Khan", "s.khan@…", "Agent · Approver", "Aug 14, 18:22", "On", [{ btn: "Edit" }]], ["D. Park", "d.park@…", "Viewer", "Aug 12, 11:03", "Off", [{ btn: "Edit" }]]], action: "+ Add User" } },
        { name: "Roles", matrix: "module permissions: Channel config RW · Connector config RW · Tool permissions RW · Agent tool config RW · Approvals R · Reports R · A2A R" },
        { name: "SSO", fields: [
          { label: "Provider", sel: true, ph: "SAML 2.0" },
          { label: "IdP URL", ph: "https://idp.example.com/saml" },
          { label: "Client ID / secret", mask: true },
          { label: "Group mapping", ph: "nextbot-admin → Admin role" }
        ] },
        { name: "MFA", fields: [
          { label: "Require 2-step verification", sel: true, ph: "For roles: Admin, Agent" }
        ] }
      ]
    },
    [
      ["User table", "Name, email, role(s), last login, MFA status."],
      ["Role editor", "Granular permissions: channel config, connector config, tool permissions, agent tool config, approvals, reporting, A2A. Read/Write/None per module."],
      ["SSO config", "SAML/OAuth2 IdP, client ID/secret, attribute + group mapping."],
      ["MFA enforcement", "Per-role toggle requiring 2-step verification."]
    ]
  );

  sc("B.8.2", "Audit Log Viewer", true, ["ADM-03", "MCP-06"],
    "Settings > Audit Log",
    "Every config change, tool call, login, escalation, A2A task and approval decision.",
    "table",
    {
      filter: ["Date range", "Actor: All", "Action: All", "Event: All"],
      cols: ["Timestamp", "Actor", "Action", "Target", "Outcome", "Details", ""],
      rows: [
        ["09:12:04", "AI agent", "Tool call", "billing.issue_refund", { pill: "a", t: "Pending" }, "Tier 3 · awaiting approval", [{ link: "Open" }]],
        ["09:10:51", "A. Rahman", "Config change", "Channel: WhatsApp", { pill: "g", t: "Success" }, "Routing rule updated", [{ link: "Open" }]],
        ["09:05:12", "System", "Login", "user a.rahman@…", { pill: "g", t: "Success" }, "MFA verified", [{ link: "Open" }]],
        ["08:58:30", "AI agent", "A2A task", "t_8839", { pill: "r", t: "Failure" }, "Input required", [{ link: "Open" }]]
      ],
      bulk: "Export CSV / JSON"
    },
    [
      ["Log table", "Timestamp, actor (user/system/AI), action type, target, details (collapsible JSON), outcome."],
      ["Filters", "Date range, actor, action, event type, target. Full-text search."],
      ["Detail drawer", "PII-masked payloads, linked conversation/A2A IDs."],
      ["Export", "CSV / JSON download."]
    ]
  );

  sc("B.8.3", "Environment Management", true, ["ADM-05"],
    "Settings > Environments",
    "Sandbox / Staging / Production per connector with promote-to-production flow.",
    "table",
    {
      cols: ["Environment", "Connectors", "Status", ""],
      rows: [
        ["Sandbox", "All (4)", { pill: "g", t: "Healthy" }, []],
        ["Staging", "All (4)", { pill: "g", t: "Healthy" }, []],
        ["Production", "Billing-Payments · Ticketing · HR Portal", { pill: "a", t: "1 degraded" }, [{ btn: "Promote from Staging" }]]
      ]
    },
    [
      ["Environment list", "Sandbox, Staging, Production — per connected backend."],
      ["Per-connector toggle", "Current environment shown; “Promote to Production” with confirmation."]
    ]
  );

  sc("B.8.4", "Data Residency & Retention", true, ["ADM-06", "SEC-05"],
    "Settings > Data & Retention",
    "Storage region, retention policies, and GDPR data subject tooling.",
    "tabs",
    {
      tabs: [
        { name: "Storage", fields: [
          { label: "Storage region", sel: true, ph: "UAE" }
        ] },
        { name: "Retention", fields: [
          { label: "Conversation transcripts", ph: "180 days" },
          { label: "Tool call payloads", ph: "90 days" },
          { label: "Tool call metadata only", ph: "365 days" },
          { label: "PII auto-purge", ph: "30 days" }
        ] },
        { name: "Data Subject Requests", note: "Process DSR: search by customer identifier → view all data → export → delete." }
      ]
    },
    [
      ["Storage region", "Configurable regions (UAE, EU, US)."],
      ["Retention policies", "Transcripts, tool-call payloads, metadata-only, PII purge — per X days."],
      ["GDPR tools", "“Process Data Subject Request”: search, view, export, delete."]
    ]
  );

  sc("B.8.5", "Credential Vault", true, ["SEC-02"],
    "Settings > Credential Vault",
    "Masked credentials with rotate/revoke/usage actions — never readable in plaintext.",
    "table",
    {
      filter: ["Type: All"],
      cols: ["Credential", "Associated with", "Type", "Created", "Last rotated", "Expiry", ""],
      rows: [
        ["oauth_billing_prod", "Billing-Payments", "OAuth Token", "Mar 01", "Jul 02, 2026", "Jan 02, 2027", [{ link: "Rotate" }, { link: "Revoke" }, { link: "Usage" }]],
        ["wa_system_user", "WhatsApp channel", "System User Token", "Feb 14", "Jun 10, 2026", "Never", [{ link: "Rotate" }, { link: "Revoke" }, { link: "Usage" }]],
        ["apikey_ticketing", "Ticketing", "API Key", "Jan 05", "Jan 05, 2026", "Dec 31, 2026", [{ link: "Rotate" }, { link: "Revoke" }, { link: "Usage" }]]
      ]
    },
    [
      ["Credential list", "Name, associated connector/channel, type, created, last rotated, expiry."],
      ["Actions", "“Rotate”, “Revoke”, “View Usage”."],
      ["No plaintext", "Always masked — rotatable, never readable."]
    ]
  );

  window.NEXTBOT_SCREENS = window.NEXTBOT_SCREENS || [];
  Array.prototype.push.apply(window.NEXTBOT_SCREENS, S);
})();