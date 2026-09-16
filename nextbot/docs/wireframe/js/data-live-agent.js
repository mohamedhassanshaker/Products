/* ============================================================
   NextBot Wireframes — Live Agent (B.5 Escalation + Portal D Bridge)
   Source: NextBot_Screen_Inventory_v3.md § B.5, Portal D
   ============================================================ */
(function () {
  var S = [];

  function sc(id, title, critical, prd, trigger, blurb, type, data, specRows, notes) {
    S.push({
      id: id, portal: "LA", title: title, critical: critical, prd: prd,
      trigger: trigger, blurb: blurb, type: type, data: data || {},
      specRows: specRows || [], notes: notes || []
    });
  }

  /* ---------- B.5 Escalation Management (admin + shared live UI) ---------- */

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
      ["Actions", "Take Over (B.5.2), Reassign, Return to Bot (ESC-04)."]
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
      ["Actions bar", "Resolve & Close, Transfer to queue, Return to Bot, Create Case."]
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

  /* ---------- Portal D — Human Agent Bridge ---------- */

  sc("D.1.1", "My Escalation Queue", true, ["ESC-01", "ESC-03"],
    "Agent Bridge > My Queue",
    "Same as B.5.1, scoped to the logged-in agent's assigned queues only.",
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

  sc("D.1.2", "Live Conversation + Context Panel", true, ["ESC-02", "AI-08"],
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
      ["Conversation panel", "Live thread with AI draft (AI-08) and prior tool-call cards."],
      ["Context panel", "Goal, parameters, confidence, customer info."],
      ["Actions", "Resolve & Close, Transfer, Return to Bot."]
    ]
  );

  sc("D.1.3", "Agent Performance Dashboard", false, ["RP-04"],
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
      ["Comparison", "Your stats vs. team average — anonymized."]
    ]
  );

  window.NEXTBOT_SCREENS = window.NEXTBOT_SCREENS || [];
  Array.prototype.push.apply(window.NEXTBOT_SCREENS, S);

  window.NEXTBOT_STORIES = [
    {
      id: "bot-author-deploy",
      title: "Author → Eval → Canary → Promote",
      desc: "Platform engineer defines an agent, runs evals, canaries traffic, then promotes.",
      steps: [
        { s: "B.15.1", note: "Registry lists agent definitions and approval status." },
        { s: "B.15.2", note: "Code-first builder scaffolds the definition + dry-run." },
        { s: "B.15.4", note: "Eval suite gates promotion (pass rate must clear threshold)." },
        { s: "B.15.3", note: "Canary traffic split, then promote or rollback." },
        { s: "B.15.6", note: "Runtime traces confirm healthy production runs." }
      ]
    },
    {
      id: "bot-design-playbook",
      title: "Design a bot playbook with tools & guardrails",
      desc: "Conversation designer curates capabilities, builds a flow, and attaches safety rules.",
      steps: [
        { s: "C.1.1", note: "Capability & Tool Catalog — enroll tools and selection guidance." },
        { s: "C.1.3", note: "Parameter validation hints for extracted fields." },
        { s: "C.1.2", note: "Dialogue Flow Designer — Call Tool + Human Handoff nodes." },
        { s: "C.1.4", note: "Guardrails — amount threshold escalates to human." },
        { s: "C.1.5", note: "Knowledge Base sources for FAQ fallback." }
      ]
    },
    {
      id: "live-handoff",
      title: "Bot escalates → live agent resolves",
      desc: "Escalation lands in the queue; agent takes over with AI draft + context; returns to bot or closes.",
      steps: [
        { s: "B.5.3", note: "Routing config maps goal/channel → backend queue." },
        { s: "B.5.1", note: "Admin Escalation Queue — SLA wait + Take Over." },
        { s: "D.1.1", note: "Agent sees only their assigned queue." },
        { s: "D.1.2", note: "Live Conversation + Context Panel (AI draft, tools, actions)." },
        { s: "B.5.2", note: "Same takeover workspace from admin Escalations." },
        { s: "D.1.3", note: "Agent performance KPIs after the shift." }
      ]
    }
  ];
})();
