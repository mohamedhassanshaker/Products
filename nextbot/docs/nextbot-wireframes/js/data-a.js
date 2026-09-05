/* ============================================================
   NextBot Wireframes — Portal A: Embeddable AI Assistant Widget
   ============================================================ */
(function () {
  var S = [];

  function sc(id, title, critical, prd, trigger, blurb, type, data, specRows, notes) {
    S.push({
      id: id, portal: "A", title: title, critical: critical, prd: prd,
      trigger: trigger, blurb: blurb, type: type, data: data || {},
      specRows: specRows || [], notes: notes || []
    });
  }

  /* ---------- A.1 Shell & Lifecycle ---------- */

  sc("A.1.1", "Launcher Button (Collapsed State)", true, ["OC-01", "OC-04"],
    "Page load on host website/app",
    "The floating action button is the entry point to the widget. It persists across SPA navigations and respects safe-area insets on mobile.",
    "launcher",
    {
      nudge: null,
      hostTitle: "acme.example.com — Shop",
      hostLines: [70, 52, 88, 64, 40]
    },
    [
      ["Floating action button", "Bottom-right (configurable). Circular or pill. Brand icon or animated AI avatar."],
      ["Unread badge", "Numeric badge when there is an unresolved message or proactive nudge."],
      ["Tooltip on hover", "Configurable label, e.g. “Chat with us” (bilingual if configured)."],
      ["Animations", "Subtle pulse on first load. Respects prefers-reduced-motion."],
      ["Branding", "Host brand colors, icon, launcher shape — configurable via embed script."]
    ],
    ["Launcher persists across page navigations (SPA-aware).", "Clicking opens A.1.2."]
  );

  sc("A.1.2", "Widget Window (Expanded State)", true, ["OC-01", "OC-04", "OC-07"],
    "Click launcher (A.1.1)",
    "The expanded widget panel: header bar, conversation area, quick-action chips and input area.",
    "widget",
    {
      wkey: "a12",
      modes: true,
      active: "chat",
      menu: [
        { ic: "✓", label: "Check Order", hint: "Track delivery" },
        { ic: "＋", label: "Submit Request", hint: "New request",
          sub: [
            { ic: "·", label: "Complaint", hint: "Report an issue" },
            { ic: "·", label: "Refund Request", hint: "Invoice #4521" },
            { ic: "·", label: "Feature Suggestion", hint: "Give feedback" }
          ] },
        { ic: "▶", label: "Track Ticket", hint: "Case follow-up" },
        { ic: "⚙", label: "Account Services", hint: "Balance & activity",
          sub: [
            { ic: "·", label: "View Balance", hint: "Current balance" },
            { ic: "·", label: "Recent Transactions", hint: "Last 10 entries" }
          ] },
        { ic: "✆", label: "Talk to an Agent", hint: "Live handoff" }
      ],
      quick: ["Check Status", "New Request", "Track Case"],
      messages: [
        { t: "sys", text: "Conversation started · Today, 10:24" },
        { t: "ai", text: "Hi there! 👋 I'm your virtual assistant. How can I help you today?" }
      ],
      welcome: false
    },
    [
      ["Header bar", "Brand logo / assistant name, language toggle, minimize (→ A.1.1), close/end-chat."],
      ["Mode switcher", "Segmented control toggles between **✎ Chat** (free-text) and **☰ Menu** (guided navigation). Active mode is highlighted."],
      ["Conversation area", "Scrollable message thread (see A.2.x)."],
      ["Input area", "Text input, send button, attachment (📎), voice toggle (🎤). Free-text always available — including in menu mode."],
      ["Quick-action bar", "Optional shortcut chips below header — map to pre-filled request text; the agent still extracts the full parameters from the conversation."],
      ["Powered-by footer", "“Powered by NextBot” — removable via white-label config."]
    ],
    ["Desktop: 400×600 floating panel, bottom-right.", "Mobile: full-screen overlay or bottom-sheet (configurable).", "RTL auto-activates when an RTL language is selected."]
  );

  sc("A.1.3", "Welcome / Home Screen", true, ["OC-04", "AI-04", "KB-01"],
    "Widget opens with no active conversation, or after resolution",
    "Landing screen with greeting, service menu cards, free-text search and a continue-conversation card.",
    "welcome",
    {
      wkey: "a13",
      modes: true,
      active: "chat",
      menu: [
        { ic: "✓", label: "Check Order", hint: "Track delivery" },
        { ic: "＋", label: "Submit Request", hint: "New request",
          sub: [
            { ic: "·", label: "Complaint", hint: "Report an issue" },
            { ic: "·", label: "Refund Request", hint: "Invoice #4521" },
            { ic: "·", label: "Feature Suggestion", hint: "Give feedback" }
          ] },
        { ic: "▶", label: "Track Ticket", hint: "Case follow-up" },
        { ic: "⚙", label: "Account Services", hint: "Balance & activity",
          sub: [
            { ic: "·", label: "View Balance", hint: "Current balance" },
            { ic: "·", label: "Recent Transactions", hint: "Last 10 entries" }
          ] },
        { ic: "✆", label: "Talk to an Agent", hint: "Live handoff" }
      ],
      greeting: "Welcome 👋",
      sub: "How can we help you today?",
      cards: [
        { ic: "ic-green", g: "✓", label: "Check Order", sub: "Track delivery" },
        { ic: "ic-blue", g: "＋", label: "Submit Request", sub: "New request" },
        { ic: "ic-amber", g: "▶", label: "Track Ticket", sub: "Case follow-up" },
        { ic: "ic-violet", g: "?", label: "Ask a Question", sub: "General help" }
      ],
      recent: { txt: "Your refund for invoice #4521 has been processed.", link: "Continue conversation" }
    },
    [
      ["Greeting message", "Personalized if identity known (“Welcome back, [Name]”), generic otherwise."],
      ["Service menu cards", "Grid/list of top-level goals / common requests (shortcuts only) — fully configurable per tenant. Tapping pre-fills the request; the agent extracts the full parameters from the conversation (no intent classification)."],
      ["Mode switcher", "Segmented control toggles between **✎ Chat** (free-text) and **☰ Menu** (guided navigation). Active mode is highlighted."],
      ["Search/type bar", "“Ask me anything…” — free-text entry."],
      ["Recent conversation preview", "Shows last message + “Continue conversation” link."]
    ]
  );

  sc("A.1.4", "Language Selection Modal", true, ["OC-07"],
    "Tap language toggle in header",
    "Modal overlay with tappable language cards and an optional auto-detect banner.",
    "modal",
    {
      title: "Choose your language",
      lang: [
        { code: "EN", label: "English" }, { code: "ع", label: "العربية" },
        { code: "FR", label: "Français" }, { code: "ES", label: "Español" },
        { code: "UR", label: "اردو" }, { code: "HI", label: "हिन्दी" }
      ],
      auto: true
    },
    [
      ["Language options", "Tappable cards. Configurable per tenant (40+ languages per NFR)."],
      ["Auto-detect banner", "“We detected your language as [X]. Continue?” — only when auto-detection fires."],
      ["Persist choice", "Stored in local storage / session. Subsequent messages use the selected language."]
    ]
  );

  sc("A.1.5", "Proactive Nudge Bubble", false, ["OC-04", "META-08"],
    "Trigger rules: time on page, scroll depth, URL path, returning visitor",
    "A small speech bubble above the launcher that auto-dismisses; tapping opens the widget with the nudge goal pre-loaded.",
    "launcher",
    {
      nudge: { text: "Need help? Ask us anything 😊", showClose: true },
      hostTitle: "acme.example.com — Shop",
      hostLines: [44, 66, 30, 80, 50]
    },
    [
      ["Trigger", "Configurable rules: time on page, scroll depth, specific URL path, returning visitor."],
      ["Display", "Small speech bubble above the launcher with a one-line message. Auto-dismisses after N seconds or on click."],
      ["Tap behavior", "Opens widget to A.1.3 with the nudge goal pre-loaded."]
    ]
  );

  /* ---------- A.2 Conversation Message Types ---------- */

  sc("A.2.1", "Text Message Bubble", true, ["AI-04"],
    "Any AI/customer exchange",
    "The three bubble variants: AI (left, avatar + markdown-like text), customer (right, status ticks), and centered system messages.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "sys", text: "Conversation started · Today, 10:24" },
        { t: "ai", text: "Welcome to NextBot Support! I can check your **order status**, **track a case**, or **submit a request**." },
        { t: "cust", text: "I need to check my order status", ticks: "✓✓ read" },
        { t: "typing" }
      ]
    },
    [
      ["AI message (left)", "Avatar icon + bubble. Markdown-like rendering (bold, links, line breaks). Typing indicator while processing."],
      ["Customer message (right)", "Plain text bubble, right-aligned. Sent/delivered/read ticks on channels that support it."],
      ["System message (centered)", "Gray, smaller — “Conversation started”, “Transferred to agent”, timestamps."]
    ],
    ["All variants support both LTR and RTL layouts."]
  );

  sc("A.2.2", "Quick Reply Chips", true, ["AI-04", "META-09"],
    "AI asks for a short selection",
    "A horizontal row of tappable chips below an AI message; tapping sends the chip and disables the row (single-use).",
    "chat",
    {
      quick: null,
      messages: [
        { t: "ai", text: "What would you like to do with your order **ORD-99231**?" },
        { t: "chips", items: [{ l: "Track my order" }, { l: "Modify delivery" }, { l: "Return / refund" }, { l: "Talk to an agent" }], note: "Single-use — row disables after selection" }
      ]
    },
    [
      ["Chip row", "Horizontal scrollable row below an AI message. Labels are plain text — no intent binding."],
      ["Behavior", "Tapping sends the chip as a user message and disables the row (single-use)."],
      ["Mapping", "Maps to WhatsApp interactive buttons (META-09) when the conversation is on WhatsApp."]
    ]
  );

  sc("A.2.3", "Interactive List / Picker", true, ["AI-04", "META-09"],
    "AI needs the customer to select from a list",
    "A list card with optional search, items with label/subtitle/icon, and a Select action per row.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "ai", text: "Please select the account you'd like to check:" },
        { t: "list", search: true, items: [
          { ic: "⌂", label: "Current Account", sub: "•••• 4821" },
          { ic: "◈", label: "Savings Account", sub: "•••• 9033" },
          { ic: "▣", label: "Credit Card", sub: "•••• 2210" },
          { ic: "✎", label: "Loan Account", sub: "LN-4492" }
        ] }
      ]
    },
    [
      ["List card", "Title + scrollable list (label + optional subtitle + optional icon) + Select per row."],
      ["Search/filter", "Optional search bar for lists > 8 items."],
      ["Selection confirmation", "Selected item appears as a customer message bubble."]
    ]
  );

  sc("A.2.4", "External Link / Action Card", true, ["MCP-07"],
    "AI returns an external URL from a connected backend",
    "Card with backend/brand logo, description, amount/summary and a prominent action button opening the URL in a new tab.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "ai", text: "Your payment link is ready:" },
        { t: "link", brand: "PAY", title: "Secure Payment Portal", desc: "Complete your payment of", amount: "$450.00", btn: "Pay Now →", domain: "payments.example.com", follow: true },
        { t: "ai", text: "Let me know once you're done." },
        { t: "chips", items: [{ l: "Check Status" }], used: false }
      ]
    },
    [
      ["Card layout", "Backend/brand logo + description, amount or summary, prominent action button (“Open →”, “Pay Now →”, “View →”)."],
      ["Security note", "“You'll be redirected to [domain].”"],
      ["Post-click state", "Card updates with follow-up prompt + “Check Status” chip."]
    ]
  );

  sc("A.2.5", "Document / File Download Card", true, ["MCP-07"],
    "AI returns a backend-generated document URL",
    "File icon + document name + size and a Download button that opens the backend-generated URL.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "ai", text: "Here is the document you requested:" },
        { t: "file", name: "Statement_March_2026.pdf", size: "248 KB" }
      ]
    },
    [
      ["Card layout", "File icon + document name + file size + “Download” button."],
      ["Behavior", "Tapping Download opens the backend-generated URL in a new tab or triggers a file download."]
    ]
  );

  sc("A.2.6", "Data Summary Card", true, ["MCP-07"],
    "Structured data returned from any MCP tool call",
    "Generic card: title, large primary value, supporting key-value fields, timestamp, and dynamically generated action chips.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "ai", text: "Here's your current balance:" },
        { t: "dcard", title: "Account Balance", value: "$12,480.50", fields: [["Available balance", "$12,480.50"], ["Currency", "USD"], ["Last updated", "Aug 15, 10:31"]], ts: "10:31 · Today" },
        { t: "chips", items: [{ l: "View Transactions" }, { l: "Recent Statements" }] }
      ]
    },
    [
      ["Card layout", "Title/label at top, primary value in center (large text), supporting key-value fields. Timestamp."],
      ["Actions row", "Quick-action chips — dynamically generated from available follow-up tools."],
      ["Theming", "Card accent color + icon configurable per backend connector."]
    ]
  );

  sc("A.2.7", "Data Table / List Card", true, ["MCP-07"],
    "Tabular data from any MCP tool call",
    "Scrollable list of rows rendered from the tool-call response, with “Show more” pagination and an empty state.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "ai", text: "Your recent transactions:" },
        { t: "dtable", cols: ["Date", "Description", "Amount"], rows: [
          ["Aug 14", "Online payment", "-$120.00"],
          ["Aug 12", "Salary deposit", "+$2,000.00"],
          ["Aug 09", "Utility bill", "-$86.40"]
        ], more: true }
      ]
    },
    [
      ["Table/list layout", "Scrollable rows; columns configurable per tool."],
      ["Overflow", "“Show more” link if rows exceed display limit (paginated via tool call)."],
      ["Empty state", "“No results found.”"]
    ]
  );

  sc("A.2.8", "Form Collection Card (Multi-Field)", true, ["AI-01", "AI-04"],
    "AI needs to collect multiple fields at once",
    "Embedded form card with inline validation and a Submit button that sends a structured message to the AI core.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "ai", text: "Please provide the following details:" },
        { t: "form", fields: [
          { label: "Full Name", ph: "e.g. John Smith", req: true },
          { label: "Email", ph: "you@example.com", req: true, err: "Invalid email format" },
          { label: "Phone", ph: "+1 555 000 1234", req: false },
          { label: "Category", sel: true, ph: "Select a category", req: true },
          { label: "Additional Notes", ta: true, ph: "Describe your request…", req: false }
        ], submit: "Submit" }
      ]
    },
    [
      ["Embedded form", "Labeled inputs rendered inline: text, email, phone, dropdown, textarea, file upload."],
      ["Validation", "Inline field-level validation (email format, required fields)."],
      ["Submit button", "Sends data to the AI core as a structured message."],
      ["Fallback", "If form rendering unsupported (e.g., WhatsApp), AI falls back to question-by-question collection."]
    ]
  );

  sc("A.2.9", "OTP / Identity Verification Card", true, ["MCP-07"],
    "Connected backend requires OTP / identity confirmation",
    "Digit input with countdown resend, error state with retry count, and a success checkmark state.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "ai", text: "To access your protected data, please verify your identity." },
        { t: "otp", sub: "Enter the verification code sent to your registered contact", boxes: "4821", timer: "Resend code in 0:30", error: "Incorrect code. Please try again. (2 attempts remaining)" }
      ]
    },
    [
      ["Card layout", "“Enter the verification code sent to your registered contact” + digit input (numeric keypad on mobile)."],
      ["Timer", "“Resend code” link with countdown timer."],
      ["Error state", "“Incorrect code. Please try again.” with retry count."],
      ["Success state", "Checkmark animation + “Verified successfully!”"]
    ]
  );

  sc("A.2.10", "Confirmation / Action Card", true, ["MCP-05"],
    "Before any write-action tool call (Tier 2 approval)",
    "Summarizes the action about to be taken — populated from tool-call args — with Confirm / Cancel and a configurable disclaimer.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "ai", text: "Please confirm the following action:" },
        { t: "confirm", rows: [["Action", "Issue Refund"], ["Amount", "$120.00"], ["Target", "Invoice #4521"], ["Reference", "ORD-99231"]], disclaimer: "This action cannot be undone." }
      ]
    },
    [
      ["Card layout", "Summary of the action — dynamically populated from tool-call args (type, amount, target, reference)."],
      ["Action buttons", "“Confirm” (primary) + “Cancel” (secondary)."],
      ["Disclaimer", "Configurable per tool (e.g., “This action cannot be undone.”)"]
    ]
  );

  sc("A.2.11", "Human Handoff Notification", true, ["AI-05", "ESC-01", "ESC-02"],
    "AI escalates; agent joins",
    "Connecting message with wait indicator, agent-joined notification, distinct agent styling, and return-to-bot message.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "sys", text: "I'm connecting you with a support agent. Please hold on…" },
        { t: "queue", pos: 3 },
        { t: "sys", text: "Agent Sarah has joined the conversation." },
        { t: "agent", name: "Sarah · Billing Support", text: "Hi, I'm Sarah! I can see you need help with your refund. Let me pull that up." },
        { t: "cust", text: "Thank you!", ticks: "✓✓ read" },
        { t: "sys", text: "Your issue has been resolved. Returning to AI assistant." }
      ]
    },
    [
      ["System message", "“I'm connecting you with a support agent. Please hold on…”"],
      ["Wait indicator", "Animated dots or position-in-queue display."],
      ["Agent joined", "“Agent [Name] has joined.” Agent messages use different avatar/color."],
      ["Return-to-bot", "“Your issue has been resolved. Returning to AI assistant.”"]
    ]
  );

  sc("A.2.12", "Ticket / Case Created Confirmation Card", true, ["TCK-01", "MCP-07"],
    "A case is created via a backend tool",
    "Checkmark + “Case Created”, copyable tracking number, type/priority/date, and a Track This Case chip.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "ai", text: "Your case has been created:" },
        { t: "ticket", rows: [["Tracking number", "NB-2026-04571", "copy"], ["Type", "Payment Dispute"], ["Priority", "High"], ["Created", "Aug 15, 2026"]], chips: [{ l: "Track This Case" }] }
      ]
    },
    [
      ["Card layout", "Checkmark icon + “Case Created”. Fields: tracking number (copyable), type, priority, created date."],
      ["Actions", "“Track This Case” chip — feeds tracking number to the status-check tool."]
    ]
  );

  sc("A.2.13", "Ticket / Case Status Card", true, ["TCK-02"],
    "Customer asks for case status",
    "Tracking number, status badge + progress stepper, assigned team and last update note.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "ai", text: "Here's the current status of your case:" },
        { t: "status", num: "NB-2026-04571", status: "In Progress", step: 1, rows: [["Assigned team", "Billing Support"], ["Last update", "Aug 15 · Awaiting payment verification"]] }
      ]
    },
    [
      ["Card layout", "Tracking number, status (Open / In Progress / Resolved / Closed), assigned team, last update date + note."],
      ["Status visual", "Colored status badge or progress stepper bar."]
    ]
  );

  sc("A.2.14", "File Upload / Attachment Bubble", true, ["TCK-06"],
    "Customer taps 📎 in the input area",
    "Upload trigger → progress bar inside the attachment bubble → completed tappable file.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "sys", text: "Attaching file…" },
        { t: "upload", name: "invoice_scan.jpg", size: "1.2 MB", progress: 64, note: "Uploading… 64%" },
        { t: "upload", name: "invoice_scan.jpg", size: "1.2 MB", progress: 100, note: "Uploaded — tap to preview", done: true },
        { t: "ai", text: "Got it! I've attached this to your case **NB-2026-04571**." }
      ]
    },
    [
      ["Upload trigger", "Customer taps 📎 → file picker opens."],
      ["Upload progress", "Progress bar inside the attachment bubble while uploading."],
      ["Completed state", "File icon + filename + size. Tappable to preview (images) or download."],
      ["Supported types", "Images (jpg, png), PDF, Word, Excel — per backend limits."]
    ]
  );

  sc("A.2.15", "Error / Fallback Message", true, ["MCP-08", "AI-05"],
    "Backend timeout · goal not understood · tool failure",
    "Scenario-based fallback messages with recovery options (try again / chips / agent).",
    "chat",
    {
      quick: null,
      messages: [
        { t: "ai", text: "I'm having trouble reaching the system right now. Please try again in a moment, or I can connect you to an agent.", tone: "error" },
        { t: "chips", items: [{ l: "Try Again" }, { l: "Talk to an Agent" }] },
        { t: "ai", text: "I'm not sure I understand. Could you rephrase that, or choose from the options below?", tone: "error" },
        { t: "chips", items: [{ l: "Check Order" }, { l: "Track Case" }, { l: "Talk to an Agent" }] }
      ]
    },
    [
      ["Backend timeout", "“I'm having trouble reaching the system right now…” + Try Again / agent options."],
      ["Goal not understood", "“Could you rephrase that…” + quick reply chips."],
      ["Tool call failed", "“Something went wrong while processing your request. I've logged this…”"]
    ]
  );

  sc("A.2.16", "Satisfaction Survey Card", false, ["RP-01"],
    "After conversation resolution (AI or human)",
    "Star rating (1–5) with optional comment and a Skip link.",
    "chat",
    {
      quick: null,
      messages: [
        { t: "ai", text: "Before you go — how was your experience?" },
        { t: "survey", stars: 4, comment: "Fast and helpful!" }
      ]
    },
    [
      ["Trigger", "Shown after conversation resolution (AI or human)."],
      ["Layout", "“How was your experience?” + star rating (1–5) or emoji scale + optional text comment."],
      ["Dismiss", "“Skip” link."]
    ]
  );

  sc("A.2.17", "Voice Mode Overlay", true, ["OC-05"],
    "Customer taps 🎤 in the input area",
    "Full-width overlay with animated waveform, live transcription bubble and TTS playback of AI responses.",
    "modal",
    {
      voice: {
        transcript: "I'd like to check my transaction history for the past month…",
        listening: true
      },
      title: null
    },
    [
      ["Trigger", "Customer taps 🎤 in the input area."],
      ["Overlay", "Full-width bottom overlay: animated waveform, “Listening…” label, stop button."],
      ["Transcription", "Real-time transcript as a growing text bubble; editable before sending."],
      ["AI voice response", "If voice mode active, AI response also read aloud (TTS); visual transcript still shown."]
    ]
  );

  sc("A.2.18", "Menu / Guided Navigation Mode", true, ["OC-04", "AI-04"],
    "Customer taps the ☰ Menu mode in the widget header",
    "A browsable menu tree replaces the message thread — breadcrumb, search box, drill-down sub-menus and a free-text hint. Selecting a leaf sends the chosen request text back to Chat mode.",
    "chat",
    {
      wkey: "a218",
      modes: true,
      active: "menu",
      menu: [
        { ic: "✓", label: "Check Order", hint: "Track delivery" },
        { ic: "＋", label: "Submit Request", hint: "New request",
          sub: [
            { ic: "·", label: "Complaint", hint: "Report an issue" },
            { ic: "·", label: "Refund Request", hint: "Invoice #4521" },
            { ic: "·", label: "Feature Suggestion", hint: "Give feedback" }
          ] },
        { ic: "▶", label: "Track Ticket", hint: "Case follow-up" },
        { ic: "⚙", label: "Account Services", hint: "Balance & activity",
          sub: [
            { ic: "·", label: "View Balance", hint: "Current balance" },
            { ic: "·", label: "Recent Transactions", hint: "Last 10 entries" }
          ] },
        { ic: "✆", label: "Talk to an Agent", hint: "Live handoff" }
      ],
      quick: null,
      messages: []
    },
    [
      ["Mode switcher", "Segmented control toggles between **✎ Chat** (free-text) and **☰ Menu** (guided navigation)."],
      ["Breadcrumb", "“Home ▸ [Parent] ▸ [Current]” — tap any crumb to jump back; Home resets to the top level."],
      ["Menu rows", "Top-level services with chevron (▸) for sub-menus; leaf items show a right arrow (→) and send the request."],
      ["Search box", "“Search menu or type a question…” — filters menu items and/or starts a free-text query."],
      ["Free-text hint", "“Tip: you can also type your question freely in the input below” — no need to browse the menu."],
      ["Request selection", "Picking a leaf appends the chosen request text in Chat mode and returns to the conversation — the agent interprets it like any free-text message."]
    ],
    ["Builds on the same menu tree configured in A.3.1 (menu config).", "Menu tree is tenant-configurable and supports nested levels."]
  );

  /* ---------- A.3 Configuration ---------- */

  sc("A.3.1", "Widget Embed Config Object", true, ["OC-04"],
    "Host website initialization",
    "The configuration object passed to NextBot.init() on the host site — theming, channels, quick actions, menu tree and proactive nudge.",
    "code",
    {
      title: "Host-side embed configuration",
      code: `NextBot.init({
  tenantId: "your-tenant-id",
  channelId: "web-widget",
  position: "bottom-right",
  language: "auto",          // "auto" | "en" | "ar" | ISO-639
  direction: "auto",         // "auto" | "ltr" | "rtl"
  theme: {
    primaryColor: "#1B6B4A",
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    launcherIcon: "https://example.com/assets/icon.svg",
    headerTitle: "Support",
    headerTitleAr: "الدعم"
  },
  quickActions: [
    { label: "Check Status", labelAr: "حالة الطلب", request: "I want to check my order status" },
    { label: "New Request", labelAr: "طلب جديد", request: "I want to submit a new request" },
    { label: "Track Case", labelAr: "متابعة", request: "I want to track my case" }
  ],
  menu: {
    enabled: true,
    defaultMode: "chat",       // "chat" | "menu"
    items: [
      { label: "Check Order", request: "I want to check my order" },
      { label: "Submit Request", children: [
        { label: "Complaint", request: "I want to file a complaint" },
        { label: "Refund Request", request: "I want to request a refund" },
        { label: "Feature Suggestion", request: "I have a feature suggestion" }
      ]},
      { label: "Track Ticket", request: "I want to track my ticket" },
      { label: "Account Services", children: [
        { label: "View Balance", request: "I want to view my balance" },
        { label: "Recent Transactions", request: "I want to see my recent transactions" }
      ]},
      { label: "Talk to an Agent", request: "I want to talk to a human agent" }
    ]
  },
  proactiveNudge: {
    enabled: true,
    delaySeconds: 15,
    message: "Need help?",
    messageAr: "هل تحتاج مساعدة؟"
  }
});`
    },
    [
      ["Purpose", "Not a screen — the configuration interface the host website uses to embed the widget."],
      ["Contents", "Tenant + channel ID, position, language/direction, theme, quick actions, menu tree, proactive nudge."],
      ["Menu config", "menu.items supports nested children for guided navigation; defaultMode picks Chat or Menu as the initial tab."]
    ]
  );

  window.NEXTBOT_SCREENS = window.NEXTBOT_SCREENS || [];
  Array.prototype.push.apply(window.NEXTBOT_SCREENS, S);
})();