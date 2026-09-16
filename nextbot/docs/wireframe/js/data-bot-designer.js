/* ============================================================
   NextBot Wireframes — Bot Conversation Designer (Portal C)
   Source: NextBot_Screen_Inventory_v3.md § Portal C
   ============================================================ */
(function () {
  var S = [];

  function sc(id, title, critical, prd, trigger, blurb, type, data, specRows, notes) {
    S.push({
      id: id, portal: "C", title: title, critical: critical, prd: prd,
      trigger: trigger, blurb: blurb, type: type, data: data || {},
      specRows: specRows || [], notes: notes || []
    });
  }

  sc("C.1.1", "Capability & Tool Catalog", true, ["AI-01", "AI-09"],
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

  sc("C.1.2", "Dialogue Flow Designer", true, ["AI-01", "AI-02", "AI-03"],
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
      ["Playbook trigger", "Flows are optional. A natural-language condition decides whether the agent follows the playbook — no declared-intent matching."],
      ["Canvas", "Node graph: Start, AI Message, Confirm Parameter, Call Tool, Condition, Human Handoff, End."],
      ["Node config", "Message text (multilingual), parameter to confirm, tool (searchable, approval-tier badge), condition, handoff target."],
      ["Call Tool node", "Auto-populates the tool payload from the tool's JSON schema (B.3A.1); shows tier badge; maps outputs to flow variables."],
      ["Flow library", "Templates by use case (Inquiry, Request, Status Check, Complaint, Multi-Backend)."],
      ["Guardrails panel", "Max write-values, disallowed topics, mandatory handover triggers."],
      ["Inline test console", "Type a message → recognize task → traverse nodes → tool payload → mock responses → final AI response."],
      ["Publish workflow", "Draft → Staging → Production with version history + rollback."]
    ]
  );

  sc("C.1.3", "Parameter Validation & Extraction Hints", true, ["AI-01"],
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
      ["Runtime behavior", "The agent extracts parameters from free text; these rules validate and normalize values before the tool payload is built."]
    ]
  );

  sc("C.1.4", "Guardrail / Safety Rules Editor", true, ["AI-10", "AI-11"],
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

  sc("C.1.5", "Knowledge Base Config", true, ["KB-01"],
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

  window.NEXTBOT_SCREENS = window.NEXTBOT_SCREENS || [];
  Array.prototype.push.apply(window.NEXTBOT_SCREENS, S);
})();
