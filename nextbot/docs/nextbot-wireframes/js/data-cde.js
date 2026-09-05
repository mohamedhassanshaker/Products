/* ============================================================
   NextBot Wireframes — Portals C (Designer), D (Agent Bridge), E (Developer)
   + Interactive Stories
   ============================================================ */
(function () {
  var S = [];

  function sc(id, title, portal, critical, prd, trigger, blurb, type, data, specRows, notes) {
    S.push({
      id: id, portal: portal, title: title, critical: critical, prd: prd,
      trigger: trigger, blurb: blurb, type: type, data: data || {},
      specRows: specRows || [], notes: notes || []
    });
  }

  /* ---------- PORTAL C — Conversation Designer Studio ---------- */

  sc("C.1.1", "Capability & Tool Catalog", "C", true, ["AI-01", "AI-09"],
    "Designer > Capabilities",
    "Curate capability groups, tool descriptions, parameter schemas and selection guidance. The agent reads these at runtime — no intent classification.",
    "tabs",
    {
      tabs: [
        { name: "Capabilities", tbl: { cols: ["Capability", "Category", "Tools", "Guidance", "Status", ""], rows: [["order_status", "Orders", "get_order_status", "Use when the user asks about a delivery or order progress", "Active", [{ btn: "Edit" }]], ["payment_refund", "Payments", "issue_refund, get_invoice", "Use for refund requests; confirm reason before calling issue_refund", "Active", [{ btn: "Edit" }]], ["case_status", "Cases", "get_case_status", "Use when the user tracks a support ticket", "Active", [{ btn: "Edit" }]]], action: "+ New Capability" } },
        { name: "Auto-Suggested", note: "AI-09 self-learning loop — mined from unhandled conversations to improve tool coverage and descriptions.", suggest: [
          { n: "invoice_download", occ: "142", reason: "Users ask for invoice PDFs — no tool currently handles it", accept: ["Add Tool", "Improve Description", "Dismiss"] },
          { n: "service_outage", occ: "87", reason: "Outage messages — KB lookup underperforms", accept: ["Add Tool", "Improve Description", "Dismiss"] }
        ] },
        { name: "Tool / Prompt Editor", fields: [
          { label: "Name", ph: "issue_refund" },
          { label: "Category", sel: true, ph: "Payments" },
          { label: "Runtime description", ta: true },
          { label: "Selection guidance", ta: true },
          { label: "Parameter validation hints", ph: "invoiceId: regex ^INV-\\d{4}$ (required) · amount: number > 0" },
          { label: "Priority weight", ph: "55" }
        ] }
      ]
    },
    [
      ["Capability list", "Capability, category, enrolled tools, runtime guidance text, status."],
      ["Capability editor", "Name, description, runtime guidance the agent reads when choosing tools, parameter validation hints, priority weight."],
      ["Auto-suggested improvements", "AI-09 panel mining unhandled goals to suggest new tools or better descriptions — Accept / Improve / Dismiss."],
      ["Selection guidance", "Guides tool-selection reasoning (B.3A.1) — supplements the agent's autonomous choice from descriptions + schemas."]
    ]
  );

  sc("C.1.2", "Dialogue Flow Designer", "C", true, ["AI-01", "AI-02", "AI-03"],
    "Designer > Flows",
    "Optional agent playbooks — visual node graph the agent may follow when it recognizes the task; Call Tool nodes build payloads from the tool schema.",
    "workflow",
    {
      demo: [
        { kind: "start", nt: "Start", name: "When: user requests a refund over $500", cls: "start" },
        { kind: "ai", nt: "AI Message", name: "Ask reason (multilingual)", cls: "ai" },
        { kind: "tool", nt: "Call Tool", name: "billing.get_invoice", cls: "tool", tag: "T1" },
        { kind: "cond", nt: "Condition", name: "IF amount > $500", cls: "cond" },
        { kind: "tool", nt: "Call Tool", name: "billing.issue_refund", cls: "tool", tag: "T3" },
        { kind: "human", nt: "Human Handoff", name: "→ Billing Support queue", cls: "human" },
        { kind: "ai", nt: "AI Message", name: "Confirmation + next steps", cls: "ai" }
      ],
      library: ["Inquiry", "Request Submission", "Status Check", "Complaint", "Multi-Backend Workflow"],
      guardrails: ["Max write-value: $500 · Disallowed topics: · Mandatory handover: payment_refund"]
    },
    [
      ["Playbook trigger", "Flows are optional. A natural-language condition (e.g., “when the user requests a refund over $500”) decides whether the agent follows the playbook — no declared-intent matching."],
      ["Canvas", "Node graph: Start, AI Message, Confirm Parameter, Call Tool, Condition, Human Handoff, End."],
      ["Node config", "Message text (multilingual), parameter to confirm, tool (searchable, approval-tier badge), condition, handoff target."],
      ["Call Tool node", "Auto-populates the tool payload from the tool's JSON schema (B.3A.1) using agent-extracted parameters; shows tier badge; maps outputs to flow variables."],
      ["Flow library", "Templates by use case (Inquiry, Request, Status Check, Complaint, Multi-Backend)."],
      ["Guardrails panel", "Max write-values, disallowed topics, mandatory handover triggers."],
      ["Inline test console", "Type a message → agent recognizes the task → traverse nodes → tool payload from schema → mock tool responses → final AI response."],
      ["Publish workflow", "Draft → Staging → Production with version history + rollback."]
    ]
  );

  sc("C.1.3", "Parameter Validation & Extraction Hints", "C", true, ["AI-01"],
    "Designer > Parameters",
    "Reusable validation hints (regex/enum/format) applied to the parameters the agent extracts at runtime — no slot-filling.",
    "tabs",
    {
      tabs: [
        { name: "Validation Rules", tbl: { cols: ["Rule", "Type", "Used by tools", "Status", ""], rows: [["invoice_id", "regex", "3", "Active", [{ btn: "Edit" }]], ["amount", "number", "2", "Active", [{ btn: "Edit" }]], ["issue_category", "enum", "4", "Active", [{ btn: "Edit" }]], ["due_date", "date", "1", "Active", [{ btn: "Edit" }]]], action: "+ New Rule" } },
        { name: "System Entities", note: "Pre-built: date, time, number, currency, phone, email, national ID (configurable pattern per country)." },
        { name: "Editor", fields: [
          { label: "Name", ph: "invoice_id" },
          { label: "Type", sel: true, ph: "regex" },
          { label: "Validation rule", ph: "^INV-\\d{4}$" },
          { label: "Synonyms (multilingual)", ta: true },
          { label: "Sample values", ph: "INV-4521, INV-8830" }
        ] }
      ]
    },
    [
      ["Validation rule list", "Name, type (free text/enum/regex/date/number/phone/email), used-by-tools count."],
      ["Rule editor", "Name, type, validation rule, multilingual synonyms, sample values."],
      ["System entities", "Date, time, number, currency, phone, email, national ID (per-country pattern)."],
      ["Runtime behavior", "The agent extracts parameters from free text; these rules validate and normalize the values before the tool payload is built."]
    ]
  );

  sc("C.1.4", "Guardrail / Safety Rules Editor", "C", true, ["AI-10", "AI-11"],
    "Designer > Guardrails",
    "Rules that filter spam, gate capabilities, enforce amount thresholds, block PII and flag sensitive topics.",
    "table",
    {
      cols: ["Rule", "Type", "Status", "Condition", ""],
      rows: [
        ["Mask card numbers", "PII block", { pill: "g", t: "Active" }, "IF input contains credit card number → mask + warn", [{ link: "Edit" }]],
        ["High-amount escalation", "Amount threshold", { pill: "g", t: "Active" }, "IF task = refund AND amount > $500 → escalate to human", [{ link: "Edit" }]],
        ["Spam filter", "Spam filter", { pill: "g", t: "Active" }, "IF repeated identical messages > 3 → gate", [{ link: "Edit" }]],
        ["Sensitive topic flag", "Sensitive topic", { pill: "gray", t: "Inactive" }, "IF topic = harassment → flag conversation", [{ link: "Edit" }]]
      ],
      actionBtn: "+ Add Rule"
    },
    [
      ["Rules table", "Name, type (Spam filter / Capability gate / Amount threshold / PII block / Sensitive topic), status."],
      ["Rule editor", "Condition builder: IF [input contains card] → [mask + warn]; IF [recognized task + amount > threshold] → [escalate]."]
    ]
  );

  sc("C.1.5", "Knowledge Base Config", "C", true, ["KB-01"],
    "Designer > Knowledge Base",
    "Connected KB sources, article browsing and sync status.",
    "tabs",
    {
      tabs: [
        { name: "Sources", tbl: { cols: ["Source", "Type", "Articles", "Last sync", "Status", ""], rows: [["FAQ database", "Internal", "1,204", "Today 08:00", "✓ Synced", [{ btn: "Re-sync" }]], ["Policies docs", "Uploaded", "38", "Today 08:00", "✓ Synced", [{ btn: "Re-sync" }]], ["Help center", "URL crawl", "412", "Yesterday 18:00", "2 failed", [{ btn: "Re-sync" }]]], action: "+ Add Source" } },
        { name: "Articles", note: "Browse and search indexed KB articles. Preview how the AI would surface each article." }
      ]
    },
    [
      ["KB source list", "FAQ databases, uploaded documents, external URLs to crawl."],
      ["Article viewer", "Browse/search indexed articles; preview AI surfacing."],
      ["Sync status", "Last sync, article count, failed articles, Re-sync button."]
    ]
  );

  /* ---------- PORTAL D — Human Agent Bridge ---------- */

  sc("D.1.1", "My Escalation Queue", "D", true, ["ESC-01", "ESC-03"],
    "Agent Bridge > My Queue",
    "Same as B.5.1, scoped to the logged-in agent's assigned queues.",
    "queue",
    {
      cols: ["Conversation", "Channel", "Customer", "Goal", "Reason", "Wait", ""],
      rows: [
        ["conv_88412", "Web Widget", "m.hassan**", "Refund request", "Tool failure (T3)", "3m", [{ btn: "Take Over" }]],
        ["conv_88350", "Web Widget", "s.khan**", "HR inquiry", "Sensitive topic", "14m", [{ btn: "Take Over" }]]
      ]
    },
    [
      ["Queue", "Same as B.5.1 but scoped to the agent's assigned queues only."]
    ]
  );

  sc("D.1.2", "Live Conversation + Context Panel", "D", true, ["ESC-02", "AI-08"],
    "Agent Bridge > Take Over",
    "The core agent working screen (same as B.5.2).",
    "trace",
    {
      left: [
        { kind: "tool", who: "AI", tool: "billing.issue_refund", ok: false, err: "Tier 3 approval required" },
        { kind: "msg", who: "System", text: "Connecting you with a support agent…" },
        { kind: "msg", who: "Agent", text: "Hi M., I'll process this refund now.", agent: true },
        { kind: "draft", who: "AI draft", text: "Shall I also raise a follow-up ticket?", editable: true }
      ],
      mid: [],
      right: {
        cust: { name: "M. Hassan", id: "usr_2201", verified: true },
        summary: "payment_refund · conf 0.90 · 3 tool calls · 1 failed (T3)",
        tools: [
          { t: "billing.issue_refund", tier: "T3" },
          { t: "billing.list_transactions", tier: "T1" }
        ],
        actions: ["Resolve & Close", "Transfer to queue", "Return to Bot"]
      },
      replay: false
    },
    [
      ["Screen", "Same as B.5.2 — the core agent working screen."]
    ]
  );

  sc("D.1.3", "Agent Performance Dashboard", "D", false, ["RP-04"],
    "Agent Bridge > My Performance",
    "Personal KPIs benchmarked against anonymized team averages.",
    "report",
    {
      kpis: [
        { t: "Conversations today", v: "42", s: "team avg 38" },
        { t: "Avg handling time", v: "3m 41s", s: "team avg 4m 12s" },
        { t: "CSAT", v: "4.7 / 5", s: "team avg 4.4" },
        { t: "Resolution rate", v: "88%", s: "team avg 84%" }
      ],
      charts: [
        { title: "Your stats vs. team average", sub: "Anonymized benchmarking", bars: [[88, 84], [42, 38], [95, 91]], labels: ["Resolution", "Handled", "CSAT %"], stacked: false }
      ]
    },
    [
      ["Metrics", "Conversations handled today, avg handling time, CSAT, resolution rate."],
      ["Comparison", "“Your stats vs. team average” — anonymized."]
    ]
  );

  /* ---------- PORTAL E — Developer Portal ---------- */

  sc("E.1.1", "Getting Started / Overview", "E", true, ["MCP-10", "MCP-11"],
    "Developer Portal home",
    "Architecture overview, quick-start guide and SDK links.",
    "code",
    {
      title: "Build your first MCP connector in 15 minutes",
      code: `# NextBot quick start
pip install mcp a2a-sdk

# 1. Define a tool with a JSON schema
@mcp.tool()
def get_balance(account_id: str) -> dict:
    """Fetch account balance by ID."""
    return {"balance": 12480.5, "currency": "USD"}

# 2. Serve via Streamable HTTP
mcp.run(transport="streamable-http")

# 3. Enroll in NextBot → B.3A.2 (MCP Server Enrollment)`
    },
    [
      ["Page content", "Platform architecture overview, quick-start guide, SDK links (Python mcp package, a2a-sdk)."]
    ]
  );

  sc("E.1.2", "MCP Connector Development Guide", "E", true, ["MCP-10", "MCP-11"],
    "Developer Portal > Guides",
    "Step-by-step connector authoring with code samples and reference connectors.",
    "tabs",
    {
      tabs: [
        { name: "Guide", note: "1. Define tools (name, description, JSON schema) → 2. Implement handlers → 3. Expose via Streamable HTTP (or stdio for on-prem) → 4. Register with NextBot." },
        { name: "Code samples", code: "@mcp.tool()\ndef create_ticket(subject: str, priority: str = \"low\") -> dict:\n    \"\"\"Create a support ticket.\"\"\"\n    return tickets.create(subject=subject, priority=priority)\n\n@mcp.tool()\ndef process_action(action_id: str, confirm: bool) -> dict:\n    \"\"\"Write action — requires Tier 2/3 approval.\"\"\"\n    ..." },
        { name: "Reference connectors", note: "Ticketing · CRM · ERP connector templates — links to source/docs." }
      ]
    },
    [
      ["Page content", "Step-by-step guide + Python code samples for read, write and multi-step tool patterns."],
      ["Reference connectors", "Links to Ticketing, CRM, ERP templates."]
    ]
  );

  sc("E.1.3", "A2A Integration Guide", "E", false, ["A2A-01", "A2A-02", "A2A-03", "A2A-04", "A2A-05", "A2A-06", "A2A-07"],
    "Developer Portal > A2A",
    "How to publish an agent card, call NextBot as an external agent, and register as trusted.",
    "code",
    {
      title: "Agent-to-agent integration",
      code: `# Publish your agent card at a well-known URI
/.well-known/agent.json → capabilities, auth, task types

# Register as a trusted agent (B.6.2)
POST /a2a/agents   { "agentId": "...", "auth": "oauth2", "trust": "restricted" }

# Send a task to NextBot
POST /a2a/tasks
{ "taskId": "t_…", "type": "refund", "input": { "invoiceId": "4521" } }`
    },
    [
      ["Page content", "Publish agent card, call NextBot as external agent, register as trusted, task lifecycle reference."]
    ]
  );

  sc("E.1.4", "API Reference (Auto-Generated)", "E", true, ["MCP-02"],
    "Developer Portal > API Reference",
    "Auto-generated from registered tool schemas — every tool, schema and tier.",
    "table",
    {
      filter: ["Connector: All", "Search"],
      cols: ["Tool", "Connector", "Tier", "Input schema", "Output schema", ""],
      rows: [
        ["get_account_balance", "Billing-Payments", { pill: "g", t: "T1" }, { mono: '{accountId: string}' }, { mono: '{balance, currency}' }, [{ btn: "Try it" }]],
        ["list_transactions", "Billing-Payments", { pill: "g", t: "T1" }, { mono: '{accountId, limit}' }, { mono: '[{date, amount}]' }, [{ btn: "Try it" }]],
        ["create_ticket", "Ticketing", { pill: "a", t: "T2" }, { mono: '{subject, priority}' }, { mono: '{ticketId}' }, [{ btn: "Try it" }]]
      ]
    },
    [
      ["Page content", "Auto-generated from registered tool schemas: name, description, input/output schemas, approval tier, example request/response. Filterable by connector."]
    ]
  );

  sc("E.1.5", "Sandbox / Test Console", "E", true, ["MCP-09", "META-11"],
    "Developer Portal > Test Console",
    "Execute tools, simulate end-to-end conversations, and test webhooks.",
    "tabs",
    {
      tabs: [
        { name: "Tool Test", test: { tool: "get_account_balance", args: '{ "accountId": "acc_4821" }', result: '{ "balance": 12480.5, "currency": "USD" }' } },
        { name: "Conversation Simulator", e2e: ["you: What's my balance?", "AI: Goal recognized: account_balance", "AI: Selected get_account_balance (Billing-Payments, T1) · payload { accountId } from schema", "AI: $12,480.50 · USD", "→ Summary card rendered (A.2.6)"] },
        { name: "Webhook Tester", note: "Send a sample inbound webhook payload → see how NextBot normalizes and processes it." }
      ]
    },
    [
      ["Test panel", "Select connector + tool → sample args → execute against sandbox → view response."],
      ["Conversation simulator", "Type message → goal recognition → tool selection → payload construction from schema → tool call → AI response."],
      ["Webhook tester", "Send sample inbound webhook → see normalization + processing."]
    ]
  );

  window.NEXTBOT_SCREENS = window.NEXTBOT_SCREENS || [];
  Array.prototype.push.apply(window.NEXTBOT_SCREENS, S);

  /* ---------- Interactive Stories (Use Case Patterns) ---------- */
  window.NEXTBOT_STORIES = [
    {
      id: "account-linking",
      title: "Account Linking (OTP Verification)",
      desc: "Link an account by selecting type, entering an identifier, and verifying via OTP.",
      steps: [
        { s: "A.1.3", note: "Customer opens the widget and lands on the Welcome screen." },
        { s: "A.2.3", note: "AI asks to select the account type from a list card." },
        { s: "A.2.8", note: "Form card collects the account identifier (multi-field, validated)." },
        { s: "A.2.9", note: "OTP card verifies identity with a countdown resend + error state." },
        { s: "A.2.1", note: "Success confirmation message — account linked." }
      ]
    },
    {
      id: "data-inquiry",
      title: "Data Inquiry (Balance / Status / Info)",
      desc: "Select an account and view a data summary card from a backend tool call.",
      steps: [
        { s: "A.2.3", note: "List card — pick the account to query." },
        { s: "A.2.6", note: "Data Summary card renders the MCP tool response (balance/status/info)." }
      ]
    },
    {
      id: "txn-history",
      title: "Transaction / Record History",
      desc: "Select an account and view a paginated table of records.",
      steps: [
        { s: "A.2.3", note: "List card — pick the account." },
        { s: "A.2.7", note: "Data Table card shows rows with Show-more pagination." }
      ]
    },
    {
      id: "doc-request",
      title: "Document / Statement Request",
      desc: "Request a document, confirm the write action, receive confirmation.",
      steps: [
        { s: "A.2.3", note: "List card — select the account / document type." },
        { s: "A.2.10", note: "Confirmation card (Tier 2 approval) summarizes the request." },
        { s: "A.2.1", note: "AI confirms the document was generated/sent." }
      ]
    },
    {
      id: "external-action",
      title: "External Action (Payment / Portal Redirect)",
      desc: "Navigate an external action from welcome to the backend redirect card.",
      steps: [
        { s: "A.1.3", note: "Welcome screen — user picks the service." },
        { s: "A.2.3", note: "List card — select the item to act on." },
        { s: "A.2.8", note: "Form card — collect the details." },
        { s: "A.2.4", note: "External Link card — redirect with security note + post-click chip." }
      ]
    },
    {
      id: "complaint",
      title: "Complaint / Suggestion Submission",
      desc: "Submit structured feedback through chips, list, form and confirmation.",
      steps: [
        { s: "A.1.3", note: "Welcome — user starts a new request." },
        { s: "A.2.2", note: "Quick Reply chips — choose complaint type." },
        { s: "A.2.3", note: "List card — pick the category." },
        { s: "A.2.8", note: "Form card — collect the details." },
        { s: "A.2.1", note: "Confirmation message." }
      ]
    },
    {
      id: "case-create",
      title: "Case / Ticket Creation",
      desc: "Create a backend case with attachments and a created confirmation card.",
      steps: [
        { s: "A.1.3", note: "Welcome — new request." },
        { s: "A.2.3", note: "List card — select the case type." },
        { s: "A.2.8", note: "Form card — details + fields." },
        { s: "A.2.14", note: "File upload bubble — attach documents with progress." },
        { s: "A.2.12", note: "Case Created card — tracking number + Track chip." }
      ]
    },
    {
      id: "case-followup",
      title: "Case / Ticket Follow-up",
      desc: "Enter a tracking number and view a live status card.",
      steps: [
        { s: "A.1.3", note: "Welcome — track a case." },
        { s: "A.2.8", note: "Form card — enter tracking number." },
        { s: "A.2.13", note: "Case Status card — badge + progress stepper + last update." }
      ]
    },
    {
      id: "doc-search",
      title: "Document / Receipt Search & Download",
      desc: "Search criteria → results list → download card.",
      steps: [
        { s: "A.1.3", note: "Welcome — document search." },
        { s: "A.2.8", note: "Form card — search criteria." },
        { s: "A.2.3", note: "List card — search results." },
        { s: "A.2.5", note: "Download card — fetch the document." }
      ]
    },
    {
      id: "handoff",
      title: "Human Handoff (any point)",
      desc: "AI escalates; agent joins with distinct styling; return to bot.",
      steps: [
        { s: "A.2.11", note: "Handoff notification — queue wait → agent joined → resolved → return to bot." }
      ]
    },
    {
      id: "voice-mode",
      title: "Voice Mode (any point)",
      desc: "Speech → STT → same AI flows → TTS response.",
      steps: [
        { s: "A.2.17", note: "Voice overlay — waveform, live transcript, stop + TTS reply." }
      ]
    },
    {
      id: "multi-backend",
      title: "Multi-Backend Workflow",
      desc: "A composed workflow touching tools on multiple backends end-to-end.",
      steps: [
        { s: "A.1.3", note: "Welcome — user starts the composed flow." },
        { s: "A.2.8", note: "Form card — collect inputs for the first tool." },
        { s: "A.2.6", note: "Result card from Tool A on Backend 1." },
        { s: "A.2.10", note: "Confirmation card (Tier 2) before Tool B on Backend 2." },
        { s: "A.2.12", note: "Case created card closes the workflow." }
      ]
    },
    {
      id: "menu-navigation",
      title: "Menu / Guided Navigation Mode",
      desc: "Customer switches from free-text chat to the guided menu, drills into a sub-menu and lands back in chat with the request sent.",
      steps: [
        { s: "A.1.3", note: "Welcome screen — chat mode active by default." },
        { s: "A.2.18", note: "Customer taps ☰ Menu — the menu tree with breadcrumb replaces the thread." },
        { s: "A.2.18", note: "Drill into Submit Request ▸ Refund Request via sub-menu rows." },
        { s: "A.1.2", note: "Selecting the request routes back to Chat mode with the customer message queued." }
      ]
    }
  ];
})();