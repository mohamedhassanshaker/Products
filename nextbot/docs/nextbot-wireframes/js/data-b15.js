/* ============================================================
   NextBot Wireframes — Portal B.15: Agent Platform Architecture Console
   Control plane / Data plane / Gateway plane / Observability plane
   for the AI Agent Orchestration Core that powers Portals A–E.
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

  sc("B.15.1", "Agent Definition Registry", true, ["AGT-01", "AGT-02", "ADM-01"],
    "Console > Agent Platform > Definitions",
    "Control-plane source of truth for every agent definition: version, orchestration graph, approval status, eval pass rate and where it's deployed.",
    "table",
    {
      filter: ["Search agents", "Status: All", "Graph: All", "Owner: All"],
      cols: ["Agent", "Version", "Graph", "Owner", "Status", "Eval pass rate", "Deployed"],
      rows: [
        ["support-triage-agent", "1.4.0", "LangGraph", "Support Eng", { pill: "g", t: "Approved" }, "97.2%", "Prod · Stage · Dev"],
        ["escalation-summarizer", "0.9.2", "Pydantic AI", "Platform Eng", { pill: "a", t: "In Review" }, "91.5%", "Stage · Dev"],
        ["hr-self-service-agent", "2.1.0", "LangGraph", "HR Ops", { pill: "g", t: "Approved" }, "98.8%", "Prod · Stage · Dev"],
        ["refund-workflow-agent", "1.5.0", "LangGraph", "Billing Eng", { pill: "a", t: "Eval-Gated" }, "84.0%", "Dev only"],
        ["kb-answer-agent", "3.0.1", "ADK", "Platform Eng", { pill: "gray", t: "Deprecated" }, "—", "—"]
      ],
      bulk: "Promote · Deprecate · Export definitions as JSON"
    },
    [
      ["Registry table", "One row per agent: name, current production version (semver), graph type (LangGraph / Pydantic AI / ADK / custom FSM), owning team, status (Draft/In Review/Approved/Deprecated), last modified."],
      ["Version list (drill-in)", "Per agent: all versions with semver, git commit ref, approval status, eval pass rate, deployed environments, changelog."],
      ["Definition preview", "Read-only render of the Agent Definition YAML — graph, entrypoint, model + fallback chain, bound tools (cross-links to Agent Tool Registry B.3A.1), memory config, guardrail bindings, eval suite reference."],
      ["Diff view", "Git-style diff between any two versions — highlights model changes, tool binding changes, guardrail changes."],
      ["Approval workflow", "Status pipeline: Draft → Eval-Gated → Human Review → Approved → Production. Reviewer sign-off with comment thread, same pattern as a PR review."]
    ]
  );

  sc("B.15.2", "Code-First Agent Builder", false, ["AGT-02", "AGT-03"],
    "Console > Agent Platform > Definitions > New / Edit (Code-First)",
    "A Claude Code-style coding agent authors and edits the Agent Definition from a natural-language brief, dry-runs it in a sandbox, and opens the result as a reviewable diff.",
    "trace",
    {
      left: [
        { kind: "sys", text: "New agent request: “Build a support-triage agent that checks account tier, verifies order status, and only allows refunds under $500 autonomously.”" },
        { kind: "ai", text: "Got it. I'll scaffold a LangGraph agent with three tools: get_customer_profile, get_order_status, issue_refund (Tier 2 under $500, Tier 3 above). Writing agent.py and agent.yaml now.", conf: 0.93 },
        { kind: "tool", tool: "write agent.py", ok: true, lat: "0.8s" },
        { kind: "tool", tool: "write agent.yaml", ok: true, lat: "0.3s" },
        { kind: "draft", text: "guardrails: [pii_redaction, jailbreak_filter]\neval_suite: tests/support-triage.eval.yaml" },
        { kind: "ai", text: "Running a dry-run against 6 sample conversations from the eval suite before opening a PR…", conf: 0.9 },
        { kind: "tool", tool: "dry-run (sandboxed namespace)", ok: true, lat: "4.1s" },
        { kind: "sys", text: "Dry-run: 6/6 sample conversations passed · 0 guardrail violations" }
      ],
      mid: [
        { tool: "get_customer_profile", be: "CRM (sandbox)", ok: true, lat: "210ms", args: '{"accountId":"acc_demo_01"}' },
        { tool: "get_order_status", be: "ERP (sandbox)", ok: true, lat: "185ms", args: '{"orderId":"ord_demo_04"}' },
        { tool: "issue_refund", be: "Billing (sandbox)", ok: true, lat: "260ms", args: '{"amount":180,"tier":"T2"}' }
      ],
      right: {
        meta: [["Target graph", "LangGraph"], ["Bound tools", "3"], ["Guardrails", "pii_redaction, jailbreak_filter"], ["Eval suite", "tests/support-triage.eval.yaml"]],
        summary: "Every edit — chat-authored or manually adjusted — is committed to the Agent Definition as a Git diff. Nothing here executes in production; Dry-Run calls the Agent Runtime's /dry-run endpoint in a sandboxed namespace only.",
        actions: ["Open Pull Request →", "Edit YAML directly", "Re-run Dry-Run"]
      }
    },
    [
      ["Spec input", "Free-text or structured brief: desired behavior, tools to bind, guardrails, target graph framework."],
      ["Live authoring transcript", "Chat-style panel showing the coding agent's plan, file edits to the Agent Definition (YAML + entrypoint code), and test iterations — the same interaction model as an IDE coding agent."],
      ["Dry-run preview", "“Run Dry-Run” calls the Agent Runtime's /dry-run endpoint in a sandboxed namespace — live conversation simulation against the in-progress definition without touching production."],
      ["Diff / PR output", "Every edit is rendered as a Git diff against the current definition. “Open Pull Request” hands off to the Approval Workflow (B.15.1). Visual and code-first authoring always converge on the same artifact."],
      ["Escape hatch", "“Edit YAML directly” toggle for admins who want to hand-edit the definition instead of prompting the builder."]
    ]
  );

  sc("B.15.3", "Deployment & Canary Manager", true, ["AGT-04", "AGT-05", "ADM-05"],
    "Console > Agent Platform > Deployments",
    "Controls which agent version serves traffic in each environment. Rollback is an instant repoint, not a redeploy, and promotion is gated on the eval suite.",
    "tabs",
    {
      tabs: [
        { name: "Production", fields: [
          { label: "support-triage-agent", pill: "g", pt: "v1.4.0 · 90% traffic" },
          { label: "Canary v1.5.0", slider: 10 },
          { label: "Promotion gate", note: "v1.5.0 is currently at 84.0% eval pass rate — below the 90% threshold required to promote. See Eval Suite Runner (B.15.4)." },
          { btn: "Promote canary to 100%", bl: false, danger: false },
          { btn: "Rollback to v1.4.0", danger: true }
        ] },
        { name: "Staging", fields: [
          { label: "support-triage-agent", pill: "a", pt: "v1.5.0 · 100% traffic (staging only)" },
          { label: "escalation-summarizer", pill: "a", pt: "v0.9.2 · 100% traffic" },
          { btn: "Promote to Production", bl: true }
        ] },
        { name: "Dev", fields: [
          { label: "refund-workflow-agent", pill: "gray", pt: "v1.5.0 · unrestricted" },
          { label: "kb-answer-agent", pill: "gray", pt: "v3.0.1-deprecated · read-only" }
        ] },
        { name: "Rollout History", tbl: { cols: ["Agent", "From → To", "By", "When", "Reason"], rows: [
          ["support-triage-agent", "v1.3.2 → v1.4.0", "M. Hassan", "Aug 10, 14:02", "Eval pass rate 97.2% · scheduled promotion"],
          ["hr-self-service-agent", "v2.0.4 → v2.1.0", "R. Osei", "Aug 08, 09:41", "New HRIS tool binding"],
          ["refund-workflow-agent", "v1.4.0 → v1.4.0", "System", "Aug 12, 03:15", "Rollback — canary error rate spike"]
        ] } }
      ]
    },
    [
      ["Deployment table", "Per agent: environment (Dev / Stage / Prod), active version, traffic split if multiple versions are live (e.g., 90% v1.4.0 / 10% v1.5.0 canary)."],
      ["Traffic-split editor", "Slider or numeric input per version; “Promote canary to 100%” and “Rollback” (instant repoint to prior version)."],
      ["Promotion gate", "Cannot promote a version that hasn't passed its bound eval suite (B.15.4) — button is disabled with an explanatory tooltip until the pass rate clears the configured threshold."],
      ["Rollout history", "Timeline of every promotion/rollback: who, when, from version → to version, reason note."]
    ]
  );

  sc("B.15.4", "Eval Suite Runner", true, ["AGT-06", "RP-04"],
    "Console > Agent Platform > Evals",
    "The regression gate that replaces “did the flow diagram still work” — every agent version must clear its golden-set test cases before promotion.",
    "report",
    {
      filters: ["Agent: refund-workflow-agent", "Version: 1.5.0"],
      kpis: [
        { t: "Pass rate", v: "84.0%", s: "threshold 90% required to promote" },
        { t: "Avg cost / test", v: "$0.018", s: "" },
        { t: "Avg latency", v: "1.9s", s: "p95 3.4s" }
      ],
      charts: [
        { title: "Pass rate by version", sub: "Last 5 submitted versions", bars: [97, 95, 91, 88, 84], labels: ["1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0"] }
      ],
      tbl: { cols: ["Test case", "Expected", "Actual", "Result"], rows: [
        ["refund_under_500_autonomous", "Tier 2 confirm, refund issued", "Tier 2 confirm, refund issued", { pill: "g", t: "Pass" }],
        ["refund_over_500_requires_approval", "Escalate to Tier 3", "Escalate to Tier 3", { pill: "g", t: "Pass" }],
        ["ambiguous_order_id", "Ask clarifying question", "Called get_order_status with guessed ID", { pill: "r", t: "Fail" }],
        ["non_english_input_ar", "Respond in Arabic", "Responded in Arabic", { pill: "g", t: "Pass" }]
      ] },
      gaps: ["ambiguous_order_id — agent skipped clarification; needs updated tool-selection guidance (B.3A.1) before this version can promote."]
    },
    [
      ["Eval suite list", "Per agent: bound eval suite (eval_suite: tests/*.eval.yaml), test case count, last run pass rate, avg cost, avg latency."],
      ["Run detail", "Per test case: input, expected outcome, actual outcome, pass/fail, diff on mismatch. Filterable to failures only."],
      ["Trigger", "“Run Eval Suite” manual trigger, or automatic on every new version submitted for review (B.15.1)."],
      ["Suite editor", "Add/edit golden-set test cases: input transcript, expected tool calls, expected final response pattern, cost/latency budget."]
    ]
  );

  sc("B.15.5", "Model Gateway Configuration", true, ["AGT-07", "AGT-08", "AGT-12", "SEC-02"],
    "Console > Agent Platform > Model Gateway",
    "Single ingress config for every LLM call made by every agent: provider routing/fallback, budgets, caching, key vaulting and PII redaction.",
    "tabs",
    {
      tabs: [
        { name: "Routing", fields: [
          { label: "Primary provider", sel: true, ph: "Anthropic · claude-sonnet-5" },
          { label: "Fallback chain", ph: "openai:gpt-5 → gemini:gemini-3-pro" },
          { label: "Routing strategy", sel: true, ph: "Fixed priority (Cost-based / Latency-based available)" }
        ] },
        { name: "Budget & Rate Limits", fields: [
          { label: "Per-tenant token/min cap", ph: "120,000" },
          { label: "Per-agent daily $ budget", ph: "$50.00" },
          { label: "Hard-stop threshold", slider: 90 },
          { label: "Alert recipients", ph: "platform-eng@company.com" }
        ] },
        { name: "Caching", fields: [
          { label: "Exact-match cache", toggle: true, t: "On · TTL 10 min" },
          { label: "Semantic cache", toggle: true, t: "On · similarity ≥ 0.92" },
          { label: "Cache hit rate (7d)", pill: "g", pt: "31.4%" }
        ] },
        { name: "Key Vaulting", fields: [
          { label: "Anthropic API key", mask: true, btn: "Rotate" },
          { label: "OpenAI API key", mask: true, btn: "Rotate" },
          { label: "Gemini API key", mask: true, btn: "Rotate" },
          { label: "Runtime access", note: "The Agent Runtime never holds provider keys directly — every model call is proxied through this gateway using vaulted, short-lived credentials (SEC-02)." }
        ] },
        { name: "PII Redaction", fields: [
          { label: "Redact before logging", toggle: true, t: "On" },
          { label: "Scope", note: "Independent of the conversation-level PII Policy Editor (B.13.1) — this redacts prompts/responses at the gateway before they reach any log sink." }
        ] }
      ]
    },
    [
      ["Provider routing", "Per agent (or platform default): primary provider/model, ordered fallback chain. Routing strategy: cost-based, latency-based, or fixed priority."],
      ["Rate limit & budget", "Per-tenant and per-agent token/min and $/day caps, hard-stop + alert thresholds (80/90/100%) — mirrors the AI Cost Report (B.7.4) but as an enforcement config rather than a report."],
      ["Caching", "Exact-match and semantic-cache toggles, TTL, cache hit-rate stat."],
      ["Key vaulting", "Provider API keys stored and rotated here; the Agent Runtime never holds provider keys directly — it calls through this gateway."],
      ["PII redaction", "Toggle: redact PII from prompts/responses before they are logged, independent of the conversation-level PII Policy Editor (B.13.1)."]
    ]
  );

  sc("B.15.6", "Agent Runtime Observability / Trace Explorer", true, ["AGT-09", "AGT-10", "AGT-11", "RP-02", "RP-08"],
    "Console > Agent Platform > Runtime Traces",
    "Cross-conversation, cross-tenant view of agent-run health — complements the single-conversation Trace Viewer (B.4.2) with an agent-definition-level lens.",
    "trace",
    {
      left: [
        { kind: "sys", text: "Run rn_88231 · support-triage-agent v1.4.0 · started 09:14:02" },
        { kind: "ai", text: "Recognized goal: payment_refund. Selected tool: billing.issue_refund (Tier 2).", conf: 0.91, goal: "payment_refund" },
        { kind: "tool", tool: "billing.issue_refund", ok: true, lat: "312ms" },
        { kind: "sys", text: "Run completed · 09:14:06 · 1,240 tokens · $0.019" },
        { kind: "sys", text: "Run rn_88245 · escalation-summarizer v0.9.2 · awaiting-resume (HITL interrupt)" }
      ],
      mid: [
        { tool: "billing.issue_refund", be: "Billing-Payments", ok: true, lat: "312ms", args: '{"invoiceId":"4521","amount":120}' }
      ],
      right: {
        meta: [["Agent version", "support-triage-agent v1.4.0"], ["Token cost (24h)", "1.2M tokens · $18.40"], ["Tool success rate", "97.8%"], ["p50 / p95 latency", "1.1s / 3.2s"]],
        tools: [{ t: "awaiting-resume: rn_88245", tier: "T3" }],
        actions: ["Resume run", "Export OTel trace"],
        summary: "Multi-tenant quota: tenant_042 at 68% of its concurrent-run cap, 41% of tokens/min — no throttling active. Isolation boundaries (per-tenant namespace, tool-egress allowlist) are enforced by the Runtime, not this console."
      }
    },
    [
      ["Run list", "Every agent run (sync, async, or resumed-after-HITL-interrupt): agent name + version, run ID, status (running / completed / failed / awaiting-resume), duration, token cost."],
      ["Span trace", "OpenTelemetry trace per run — one span per graph node / tool call — exportable to the platform's existing APM."],
      ["Per-version rollup", "Token usage, cost, latency (p50/p95), and tool-call success rate aggregated per agent version — the data that feeds the Deployment & Canary Manager's promotion decisions."],
      ["HITL interrupts", "List of runs paused on a human-in-the-loop interrupt (approval gate), with a “Resume” action — the runtime-level counterpart to the Approval Queue (B.3.6)."],
      ["Multi-tenant quota view", "Per-tenant concurrent-run count, tokens/min usage, and tool-egress allowlist status — surfaces the isolation boundaries the Runtime enforces so one tenant's agent load cannot starve another's."]
    ]
  );

  window.NEXTBOT_SCREENS = window.NEXTBOT_SCREENS || [];
  Array.prototype.push.apply(window.NEXTBOT_SCREENS, S);
})();
