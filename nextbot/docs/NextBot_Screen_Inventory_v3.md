# NextBot Platform — Complete Screen Inventory
## BA & UX Specification: Every Expected Screen

**Document type:** Screen Inventory & Wireframe Specification
**Version:** 3.1 (Generic Platform — Tahseel-specific content removed; MCP Agent Tool Config added; Agent Platform Architecture screens added)
**Date:** August 15, 2026
**Companion to:** NextBot PRD v2.0, Gap Analysis, Agent Platform Architecture Specification
**Audience:** UI/UX designers, frontend developers, QA, platform engineers

---

## Document Structure

This inventory is organized by **portal** (who uses it) and then by **functional area**. Every screen references the PRD requirement(s) it fulfills and names the data objects it reads or writes. Screens marked with 🔵 are launch-critical (Phases 1–3). Screens marked with 🟡 are post-launch (Phases 4–6).

**v3.0 changes:** All customer-specific references (Tahseel, government fee use cases) have been removed. NextBot is now described as a **generic omnichannel AI agent orchestration platform** — any customer-specific backend is enrolled through the MCP connector framework. A new **MCP Agent Tool Configuration** section (B.3) allows platform admins to register, discover, permission, and test MCP servers and their tools — the primary mechanism by which any project's backend services are made available to the AI agent.

**v3.1 changes:** Added **B.15 — Agent Platform Architecture Console**, a new Admin Console section exposing the four-plane agent architecture (Control Plane / Data Plane / Gateway Plane / Observability Plane) that underlies the AI Agent Orchestration Core referenced throughout Portals A–E: Agent Definition Registry, code-first Agent Builder, Deployment & Canary Manager, Eval Suite Runner, Model Gateway Configuration, and Runtime Observability / Trace Explorer. A companion **Appendix: Agent Platform Architecture (Engineering Reference)** documents the underlying system design these screens expose. New requirement IDs (AGT-01 through AGT-12) are introduced for these capabilities pending incorporation into PRD v2.1.

---

## Portal Map

| Portal | Primary User | Access Method |
|---|---|---|
| **A — Embeddable AI Assistant Widget** | End customer / Employee | Embedded `<script>` tag or SDK in any website or mobile app |
| **B — Admin Console** | Platform Admin, Backend System Owner | Authenticated web app (SSO/MFA) |
| **C — Conversation Designer Studio** | Conversation/Bot Designer | Authenticated web app (section within Admin Console) |
| **D — Human Agent Bridge** | Human Escalation Agent | Lightweight panel within the Admin Console + deep-link into backend system |
| **E — Developer Portal** | Developer / Integrator | Authenticated web app or docs site |

---

# PORTAL A — Embeddable AI Assistant Widget

The widget is the customer-facing conversational front door. It must be embeddable in any website via a `<script>` tag and in mobile apps via WebView/SDK. It is channel-aware: the same conversation engine powers the widget, WhatsApp, voice, etc. — but the widget has its own visual design system.

---

## A.1 Widget Shell & Lifecycle

### A.1.1 — Launcher Button (Collapsed State) 🔵
**PRD refs:** OC-01, OC-04
**Trigger:** Page load on host website/app

| Element | Detail |
|---|---|
| Floating action button | Bottom-right (configurable position). Circular or pill-shaped. Displays brand icon or animated AI avatar. |
| Unread badge | Numeric badge when there is an unresolved message or a proactive nudge. |
| Tooltip on hover | Configurable label (e.g., "Chat with us" — bilingual if configured). |
| Animations | Subtle pulse or bounce on first load to attract attention. Respects `prefers-reduced-motion`. |
| Branding | Host brand colors, icon, and launcher shape are configurable via widget config (passed in embed script). |

**Behavior notes:**
- Launcher persists across page navigations (SPA-aware).
- On mobile, launcher respects safe-area insets.
- Clicking opens A.1.2.

---

### A.1.2 — Widget Window (Expanded State) 🔵
**PRD refs:** OC-01, OC-04, OC-07

| Zone | Elements |
|---|---|
| **Header bar** | Brand logo / AI assistant name, language toggle (configurable languages), minimize button (→ A.1.1), close/end-chat button. |
| **Conversation area** | Scrollable message thread. See A.2.x for message bubble types. |
| **Input area** | Text input field, send button, attachment button (📎), voice-input toggle (🎤). |
| **Quick-action bar** (optional) | Persistent shortcut chips below header — configurable per deployment, map to pre-filled request text. The agent still extracts the full parameters from the conversation. |
| **Powered-by footer** | "Powered by NextBot" — removable via white-label config. |

**Layout behavior:**
- Desktop: 400px wide × 600px tall floating panel, bottom-right.
- Mobile: Full-screen overlay or bottom-sheet (configurable).
- RTL layout auto-activates when an RTL language is selected.

---

### A.1.3 — Welcome / Home Screen 🔵
**PRD refs:** OC-04, AI-04, KB-01

Displayed when the widget opens with no active conversation, or after a conversation is resolved.

| Element | Detail |
|---|---|
| Greeting message | Personalized if identity is known ("Welcome back, [Name]"), generic otherwise ("Welcome 👋"). Configurable per deployment. |
| Service menu cards | Grid or list of top-level goals / common requests (shortcuts only) — fully configurable per tenant (e.g., "Check Order", "Submit Request", "Track Ticket", "Ask a Question"). Each card has an icon and label. Tapping a card pre-fills the request; the agent extracts the full parameters from the conversation (no intent classification). |
| Search/type bar | "Ask me anything…" — for free-text entry. |
| Recent conversation preview | If session exists, shows last message + "Continue conversation" link. |

---

### A.1.4 — Language Selection Modal 🔵
**PRD refs:** OC-07

| Element | Detail |
|---|---|
| Language options | Shown as tappable cards. Language list configurable per tenant (supports 40+ languages per NFR). |
| Auto-detect banner | "We detected your language as [X]. Continue?" — shown only when auto-detection fires. |
| Persist choice | Selection stored in local storage / session. Subsequent messages and AI responses use the selected language. |

---

### A.1.5 — Proactive Nudge Bubble 🟡
**PRD refs:** OC-04, META-08

| Element | Detail |
|---|---|
| Trigger | Configurable rules: time on page, scroll depth, specific URL path, returning visitor. |
| Display | Small speech bubble above the launcher button with a one-line message. Auto-dismisses after configurable seconds or on click. |
| Tap behavior | Opens widget to A.1.3 with the nudge goal pre-loaded. |

---

## A.2 Conversation Message Types

These are the bubble/card types rendered inside the conversation area (A.1.2). All must support both LTR and RTL layouts.

### A.2.1 — Text Message Bubble 🔵
**PRD refs:** AI-04

| Variant | Detail |
|---|---|
| AI message (left-aligned) | Avatar icon + text bubble. Supports markdown-like rendering (bold, links, line breaks). Typing indicator (three dots) shown while AI is processing. |
| Customer message (right-aligned) | Plain text bubble, right-aligned. Shows sent/delivered/read status ticks on channels that support it. |
| System message (centered) | Gray, smaller text — used for "Conversation started", "Transferred to agent", timestamps. |

---

### A.2.2 — Quick Reply Chips 🔵
**PRD refs:** AI-04, META-09

| Element | Detail |
|---|---|
| Chip row | Horizontal scrollable row of tappable chips below an AI message. Labels are plain text — no intent binding. |
| Behavior | Tapping a chip sends it as a user message and disables the row (single-use). |
| Mapping | Maps to WhatsApp interactive buttons (META-09) when conversation is on WhatsApp channel. |

---

### A.2.3 — Interactive List / Picker 🔵
**PRD refs:** AI-04, META-09

Used when the AI needs the customer to select from a list (e.g., service types, linked accounts, categories).

| Element | Detail |
|---|---|
| List card | Card with a title, a scrollable list of items (each with label + optional subtitle + optional icon), and a "Select" action per row. |
| Search/filter | Optional search bar at the top of the list for lists > 8 items. |
| Selection confirmation | After tapping, the selected item appears as a customer message bubble. |

---

### A.2.4 — External Link / Action Card 🔵
**PRD refs:** MCP-07

Displayed when the AI returns an external URL from any connected backend (e.g., a payment link, a portal redirect, a document viewer).

| Element | Detail |
|---|---|
| Card layout | Backend/brand logo + description, amount or summary (if applicable), and a prominent action button ("Open →", "Pay Now →", "View →") that opens the URL in a new tab. |
| Security note | Small text: "You'll be redirected to [domain]." |
| Post-click state | Card updates with a follow-up prompt (e.g., "Let me know once you're done" with a "Check Status" chip). |

---

### A.2.5 — Document / File Download Card 🔵
**PRD refs:** MCP-07

| Element | Detail |
|---|---|
| Card layout | File icon + document name, file size, and a "Download" button. |
| Behavior | Tapping "Download" opens the backend-generated URL in a new tab or triggers a file download. |

---

### A.2.6 — Data Summary Card 🔵
**PRD refs:** MCP-07

Generic card for displaying structured data returned from any MCP tool call (e.g., account balance, order status, subscription info).

| Element | Detail |
|---|---|
| Card layout | Title/label at top, primary value in center (large text), supporting fields below (key-value pairs). Timestamp. |
| Actions row | Quick-action chips rendered below the card — dynamically generated based on available follow-up tools. |
| Theming | Card accent color and icon are configurable per backend connector. |

---

### A.2.7 — Data Table / List Card 🔵
**PRD refs:** MCP-07

Generic card for displaying tabular data returned from any MCP tool call (e.g., transaction history, order list, search results).

| Element | Detail |
|---|---|
| Table/list layout | Scrollable list of rows. Each row renders fields from the tool-call response (columns configurable per tool). |
| Overflow | "Show more" link if rows exceed display limit (paginated via tool call). |
| Empty state | "No results found." |

---

### A.2.8 — Form Collection Card (Multi-Field) 🔵
**PRD refs:** AI-01, AI-04

Used when the AI needs to collect multiple fields at once (e.g., any structured data submission).

| Element | Detail |
|---|---|
| Embedded form | Card with labeled input fields rendered inline in the chat. Fields: text input, email input, phone input, dropdown/select, textarea, file upload. |
| Validation | Inline field-level validation (email format, required fields). |
| Submit button | "Submit" button at the bottom of the card. On submit, data is sent to the AI core as a structured message. |
| Fallback | If form rendering is not supported (e.g., on WhatsApp), the AI falls back to sequential question-by-question collection (one message per field). |

---

### A.2.9 — OTP / Identity Verification Card 🔵
**PRD refs:** MCP-07

Generic identity verification card — used whenever any connected backend requires OTP or identity confirmation before granting access to protected data.

| Element | Detail |
|---|---|
| Card layout | "Enter the verification code sent to your registered contact" + digit input field (numeric keypad on mobile). |
| Timer | "Resend code" link with countdown timer. |
| Error state | "Incorrect code. Please try again." with retry count. |
| Success state | Checkmark animation + "Verified successfully!" |

---

### A.2.10 — Confirmation / Action Card 🔵
**PRD refs:** MCP-05

Used before any write-action tool call that requires customer confirmation (Tier 2 approval).

| Element | Detail |
|---|---|
| Card layout | Summary of the action about to be taken — dynamically populated from the tool-call args (e.g., action type, amount, target, reference). |
| Action buttons | "Confirm" (primary) + "Cancel" (secondary). |
| Disclaimer | Configurable per tool (e.g., "This action cannot be undone."). |

---

### A.2.11 — Human Handoff Notification 🔵
**PRD refs:** AI-05, ESC-01, ESC-02

| Element | Detail |
|---|---|
| System message | "I'm connecting you with a support agent. Please hold on…" |
| Wait indicator | Animated dots or position-in-queue display. |
| Agent joined | "Agent [Name] has joined the conversation." Agent messages render with a different avatar/color from AI messages. |
| Return-to-bot | After resolution, system message: "Your issue has been resolved. Returning to AI assistant." |

---

### A.2.12 — Ticket / Case Created Confirmation Card 🔵
**PRD refs:** TCK-01, MCP-07

| Element | Detail |
|---|---|
| Card layout | Checkmark icon + "Case Created" title. Fields: tracking number (copyable), type, priority, created date. |
| Actions | "Track This Case" chip (feeds tracking number to status-check tool). |

---

### A.2.13 — Ticket / Case Status Card 🔵
**PRD refs:** TCK-02

| Element | Detail |
|---|---|
| Card layout | Tracking number, current status (Open / In Progress / Resolved / Closed), assigned team, last update date and note. |
| Status visual | Colored status badge or progress stepper bar. |

---

### A.2.14 — File Upload / Attachment Bubble 🔵
**PRD refs:** TCK-06

| Element | Detail |
|---|---|
| Upload trigger | Customer taps 📎 in input area → file picker opens. |
| Upload progress | Progress bar inside the attachment bubble while uploading. |
| Completed state | File icon + filename + size. Tappable to preview (images) or download. |
| Supported types | Images (jpg, png), PDF, Word, Excel — per backend limits. |

---

### A.2.15 — Error / Fallback Message 🔵
**PRD refs:** MCP-08, AI-05

| Scenario | Message |
|---|---|
| Backend timeout | "I'm having trouble reaching the system right now. Please try again in a moment, or I can connect you to an agent." |
| Goal not understood | "I'm not sure I understand. Could you rephrase that, or choose from the options below?" + quick reply chips. |
| Tool call failed | "Something went wrong while processing your request. I've logged this — would you like to try again or speak with an agent?" |

---

### A.2.16 — Satisfaction Survey Card 🟡
**PRD refs:** RP-01

| Element | Detail |
|---|---|
| Trigger | Shown after conversation resolution (AI or human). |
| Layout | "How was your experience?" + star rating (1–5) or emoji scale + optional text comment. |
| Dismiss | "Skip" link. |

---

### A.2.17 — Voice Mode Overlay 🔵
**PRD refs:** OC-05

| Element | Detail |
|---|---|
| Trigger | Customer taps 🎤 in input area. |
| Overlay | Full-width overlay at bottom of widget with animated waveform, "Listening…" label, and a stop button. |
| Transcription | Speech is transcribed in real time and shown as a growing text bubble. Customer can edit before sending. |
| AI voice response | If voice mode is active, AI response is also read aloud (text-to-speech). Visual transcript still shown. |

---

## A.3 Widget Configuration & Theming (Host-Side)

### A.3.1 — Widget Embed Config Object 🔵
**PRD refs:** OC-04

Not a "screen" per se, but the configuration interface the host website uses:

```
NextBot.init({
  tenantId: "your-tenant-id",
  channelId: "web-widget",
  position: "bottom-right",
  language: "auto",        // "auto" | "en" | "ar" | any ISO-639 code
  direction: "auto",       // "auto" | "ltr" | "rtl"
  theme: {
    primaryColor: "#1B6B4A",
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    launcherIcon: "https://example.com/assets/icon.svg",
    headerTitle: "Support",
    headerTitleAr: "الدعم",   // optional — per-language header titles
  },
  quickActions: [
    { label: "Check Status", labelAr: "حالة الطلب", request: "I want to check my order status" },
    { label: "New Request", labelAr: "طلب جديد", request: "I want to submit a new request" },
    { label: "Track Case", labelAr: "متابعة", request: "I want to track my case" },
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
});
```

---

# PORTAL B — Admin Console

The Admin Console is the back-office web application for platform administrators and backend system owners.

---

## B.1 Dashboard & Navigation

### B.1.1 — Global Navigation Shell 🔵
**PRD refs:** ADM-01, ADM-02

| Element | Detail |
|---|---|
| Left sidebar | Collapsible nav with sections: Dashboard, Channels, Connectors (MCP), Tool Catalog, Agent Tool Config, Agent Platform (B.15 — Definitions, Deployments, Evals, Model Gateway, Runtime Traces), Conversations, Escalations, Approvals, Reports, A2A, Settings. Icons + labels. |
| Top bar | Tenant name / logo, environment badge (Sandbox / Production — per ADM-05), global search, notifications bell, user avatar + role label + logout. |
| Breadcrumb | Context trail below top bar: e.g., "Connectors > [Backend Name] > Tools > [tool_name]". |

---

### B.1.2 — Dashboard Home 🔵
**PRD refs:** RP-01 through RP-08

| Widget | Data Source | Visual |
|---|---|---|
| Conversations today | RP-01 | Large number + sparkline trend. |
| AI resolution rate | RP-04 | Percentage gauge + trend arrow. |
| Pending approvals | MCP-05 | Count badge + "View queue" link. |
| Active escalations | ESC-01 | Count + breakdown by backend. |
| Channel breakdown | RP-01 | Donut chart: web widget, WhatsApp, voice, email, etc. |
| Tool call health | RP-02 | Mini table: top 5 tools by volume, each with success rate + avg latency. |
| AI cost today | RP-07 | Dollar/credit amount + daily burn rate. |
| Connected backends status | MCP-01 | Card per connector: name, status dot (green/amber/red), last health check, tool count. Click → B.3.1. |
| Pending approvals badge | MCP-05 | Prominent count badge linking to B.3.6 (Approval Queue). |
| Recent alerts | MCP-08 | Last 5 alerts: backend failures, rate-limit warnings, SLA breaches, A2A auth failures. Severity-colored. "View all" → B.8.2. |

---

## B.2 Channel Management

### B.2.1 — Channel Overview List 🔵
**PRD refs:** OC-01, OC-06

| Element | Detail |
|---|---|
| Table | One row per configured channel: name, type (Web Widget / WhatsApp / Messenger / Instagram / Voice / Email / SMS / Slack / Teams / Twitter-X), status (Active / Inactive / Error), message volume (last 24h). |
| Actions | "Configure" (→ B.2.2 or B.2.3 or B.2.5), "Disable", "View Routing Rules" (→ B.2.4). |
| Add button | "+ Add Channel" → channel type picker → type-specific setup wizard. |

---

### B.2.2 — Web Widget Channel Config 🔵
**PRD refs:** OC-04

| Tab | Fields |
|---|---|
| General | Widget name, description, status toggle, allowed domains (CORS). |
| Appearance | Primary color, font, launcher icon, header title (multilingual), position (bottom-right / bottom-left), mobile behavior (full-screen / bottom-sheet). |
| Quick Actions | Ordered list of quick-action chips: label (multilingual), pre-filled request text. Add/remove/reorder. |
| Proactive Nudge | Enable toggle, delay (seconds), trigger rules (URL, time on page), message (multilingual). |
| Embed Code | Read-only `<script>` snippet + copy button. Preview iframe showing the configured widget in real time. |

---

### B.2.3 — Meta Channel Connector Config 🔵
**PRD refs:** META-01 through META-13

| Tab | Fields |
|---|---|
| Business Manager | Meta Business Manager ID, verification status badge, link/unlink button. OAuth linking step: "Connect to Meta Business Manager" button → OAuth flow → displays verified name + ID. |
| WhatsApp | WABA ID, phone number(s) with verification status, messaging tier gauge (Tier 1–4 visual), 24h session window policy toggle. |
| Messenger | Linked Facebook Page name + Page ID, page token status. |
| Instagram | Linked Instagram Professional account, handle display. |
| Credentials | System User token (masked, with rotate button), App ID, App Secret — all stored via SEC-02 vaulting. Last rotation date. Token shown as masked value with "Rotate Now" button. |
| Webhook | Webhook URL (read-only), verification token, verification status badge (Verified / Pending / Failed), "Re-verify Challenge" button, subscription status per event type, last event received timestamp. |
| Templates | Table of registered WhatsApp message templates: name, language, status (Approved/Pending/Rejected), variable list. "Sync from Meta" button. "Create New" button. |
| Consent/Opt-in | Opt-in tracking toggle, consent log viewer (META-13). Opt-in list viewer: customer phone (masked), opt-in date, consent source, status. Bulk import/export. |

---

### B.2.4 — Channel Routing Rules 🔵
**PRD refs:** OC-06, META-10

| Element | Detail |
|---|---|
| Rules table | Rows: one per rule. Columns: channel(s), condition (recognized task / customer segment / time of day), action (allow / deny / redirect to queue). |
| Rule editor | Condition builder: IF channel = [X] AND recognized task = [Y] AND [condition] THEN [action]. |
| Priority order | Drag-to-reorder. First matching rule wins. |
| Test tool | "Test a scenario" panel: select channel + type a sample utterance → shows which rules would fire. |

---

### B.2.5 — Voice / IVR Channel Config 🔵
**PRD refs:** OC-05

| Tab | Fields |
|---|---|
| Phone Numbers | List of connected phone numbers. Provider (Twilio, Genesys, etc.). Status. |
| STT/TTS | Speech-to-text engine config (language models). Text-to-speech voice selection (male/female, language). |
| IVR Menu | Optional pre-AI IVR tree for basic routing. Visual tree editor. |
| Fallback | Behavior when voice channel fails: queue to human, voicemail, or callback request. |

---

## B.3 MCP Backend Connector Management (Core Differentiator)

This is the heart of NextBot's backend-agnostic integration framework. Every backend system — ticketing, CRM, ERP, billing, HRIS, knowledge base, or any custom system — is connected through this section. The AI agent can only call tools that have been registered, discovered, and permissioned here.

### B.3.1 — Connector Overview List 🔵
**PRD refs:** MCP-01, ADM-01

| Element | Detail |
|---|---|
| Table | One row per registered MCP server: connector name, backend type (Ticketing / CRM / ERP / Billing-Payments / HRIS / Knowledge Base / Custom), environment (Sandbox / Production), status (Connected / Degraded / Offline), tool count, last health check. |
| Actions | "Configure" (→ B.3.2), "View Tools" (→ B.3.4), "Test Connection", "Disable". |
| Add button | "+ Add Connector" (→ B.3.3) |
| Status indicators | Green/amber/red dots for each connector. Amber if latency is degraded; red if offline or auth expired. |

---

### B.3.2 — Connector Detail / Edit 🔵
**PRD refs:** MCP-01, MCP-12, SEC-02

| Tab | Fields |
|---|---|
| General | Name, description, backend type (dropdown: Ticketing, CRM, ERP, Billing/Payments, HRIS, Knowledge Base, Custom), environment (Sandbox / Production toggle — ADM-05). |
| Connection | Transport type: **Streamable HTTP** (URL, headers) or **stdio-via-Gateway-Agent** (Gateway Agent ID, local command). Authentication method: OAuth2, API Key, Bearer Token, Custom Header. Credentials (masked, stored via SEC-02). |
| Health Check | Ping interval, timeout threshold, failure alert recipients. Health history chart (last 7 days). |
| Gateway Agent (if stdio) | Agent ID, last heartbeat, tunnel status (connected/disconnected), version. |
| Tool Overrides | Per-tool configuration overrides specific to this connector instance (display names, approval tier overrides, channel restrictions). |

---

### B.3.3 — Add Connector Wizard 🔵
**PRD refs:** MCP-10, MCP-11

| Step | Content |
|---|---|
| 1 — Choose Type | Card grid: **pre-built templates** (Zendesk, Salesforce, SAP, Jira SM, Freshdesk, HubSpot, NetSuite, ServiceNow, etc. — MCP-10) OR **"Custom MCP Server"** (MCP-11). Each template card shows: logo, name, backend type, "X tools available", brief description. |
| 2 — Connection Details | Transport, URL/endpoint, credential entry. For templates: pre-populated fields with guided instructions. For custom: manual entry with JSON schema validation. |
| 3 — Discover Tools | "Discover Tools" button → calls `list_tools` on the MCP server → shows discovered tool list with names, descriptions, input/output schemas. Admin reviews and confirms which tools to **enable** (unchecked tools are hidden from the AI agent). |
| 4 — Set Permissions | Per-tool permission defaults (channel, role, task/scope — see B.3.5). Default approval tiers pre-set by read/write classification. |
| 5 — Test | Sandbox tool-call test panel: pick a tool, enter sample args, execute, view response. |
| 6 — Activate | Confirmation + activate in production toggle. |

---

### B.3.4 — Tool Catalog 🔵
**PRD refs:** MCP-02, MCP-03

The central registry of every tool available to the AI agent across all connected backends.

| Element | Detail |
|---|---|
| Filter bar | Filter by: backend connector, tool type (Read / Write), approval requirement (Tier 1 Autonomous / Tier 2 Customer Confirmation / Tier 3 Human Approval), status (Enabled / Disabled). |
| Tool table | Name, backend connector, description, type (Read/Write), approval tier, call count (last 7d), avg latency, error rate. |
| Tool detail (side panel or page) | Full JSON schema (input + output), description, permission scope, approval config, call history log (last 50 calls), latency chart. |
| Bulk actions | Enable/disable multiple tools, change approval tier in bulk, export catalog as JSON. |

---

### B.3.5 — Tool Permission Editor 🔵
**PRD refs:** MCP-04, SEC-06

| Element | Detail |
|---|---|
| Scope matrix | Rows = tools, Columns = dimensions (Channel, Role, Recognized task, Customer Segment). Each cell = Allow / Deny / Require Approval. |
| Rule builder | "When [channel = X] AND [recognized task = Y] AND [condition] → [action]." |
| Inheritance | Default permission per backend type (e.g., all Billing write-tools default to "Require Customer Confirmation"), overridable per tool. |

---

### B.3.6 — Approval Queue 🔵
**PRD refs:** MCP-05, ADM-04

| Element | Detail |
|---|---|
| Queue list | Pending tool-call approvals. Columns: timestamp, tool name, backend, initiating conversation (link), requested action summary, requesting channel, wait time. |
| Approval detail | Full context panel: conversation transcript excerpt, recognized goal, tool call args (payload), customer identity (if verified). |
| Actions | "Approve" (executes the tool call), "Reject" (returns rejection message to AI, which informs the customer), "Request More Info" (sends a question back into the conversation). |

---

### B.3.7 — Connector Instance Config 🔵
**PRD refs:** Section 6.5, MCP-01

This is a reusable detail screen for any specific connector instance. When an admin clicks "Configure" on any connector in B.3.1, they land here with fields populated for that backend.

| Tab | Fields |
|---|---|
| General | Connector name, environment, status. |
| Connection | Backend API base URL, authentication (OAuth2 / API Key / Bearer Token — per B2B agreement), credentials (vaulted via SEC-02). |
| Tools | Discovered tool list with per-tool approval tier configuration. Each tool shows: name, description, schema, read/write badge, current approval tier, enable/disable toggle. |
| Policies | Configurable per connector: default approval tier for write tools, amount thresholds for elevated approval, required pre-call tools (e.g., "must call `list_items` before `process_action`"), identity verification requirements. |
| Test | Sandbox test panel scoped to this connector's tools. |

---

## B.3A — MCP Agent Tool Configuration (NEW — Platform-Level AI Agent Tool Management)

This section governs **how the AI agent discovers, selects, and calls MCP tools** across all connected backends. While B.3 manages the connector/backend registration, B.3A manages the **agent-facing configuration** — which tools are available to the AI, how they're prioritized, how they're composed into multi-step workflows, and how new MCP servers can be enrolled as callable tools by the platform's AI agents.

### B.3A.1 — Agent Tool Registry 🔵
**PRD refs:** MCP-02, MCP-03, AI-02, AI-03

The unified view of every MCP tool the AI agent can call, aggregated across all connected backends. This is the platform admin's primary screen for controlling what the AI agent is capable of.

| Element | Detail |
|---|---|
| **Unified tool list** | Table showing every enabled tool across all connectors: tool name, source connector, backend type, description, input schema summary, output schema summary, read/write classification, approval tier, agent-priority weight, status (Active / Disabled / Error). |
| **Search & filter** | Full-text search across tool names and descriptions. Filter by: connector, backend type, read/write, approval tier, agent-priority level, usage frequency, error rate. |
| **Agent visibility toggle** | Per-tool toggle: "Visible to AI Agent" — when OFF, the tool exists in the catalog but the AI orchestration core will never select it. Useful for temporarily hiding tools without disconnecting the backend. |
| **Priority weight** | Numeric weight (1–100) per tool influencing the AI agent's tool-selection reasoning. Higher weight = preferred when multiple tools could satisfy the same goal. Drag-to-reorder within the same capability group. |
| **Tool grouping** | Admin can group tools into named **capability groups** (e.g., "Order Management", "Billing", "HR Self-Service", "Knowledge") for organization and selection guidance (C.1.1 can bind a capability group to guidance rather than individual tools). |
| **Health summary** | Per-tool: last-call timestamp, last-24h success rate, avg latency, error count. Red highlight on tools with >5% error rate. |
| **Bulk actions** | Enable/disable multiple tools, assign to capability group, change approval tier, change priority weight. |

---

### B.3A.2 — MCP Server Enrollment 🔵
**PRD refs:** MCP-01, MCP-10, MCP-11, GEN-01

The primary screen for enrolling new MCP servers so their tools become available to the platform's AI agents. This is the generalized version of "Add Connector" (B.3.3) focused specifically on making tools callable by the agent.

| Step | Content |
|---|---|
| **1 — Source** | Choose how the MCP server will be enrolled: **a)** From connector template library (pre-built: Zendesk, Salesforce, SAP, Jira SM, Freshdesk, HubSpot, NetSuite, ServiceNow, Stripe, Twilio, custom HRIS, etc.); **b)** From URL — enter a Streamable HTTP endpoint URL for any MCP server; **c)** From Gateway Agent — select an on-prem Gateway Agent (B.12) and pick a locally-spawned stdio MCP server; **d)** From MCP server registry/marketplace — search a public or private MCP server directory (if configured). |
| **2 — Connect & Authenticate** | Enter connection details (URL, transport type). Select auth method (OAuth2 flow, API key, Bearer token, mTLS, Custom header). For OAuth2: initiate authorization flow inline — redirect → consent → token stored in vault (SEC-02). For API key: paste key → masked and vaulted. Test connection: green checkmark or error details. |
| **3 — Discover Tools** | "Discover" button calls `list_tools` on the MCP server. Displays all available tools in a checklist: tool name, description, input/output schema preview, read/write auto-classification. Admin checks which tools to **enroll** for the AI agent. Unchecked tools are ignored. |
| **4 — Configure Each Tool** | Per enrolled tool: **Display name** (override the MCP-provided name for clarity in the Tool Catalog and in conversation traces), **Description override** (refine the description the AI agent sees during tool-selection reasoning), **Approval tier** (Tier 1 Autonomous / Tier 2 Customer Confirmation / Tier 3 Human Approval — defaults based on read/write classification), **Agent priority weight** (1–100), **Capability group** assignment, **Channel restrictions** (which channels may trigger this tool), **Task/scope guidance** (prompt-level guidance on when the tool should be used — or "any"), **Rate limits** (max calls per minute/hour — to protect the backend). |
| **5 — Set Selection Guidance** | Optional: assign capability groups + priority weights so the agent prefers specific tools. This guides the agent's tool-selection reasoning — it does not define intent detection. If skipped, the AI agent uses tool descriptions + schemas for autonomous selection. |
| **6 — Test** | Sandbox test panel: pick any enrolled tool → fill sample args from its schema → execute against the connected backend (sandbox environment if available, production with read-only tools if not) → view full request/response. **End-to-end simulation:** type a natural-language message → see goal recognition → see which enrolled tool the AI selects → see the payload constructed from the tool schema → see tool call → see synthesized AI response. |
| **7 — Review & Activate** | Summary: MCP server URL, auth method, enrolled tool count, approval tiers, selection guidance, channel restrictions. "Activate" button makes all enrolled tools live for the AI agent. |

---

### B.3A.3 — Tool Composition / Multi-Tool Workflows 🔵
**PRD refs:** AI-03 (Multi-Step / Multi-Backend Planning)

Allows admins to define **explicit multi-step tool chains** that the AI agent should follow for specific tasks, rather than relying entirely on autonomous tool-selection reasoning.

| Element | Detail |
|---|---|
| **Workflow list** | Table: workflow name, trigger condition(s), steps count, connectors involved, status (Active / Draft). |
| **Workflow builder** | Visual step editor: Step 1 → Step 2 → Step 3, with branching (if/else based on tool output). Each step: select tool (from Agent Tool Registry), define which output fields feed into the next step's input, set conditions for branching. |
| **Example workflow** | "Order Refund": Step 1 — `crm.get_customer_profile` (check account tier) → Step 2 — `erp.get_order_status` (verify order exists) → IF order.status = "delivered" → Step 3 — `billing.issue_refund` (Tier 3 approval) → Step 4 — `ticketing.create_ticket` (log the refund case). |
| **Cross-backend data passing** | Visual mapping of output fields from one tool to input fields of the next. Type checking against schemas. |
| **Fallback / error handling** | Per step: define what happens if the tool call fails — retry, skip, escalate to human, call alternative tool. |
| **Test** | Simulate the full workflow with sample inputs. Shows each step executing in sequence with actual or mock tool responses. |

---

### B.3A.4 — MCP Server Health & Monitoring 🔵
**PRD refs:** MCP-08, RP-02

Centralized health view across all enrolled MCP servers and their tools.

| Element | Detail |
|---|---|
| **Server status grid** | Card per enrolled MCP server: name, URL/gateway, status (Online / Degraded / Offline), uptime (last 30d), avg response time, total tool calls (last 24h). Click → B.3.2 connector detail. |
| **Tool-level health table** | Per tool across all servers: success rate, avg latency (p50/p95/p99), error count, last error message, call volume trend (sparkline). Sort by error rate descending to surface problems. |
| **Alert configuration** | Per MCP server or per tool: set alert thresholds (latency > X ms, error rate > Y%, server offline > Z minutes). Alert destinations: email, Slack webhook, in-app notification. |
| **Circuit breaker status** | Shows which tools/servers have tripped the circuit breaker (auto-disabled due to repeated failures). "Reset" button to re-enable after investigating. |

---

### B.3A.5 — Tool Schema Inspector 🔵
**PRD refs:** MCP-02

Deep-dive into any tool's schema — for admins and developers to understand exactly what a tool accepts and returns.

| Element | Detail |
|---|---|
| **Input schema** | Full JSON Schema displayed as an interactive, collapsible tree. Each field: name, type, required/optional, description, constraints (enum values, min/max, pattern). |
| **Output schema** | Same interactive tree for the response schema. |
| **Try it** | Inline form auto-generated from the input schema. Fill values → call tool → view raw JSON response → view how the response maps to the output schema. |
| **Version history** | If the MCP server's tool schema changes (detected on re-discovery), show diff: added fields, removed fields, type changes. Alert if breaking changes could affect existing payload guidance or workflows. |
| **AI agent view** | Preview how the AI orchestration core "sees" this tool: the description + schema it uses for tool-selection reasoning. Edit the description override to improve AI accuracy. |

---

## B.4 Conversation Management

### B.4.1 — Conversation List 🔵
**PRD refs:** AI-06, RP-01

| Element | Detail |
|---|---|
| Filter bar | Channel, status (Active / Resolved / Escalated), date range, recognized task, backend involved, language. |
| Table | Conversation ID, channel icon, customer identifier (name/phone/email), last message preview, status badge, recognized goal, duration, resolution (AI / Human / Abandoned). |
| Bulk actions | Export, tag, archive. |

---

### B.4.2 — Conversation Detail / Trace Viewer 🔵
**PRD refs:** RP-08, MCP-06, MCP-07

This is the most information-dense screen in the console. It provides the end-to-end trace for debugging and QA.

| Panel | Content |
|---|---|
| **Left: Transcript** | Full conversation message timeline with sender labels (Customer / AI / Human Agent / System). Each AI message shows a "reasoning" expandable block showing which goal was recognized, which tool was selected and the payload constructed from its schema. Inline tool-call blocks appear as visually distinct expandable cards (tool name, backend badge, input/output JSON, latency, status). |
| **Center: Tool Call Timeline** | Vertical timeline of every MCP tool call in the conversation: tool name, backend, input args (collapsible JSON), output (collapsible JSON), latency, status (success/fail). Click a tool call → highlights the corresponding conversation message. |
| **Right: Context Panel** | Customer info (if known), linked accounts, channel metadata, session variables, escalation history, A2A task links (if any). |
| **Bottom: Raw Event Log** | Collapsible JSON log of every event: channel events, NLU results, tool calls, A2A messages. Filterable and searchable. |
| **AI confidence gauge** | Per-message confidence score shown as a colored bar (green >0.85, amber 0.60–0.85, red <0.60). Confidence trend sparkline for the full conversation at top. |
| **Replay** | "Replay in Test Console" button: opens the conversation in E.1.5 with the same inputs pre-loaded. |

---

## B.5 Escalation Management

### B.5.1 — Escalation Queue 🔵
**PRD refs:** ESC-01, ESC-03

| Element | Detail |
|---|---|
| Queue list | Active escalations awaiting human pickup. Columns: conversation ID, channel, customer, recognized goal, escalation reason (low confidence / tool failure / customer request / sensitive topic), wait time, assigned backend queue. |
| Priority sorting | SLA-aware sorting: longest wait first, with priority overrides. |
| Actions | "Take Over" (→ B.5.2), "Reassign" (to different queue/agent), "Return to Bot" (ESC-04). |

---

### B.5.2 — Live Agent Takeover Panel 🔵
**PRD refs:** ESC-02, ESC-01, AI-08

| Panel | Content |
|---|---|
| **Conversation panel** | Live conversation thread with customer. Agent types messages here. AI-generated draft reply shown as editable suggestion (AI-08). Tool-call context cards inline — showing what the AI already tried (tool name, inputs, outputs, status). |
| **Context panel** | AI summary of the conversation, recognized goal + extracted parameters, tool calls made, confidence score (with badge), customer info, linked accounts. |
| **Tool panel** | Agent can manually trigger MCP tool calls (with appropriate permissions) — e.g., create ticket, check status — directly from this panel. Tools listed from Agent Tool Registry (B.3A.1). |
| **Actions bar** | "Resolve & Close", "Transfer to [queue]", "Return to Bot", "Create Case" (opens tool call form). |

---

### B.5.3 — Escalation Routing Config 🔵
**PRD refs:** ESC-03

| Element | Detail |
|---|---|
| Rules table | IF [recognized goal = X] AND [channel = Y] → route to [queue Z]. |
| Backend queue mapping | Map NextBot escalation destinations to backend system queues/groups (e.g., Zendesk group, Jira SM queue). |
| Fallback rule | Default destination when no rule matches. |

---

## B.6 A2A (Agent-to-Agent) Management

### B.6.1 — Agent Card Editor 🟡
**PRD refs:** A2A-01

| Element | Detail |
|---|---|
| Card preview | JSON preview of the published agent card (capabilities, auth method, supported task types). |
| Capabilities toggle | Enable/disable which NextBot capabilities are exposed to external agents. |
| Publishing targets | Checkboxes: self-hosted well-known URI (always on), private registry (URL + credentials), public marketplace (URL + credentials — behind SEC-07 trust config). |

---

### B.6.2 — Trusted Agents List 🟡
**PRD refs:** A2A-05, SEC-07

| Element | Detail |
|---|---|
| Table | Registered external agents: agent name, identity URI, auth method (OAuth2 / API key), trust level (full / restricted), last activity, status. |
| Actions | "Add Agent", "Edit Permissions", "Revoke Trust", "Rotate Credentials". |

---

### B.6.3 — A2A Task Monitor 🟡
**PRD refs:** A2A-04, A2A-06, RP-05

| Element | Detail |
|---|---|
| Task list | Inbound and outbound A2A tasks. Columns: task ID, direction (inbound/outbound), requesting/target agent, status (submitted / working / input-required / completed / failed), linked conversation, created/updated timestamps. |
| Task detail | Full task payload, status history timeline, linked MCP tool calls, result payload. |

---

## B.7 Reporting & Analytics

### B.7.1 — Channel Performance Report 🔵
**PRD refs:** RP-01, RP-04

| Element | Detail |
|---|---|
| Filters | Date range, channel(s), language. |
| Metrics | Conversation volume, resolution rate, avg handling time, abandonment rate, CSAT (if survey enabled). |
| AI deflection by channel | Bar chart: per channel, percentage resolved by AI vs. escalated. Drill-down to escalation-driving goals/tasks. |
| Visualization | Line chart (volume over time), bar chart (by channel), table with drill-down. |

---

### B.7.2 — Tool Call Analytics 🔵
**PRD refs:** RP-02

| Element | Detail |
|---|---|
| Filters | Date range, backend, tool, outcome (success/fail). |
| Metrics | Call volume, success rate, avg latency (p50, p95, p99), error breakdown. |
| Per-tool detail | Latency distribution histogram, error breakdown by type, call volume trend, top-calling goals/tasks. |
| Visualization | Heatmap (tools × time), latency distribution chart, error rate trend. |

---

### B.7.3 — Goal / Capability Coverage Report 🔵
**PRD refs:** RP-03

| Element | Detail |
|---|---|
| Table | Goal/capability name, total occurrences, AI-resolved %, escalated %, escalation target backend, avg confidence. |
| Gap analysis | Heatmap: goals × channels. Highlight goals with > 30% escalation rate (candidates for improved AI handling or new tool support). Per goal: top escalation reasons, suggested improvements (new tools, better tool descriptions, playbooks). |

---

### B.7.4 — AI Cost Report 🔵
**PRD refs:** RP-07, AI-12

| Element | Detail |
|---|---|
| Metrics | Total AI credits/tokens consumed, cost per resolved conversation, cost by channel, cost by backend, budget utilization gauge. |
| Breakdown | Cost per goal/capability/tool, cost per backend (which backends' tool calls consume the most AI reasoning tokens). Burn-rate projection chart. |
| Budget controls | Set monthly budget cap, alert thresholds (80%, 90%, 100%). Auto-throttle policy when budget exceeded. Alert history. |

---

### B.7.5 — SLA Compliance Report 🟡
**PRD refs:** RP-06, TCK-07

| Element | Detail |
|---|---|
| Data source | Pulled from connected ticketing system (passthrough, not native). |
| Metrics | SLA breach rate, avg first response time, avg resolution time, by priority level. |

---

### B.7.6 — A2A Task Report 🟡
**PRD refs:** RP-05

| Element | Detail |
|---|---|
| Metrics | Inbound/outbound task volume, completion rate, avg duration, failure reasons. |

---

## B.8 Settings & Security

### B.8.1 — User & Role Management 🔵
**PRD refs:** ADM-02, SEC-03

| Element | Detail |
|---|---|
| User table | Name, email, role(s), last login, MFA status. |
| Role editor | Create/edit roles with granular permissions: channel config, connector config, tool permissions, agent tool config, approval queue access, reporting access, A2A config. Permission matrix across modules with Read/Write/None per module. |
| SSO config | SAML / OAuth2 provider config (IdP URL, client ID/secret, attribute mapping). SSO group mapping for automatic role assignment. |
| MFA enforcement | Toggle per role: require 2-step verification. |

---

### B.8.2 — Audit Log Viewer 🔵
**PRD refs:** ADM-03, MCP-06

| Element | Detail |
|---|---|
| Log table | Timestamp, actor (user / system / AI agent), action type (config change / tool call / login / escalation / A2A task / approval decision), target (connector / tool / conversation / user), details (collapsible JSON), outcome (Success / Failure / Pending). |
| Filters | Date range, actor, action type, event type (Tool Call / A2A Task / Admin Action / Approval Decision), target. Full-text search. |
| Detail drawer | PII-masked input/output payloads, linked conversation/A2A task IDs. |
| Export | CSV / JSON download. |

---

### B.8.3 — Environment Management 🔵
**PRD refs:** ADM-05

| Element | Detail |
|---|---|
| Environment list | Sandbox, Staging, Production — per connected backend. |
| Per-connector toggle | Each connector shows its current environment. "Promote to Production" workflow with confirmation. |

---

### B.8.4 — Data Residency & Retention 🔵
**PRD refs:** ADM-06, SEC-05

| Element | Detail |
|---|---|
| Storage region | Dropdown: configurable regions (e.g., UAE, EU, US). |
| Retention policies | Conversation transcripts: [X] days. Tool call payloads: [X] days. Tool call metadata only: [X] days. PII: auto-purge after [X] days. |
| GDPR/data subject tools | "Process Data Subject Request" — search by customer identifier, view all data, export, or delete. |

---

### B.8.5 — Credential Vault 🔵
**PRD refs:** SEC-02

| Element | Detail |
|---|---|
| Credential list | Table: credential name, associated connector/channel, type (API Key / OAuth Token / System User Token), created date, last rotated, expiry. |
| Actions | "Rotate", "Revoke", "View Usage" (which connectors use this credential). |
| No plaintext display | Credentials are always masked. Only rotatable, never readable from the console. |

---

## B.9 Campaign Manager (Broadcast Messaging) 🟡

Scheduled/broadcast messaging across channels. **Product decision required:** carry forward from existing platform or defer.

### B.9.1 — Campaign List 🟡
**PRD refs:** META-08, META-12, META-13

| Element | Detail |
|---|---|
| Table | One row per campaign: name, channel, template used, status (Draft / Scheduled / Sending / Completed / Failed), scheduled date/time, audience size, sent/delivered/read/opt-out counts. |
| Actions | "Create Campaign" (→ B.9.2), "Duplicate", "Pause", "Delete", "View Report" (→ B.9.3). |

---

### B.9.2 — Campaign Builder 🟡
**PRD refs:** META-08, META-07, META-13

| Step | Content |
|---|---|
| 1 — Channel & Template | Select channel. For WhatsApp: select from approved templates (META-08). For other channels: compose message. |
| 2 — Audience | Audience selector: all contacts, segment filter, CSV upload, or manual list. Opt-in enforcement. |
| 3 — Personalization | Variable mapping + live preview. |
| 4 — Schedule | Send now or schedule. Rate-limit awareness (META-12). |
| 5 — Review & Send | Summary + confirmation. |

---

### B.9.3 — Campaign Report 🟡
**PRD refs:** RP-01

| Element | Detail |
|---|---|
| Metrics | Sent, delivered, read, replied, failed, opt-out. Delivery timeline chart. Failure breakdown. Engagement metrics. |

---

## B.10 Growth Tools (Social Auto-Reply) 🟡

Automated replies to Facebook/Instagram post comments. **Product decision required:** carry forward or deprecate.

### B.10.1 — Growth Tool List 🟡
**PRD refs:** META-03, META-09

| Element | Detail |
|---|---|
| Table | One row per rule: name, platform, target post, trigger keyword(s), auto-reply message, status, engagement count. |
| Actions | "Create Rule" (→ B.10.2), "Edit", "Pause/Resume", "Delete". |

---

### B.10.2 — Growth Tool Rule Editor 🟡
**PRD refs:** META-03, META-09

| Element | Detail |
|---|---|
| Config | Platform selector, post targeting, trigger keywords, public reply text, private DM text, quick-reply buttons. Preview panel. |

---

## B.11 Speech Lab / TTS Configuration

### B.11.1 — Voice & Speech Settings 🔵
**PRD refs:** OC-05

| Element | Detail |
|---|---|
| STT engine config | Provider selection, language model selection, confidence threshold. |
| TTS engine config | Provider selection, voice catalog (browse/preview voices by language, gender, style), default voice per language, rate/pitch sliders with preview. |
| Voice personas | Named presets (voice + rate + pitch + language). Assignable to channels or tenants. |
| Test console | "Type or paste text → hear it spoken" live preview. Side-by-side voice comparison. |

---

### B.11.2 — IVR Flow Builder 🔵
**PRD refs:** OC-05

| Element | Detail |
|---|---|
| Visual tree editor | Drag-and-drop IVR menu tree. Nodes: greeting, language selection, department routing, DTMF input, AI handoff, voicemail, callback. |
| Node config | Audio prompt (TTS or WAV), DTMF mapping, timeout, retries, fallback. |
| AI handoff node | Point where IVR hands to AI Agent Orchestration Core with collected context. |
| Preview/test | Simulate call flow by clicking through. Play TTS prompts inline. |

---

## B.12 Gateway Agent Management (On-Prem Backends) 🟡

### B.12.1 — Gateway Agent List 🟡
**PRD refs:** MCP-12

| Element | Detail |
|---|---|
| Table | Agent ID, name/label, deployment location, tunnel status, last heartbeat, agent version, connected backends count. |
| Actions | "Download Agent" (→ B.12.2), "View Details", "Rotate Tunnel Credentials", "Decommission". |
| Health | Uptime, avg tunnel latency, reconnection count. |

---

### B.12.2 — Gateway Agent Setup Wizard 🟡
**PRD refs:** MCP-12, MCP-11

| Step | Content |
|---|---|
| 1 — Download | Select OS. Download binary/Docker image. One-time registration token. |
| 2 — Install & Register | Copy-paste install commands. Agent phones home over outbound HTTPS tunnel. Status indicator. |
| 3 — Connect Backends | Add stdio-based MCP servers: name, spawn command, env vars. |
| 4 — Test | `list_tools` through tunnel. Test sample tool calls. |
| 5 — Activate | Agent appears in B.12.1; backends appear in B.3.1 with "via Gateway Agent" badge. |

---

## B.13 PII Detection & Masking Configuration

### B.13.1 — PII Policy Editor 🔵
**PRD refs:** SEC-04

| Element | Detail |
|---|---|
| Detection rules | Table of PII entity types: national ID, credit card, IBAN, phone, email, passport, DOB. Each: detection method, status, sample match. |
| Custom patterns | Add custom PII: name, regex/keyword, masking format. |
| Masking policy per context | Matrix: PII types × contexts (transcript, tool-call payload, A2A payload, export, human-agent view). Each cell = Show / Partial Mask / Full Mask / Redact. |
| Tool trust levels | Per connector: trust level (Trusted / Semi-Trusted / Untrusted). PII masking intensifies for less-trusted tools. |
| Audit | PII Detection Log: recent detections with timestamp, conversation, entity type, action taken. |

---

## B.14 Authentication & Login Screens

### B.14.1 — Admin Login Page 🔵
**PRD refs:** SEC-03

| Element | Detail |
|---|---|
| Login form | Email + password. "Sign in" button. "Forgot password?" link. |
| SSO button | "Sign in with SSO" → SAML/OAuth2 IdP redirect. Organization logo if tenant recognized. |
| MFA prompt | 6-digit TOTP input, "Use backup code" fallback, "Resend code" for SMS/email MFA. |
| Session management | Configurable session timeout per role. "Remember this device" checkbox. |

---

### B.14.2 — MFA Enrollment Screen 🔵
**PRD refs:** SEC-03

| Element | Detail |
|---|---|
| Enrollment | Choose method (Authenticator / SMS / Email) → QR code scan or phone entry → verify test code → save backup codes. |
| Manage MFA | View enrolled methods, add secondary, regenerate backup codes, remove method. |

---

## B.15 Agent Platform Architecture Console (NEW — Design-Time / Runtime / Gateway Control)

Everything in B.3/B.3A configures *what tools the agent can call*. B.15 exposes the layer beneath that: the **agent definition itself** — its orchestration graph, model routing, guardrails, and version lifecycle — following the control-plane / data-plane / gateway-plane / observability-plane split described in the companion Agent Platform Architecture Specification (see closing appendix). This section is for platform engineers and senior admins, not conversation designers.

### B.15.1 — Agent Definition Registry 🔵
**PRD refs:** AGT-01, AGT-02, ADM-01

The control-plane source of truth for every agent definition in the platform (support-triage agent, escalation-summarizer agent, per-tenant custom agents, etc.) — Docker-registry-for-agents.

| Element | Detail |
|---|---|
| Registry table | One row per agent: name, current production version (semver), orchestration graph type (LangGraph / Pydantic AI / ADK / custom FSM), owning team, status (Draft / In Review / Approved / Deprecated), last modified. |
| Version list (drill-in) | Per agent: all versions with semver, git commit ref, approval status, eval pass rate, deployed environments, changelog. |
| Definition preview | Read-only render of the Agent Definition YAML (`apiVersion: agents.platform/v1`) — graph, entrypoint, model + fallback chain, bound tools (cross-links to Agent Tool Registry B.3A.1), memory config, guardrail bindings, eval suite reference. |
| Diff view | Git-style diff between any two versions of a definition — highlights model changes, tool binding changes, guardrail changes. |
| Approval workflow | Status pipeline: Draft → Eval-Gated → Human Review → Approved → Production. Reviewer sign-off with comment thread, same pattern as a PR review. |

---

### B.15.2 — Code-First Agent Builder (Agentic Authoring) 🟡
**PRD refs:** AGT-02, AGT-03

The "Claude Code-style" authoring surface — a chat-driven coding agent that writes and edits Agent Definitions from a natural-language spec, as an alternative to the visual Dialogue Flow Designer (C.1.2) for complex agent logic.

| Element | Detail |
|---|---|
| Spec input | Free-text or structured brief: desired behavior, tools to bind, guardrails, target graph framework. |
| Live authoring transcript | Chat-style panel showing the coding agent's plan, file edits to the Agent Definition (YAML + entrypoint code), and test iterations — same interaction model as an IDE coding agent. |
| Dry-run preview | "Run Dry-Run" button calls the Agent Runtime's `/dry-run` endpoint in a sandboxed namespace — shows a live conversation simulation against the in-progress definition without touching production. |
| Diff / PR output | Every edit (chat-authored or manually adjusted) is rendered as a Git diff against the current definition — "Open Pull Request" hands off to the same review flow as B.15.1's Approval Workflow. Visual and code-first authoring always converge on the same artifact. |
| Escape hatch | "Edit YAML directly" toggle for admins who want to hand-edit the definition instead of prompting the builder. |

---

### B.15.3 — Deployment & Canary Manager 🔵
**PRD refs:** AGT-04, AGT-05, ADM-05

Controls which agent version actually serves traffic in each environment — rollback is a repoint, not a redeploy.

| Element | Detail |
|---|---|
| Deployment table | Per agent: environment (Dev / Stage / Prod), active version, traffic split if multiple versions are live (e.g., 90% v1.4.0 / 10% v1.5.0 canary). |
| Traffic-split editor | Slider or numeric input per version; "Promote canary to 100%" and "Rollback" (instant repoint to prior version) actions. |
| Promotion gate | Cannot promote a version that hasn't passed its bound eval suite (B.15.4) — button is disabled with an explanatory tooltip until eval pass rate clears the configured threshold. |
| Rollout history | Timeline of every promotion/rollback: who, when, from version → to version, reason note. |

---

### B.15.4 — Eval Suite Runner 🔵
**PRD refs:** AGT-06, RP-04

The regression gate that replaces "did the flow diagram still work" — every agent version must pass its golden-set test cases before promotion.

| Element | Detail |
|---|---|
| Eval suite list | Per agent: bound eval suite (`eval_suite: tests/*.eval.yaml`), test case count, last run pass rate, avg cost, avg latency. |
| Run detail | Per test case: input, expected outcome, actual outcome, pass/fail, diff on mismatch. Filterable to failures only. |
| Trigger | "Run Eval Suite" manual trigger, or automatic on every new version submitted for review (B.15.1). |
| Suite editor | Add/edit golden-set test cases: input transcript, expected tool calls, expected final response pattern, cost/latency budget. |

---

### B.15.5 — Model Gateway Configuration 🔵
**PRD refs:** AGT-07, AGT-08, SEC-02

Single ingress config for all LLM calls made by every agent — decouples the platform from any one model vendor's roadmap.

| Element | Detail |
|---|---|
| Provider routing | Per agent (or platform default): primary provider/model, ordered fallback chain (e.g., `anthropic:claude-sonnet-5` → `openai:gpt-5` → `gemini:gemini-3-pro`). Routing strategy toggle: cost-based, latency-based, or fixed priority. |
| Rate limit & budget | Per-tenant and per-agent token/min and $/day caps, with hard-stop + alert thresholds (80/90/100%) — mirrors the AI Cost Report (B.7.4) but as an enforcement config rather than a report. |
| Caching | Exact-match and semantic-cache toggles, TTL, cache hit-rate stat. |
| Key vaulting | Provider API keys stored and rotated here (via SEC-02); the Agent Runtime never holds provider keys directly — it calls through this gateway. |
| PII redaction | Toggle: redact PII from prompts/responses before they are logged, independent of the PII Policy Editor (B.13.1) which governs conversation-level masking. |

---

### B.15.6 — Agent Runtime Observability / Trace Explorer 🔵
**PRD refs:** AGT-09, AGT-10, RP-02, RP-08

Cross-conversation, cross-tenant view of agent-run health — complements the single-conversation Trace Viewer (B.4.2) with an agent-definition-level lens.

| Element | Detail |
|---|---|
| Run list | Every agent run (sync, async, or resumed-after-HITL-interrupt): agent name + version, run ID, status (running / completed / failed / awaiting-resume), duration, token cost. |
| Span trace | OpenTelemetry trace per run — one span per graph node / tool call — exportable to the platform's existing APM. |
| Per-version rollup | Token usage, cost, latency (p50/p95), and tool-call success rate aggregated per agent version — the data that feeds the Deployment & Canary Manager's promotion decisions. |
| HITL interrupts | List of runs currently paused on a human-in-the-loop interrupt (approval gate), with a "Resume" action — the runtime-level counterpart to the Approval Queue (B.3.6). |
| Multi-tenant quota view | Per-tenant concurrent-run count, tokens/min usage, and tool-egress allowlist status — surfaces the isolation boundaries the Runtime enforces so one tenant's agent load cannot starve another's. |

---

# PORTAL C — Conversation Designer Studio

A visual workspace for configuring how the AI agent handles conversations, integrated within the Admin Console.

---

### C.1.1 — Capability & Tool Catalog 🔵
**PRD refs:** AI-01, AI-09

Curate capability groups, tool descriptions, parameter schemas and selection guidance. The agent reads these at runtime — no intent classification.

| Element | Detail |
|---|---|
| Capability list | Table: capability name, category (configurable per tenant), enrolled tools (from Agent Tool Registry B.3A.1), runtime guidance text, status. |
| Capability editor | Name, description, runtime guidance the agent reads when choosing tools, parameter validation hints, priority weight. |
| Auto-suggested improvements | AI-09 (Self-Learning Loop): panel mining unhandled goals from conversations, suggesting new tools or better tool descriptions — with "Add Tool" / "Improve Description" / "Dismiss" actions. |
| Selection guidance | Guides the agent's tool-selection reasoning (B.3A.1) — supplements the agent's autonomous choice from tool descriptions + schemas. |

---

### C.1.2 — Dialogue Flow Designer 🔵
**PRD refs:** AI-01, AI-02, AI-03

Optional agent **playbooks** — a visual node graph the agent may follow when it recognizes the task. Triggered by a natural-language condition, not declared-intent matching.

| Element | Detail |
|---|---|
| Playbook trigger | A natural-language condition on the Start node (e.g., "when the user requests a refund over $500") decides whether the agent follows the playbook. |
| Canvas | Visual node-graph editor for multi-step flows. Nodes: Start, AI Message, Confirm Parameter, **Call Tool** (from Tool Catalog B.3.4 / Agent Tool Registry B.3A.1), Condition (if/else), Human Handoff, End. |
| Node config | Each node has a config panel: message text (multilingual), parameter to confirm, tool to call (searchable from Agent Tool Registry — shows connector, approval tier badge), condition logic, handoff target. |
| Call Tool node | Select a tool from the Agent Tool Registry by connector and tool name. Auto-populates the tool payload from the tool's JSON schema (B.3A.1) using agent-extracted parameters. Shows approval tier badge on the node. Maps tool outputs to flow variables for downstream nodes. |
| Flow library | Pre-built flow templates organized by use case (Inquiry, Request Submission, Status Check, Complaint, Multi-Backend Workflow). |
| Guardrails panel | Side panel: max write-value thresholds, disallowed topic list, mandatory handover triggers. Scoped per flow or global. |
| Inline test console | "Test this flow" side panel: type a message → see goal recognition → watch it traverse nodes → see the tool payload built from schema → see mock tool responses → view final AI response. |
| Publish workflow | Flow status: Draft → Staging → Production. Version history with rollback. "Promote to Production" requires confirmation. |
| Test panel | Side panel: simulate a conversation through the flow step by step, with mock tool responses. |

---

### C.1.3 — Parameter Validation & Extraction Hints 🔵
**PRD refs:** AI-01

Reusable validation hints (regex/enum/format) applied to the parameters the agent extracts at runtime — no slot-filling.

| Element | Detail |
|---|---|
| Validation rule list | Table: rule name, type (free text / enum / regex / date / number / phone / email), used-by-tools count. |
| Rule editor | Name, type, validation rule, synonyms (multilingual), sample values. |
| System entities | Pre-built: date, time, number, currency, phone, email, national ID (configurable pattern per country). |
| Runtime behavior | The agent extracts parameters from free text; these rules validate and normalize the values before the tool payload is built. |

---

### C.1.4 — Guardrail / Safety Rules Editor 🔵
**PRD refs:** AI-10, AI-11

| Element | Detail |
|---|---|
| Rules table | Rule name, type (Spam filter / Capability gate / Amount threshold / PII block / Sensitive topic flag), status (Active / Inactive). |
| Rule editor | Condition builder: IF [input contains credit card number] → [mask and warn]. IF [recognized task = X AND amount > threshold] → [escalate to human]. |

---

### C.1.5 — Knowledge Base Config 🔵
**PRD refs:** KB-01

| Element | Detail |
|---|---|
| KB source list | Connected knowledge sources: FAQ databases, uploaded documents, external URLs to crawl. |
| Article viewer | Browse and search indexed KB articles. Preview how the AI would surface each article. |
| Sync status | Last sync timestamp, article count, failed articles. "Re-sync" button. |

---

# PORTAL D — Human Agent Bridge

A lightweight operational view for human agents handling escalations. This is NOT a full agent desktop — NextBot deliberately defers to the backend system's own agent console (Section 6.7). This bridge provides NextBot-specific context alongside the backend tool.

---

### D.1.1 — My Escalation Queue 🔵
**PRD refs:** ESC-01, ESC-03

Same as B.5.1 but scoped to the logged-in agent's assigned queues only.

---

### D.1.2 — Live Conversation + Context Panel 🔵
**PRD refs:** ESC-02, AI-08

Same as B.5.2 — the core agent working screen.

---

### D.1.3 — Agent Performance Dashboard 🟡
**PRD refs:** RP-04

| Element | Detail |
|---|---|
| Metrics | Conversations handled today, avg handling time, CSAT scores, resolution rate. |
| Comparison | "Your stats vs. team average" — anonymized benchmarking. |

---

# PORTAL E — Developer Portal

For developers and integrators building MCP connectors or consuming the A2A API.

---

### E.1.1 — Getting Started / Overview 🔵
**PRD refs:** MCP-10, MCP-11

| Element | Detail |
|---|---|
| Page content | Platform architecture overview, quick-start guide ("Build your first MCP connector in 15 minutes"), SDK links (Python `mcp` package, `a2a-sdk`). |

---

### E.1.2 — MCP Connector Development Guide 🔵
**PRD refs:** MCP-10, MCP-11, Section 6.4.1

| Element | Detail |
|---|---|
| Page content | Step-by-step guide: define tools (name, description, JSON schema), implement handlers, expose via Streamable HTTP (or stdio for on-prem), register with NextBot. |
| Code samples | Python code snippets for each tool pattern (read, write, multi-step). |
| Reference connectors | Links to source/docs for Ticketing, CRM, ERP connector templates. |

---

### E.1.3 — A2A Integration Guide 🟡
**PRD refs:** A2A-01 through A2A-07, Section 6.6.1

| Element | Detail |
|---|---|
| Page content | How to publish an agent card, how to call NextBot as an external agent, how to register as a trusted agent, task lifecycle reference. |

---

### E.1.4 — API Reference (Auto-Generated) 🔵
**PRD refs:** MCP-02

| Element | Detail |
|---|---|
| Page content | Auto-generated from registered tool schemas: every tool name, description, input schema, output schema, approval tier, example request/response. Filterable by connector. |

---

### E.1.5 — Sandbox / Test Console 🔵
**PRD refs:** MCP-09, META-11

| Element | Detail |
|---|---|
| Test panel | Select a connector + tool → fill in sample args → execute against sandbox → view response. |
| Conversation simulator | Simulate end-to-end: type a message → see goal recognition → see tool selection → see payload construction from schema → see tool call → see AI response. |
| Webhook tester | For channel connectors: send a sample inbound webhook payload → see how NextBot normalizes and processes it. |

---

# Appendix: Screen Count Summary

| Portal | Launch-Critical (🔵) | Post-Launch (🟡) | Total |
|---|---|---|---|
| A — Embeddable Widget | 17 screen/component types | 2 | 19 |
| B — Admin Console | 39 screens | 12 | 51 |
| B.3A — MCP Agent Tool Config (new in v3.0) | 5 screens | 0 | 5 (included in B total) |
| B.15 — Agent Platform Architecture Console (new in v3.1) | 5 screens | 1 | 6 (included in B total) |
| C — Conversation Designer | 5 screens | 0 | 5 |
| D — Human Agent Bridge | 2 screens | 1 | 3 |
| E — Developer Portal | 4 screens | 1 | 5 |
| **Total** | **67** | **17** | **84** |

**Changes from v2.0 → v3.0:**
- Removed all Tahseel-specific content (connector config, tool lists, use-case mappings, branding references). Platform is now fully generic.
- Added **B.3A — MCP Agent Tool Configuration** (5 new screens): Agent Tool Registry, MCP Server Enrollment, Tool Composition/Workflows, MCP Server Health & Monitoring, Tool Schema Inspector.
- Renamed Tahseel-specific widget cards (A.2.4, A.2.6, A.2.7) to generic versions usable by any backend.
- All example data in screen specs uses generic placeholders instead of Tahseel entities.

**Changes from v3.0 → v3.1:**
- Added **B.15 — Agent Platform Architecture Console** (6 new screens): Agent Definition Registry, Code-First Agent Builder, Deployment & Canary Manager, Eval Suite Runner, Model Gateway Configuration, Agent Runtime Observability/Trace Explorer.
- Introduced requirement IDs AGT-01 through AGT-12 for the underlying agent-platform architecture (control plane / data plane / gateway plane / observability plane), pending merge into PRD v2.1.
- Added the closing **Appendix: Agent Platform Architecture (Engineering Reference)** summarizing the four-plane design these screens expose.

---

# Appendix: Use Case Pattern → Screen Mapping

Every common use-case pattern is traced to the widget screens that deliver it. Any project's specific use cases follow one of these patterns.

| Use Case Pattern | Widget Screens Used (in order) |
|---|---|
| **Account Linking (OTP Verification)** | A.1.3 (Welcome) → A.2.3 (List: select account type) → A.2.8 (Form: enter identifier) → A.2.9 (OTP card) → A.2.1 (Success confirmation) |
| **Data Inquiry (Balance / Status / Info)** | A.2.3 (List: select account) → A.2.6 (Data summary card) |
| **Transaction / Record History** | A.2.3 (List: select account) → A.2.7 (Data table) |
| **Document / Statement Request** | A.2.3 (List: select account) → A.2.10 (Confirmation) → A.2.1 (AI confirms sent/generated) |
| **External Action (Payment / Portal Redirect)** | A.1.3 (Welcome) → A.2.3 (List: select item) → A.2.8 (Form: collect details) → A.2.4 (External link card) |
| **Complaint / Suggestion Submission** | A.1.3 (Welcome) → A.2.2 (Chips: type selection) → A.2.3 (List: select category) → A.2.8 (Form: details) → A.2.1 (Confirmation) |
| **Case / Ticket Creation** | A.1.3 (Welcome) → A.2.3 (List: select type) → A.2.8 (Form: details) → A.2.14 (Attach documents) → A.2.12 (Case created card) |
| **Case / Ticket Follow-up** | A.1.3 (Welcome) → A.2.8 (Form: enter tracking number) → A.2.13 (Case status card) |
| **Document / Receipt Search & Download** | A.1.3 (Welcome) → A.2.8 (Form: search criteria) → A.2.3 (List: results) → A.2.5 (Download card) |
| **Human Handoff (any point)** | A.2.11 (Handoff notification + agent joined) |
| **Voice Mode (any point)** | A.2.17 (Voice overlay — STT → same AI flows → TTS) |
| **Multi-Backend Workflow** | A.1.3 → A.2.8 (collect info) → [AI calls Tool A on Backend 1] → A.2.6 (result card) → [AI calls Tool B on Backend 2] → A.2.10 (confirmation) → A.2.12 (case created) |

---

# Appendix: Agent Platform Architecture (Engineering Reference)

This appendix is the design premise behind Portal B.15 and the AI Agent Orchestration Core referenced throughout Portals A–E. It is written for platform engineers; UI/UX and QA readers only need the screen specs above (B.15, B.3, B.3A, C.1).

**Design premise.** A rigid, node-based visual workflow layer breaks down once agent logic gets complex — this is why the flow-based visual builders that preceded NextBot's architecture were retired industry-wide in favor of code-first agents. The lesson is not "kill the visual layer," it's **demote it from runtime to control-plane**: the Conversation Designer Studio (Portal C) and Agent Builder (B.15.2) generate/edit a code-first agent definition; neither ever *is* the execution engine.

```
                    NextBot Agent Platform
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                   │
   Agent Builder      Agent Runtime       Agent Registry
   (B.15.2, C.1.2)    (Orchestration      (B.15.1, B.15.3)
        │              Core — B.4.2,           │
        │              B.5.2, A.2.x)            │
        │           ┌──────┴──────┐            │
        │           │             │            │
        │      LangGraph      Pydantic AI       │
        │       (Python)      / ADK (typed)     │
        │           │             │            │
        └───────────┴─────────────┴────────────┘
                           │
                    Model Gateway (B.15.5)
                           │
        ┌──────────────────┼──────────────────┐
      OpenAI           Anthropic            Gemini / on-prem
```

**Four planes.**

| Plane | Responsibility | Corresponding Screens | Analogy |
|---|---|---|---|
| **Control Plane** | Define, version, approve, publish agent definitions | B.15.1, B.15.2, B.15.3 | Kubernetes API server |
| **Data Plane** | Execute agent graphs, tools, memory | Underlies A.2.x, B.4.2, B.5.2 (Agent Runtime) | Kubernetes kubelet/pods |
| **Gateway Plane** | Route/normalize LLM calls across providers | B.15.5 | Envoy/API gateway |
| **Observability Plane** | Tracing, evals, cost tracking, guardrails | B.15.4, B.15.6, B.7.4, B.8.2 | Datadog/LangSmith-equivalent |

**Agent Definition — the source of truth.** Every agent (support-triage, escalation-summarizer, per-tenant custom agents) is a versioned YAML + code artifact stored in Git, previewed in B.15.1:

```yaml
apiVersion: agents.platform/v1
kind: AgentDefinition
metadata:
  name: support-triage-agent
  version: 1.4.0
spec:
  graph: langgraph        # or "pydantic-ai", "adk"
  entrypoint: agent.py
  model:
    provider: anthropic
    model: claude-sonnet-5
    fallback: [openai:gpt-5, gemini:gemini-3-pro]
  tools: [search_tickets, escalate, kb_lookup]   # bound from Agent Tool Registry (B.3A.1)
  memory:
    type: vector
    store: pgvector
  guardrails: [pii_redaction, jailbreak_filter]
  eval_suite: tests/support-triage.eval.yaml     # gates promotion — see B.15.4
```

Definitions are just code + config in Git — the Builder (visual or code-first) is a **PR-generating layer** on top of that repo; every edit produces a diff, reviewed like code, never executed directly by the Builder itself (it calls the Runtime's `/dry-run` endpoint in a sandboxed namespace instead — see B.15.2).

**Runtime composition (pluggable, not monolithic).**

| Layer | Options | Notes |
|---|---|---|
| Orchestration graph | LangGraph, Pydantic AI (graph mode), Google ADK, custom FSM | Selected per-agent via `spec.graph` — never forced platform-wide |
| Execution isolation | Firecracker microVM or gVisor container per run | Untrusted tool code (especially AI-generated) never shares a kernel with the host |
| State/checkpointing | Redis (hot state) + Postgres (durable checkpoints) | Backs the "awaiting-resume" runs shown in B.15.6 |
| Tool execution | MCP servers as the tool interface | The same MCP contract used by B.3/B.3A — one abstraction, not one per framework |
| Streaming | SSE / WebSocket back to the caller | Powers token streaming in the widget (A.2.1 typing indicator) |
| Human-in-the-loop | Interrupt/resume via durable execution | Backs the Approval Queue (B.3.6) and Live Agent Takeover (B.5.2) |

**Registry responsibilities** (B.15.1/B.15.3): semantic versioning + changelogs per agent; eval-gated approval workflow (draft → eval-gated → human review → prod); canary/traffic-split deployment; rollback as a repoint of `deployments.agent_version_id` rather than a redeploy.

**Model Gateway responsibilities** (B.15.5): unified request/response schema across providers; primary/fallback routing (cost- or latency-based); per-tenant rate limiting and budget enforcement; prompt/response caching (exact + semantic); centralized API-key vaulting so the Runtime never holds provider keys directly; PII/secrets redaction before logging.

**Cross-cutting concerns.**

| Concern | Approach | Owning Screen |
|---|---|---|
| Observability | OTel trace per run, span per node/tool call; token/cost/latency/tool-success tracking per agent version | B.15.6 |
| Evals | Every agent version must pass its golden-set `eval_suite` before promotion — the regression gate that replaces "did the flow diagram still work" | B.15.4 |
| Guardrails | Input/output filters (PII, jailbreak, toxicity) as pluggable Runtime middleware, not baked into individual agents | C.1.4, B.13.1 |
| Secrets/tool auth | Vault-issued, scoped, short-lived credentials injected at run time — never embedded in the Agent Definition | B.8.5, SEC-02 |
| Cost governance | Per-tenant budgets enforced at the Model Gateway; hard-stop + alert before overrun | B.15.5, B.7.4 |

**Why this avoids the industry's flow-tool failure mode:** (1) no single execution engine to outgrow — the orchestration framework is a pluggable field in the Agent Definition, not baked into the platform; (2) code-first authoring (B.15.2) is a first-class path from day one, not an escape hatch, for agents too complex for the visual Dialogue Flow Designer (C.1.2); (3) the Registry + eval gating (B.15.1/B.15.3/B.15.4) gives the safety net visual builders tried and struggled to provide via "flow validation"; (4) the Model Gateway (B.15.5) decouples the platform from any single model vendor's roadmap.

---

*This screen inventory (v3.1) describes NextBot as a fully generic omnichannel AI agent orchestration platform. All backend-specific functionality is enrolled through the MCP connector framework and the MCP Agent Tool Configuration section (B.3A). The underlying agent architecture — how agent definitions are authored, versioned, deployed, and observed — is exposed to platform engineers via B.15 and detailed in the appendix above. No customer-specific references remain — any project connects its backend systems via MCP Server Enrollment (B.3A.2) and the AI agent automatically gains access to the enrolled tools.*
