/* ============================================================
   NextBot Wireframes — Portal B (continued): Campaigns → Auth
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

  /* ---------- B.9 Campaign Manager ---------- */

  sc("B.9.1", "Campaign List", false, ["META-08", "META-12", "META-13"],
    "Console > Campaigns",
    "Scheduled/broadcast messaging campaigns across channels. Product decision: carry forward or defer.",
    "table",
    {
      filter: ["Status: All", "Channel: All"],
      cols: ["Campaign", "Channel", "Template", "Status", "Scheduled", "Audience", "Sent/Del/Read", ""],
      rows: [
        ["Aug Promo 2026", "WhatsApp", "aug_promo", { pill: "g", t: "Sending" }, "Aug 15, 10:00", "12,400", "3,204 / 2,988 / 1,912", [{ btn: "View Report" }, { link: "Pause" }]],
        ["Renewal Reminder", "WhatsApp", "renewal_reminder", { pill: "gray", t: "Scheduled" }, "Aug 20, 09:00", "8,150", "—", [{ btn: "View Report" }, { link: "Duplicate" }]],
        ["New Feature Ann.", "Email", "— (composed)", { pill: "a", t: "Draft" }, "—", "—", "—", [{ btn: "View Report" }, { link: "Delete" }]]
      ],
      actionBtn: "+ Create Campaign"
    },
    [
      ["Table", "Name, channel, template, status (Draft/Scheduled/Sending/Completed/Failed), schedule, audience size, sent/delivered/read/opt-out."],
      ["Actions", "“Create Campaign” (B.9.2), “Duplicate”, “Pause”, “Delete”, “View Report” (B.9.3)."]
    ]
  );

  sc("B.9.2", "Campaign Builder", false, ["META-08", "META-07", "META-13"],
    "Campaigns > Create Campaign",
    "Five-step builder: channel & template, audience, personalization, schedule, review & send.",
    "wizard",
    {
      steps: [
        { name: "Channel & Template", fields: [
          { label: "Channel", sel: true, ph: "WhatsApp" },
          { label: "Template", sel: true, ph: "aug_promo (Approved)" },
          { label: "Variables", ph: "{{first_name}}, {{offer}}" }
        ] },
        { name: "Audience", fields: [
          { label: "Audience source", sel: true, ph: "Segment: opted-in customers" },
          { label: "Opt-in enforcement", toggle: true, t: "On" }
        ] },
        { name: "Personalization", note: "Variable mapping + live preview." },
        { name: "Schedule", fields: [
          { label: "Send", sel: true, ph: "Now" },
          { label: "Rate limit awareness", ph: "META-12 · 10k msgs / hr" }
        ] },
        { name: "Review & Send", summary: ["Channel: WhatsApp", "Template: aug_promo", "Audience: 12,400 opted-in", "Schedule: Aug 15, 10:00"], activate: true }
      ]
    },
    [
      ["1 — Channel & Template", "Select channel; WhatsApp → approved template; others → compose."],
      ["2 — Audience", "All contacts, segment, CSV upload, manual list. Opt-in enforcement."],
      ["3 — Personalization", "Variable mapping + live preview."],
      ["4 — Schedule", "Send now or schedule; rate-limit awareness (META-12)."],
      ["5 — Review & Send", "Summary + confirmation."]
    ]
  );

  sc("B.9.3", "Campaign Report", false, ["RP-01"],
    "Campaigns > View Report",
    "Delivery and engagement metrics for a campaign.",
    "report",
    {
      kpis: [
        { t: "Sent", v: "12,400", s: "100%" },
        { t: "Delivered", v: "11,592", s: "93.5%" },
        { t: "Read", v: "9,144", s: "78.9% of delivered" },
        { t: "Opt-outs", v: "61", s: "0.5%" }
      ],
      charts: [
        { title: "Delivery timeline", sub: "Messages per hour", bars: [0, 8, 20, 42, 60, 72, 65, 51, 38, 24, 10, 4], stacked: false }
      ]
    },
    [
      ["Metrics", "Sent, delivered, read, replied, failed, opt-out. Delivery timeline, failure breakdown, engagement."]
    ]
  );

  /* ---------- B.10 Growth Tools ---------- */

  sc("B.10.1", "Growth Tool List", false, ["META-03", "META-09"],
    "Console > Growth Tools",
    "Social auto-reply rules for Facebook/Instagram comments. Product decision: carry forward or deprecate.",
    "table",
    {
      filter: ["Platform: All"],
      cols: ["Rule", "Platform", "Target post", "Trigger keywords", "Auto-reply", "Status", "Engagements", ""],
      rows: [
        ["Service outage reply", "Facebook", "Post #22104", "outage, down, error", "We're aware and working on it.", { pill: "g", t: "Active" }, "214", [{ btn: "Edit" }, { link: "Pause" }]],
        ["Promo DM", "Instagram", "Reel #8803", "price, buy, promo", "DM with link", { pill: "gray", t: "Paused" }, "96", [{ btn: "Edit" }, { link: "Resume" }]]
      ],
      actionBtn: "+ Create Rule"
    },
    [
      ["Table", "Name, platform, target post, trigger keywords, auto-reply, status, engagement count."],
      ["Actions", "“Create Rule” (B.10.2), “Edit”, “Pause/Resume”, “Delete”."]
    ]
  );

  sc("B.10.2", "Growth Tool Rule Editor", false, ["META-03", "META-09"],
    "Growth Tools > Create Rule",
    "Configure social auto-reply: trigger, public/DM text and quick-reply buttons with preview.",
    "tabs",
    {
      tabs: [
        { name: "Config", fields: [
          { label: "Platform", sel: true, ph: "Facebook" },
          { label: "Target post", ph: "Select post or keyword match" },
          { label: "Trigger keywords", ph: "outage, down, error" },
          { label: "Public reply text", ph: "We're aware and working on it." },
          { label: "Private DM text", ph: "Hi! For faster help, open the chat widget." },
          { label: "Quick-reply buttons", ph: "Track my case · Talk to agent" }
        ] },
        { name: "Preview", preview: true }
      ]
    },
    [
      ["Config", "Platform selector, post targeting, trigger keywords, public reply, private DM, quick-reply buttons. Preview panel."]
    ]
  );

  /* ---------- B.11 Speech Lab ---------- */

  sc("B.11.1", "Voice & Speech Settings", true, ["OC-05"],
    "Console > Speech Lab",
    "STT/TTS engines, voice catalog with preview, personas and test console.",
    "tabs",
    {
      tabs: [
        { name: "STT", fields: [
          { label: "Provider", sel: true, ph: "Provider A" },
          { label: "Language model", sel: true, ph: "en-US · general" },
          { label: "Confidence threshold", ph: "0.80" }
        ] },
        { name: "TTS", fields: [
          { label: "Provider", sel: true, ph: "Provider B" },
          { label: "Default voice (en)", sel: true, ph: "Female · Nova" },
          { label: "Default voice (ar)", sel: true, ph: "Female · Arabic" },
          { label: "Rate", slider: 50 },
          { label: "Pitch", slider: 40 }
        ] },
        { name: "Voice Personas", tbl: { cols: ["Persona", "Voice", "Rate", "Pitch", "Assigned"], rows: [["Support (EN)", "Nova · F", "1.0", "1.0", "web-widget, voice"], ["Support (AR)", "Huda · F", "1.0", "1.0", "voice"], ["Info (EN)", "Omar · M", "0.9", "0.9", "IVR"]] } },
        { name: "Test Console", note: "Type or paste text → hear it spoken. Side-by-side voice comparison." }
      ]
    },
    [
      ["STT engine", "Provider, language model, confidence threshold."],
      ["TTS engine", "Provider, voice catalog (browse/preview by language, gender, style), default voice per language, rate/pitch sliders with preview."],
      ["Voice personas", "Named presets (voice + rate + pitch + language), assignable to channels/tenants."],
      ["Test console", "Live preview + side-by-side voice comparison."]
    ]
  );

  sc("B.11.2", "IVR Flow Builder", true, ["OC-05"],
    "Console > Speech Lab > IVR",
    "Drag-and-drop IVR tree with DTMF nodes, AI handoff and click-through simulation.",
    "workflow",
    {
      demo: [
        { kind: "start", nt: "Start", name: "Greeting · TTS", cls: "start" },
        { kind: "cond", nt: "Branch", name: "Language selection", cls: "cond" },
        { kind: "cond", nt: "Branch", name: "Department routing · DTMF", cls: "cond" },
        { kind: "tool", nt: "AI handoff", name: "Hand to AI core + context", cls: "tool", tag: "context" },
        { kind: "cond", nt: "Fallback", name: "Voicemail / callback", cls: "cond" }
      ],
      nodes: ["Node config: audio prompt (TTS/WAV), DTMF mapping, timeout, retries, fallback"]
    },
    [
      ["Visual tree editor", "Nodes: greeting, language selection, department routing, DTMF, AI handoff, voicemail, callback."],
      ["Node config", "Audio prompt (TTS or WAV), DTMF mapping, timeout, retries, fallback."],
      ["AI handoff node", "Point where IVR hands to the AI Agent Orchestration Core with collected context."],
      ["Preview/test", "Simulate call flow by clicking through; play TTS prompts inline."]
    ]
  );

  /* ---------- B.12 Gateway Agent ---------- */

  sc("B.12.1", "Gateway Agent List", false, ["MCP-12"],
    "Console > Gateway Agents",
    "On-prem gateway agents bridging private backends via outbound HTTPS tunnels.",
    "table",
    {
      cols: ["Agent ID", "Label", "Deployment", "Tunnel", "Last heartbeat", "Version", "Backends", ""],
      rows: [
        ["gw-billing-01", "Billing gateway", "On-prem DC-A", { pill: "g", t: "Connected" }, "32s ago", "1.4.2", "3", [{ btn: "Details" }, { link: "Rotate Creds" }]],
        ["gw-hr-01", "HR gateway", "On-prem DC-B", { pill: "r", t: "Disconnected" }, "> 1h ago", "1.3.8", "2", [{ btn: "Details" }, { link: "Rotate Creds" }]]
      ],
      actionBtn: "+ Download Agent"
    },
    [
      ["Table", "Agent ID, label, deployment location, tunnel status, last heartbeat, version, connected backends."],
      ["Actions", "“Download Agent” (B.12.2), “View Details”, “Rotate Tunnel Credentials”, “Decommission”."],
      ["Health", "Uptime, avg tunnel latency, reconnection count."]
    ]
  );

  sc("B.12.2", "Gateway Agent Setup Wizard", false, ["MCP-12", "MCP-11"],
    "Gateway Agents > Download Agent",
    "Five-step on-prem install: download, install & register, connect stdio backends, test, activate.",
    "wizard",
    {
      steps: [
        { name: "Download", fields: [
          { label: "OS", sel: true, ph: "Linux x64 (Docker)" },
          { label: "Registration token", mask: true, btn: "Copy" }
        ] },
        { name: "Install & Register", code: "curl -sSL https://get.nextbot.example/gw/install.sh | bash -s -- --token ••••\nnextbot-gw register --token ••••" },
        { name: "Connect Backends", fields: [
          { label: "MCP server name", ph: "hr-db-mcp" },
          { label: "Spawn command", ph: "python mcp_server.py --env prod" },
          { label: "Env vars", ph: "DB_URL=…, API_KEY=…" }
        ] },
        { name: "Test", test: { tool: "list_tools (through tunnel)", args: "—", result: "12 tools discovered ✓" } },
        { name: "Activate", activate: true, summary: ["Agent appears in B.12.1", "Backends appear in B.3.1 with “via Gateway Agent” badge"] }
      ]
    },
    [
      ["1 — Download", "Select OS; binary/Docker image; one-time registration token."],
      ["2 — Install & Register", "Copy-paste commands; agent phones home over outbound HTTPS tunnel."],
      ["3 — Connect Backends", "Add stdio MCP servers: name, spawn command, env vars."],
      ["4 — Test", "list_tools through tunnel; test sample calls."],
      ["5 — Activate", "Appears in B.12.1; backends in B.3.1 with “via Gateway Agent” badge."]
    ]
  );

  /* ---------- B.13 PII ---------- */

  sc("B.13.1", "PII Policy Editor", true, ["SEC-04"],
    "Settings > PII Policies",
    "Detection rules, masking matrix per context, connector trust levels and detection audit log.",
    "matrix",
    {
      dims: ["Transcript", "Tool-call payload", "A2A payload", "Export", "Agent view"],
      tools: [
        { n: "National ID", cells: ["show", "mask", "mask", "mask", "mask"] },
        { n: "Credit card", cells: ["mask", "mask", "redact", "redact", "mask"] },
        { n: "IBAN", cells: ["mask", "mask", "redact", "redact", "mask"] },
        { n: "Phone", cells: ["show", "mask", "mask", "mask", "show"] },
        { n: "Email", cells: ["show", "mask", "mask", "show", "show"] }
      ],
      trust: ["Billing-Payments → Trusted · Ticketing → Semi-Trusted · HR Portal → Untrusted (full masking)"],
      audit: ["09:03 · conv_88412 · Credit card detected · masked in transcript"]
    },
    [
      ["Detection rules", "PII entity types (national ID, card, IBAN, phone, email, passport, DOB): detection method, status, sample match."],
      ["Custom patterns", "Add custom PII: name, regex/keyword, masking format."],
      ["Masking matrix", "PII types × contexts (transcript, tool-call, A2A, export, agent view). Show / Partial / Full / Redact."],
      ["Tool trust levels", "Trusted / Semi-Trusted / Untrusted — masking intensifies for less-trusted tools."],
      ["Audit", "PII detection log: timestamp, conversation, entity, action."]
    ]
  );

  /* ---------- B.14 Auth ---------- */

  sc("B.14.1", "Admin Login Page", true, ["SEC-03"],
    "Console entry",
    "Email + password, SSO redirect, MFA TOTP prompt, session management and remember-device.",
    "login",
    {
      title: "Sign in to NextBot Console",
      note: "MFA prompt shown after credentials: 6-digit TOTP, backup code, resend."
    },
    [
      ["Login form", "Email + password, “Sign in”, “Forgot password?”."],
      ["SSO button", "“Sign in with SSO” → IdP redirect. Org logo if tenant recognized."],
      ["MFA prompt", "6-digit TOTP, “Use backup code”, “Resend code” for SMS/email."],
      ["Session management", "Configurable timeout per role; “Remember this device”."]
    ]
  );

  sc("B.14.2", "MFA Enrollment Screen", true, ["SEC-03"],
    "Settings > Security > MFA",
    "Enroll authenticator/SMS/email, manage methods, regenerate backup codes.",
    "tabs",
    {
      tabs: [
        { name: "Enroll", fields: [
          { label: "Choose method", sel: true, ph: "Authenticator app" },
          { label: "Scan QR", qr: true },
          { label: "Verify test code", ph: "6-digit code" },
          { label: "Backup codes", ph: "8 one-time codes — save securely" }
        ] },
        { name: "Manage", fields: [
          { label: "Enrolled methods", list: ["Authenticator app · primary", "SMS · secondary"] },
          { btn: "Regenerate backup codes", bl: true },
          { btn: "Remove method", bl: true, danger: true }
        ] }
      ]
    },
    [
      ["Enrollment", "Choose method (Authenticator/SMS/Email) → QR scan or phone entry → verify test code → save backup codes."],
      ["Manage MFA", "View methods, add secondary, regenerate backup codes, remove method."]
    ]
  );

  window.NEXTBOT_SCREENS = window.NEXTBOT_SCREENS || [];
  Array.prototype.push.apply(window.NEXTBOT_SCREENS, S);
})();