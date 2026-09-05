/* ============================================================
   NextBot Wireframes — Portal B: Admin Console
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

  /* ---------- B.1 Dashboard & Navigation ---------- */

  sc("B.1.1", "Global Navigation Shell", true, ["ADM-01", "ADM-02"],
    "Every authenticated console screen",
    "The persistent shell: collapsible sidebar with all modules, top bar with tenant/environment/search/notifications, and breadcrumb trail.",
    "shell",
    {
      side: [
        { l: "Dashboard", act: true }, { l: "Channels" }, { l: "Connectors (MCP)" },
        { l: "Tool Catalog" }, { l: "Agent Tool Config" }, { l: "Conversations" },
        { l: "Escalations" }, { l: "Approvals" }, { l: "Reports" }, { l: "A2A" }, { l: "Settings" }
      ],
      breadcrumb: "Connectors > Billing-Payments > Tools > issue_refund",
      body: null
    },
    [
      ["Left sidebar", "Collapsible: Dashboard, Channels, Connectors (MCP), Tool Catalog, Agent Tool Config, Conversations, Escalations, Approvals, Reports, A2A, Settings."],
      ["Top bar", "Tenant name/logo, environment badge (Sandbox/Production), global search, notifications bell, user avatar + role + logout."],
      ["Breadcrumb", "Context trail: “Connectors > [Backend] > Tools > [tool_name]”."]
    ]
  );

  sc("B.1.2", "Dashboard Home", true, ["RP-01", "RP-02", "RP-04", "RP-07", "MCP-01", "MCP-05", "MCP-08", "ESC-01"],
    "Console home after login",
    "Operations overview: live KPIs, channel mix, tool-call health, connector status and alerts.",
    "dashboard",
    {
      kpis: [
        { t: "Conversations today", v: "1,284", s: "<span class='trend-up'>▲ 12%</span> vs yesterday", spark: [8, 12, 9, 15, 14, 18, 22] },
        { t: "AI resolution rate", v: "78.4%", s: "<span class='trend-up'>▲ 2.1 pt</span> this week", gauge: 78 },
        { t: "Pending approvals", v: "7", s: "3 high-amount · <a href='#'>View queue →</a>", gauge: null },
        { t: "Active escalations", v: "14", s: "9 Billing · 3 CRM · 2 HRIS", gauge: null }
      ],
      charts: [
        { title: "Channel breakdown", sub: "Conversations by channel · today", donut: [["Web Widget", 38], ["WhatsApp", 23], ["Voice", 14], ["Other", 25]] },
        { title: "Tool call health", sub: "Top 5 tools by volume", tbl: { cols: ["Tool", "Calls", "Success", "Latency"], rows: [["get_account_balance", "1,204", "99.2%", "142ms"], ["list_transactions", "932", "98.7%", "176ms"], ["create_ticket", "341", "96.4%", "230ms"], ["issue_refund", "52", "88.5%", "510ms"], ["get_employee_info", "41", "97.6%", "198ms"]] } },
        { title: "AI cost today", sub: "Credits consumed · daily burn rate", kpi: { v: "$38.40", s: "≈ $0.03 / conversation" } }
      ],
      connectors: [
        { n: "Billing-Payments", st: "g", tools: 12, check: "2 min ago" },
        { n: "Ticketing", st: "a", tools: 9, check: "5 min ago · degraded" },
        { n: "CRM", st: "g", tools: 15, check: "1 min ago" },
        { n: "HRIS", st: "r", tools: 6, check: "Offline — auth expired" }
      ],
      alerts: [
        { sev: "r", text: "HRIS connector offline — auth token expired", at: "09:12" },
        { sev: "a", text: "issue_refund latency above 500ms threshold", at: "09:04" },
        { sev: "a", text: "Rate-limit warning on WhatsApp channel", at: "08:47" }
      ]
    },
    [
      ["Conversations today", "RP-01 · Large number + sparkline trend."],
      ["AI resolution rate", "RP-04 · Percentage gauge + trend arrow."],
      ["Pending approvals", "MCP-05 · Count badge + “View queue” link."],
      ["Active escalations", "ESC-01 · Count + breakdown by backend."],
      ["Channel breakdown", "RP-01 · Donut chart."],
      ["Tool call health", "RP-02 · Top 5 tools: success rate + avg latency."],
      ["AI cost today", "RP-07 · Amount + daily burn rate."],
      ["Connected backends status", "MCP-01 · Card per connector, status dot, last health check, tool count."],
      ["Pending approvals badge", "MCP-05 · Prominent count badge → B.3.6."],
      ["Recent alerts", "MCP-08 · Last 5 alerts, severity-colored → B.8.2."]
    ]
  );

  /* ---------- B.2 Channel Management ---------- */

  sc("B.2.1", "Channel Overview List", true, ["OC-01", "OC-06"],
    "Console > Channels",
    "One row per configured channel with status, 24h volume, and type-specific config actions.",
    "table",
    {
      filter: ["Search channels", "Type: All", "Status: All"],
      cols: ["Channel", "Type", "Status", "Volume (24h)", ""],
      rows: [
        ["Web Widget", "Web Widget", { pill: "g", t: "Active" }, "842", [{ btn: "Configure" }, { link: "Routing Rules" }]],
        ["WhatsApp Business", "WhatsApp", { pill: "g", t: "Active" }, "1,105", [{ btn: "Configure" }, { link: "Routing Rules" }]],
        ["Sales Voice", "Voice", { pill: "a", t: "Degraded" }, "213", [{ btn: "Configure" }, { link: "Routing Rules" }]],
        ["Customer Service Email", "Email", { pill: "g", t: "Active" }, "167", [{ btn: "Configure" }, { link: "Routing Rules" }]],
        ["Instagram DM", "Instagram", { pill: "gray", t: "Inactive" }, "—", [{ btn: "Configure" }, { link: "Routing Rules" }]]
      ],
      actionBtn: "+ Add Channel"
    },
    [
      ["Table", "Name, type (Web Widget / WhatsApp / Messenger / Instagram / Voice / Email / SMS / Slack / Teams / Twitter-X), status, message volume (24h)."],
      ["Actions", "“Configure”, “Disable”, “View Routing Rules” (→ B.2.4)."],
      ["Add button", "“+ Add Channel” → type picker → setup wizard."]
    ]
  );

  sc("B.2.2", "Web Widget Channel Config", true, ["OC-04"],
    "Channels > Web Widget > Configure",
    "Five tabs governing the embeddable widget: general, appearance, quick actions, nudge, and the embed code with live preview.",
    "tabs",
    {
      tabs: [
        { name: "General", fields: [
          { label: "Widget name", ph: "Customer Support Widget" },
          { label: "Description", ph: "Primary support channel for web visitors" },
          { label: "Status", toggle: true, t: "Active" },
          { label: "Allowed domains (CORS)", ph: "app.example.com, www.example.com" }
        ] },
        { name: "Appearance", fields: [
          { label: "Primary color", color: "#1B6B4A" },
          { label: "Launcher icon", ph: "https://…/icon.svg", btn: "Upload" },
          { label: "Header title (EN)", ph: "Support" },
          { label: "Header title (AR)", ph: "الدعم" },
          { label: "Position", sel: true, ph: "Bottom-right" },
          { label: "Mobile behavior", sel: true, ph: "Full-screen overlay" }
        ] },
        { name: "Quick Actions", fields: [
          { label: "Quick action chips", list: ["Check Status → check_status", "New Request → new_request", "Track Case → track_case"], note: "Add / remove / reorder" }
        ] },
        { name: "Proactive Nudge", fields: [
          { label: "Enabled", toggle: true, t: "Yes" },
          { label: "Delay (seconds)", ph: "15" },
          { label: "Message (EN)", ph: "Need help?" },
          { label: "Message (AR)", ph: "هل تحتاج مساعدة؟" }
        ] },
        { name: "Embed Code", embed: true }
      ]
    },
    [
      ["General", "Widget name, description, status toggle, allowed domains (CORS)."],
      ["Appearance", "Primary color, font, launcher icon, multilingual header title, position, mobile behavior."],
      ["Quick Actions", "Ordered chips: label (multilingual) + pre-filled request text. Add/remove/reorder."],
      ["Proactive Nudge", "Enable, delay (s), trigger rules, message (multilingual)."],
      ["Embed Code", "Read-only <script> snippet + copy button + live preview iframe."]
    ]
  );

  sc("B.2.3", "Meta Channel Connector Config", true, ["META-01", "META-02", "META-03", "META-04", "META-05", "META-08", "META-12", "META-13"],
    "Channels > WhatsApp/Messenger > Configure",
    "Meta business linking: Business Manager, WhatsApp WABA + tiers, Messenger/Instagram pages, credentials vault, webhooks, templates and consent log.",
    "tabs",
    {
      tabs: [
        { name: "Business Manager", fields: [
          { label: "Business Manager ID", ph: "11223344556677" },
          { label: "Verification", pill: "g", pt: "Verified — Acme Inc." },
          { btn: "Connect to Meta Business Manager", bl: true }
        ] },
        { name: "WhatsApp", fields: [
          { label: "WABA ID", ph: "104588901234567" },
          { label: "Phone number(s)", ph: "+1 555 000 1234 · verified" },
          { label: "Messaging tier", tier: 3 },
          { label: "24h session window", toggle: true, t: "Enabled" }
        ] },
        { name: "Messenger", fields: [
          { label: "Linked Page", ph: "Acme Support — Page ID 220344" },
          { label: "Page token status", pill: "g", pt: "Valid" }
        ] },
        { name: "Instagram", fields: [
          { label: "Professional account", ph: "@acme.shop · linked" }
        ] },
        { name: "Credentials", fields: [
          { label: "System User token", mask: true, btn: "Rotate Now" },
          { label: "App ID", ph: "334455667788" },
          { label: "App Secret", mask: true, btn: "Rotate Now" },
          { label: "Last rotation", ph: "Jul 02, 2026" }
        ] },
        { name: "Webhook", fields: [
          { label: "Webhook URL", ph: "https://api.nextbot.example/webhooks/meta", readonly: true },
          { label: "Verification status", pill: "g", pt: "Verified" },
          { btn: "Re-verify Challenge", bl: true },
          { label: "Last event received", ph: "Aug 15, 09:03:12 UTC" }
        ] },
        { name: "Templates", tbl: { cols: ["Template", "Language", "Status"], rows: [["order_update", "en", "Approved"], ["refund_confirmation", "en", "Pending"], ["welcome_msg", "ar", "Approved"]], action: "Sync from Meta · Create New" } },
        { name: "Consent / Opt-in", fields: [
          { label: "Opt-in tracking", toggle: true, t: "On" },
          { label: "Consent log", note: "Viewer: masked phone, opt-in date, source, status. Bulk import/export." }
        ] }
      ]
    },
    [
      ["Business Manager", "ID, verification badge, OAuth link button → verified name + ID."],
      ["WhatsApp", "WABA ID, verified phone numbers, Tier 1–4 gauge, 24h session policy toggle."],
      ["Messenger / Instagram", "Linked Page/Professional account + token status."],
      ["Credentials", "System User token (masked, rotate), App ID/Secret via SEC-02 vault. Last rotation date."],
      ["Webhook", "URL, verification token, status badge, Re-verify button, per-event subscriptions."],
      ["Templates", "Registered WA templates: name, language, status, variables. Sync / Create New."],
      ["Consent/Opt-in", "Opt-in toggle + consent log viewer (META-13). Bulk import/export."]
    ]
  );

  sc("B.2.4", "Channel Routing Rules", true, ["OC-06", "META-10"],
    "Channels > Routing Rules",
    "Conditional routing table with a visual rule editor, drag-to-reorder priority and a test-scenario panel.",
    "table",
    {
      filter: ["Channel: All", "Recognized task: All"],
      cols: ["Priority", "Channels", "Condition", "Action", ""],
      rows: [
        ["1", "WhatsApp", "task = payment_dispute", { pill: "a", t: "Redirect to queue" }, [{ link: "Edit" }, { link: "Delete" }]],
        ["2", "All", "time = out-of-hours", { pill: "a", t: "Redirect to queue" }, [{ link: "Edit" }, { link: "Delete" }]],
        ["3", "Web Widget", "segment = VIP", { pill: "g", t: "Allow" }, [{ link: "Edit" }, { link: "Delete" }]],
        ["4", "All", "task = spam", { pill: "r", t: "Deny" }, [{ link: "Edit" }, { link: "Delete" }]]
      ],
      testPanel: true,
      actionBtn: "+ Add Rule"
    },
    [
      ["Rules table", "Channel(s), condition (recognized task / segment / time), action (allow / deny / redirect to queue)."],
      ["Rule editor", "Condition builder: IF channel = X AND recognized task = Y … THEN action."],
      ["Priority order", "Drag-to-reorder. First matching rule wins."],
      ["Test tool", "“Test a scenario”: pick channel + sample utterance → shows which rules fire."]
    ]
  );

  sc("B.2.5", "Voice / IVR Channel Config", true, ["OC-05"],
    "Channels > Voice > Configure",
    "Phone numbers, STT/TTS engines, optional IVR menu tree and failure fallback behavior.",
    "tabs",
    {
      tabs: [
        { name: "Phone Numbers", tbl: { cols: ["Number", "Provider", "Status"], rows: [["+1 555 000 1234", "Twilio", "Active"], ["+971 4 000 0000", "Genesys", "Active"]], action: "+ Add Number" } },
        { name: "STT / TTS", fields: [
          { label: "Speech-to-text engine", sel: true, ph: "Provider A · en-US model" },
          { label: "Confidence threshold", ph: "0.80" },
          { label: "Text-to-speech voice", sel: true, ph: "Female · English (US) · Nova" },
          { label: "Default voice per language", ph: "ar → Female · Arabic" }
        ] },
        { name: "IVR Menu", nodes: "greeting → language → department → DTMF → AI handoff → voicemail" },
        { name: "Fallback", fields: [
          { label: "On voice failure", sel: true, ph: "Queue to human" },
          { label: "Alternative", sel: true, ph: "Voicemail / Callback request" }
        ] }
      ]
    },
    [
      ["Phone Numbers", "Provider (Twilio, Genesys, etc.) + status."],
      ["STT/TTS", "Speech-to-text language models; TTS voice selection (gender, language)."],
      ["IVR Menu", "Optional pre-AI IVR tree — visual tree editor."],
      ["Fallback", "Queue to human, voicemail, or callback request."]
    ]
  );

  /* ---------- B.3 MCP Backend Connector Management ---------- */

  sc("B.3.1", "Connector Overview List", true, ["MCP-01", "ADM-01"],
    "Console > Connectors (MCP)",
    "Every registered MCP server: type, environment, health status, tool count and last health check.",
    "table",
    {
      filter: ["Search connectors", "Type: All", "Env: All", "Status: All"],
      cols: ["Connector", "Backend type", "Environment", "Status", "Tools", "Last health check", ""],
      rows: [
        [{ m: "Billing-Payments", s: "API v3 · Billing/Payments" }, "Billing-Payments", { pill: "b", t: "Production" }, { pill: "g", t: "Connected" }, "12", "2 min ago", [{ btn: "Configure" }, { link: "View Tools" }, { link: "Test" }]],
        [{ m: "Tahseel-agnostic Ticketing", s: "Streamable HTTP" }, "Ticketing", { pill: "b", t: "Production" }, { pill: "a", t: "Degraded" }, "9", "5 min ago", [{ btn: "Configure" }, { link: "View Tools" }, { link: "Test" }]],
        [{ m: "CRM Suite", s: "OAuth2" }, "CRM", { pill: "gray", t: "Sandbox" }, { pill: "g", t: "Connected" }, "15", "1 min ago", [{ btn: "Configure" }, { link: "View Tools" }, { link: "Test" }]],
        [{ m: "HR Portal", s: "via Gateway Agent" }, "HRIS", { pill: "b", t: "Production" }, { pill: "r", t: "Offline" }, "6", "Auth expired", [{ btn: "Configure" }, { link: "View Tools" }, { link: "Test" }]]
      ],
      actionBtn: "+ Add Connector"
    },
    [
      ["Table", "Connector name, backend type (Ticketing/CRM/ERP/Billing-Payments/HRIS/Knowledge Base/Custom), environment, status, tool count, last health check."],
      ["Actions", "“Configure” (B.3.2), “View Tools” (B.3.4), “Test Connection”, “Disable”."],
      ["Add button", "“+ Add Connector” → B.3.3 wizard."],
      ["Status indicators", "Green/amber/red dots. Amber = degraded latency; red = offline / auth expired."]
    ]
  );

  sc("B.3.2", "Connector Detail / Edit", true, ["MCP-01", "MCP-12", "SEC-02"],
    "Connectors > [name] > Configure",
    "Full connector lifecycle: general info, transport + auth, health monitoring, gateway agent (stdio) and per-tool overrides.",
    "tabs",
    {
      tabs: [
        { name: "General", fields: [
          { label: "Name", ph: "Billing-Payments" },
          { label: "Description", ph: "Core billing & payments backend" },
          { label: "Backend type", sel: true, ph: "Billing-Payments" },
          { label: "Environment", env: "Production" }
        ] },
        { name: "Connection", fields: [
          { label: "Transport", sel: true, ph: "Streamable HTTP" },
          { label: "URL", ph: "https://api.billing.example.com/mcp" },
          { label: "Auth method", sel: true, ph: "OAuth2" },
          { label: "Client credentials", mask: true, btn: "Rotate" }
        ] },
        { name: "Health Check", fields: [
          { label: "Ping interval", ph: "60 s" },
          { label: "Timeout threshold", ph: "2 s" },
          { label: "Failure alert recipients", ph: "ops@example.com" },
          { label: "Health history (7d)", health: [95, 98, 100, 88, 96, 99, 97] }
        ] },
        { name: "Gateway Agent (stdio)", fields: [
          { label: "Agent ID", ph: "gw-billing-01" },
          { label: "Tunnel status", pill: "g", pt: "Connected" },
          { label: "Agent version", ph: "1.4.2" }
        ] },
        { name: "Tool Overrides", note: "Per-tool overrides: display names, approval tier overrides, channel restrictions.", tbl: { cols: ["Tool", "Override"], rows: [["issue_refund", "Tier 2 → Tier 3"], ["create_ticket", "Display: 'Open support case'"]] } }
      ]
    },
    [
      ["General", "Name, description, backend type, environment toggle (ADM-05)."],
      ["Connection", "Streamable HTTP (URL, headers) or stdio-via-Gateway-Agent. Auth: OAuth2, API Key, Bearer, Custom Header. Credentials via SEC-02."],
      ["Health Check", "Ping interval, timeout, alert recipients, 7-day history chart."],
      ["Gateway Agent", "Agent ID, heartbeat, tunnel status, version."],
      ["Tool Overrides", "Per-tool config overrides for this connector instance."]
    ]
  );

  sc("B.3.3", "Add Connector Wizard", true, ["MCP-10", "MCP-11"],
    "Connectors > + Add Connector",
    "Six-step onboarding: choose template or custom server, connect, discover tools, set permissions, test, and activate.",
    "wizard",
    {
      steps: [
        { name: "Choose Type", tpl: [
          { logo: "Z", n: "Zendesk", type: "Ticketing", tools: "24 tools", d: "Ticketing + support cases" },
          { logo: "S", n: "Salesforce", type: "CRM", tools: "38 tools", d: "Accounts, opportunities, cases" },
          { logo: "SAP", n: "SAP", type: "ERP", tools: "31 tools", d: "Finance + supply chain" },
          { logo: "J", n: "Jira Service Mgmt", type: "Ticketing", tools: "18 tools", d: "ITSM queues" },
          { logo: "F", n: "Freshdesk", type: "Ticketing", tools: "16 tools", d: "Helpdesk" },
          { logo: "H", n: "HubSpot", type: "CRM", tools: "27 tools", d: "Marketing + CRM" },
          { logo: "✚", n: "Custom MCP Server", type: "Custom", tools: "—", d: "Bring your own Streamable HTTP / stdio server", custom: true }
        ] },
        { name: "Connection Details", fields: [
          { label: "Transport", sel: true, ph: "Streamable HTTP" },
          { label: "Endpoint URL", ph: "https://…/mcp" },
          { label: "Auth method", sel: true, ph: "API Key" },
          { label: "API key", mask: true },
          { label: "Environment", env: "Sandbox" }
        ] },
        { name: "Discover Tools", discover: true, tools: [
          { n: "get_account_balance", d: "Fetch account balance by ID", rw: "Read", on: true },
          { n: "list_transactions", d: "List recent transactions", rw: "Read", on: true },
          { n: "issue_refund", d: "Issue a refund against an invoice", rw: "Write", on: true },
          { n: "get_currency_rates", d: "Live FX rates", rw: "Read", on: false }
        ] },
        { name: "Set Permissions", note: "Per-tool permission defaults + approval tiers by read/write classification.", tbl: { cols: ["Tool", "Default tier", "Channels", "Roles"], rows: [["get_account_balance", "Tier 1 Autonomous", "All", "All"], ["list_transactions", "Tier 1 Autonomous", "All", "All"], ["issue_refund", "Tier 2 Customer Confirmation", "Web, WhatsApp", "Agent, Admin"]] } },
        { name: "Test", test: { tool: "get_account_balance", args: '{ "accountId": "acc_4821" }', result: '{ "balance": 12480.5, "currency": "USD" }' } },
        { name: "Activate", activate: true }
      ]
    },
    [
      ["1 — Choose Type", "Template cards (Zendesk, Salesforce, SAP, Jira SM, Freshdesk, HubSpot, NetSuite, ServiceNow…) or “Custom MCP Server”."],
      ["2 — Connection Details", "Transport, URL/endpoint, credentials. Templates pre-populate; custom validated against JSON schema."],
      ["3 — Discover Tools", "list_tools → discovered list with schemas; admin checks which to enable."],
      ["4 — Set Permissions", "Per-tool defaults (channel/role/task/scope) + approval tiers by read/write."],
      ["5 — Test", "Sandbox panel: pick tool, sample args, execute, view response."],
      ["6 — Activate", "Confirmation + activate in production."]
    ]
  );

  sc("B.3.4", "Tool Catalog", true, ["MCP-02", "MCP-03"],
    "Console > Tool Catalog",
    "Central registry of every tool across all connectors, with rich filters, bulk actions and JSON-schema tool detail.",
    "table",
    {
      filter: ["Connector: All", "Type: Read", "Approval: All", "Status: Enabled"],
      cols: ["Tool", "Connector", "Type", "Approval tier", "Calls (7d)", "Avg latency", "Error rate", ""],
      rows: [
        ["get_account_balance", "Billing-Payments", "Read", { pill: "g", t: "Tier 1" }, "7,210", "142ms", "0.4%", [{ link: "Detail" }]],
        ["list_transactions", "Billing-Payments", "Read", { pill: "g", t: "Tier 1" }, "5,904", "176ms", "0.8%", [{ link: "Detail" }]],
        ["create_ticket", "Ticketing", "Write", { pill: "a", t: "Tier 2" }, "1,120", "230ms", "1.1%", [{ link: "Detail" }]],
        ["issue_refund", "Billing-Payments", "Write", { pill: "r", t: "Tier 3" }, "286", "510ms", "4.2%", [{ link: "Detail" }]],
        ["get_employee_info", "HR Portal", "Read", { pill: "g", t: "Tier 1" }, "221", "198ms", "0.2%", [{ link: "Detail" }]]
      ],
      bulk: "Enable / Disable · Change tier · Export JSON"
    },
    [
      ["Filter bar", "Backend connector, type (Read/Write), approval tier, status."],
      ["Tool table", "Name, connector, description, type, tier, call count (7d), latency, error rate."],
      ["Tool detail", "Full JSON schema (input+output), permissions, approval config, call history, latency chart."],
      ["Bulk actions", "Enable/disable, change tier in bulk, export catalog as JSON."]
    ]
  );

  sc("B.3.5", "Tool Permission Editor", true, ["MCP-04", "SEC-06"],
    "Tool Catalog > Permissions",
    "Scope matrix (tools × channel/role/task/segment) with a rule builder and backend-type permission inheritance.",
    "matrix",
    {
      dims: ["Channel: Web", "Channel: WhatsApp", "Role: Customer", "Role: Agent", "Task: refund", "Task: info"],
      tools: [
        { n: "get_account_balance", cells: ["allow", "allow", "allow", "allow", "allow", "allow"] },
        { n: "list_transactions", cells: ["allow", "allow", "allow", "allow", "req", "allow"] },
        { n: "create_ticket", cells: ["allow", "req", "allow", "allow", "allow", "allow"] },
        { n: "issue_refund", cells: ["req", "req", "deny", "req", "req", "deny"] },
        { n: "get_employee_info", cells: ["deny", "deny", "deny", "allow", "deny", "allow"] }
      ],
      rules: ["IF channel = WhatsApp AND task = refund → Require customer confirmation", "IF task = info AND amount > $500 → Require human approval"]
    },
    [
      ["Scope matrix", "Rows = tools, columns = Channel/Role/Recognized task/Customer Segment. Each cell Allow / Deny / Require Approval."],
      ["Rule builder", "“When [channel = X] AND [recognized task = Y] → [action].”"],
      ["Inheritance", "Default permission per backend type (e.g., Billing writes → Require Customer Confirmation), overridable per tool."]
    ]
  );

  sc("B.3.6", "Approval Queue", true, ["MCP-05", "ADM-04"],
    "Console > Approvals",
    "Pending Tier 2/3 tool-call approvals with full conversation context and Approve / Reject / Request-More-Info actions.",
    "queue",
    {
      cols: ["Time", "Tool", "Backend", "Conversation", "Requested action", "Channel", "Wait"],
      rows: [
        ["09:12", "issue_refund", "Billing-Payments", "conv_88412", "Refund $120.00 · invoice #4521", "Web Widget", "3m"],
        ["09:07", "create_ticket", "Ticketing", "conv_88396", "Open payment dispute case", "WhatsApp", "8m"],
        ["08:58", "update_employee_data", "HR Portal", "conv_88371", "Update personal details", "Web Widget", "17m"]
      ],
      detail: { tool: "issue_refund", args: '{ "invoiceId": "4521", "amount": 120.00, "reason": "duplicate charge" }', goal: "payment_refund", confidence: 0.92 }
    },
    [
      ["Queue list", "Timestamp, tool, backend, initiating conversation, action summary, channel, wait time."],
      ["Approval detail", "Conversation excerpt, recognized goal, tool args (payload), customer identity (if verified)."],
      ["Actions", "Approve (executes call), Reject (AI informs customer), Request More Info (question back into conversation)."]
    ]
  );

  sc("B.3.7", "Connector Instance Config", true, ["MCP-01"],
    "Any connector instance detail",
    "Reusable per-instance screen: general, connection, tools (with tier config), policies and sandbox test.",
    "tabs",
    {
      tabs: [
        { name: "General", fields: [
          { label: "Connector name", ph: "Billing-Payments" },
          { label: "Environment", env: "Production" },
          { label: "Status", pill: "g", pt: "Connected" }
        ] },
        { name: "Connection", fields: [
          { label: "Backend API base URL", ph: "https://api.billing.example.com" },
          { label: "Auth method", sel: true, ph: "OAuth2" },
          { label: "Credentials", mask: true, btn: "Rotate" }
        ] },
        { name: "Tools", tbl: { cols: ["Tool", "Description", "RW", "Approval tier", "Enabled"], rows: [["get_account_balance", "Fetch balance", "Read", "Tier 1", true], ["list_transactions", "List txns", "Read", "Tier 1", true], ["issue_refund", "Issue refund", "Write", "Tier 2", true]] } },
        { name: "Policies", fields: [
          { label: "Default write tier", sel: true, ph: "Tier 2 Customer Confirmation" },
          { label: "Elevated amount threshold", ph: "$500" },
          { label: "Required pre-call tools", ph: "must call list_items before process_action" },
          { label: "Identity verification required", toggle: true, t: "Yes" }
        ] },
        { name: "Test", test: { tool: "list_transactions", args: '{ "accountId": "acc_4821", "limit": 5 }', result: '[ { … } ]' } }
      ]
    },
    [
      ["General", "Connector name, environment, status."],
      ["Connection", "API base URL, auth method, vaulted credentials."],
      ["Tools", "Discovered tools: name, schema, read/write badge, tier, enable toggle."],
      ["Policies", "Default write tier, amount thresholds, required pre-call tools, identity verification."],
      ["Test", "Sandbox test panel scoped to this connector."]
    ]
  );

  window.NEXTBOT_SCREENS = window.NEXTBOT_SCREENS || [];
  Array.prototype.push.apply(window.NEXTBOT_SCREENS, S);
})();