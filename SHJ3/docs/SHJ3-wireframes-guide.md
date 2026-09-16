# SHJ3 — Interactive Wireframes
## Functional Specification, Final Version

| | |
|---|---|
| **Deliverable** | `shj3-wireframes.html` — single self-contained file |
| **Size** | ~151 KB, no build step, no runtime dependencies |
| **Screens** | 17 — 3 assistant-facing, 14 admin/configurator |
| **Source brief** | `shj3.docx` (text brief + 5 annotated reference screenshots) |
| **State** | In-memory only; refresh resets the prototype |

---

# 1. Purpose and scope

## 1.1 What this document is

A screen-by-screen functional specification of the SHJ3 wireframe prototype. For each screen it records the **purpose**, **layout**, **components**, **seeded data**, **interactions**, and **business rules the wireframe encodes**.

It is written to be usable three ways:

- as a **walkthrough guide** for demoing the prototype
- as a **requirements baseline** for writing user stories or an SRS
- as a **handover brief** for a UI team building the high-fidelity design

## 1.2 What the prototype is

A clickable low-fidelity wireframe for **SHJ3** — an agentic government-services assistant for the Emirate of Sharjah, plus the backoffice that builds, governs and operates it.

Every screen holds live state. Chips, tabs, toggles, wizard steps, graph nodes, form buttons and rule editors all respond, so a full journey can be demonstrated without a backend.

## 1.3 What the prototype is deliberately not

- **Not a visual design.** The palette is muted paper and a single green accent so review attention stays on structure, flow and completeness rather than styling.
- **Not connected.** No API calls, no persistence, no authentication.
- **Not a content source.** All names, figures and transcripts are illustrative sample data chosen to make behaviour legible.

## 1.4 How to open it

Double-click `shj3-wireframes.html` in any modern browser. Navigate with the left sidebar, which is grouped into **Assistant window** and **Admin / configurator**.

---

# 2. Traceability to the source brief

## 2.1 Written requirements

| # | Requirement in `shj3.docx` | Implemented in | Evidence in the prototype |
|---|---|---|---|
| R1 | "Imagine the Backoffice to build AI assistant agentic" | Agent designer wizard, Agent registry | 10-step wizard; 4 agents with lifecycle controls |
| R2 | "Don't consider digital Sharjah, make use any name it SHJ3" | All screens | Brand applied throughout; assistant identifies as "SHJ3 Assistant" |
| R3 | "Suggested flows is dynamic and also can be free text" | Flow designer, Conversation screen | Condition node for free-text escape; conversation step 4 demonstrates it |
| R4 | "Integrations for this will use MCP, API" | Tools & MCP registry, wizard step 4 | MCP server registry with tool discovery; API connector builder |
| R5 | "Multiple agents (tools, skills) can be assigned for one prompt" | Orchestrator / router | Sequential, Parallel and Supervisor–worker modes with distinct traces |
| R6 | "System must have graph RAG as knowledgebase" | Knowledge — Graph RAG | Sources, entity graph, hybrid retrieval, conflict resolution |
| R7 | "Include agent designer (like wizard to build agents)" | Agent designer — wizard | 10 steps, freely navigable, state persists between steps |
| R8 | "This assistant can be on web, WhatsApp, …" | Launcher screen, Channel configurations | Native WhatsApp rendering; 4 channels configurable |

## 2.2 Reference screenshots

The five annotated screenshots in the brief drove the assistant UI. Elements reproduced:

| Element in screenshot | Where reproduced |
|---|---|
| Header with sparkle icon, minimise (–), expand (⧉) — both circled in the annotation | Launcher screen header |
| Grey disclaimer banner, "continuously learning… may not be fully accurate", with × dismiss | Launcher and conversation screens |
| Greeting bubble with five suggestion chips | Launcher screen |
| The five specific chips | Pay SEWA Bills · Pay Utilities Bills · Sharjah Custom Services · Emirate of Sharjah Libraries · Jawaher Centre Booking |
| Right-aligned mint user bubbles, left-aligned sand assistant bubbles | Conversation thread |
| Per-message speaker (TTS), thumbs up, thumbs down, timestamps | Message meta row |
| "Still Thinking…" processing state | Voice & handover screen |
| Composer placeholder "Ask Digital Sharjah Assistant" with mic | Rebranded to "Ask SHJ3 Assistant" |
| Portal chrome — Home / Services / Support / About, عربي, Login | Launcher screen portal frame |

## 2.3 The worked example

One journey, taken verbatim from the brief's screenshots, runs through the entire prototype so every screen can be understood against the same concrete case:

```
Pay Utilities Bills
  → "Which utility service? We offer Etisalat, du, and SEWA."
    → Pay SEWA Bills
      → "Could you please provide me with your SEWA account number?"
        → "i have another inquiry"   ← free-text escape
```

This journey appears as: the conversation stepper (A2), the flow canvas (B7), the orchestrator trace (B4), an escalated ticket (B8), a transaction record (B11), and a golden test set (B13).

---

# 3. Reading conventions

## 3.1 Shared UI components

| Component | Appearance | Meaning |
|---|---|---|
| **Sub-tab bar** | Text tabs with green underline on active | Sections within one screen |
| **Toggle row** | Pill buttons, dark fill when active | Mutually exclusive states of one view |
| **Card** | White, thin border, title + mono sub-line | One record (agent, source, rule, user) |
| **Badge — green** | `Active` `Live` `Approved` `Passed` `Healthy` | Healthy or complete state |
| **Badge — rust** | `Draft` `Pending` `Failed` `Degraded` `Blocked` | Attention required |
| **Switch** | Pill toggle, green when on | Boolean setting; changes state on click |
| **Pill (selectable)** | Rounded outline, green fill when selected | Single or multi-select option |
| **Progress bar** | Thin track with green fill | Completeness percentage |
| **Mono sub-line** | Small monospace grey text | Metadata: IDs, endpoints, timestamps, owners |
| **Summary strip** | Grey box at the bottom of a pane | Business rule or consequence explaining the pane |

## 3.2 Interaction legend used in this document

- **[click]** — a control that changes state in the prototype
- **[static]** — displayed for context, not interactive
- **[rule]** — a business rule the wireframe enforces or explains

---

# 4. Part A — Assistant window

Three screens covering the citizen-facing surface across web and WhatsApp.

---

## A1. Launcher & widget shell

**Purpose.** Establish the assistant's entry point on the Sharjah portal and prove that one assistant renders correctly across surfaces.

### Layout

A simulated portal page frame containing wireframe navigation lines, with the assistant widget overlaid and a floating launcher control at the bottom right.

### States — toggle row

| State | Behaviour |
|---|---|
| **Docked** [click] | Widget constrained to 400 px, overlaying portal content without navigation loss |
| **Expanded** [click] | Widget grows to 560 px; thread and scroll position are retained |
| **WhatsApp** [click] | Replaces the web frame entirely with a native WhatsApp rendering |

### Components — web states

| Component | Detail |
|---|---|
| Portal chrome | Wireframe lines standing in for Home / Services / Support / About, language toggle, Login |
| Widget header | Sparkle mark, "SHJ3 Assistant", minimise (–) and expand (⧉) controls |
| Disclaimer banner | "I'm continuously learning, so some responses may not be fully accurate." with × dismiss |
| Greeting bubble | Assistant welcome message |
| Suggestion chips | Five chips, config-driven from the Quick Actions manager |
| Message meta | Speaker (TTS) icon and timestamp |
| Composer | "Ask SHJ3 Assistant" field with mic button |
| Launcher FAB | Floating open/close toggle |
| Annotations | Five numbered callouts with a legend beneath |

### Components — WhatsApp state

| Component | Detail |
|---|---|
| Header | Business account avatar, name, "business account · online" |
| Opt-in notice | "You opted in to receive messages from SHJ3. Reply STOP to opt out." |
| Greeting | Same copy, rendered as a WhatsApp **list message** — options are stacked blue rows, not chips |
| User reply | Green right-aligned bubble |
| Session marker | "24-hour session window open" |
| Composer | WhatsApp-style rounded field with mic |

**[rule]** Channel adaptation is structural, not cosmetic. WhatsApp has no chip component, so suggestions render as list-message rows; the 24-hour session window is surfaced because it governs whether a free-form reply is permitted.

---

## A2. Conversation & dynamic flow

**Purpose.** Show a dynamic slot-filling flow that never traps the user, and expose what the system was doing behind each turn.

### Layout

Two columns — the assistant thread on the left, a diagnostics rail on the right holding the agent trace and grounding sources.

### The four steps [click]

| Step | User input | Assistant response | Agent trace | Sources panel |
|---|---|---|---|---|
| **1 · Greeting** | — | Welcome + 3 chips | `router → billing_agent (confidence 0.94)` | No grounding needed — static template |
| **2 · Pick utility** | Pay Utilities Bills | "Which utility service? Etisalat, du, and SEWA." + 3 chips | `router → billing_agent`, `tool list_service_centres()`, `knowledge_agent confirmed 3 eligible providers` | Utilities providers directory · updated 3 days ago |
| **3 · Ask account #** | Pay SEWA Bills | "Could you please provide me with your SEWA account number?" | `router → billing_agent`, `tool get_bill_status(provider="SEWA")`, `awaiting slot: account_number` | SEWA tariff schedule · Entity: Service → Provider(SEWA) |
| **4 · New inquiry** | i have another inquiry | "Sure, feel free to ask your inquiry…" | `flow escape triggered → context preserved`, `router re-evaluates next prompt` | Free-text escape re-opens the router |

The thread **accumulates** — stepping to 3 shows steps 1–3 in sequence, as a real transcript would.

### Diagnostics rail

| Panel | Contents |
|---|---|
| **Agent trace** | Routing decision with confidence, tools invoked with arguments, secondary agents consulted, pending slot |
| **Sources** | The Graph RAG grounding for the last answer: source document, freshness, and the entity path traversed |

**[rule]** The `awaiting slot: account_number` line at step 3 is the visible seam between conversation and transaction — this is the point where Identity & transactions (B11) requires step-up verification before proceeding.

**[rule]** Step 4 demonstrates the brief's "free text" requirement. The escape is available at every node, and context is preserved rather than discarded, so the user can return to the billing flow afterwards.

---

## A3. Voice input & human handover

**Purpose.** Show the two states where the assistant is not producing an answer — thinking, and no longer in control.

### States — toggle row

| State | Banner | Composer | Meaning |
|---|---|---|---|
| **AI thinking** [click] | "◐ Still thinking…" on grey | Live transcription preview: *Listening — "my account number is…"* with a red recording dot; mic highlighted | Voice captured, model generating |
| **Escalated to human** [click] | "Escalated · queue position 2 · agent context transferred" on green | "Composer paused — a live agent has joined" | Control passed to a person |

### Components

| Component | Detail |
|---|---|
| Thread | Retains the prior assistant turn asking for the SEWA account number |
| Live transcription | Interim speech-to-text shown before commit, so the user can correct |
| Queue position | Sets expectation during wait |
| Context transfer note | Confirms the human receives the full conversation, not a cold start |

**[rule]** Escalation is not a dead end nor a restart. The transcript, the identity state and the pending slot all transfer — which is what the Human agent workspace (B8) receives on the other side.
---

# 5. Part B — Admin / configurator

Fourteen screens covering build, knowledge, operations, governance and channels.

---

## B1. Command centre

**Purpose.** The admin landing screen: system health at a glance, transcript search, and the two queues that feed improvements back into the agents.

### Tab 1 — Overview

**Date range** [click] — `Today` · `Last 7 days` · `Last 30 days`. Switching re-renders all three panels below.

| Metric | Today | Last 7 days | Last 30 days |
|---|---|---|---|
| Conversations | 1,284 | 8,940 | 36,410 |
| Containment rate | 78% | 81% | 83% |
| Deflection rate | 64% | 67% | 69% |
| Tool error rate | 3.1% | 2.4% | 2.0% |

- **Channel split** — 7-bar chart, redraws per range
- **Top intents** — Pay utilities bill · Sharjah customs enquiry · Library membership · Jawaher Centre booking · Escalated to agent, with counts scaled per range

### Tab 2 — Conversation explorer

**Filter** [click] — `All` · `Escalated` · `Resolved` · `Abandoned`

| User | Channel | Intent | Outcome | Rating | When |
|---|---|---|---|---|---|
| Ahmed R. | WhatsApp | Pay utilities bill | Escalated | 👎 | 12 min ago |
| Fatima S. | Web | Customs enquiry | Escalated | 👎 | 28 min ago |
| Yousef M. | Web | Library membership | Resolved | 👍 | 1 hr ago |
| Mariam A. | WhatsApp | Pay utilities bill | Resolved | 👍 | 2 hrs ago |
| Hassan T. | Web | Jawaher booking | Abandoned | — | 3 hrs ago |

**View transcript** [click] expands an inline thread with an outcome/rating/PII-redaction footer, plus two actions:
- **Add to golden set** [click] — increments the *Billing core journeys* set in Evaluation (B13) and disables itself with confirmation text
- **Export** [static]

### Tab 3 — Feedback & knowledge gaps

**Thumbs-down review queue** — each item has a root-cause tag and **Mark fixed / Reopen** [click]:

| Issue | Volume | Root cause |
|---|---|---|
| Why was my SEWA bill higher this month? | 34 | Missing knowledge |
| Can I pay someone else's bill? | 21 | Missing knowledge |
| Assistant gave wrong customs fee | 12 | Stale source |

**Unanswered questions** — clustered by frequency, each with two resolutions [click], both of which remove the item from the queue:

| Question | Asked |
|---|---|
| Do you accept Apple Pay? | 58× |
| How do I dispute a fine? | 41× |
| Library opening hours on Fridays | 27× |

**[rule]** These two queues are the improvement loop. A thumbs-down becomes a root cause; an unanswered question becomes either a knowledge entry or a new flow. Both paths lead back into the build screens.

---

## B2. Agent registry

**Purpose.** Lifecycle management for agents once the wizard has created them — the wizard authors, the registry governs.

### Seeded agents

| Agent | Owner | Version | Status | Channels | Usage |
|---|---|---|---|---|---|
| SEWA & Utilities Billing Agent | SEWA | v1.4 | Published | Web, WhatsApp | 412/day |
| Customs Enquiry Agent | Sharjah Customs | v2.1 | Published | Web | 301/day |
| Library Services Agent | Sharjah Libraries | v0.9 | Draft | — | — |
| General FAQ Agent | Platform | v3.0 | Published | Web, WhatsApp | 640/day |

### Per-agent actions

| Action | Behaviour |
|---|---|
| **Version history** [click] | Expands the version list inline |
| **Clone** [click] | Creates `<name> (copy)` as a Draft at v0.1, with a history entry "Cloned from …" |
| **Publish / Unpublish** [click] | Flips status and badge |
| **Archive** [click] | Removes the agent from the registry |
| **Roll back** [click] | On any non-current version; sets it as current and prepends a "Rolled back to …" history entry |

### Version history contents

| Agent | Versions |
|---|---|
| SEWA & Utilities Billing | v1.4 Added du/Etisalat lookup tool · v1.3 Tightened guardrail threshold · v1.2 Initial billing flow |
| Customs Enquiry | v2.1 Added declaration status tool · v2.0 Rebuilt on Graph RAG |
| Library Services | v0.9 Draft — membership flow in progress |
| General FAQ | v3.0 Merged entity FAQs into one graph · v2.4 Arabic locale added |

**[rule]** Rollback and environment promotion are distinct. Rollback changes *which version is current*; promotion (B14) moves a version *between environments*.

---

## B3. Agent designer — wizard

**Purpose.** The core authoring tool named in the brief: build one agent end to end.

### Structure

A progress bar plus a 10-step tab strip. Any step is directly clickable — the wizard does not force linear progress. **Back** and **Save & continue** navigate; the final step's button reads **Publish agent**. All state persists when moving between steps.

### Steps 1–3, 5–10

| Step | Fields |
|---|---|
| **1 · Identity** | Agent name (`SEWA & Utilities Billing Agent`), Owning entity (`SEWA`), Description |
| **2 · Instructions** | System prompt textarea; Tone pills — Helpful / Formal / Concise |
| **3 · Model** | Primary model (`claude-sonnet-5`), Fallback model (`claude-haiku-4.5`), Temperature (`0.2`) |
| **5 · Knowledge** | Bind collections — SEWA tariff schedule ✓, Utilities providers directory ✓, Sharjah Customs handbook |
| **6 · Flows** | Pay utilities bill (Published) · Update account details (Draft) |
| **7 · Guardrails** | Mask PII ✓ · Refuse below 60% grounding ✓ · Allow competitor discussion ✗ |
| **8 · Channels** | Web widget ✓ · WhatsApp ✓ · Kiosk/IVR ✗ |
| **9 · Test** | Sandbox preview showing a live exchange before publish |
| **10 · Publish** | Environment (Production), Version (v1.3 → v1.4), Change summary |

### Step 4 — Skills & tools (the deepest step)

Three sub-tabs, all interactive.

**Sub-tab A — Skills catalogue**

| Skill | Default |
|---|---|
| Fetch SEWA bill | Attached |
| Fetch Etisalat/du bill | Attached |
| Escalate to live agent | Attached |
| Book Jawaher Centre slot | Not attached |

Each is a toggle [click]. A live summary strip counts attached catalogue skills, bound MCP tools and API connectors.

**Sub-tab B — MCP servers**

| Server | Endpoint | Auth | State |
|---|---|---|---|
| Sharjah Services Gateway | `mcp://sharjah-services.internal` | OAuth2 · client credentials | Connected |
| Sharjah Customs MCP | `mcp://customs.shj.ae` | mTLS | Not connected |

- Connected servers expose their discovered tools as bindable pills: `get_bill_status` ✓, `create_payment_link` ✓, `list_service_centres` ✓, `cancel_booking` ✗ — each toggles independently [click]
- **Connect & discover tools** [click] on the unconnected server simulates discovery, returning `get_declaration_status`, `submit_customs_form`, `list_fees`
- **+ Add MCP server** [click] reveals endpoint and auth fields, then discovers two tools on connect

**Sub-tab C — API connectors**

| Connector | Method | Endpoint | Auth | State |
|---|---|---|---|---|
| Fetch SEWA bill | GET | `https://api.sewa.ae/v1/bills/{account}` | API key | Tested ✓ |
| Create payment link | POST | `https://pay.shj.ae/v1/links` | OAuth2 · client credentials | Untested |

- **Test connection** [click] on an untested connector flips its badge and reveals a sample JSON response
- **+ Add API connector** [click] reveals method, endpoint and auth fields

**[rule]** Registered ≠ callable. A tool exists on the server once discovered, but the agent can only invoke it if explicitly bound. This is the tool-permission boundary.

**[rule]** Every API connector automatically becomes a callable skill with its own schema and rate-limit policy.

---

## B4. Orchestrator / router

**Purpose.** Configure the brief's central requirement — several agents, tools and skills serving a single prompt.

### Diagram

`Prompt → Router → [Billing agent · Knowledge agent · Handover agent] → Merge → Response`

### Execution modes [click]

| Mode | Trace for the "Pay SEWA bills" prompt |
|---|---|
| **Sequential** | Router selects billing_agent → runs alone → billing_agent calls `get_bill_status()` → router hands to knowledge_agent for policy text → merge combines both replies in order |
| **Parallel** | Router fans out to billing_agent + knowledge_agent simultaneously → both return within one turn → merge combines replies and resolves overlap |
| **Supervisor–worker** | Supervisor plans: fetch bill → check eligibility → prepare payment link → delegates each sub-task to billing_agent as a worker → supervisor reviews before responding |

### Configuration surfaced

Routing strategy, agent selection scope, max hops, loop and cost ceilings, conflict resolution and response-merge policy, fallback agent.

**[rule]** Mode choice is a cost and latency trade-off, not just an architecture preference: parallel is fastest but risks overlapping content; supervisor is most controlled but costs the most tokens.

---

## B5. Tools & MCP registry

**Purpose.** The shared, platform-wide catalogue every agent draws from — the same data as wizard step 4, viewed as an estate rather than per-agent.

### Tabs 1–3 — Skills catalogue · MCP servers · API connectors

Identical structure and controls to wizard step 4, **operating on the same underlying data**. Binding a tool in either location is reflected in the other immediately.

### Tab 4 — Resilience & fallbacks

| Service | Trips at | Cooldown | Fallback | State |
|---|---|---|---|---|
| SEWA bill API | 5 failures / 60s | 2 min | Apologise + offer live agent | **Open — fallback active** |
| Sharjah Services Gateway (MCP) | 5 failures / 60s | 2 min | Serve cached answer if under 24h old | Closed — healthy |
| WhatsApp BSP | 10 failures / 60s | 5 min | Queue and retry | Closed — healthy |

- **Reset breaker / Trip manually (test)** [click] — flips breaker state so the fallback path can be demonstrated
- **Serve cached answers while a source is down** [click] toggle
- **Degraded-mode message** — *"Some services are slow right now — I can still answer questions, but payments may be delayed."*

**[rule]** Without a breaker, a slow dependency stalls every conversation that touches it. Tripped services fail fast to the fallback instead of holding the user.

**[rule]** The SEWA bill API breaker is seeded **Open**, matching the Degraded status shown in Observability (B14) — one incident, visible in two places.

---

## B6. Knowledge — Graph RAG

**Purpose.** The brief's mandated Graph RAG knowledgebase: what is ingested, what graph it produces, how retrieval is tuned, and what happens when sources disagree.

### Tab 1 — Sources

| Source | Type | Owner | Schedule | Indexed | Last crawled |
|---|---|---|---|---|---|
| SEWA tariff schedule | Document | SEWA | Manual | 100% | 2 hours ago |
| Utilities providers directory | URL crawler | Platform | Daily | 90% | 1 day ago |
| Sharjah Customs handbook | Document | Customs | Weekly | 70% | 3 days ago |
| Library membership policy | Document | Libraries | Weekly | 55% | 6 days ago |

- **Re-crawl now** [click] — sets indexing to 100% and timestamp to "just now"
- **Remove** [click]
- **+ Add source** [click] — name, location/URL, type (`Document` · `URL crawler` · `Database` · `SharePoint` · `API feed`), schedule (`Manual` · `Daily` · `Weekly`)

### Tab 2 — Graph explorer

The graph is **generated from data**, not static markup, so additions appear immediately.

**Entities:** Service · Provider · Fee · Document · Channel
**Relationships:** Service→Provider, Service→Fee, Service→Document, Fee→Channel

| Node | Meaning shown on click |
|---|---|
| Service | "Pay utilities bill" — connects to Provider, Fee and Document nodes that ground every answer in this flow |
| Provider | SEWA / Etisalat / du — disambiguates the "which utility service" question |
| Fee | Tariff and payment thresholds from the SEWA tariff schedule |
| Document | Source passage cited when explaining a policy |
| Channel | Which surface (web / WhatsApp) the service is available on |

- **Search entities** [click/type] — dims non-matching nodes live
- **Duplicate detection** — `SEWA ↔ Sharjah Electricity & Water Authority`, `du ↔ du Telecom`, each with **Merge** / **Ignore** [click]
- **+ Add node** [click] — label plus parent selection; the new entity is placed, edged and immediately clickable

### Tab 3 — Retrieval & indexing

| Setting | Default |
|---|---|
| Chunk size | 512 tokens |
| Chunk overlap | 64 tokens |
| Embedding model | `text-embedding-3-large` (also `text-embedding-3-small`, `multilingual-e5`) |
| Hybrid weighting | 60% graph / 40% vector — **slider** [click] with live label |
| Top-K passages | 8 |
| Reranker | On [click] |

**Retrieval playground** [click] — enter a query, **Run** returns ranked passages with scores and the matched subgraph:

```
Top passages
1. SEWA tariff schedule · score 0.91
2. Utilities providers directory · score 0.84
3. SEWA tariff schedule (section 2) · score 0.77

Matched subgraph
Service(Pay utilities bill) → Provider(SEWA) → Fee
```

**Re-index jobs** — history with Completed/Failed status; **Re-index all sources now** [click] adds a Running job that resolves to Completed.

### Tab 4 — Source conflicts

**Default resolution policy** [click] — `Prefer most recently updated source` · `Prefer owning entity source` · `Always ask an admin`

| Topic | Source A | Source B |
|---|---|---|
| SEWA residential tariff rate | **AED 0.23 / kWh** — SEWA tariff schedule (updated 2 hours ago) | **AED 0.19 / kWh** — Sharjah Customs handbook appendix (updated 3 months ago) |
| Library visitor membership duration | **3 months** — Library membership policy (updated 6 days ago) | **1 month** — Utilities providers directory FAQ (updated 1 day ago) |

**Make authoritative** [click] on either side resolves the conflict.

**[rule]** Detected when two indexed sources return contradicting values for the same graph entity. Unresolved conflicts lower the grounding confidence of any answer that touches them — which can in turn trip the refusal threshold in Guardrails (B12).

**[rule]** The second conflict is deliberately awkward: the *more recent* source holds the *less authoritative* value. It demonstrates why "prefer most recent" cannot be the only policy available.

---

## B7. Flow designer

**Purpose.** Author the dynamic journeys the brief calls for, while guaranteeing free-text escape.

### Canvas

Grid canvas with connected nodes; clicking any node loads its inspector panel.

| Node | Type | Inspector detail |
|---|---|---|
| Greeting + suggested chips | **Message** | Greeting text plus 5 suggested chips, sourced from the Quick Actions manager |
| Which utility service? | **Question** | Options bound to the Provider list (SEWA, Etisalat, du) |
| Fetch bill by account # | **Tool call** | Calls `get_bill_status(provider, account_number)`. Retries once on timeout, then falls through to the condition node |
| Escalate on low confidence | **Handover** | Triggers when confidence < 60% or the tool call fails twice. Passes full transcript to a live agent |
| User picks "another inquiry" | **Condition** | Exits the flow at any point and returns control to the router |

**[rule]** The handover node's two triggers correspond exactly to two of the three escalation reasons seeded in the Human agent workspace (B8) — the flow definition and the operational queue agree.
---

## B8. Human agent workspace

**Purpose.** Where an escalated conversation is picked up with full context, plus the rules that decide who picks it up.

### Agent status [click]

`● Available` · `● Busy` · `● Offline`

### Escalation queue

| User | Topic | Channel | Waiting | Priority |
|---|---|---|---|---|
| Ahmed R. | SEWA billing | WhatsApp | 2m | Normal |
| Fatima S. | Customs enquiry | Web | 6m | **High** |
| Yousef M. | Library membership | Web | 1m | Normal |

Selecting a ticket [click] loads its transcript and context rail.

### Per-ticket detail

| | Ahmed R. | Fatima S. | Yousef M. |
|---|---|---|---|
| **Customer** | SEWA account ending 4821 · Verified via UAE PASS | Import declaration #SC-88213 · Not verified | No membership on file |
| **Escalation reason** | Tool call failed twice (invalid account lookup) — auto-escalated per guardrail policy | User requested escalation directly — sentiment flagged as frustrated | Low grounding confidence on eligibility question (below 60% threshold) |
| **Canned replies** | 3 billing-specific | 3 customs-specific | 3 library-specific |

The transcript includes the system note *"Escalated to human agent — full context transferred"*, marking the handoff point.

**Canned replies** [click] populate the composer rather than sending, so the agent can edit first.

**[rule]** The three escalation reasons cover the three distinct triggers: tool failure, user request, and low confidence. Each requires different agent handling, which is why the reason is shown prominently rather than buried.

### Routing rules manager

Rules evaluate **top to bottom; first active match wins**.

| # | Condition | Routes to |
|---|---|---|
| 1 | Topic = Billing | SEWA billing team |
| 2 | Priority = High | Senior agents |
| 3 | Channel = WhatsApp | WhatsApp-trained agents |
| 4 | Wait time > 5 min | Re-queue + supervisor alert |

**Per-rule actions** [click]: **Move up** / **Move down** (changes precedence) · **Enable / Disable** · **Edit** · **Delete**

**+ Add rule** [click] opens a form: condition attribute (`Topic` · `Priority` · `Channel` · `Wait time`), operator (auto-switches to `>` for Wait time, `=` otherwise), value, and route target. **Edit** reuses the same form pre-filled.

### Rule tester

Compose a sample ticket [click] from `Topic` (Billing/Customs/Library/General), `Priority` (Normal/High), `Channel` (Web/WhatsApp), `Wait time` (2/6/10 min), then **Run test**.

The tester evaluates the **live rule list** — including any reordering, disabling or edits just made — and reports which rule fired and where the ticket routes, or that no rule matched and it falls to the default queue.

**[rule]** Because order determines the outcome, a Billing + High-priority ticket routes to the SEWA billing team, not Senior agents. Moving rule 2 above rule 1 changes that — and the tester proves it before the change goes live.

---

## B9. Users, teams & roles

**Purpose.** Access governance for the backoffice — this screen determines what every other screen permits.

### Tab 1 — Users

| Name | Email | Team | Role | Status |
|---|---|---|---|---|
| Sara Al Mazrouei | sara.almazrouei@shj.ae | SEWA Billing | Agent Designer | Active |
| Omar Khan | omar.khan@shj.ae | Customs | Live Agent | Active |
| Priya Nair | priya.nair@shj.ae | Libraries | Knowledge Manager | Invited |
| Ahmed Saeed | ahmed.saeed@shj.ae | Platform | Super Admin | Active |
| Lina Haddad | lina.haddad@shj.ae | Libraries | Reviewer | Suspended |

**Actions** [click]: **Edit** (name, email, team pills, role pills) · **Suspend / Reactivate** · **Remove** · **+ Invite user** (new users enter as `Invited`)

### Tab 2 — Teams

| Team | Entity scope |
|---|---|
| SEWA Billing | SEWA |
| Customs | Sharjah Customs |
| Libraries | Sharjah Libraries |
| Platform | All entities |

Membership chips are **derived live** from the Users tab — reassigning a user's team updates both tabs. **+ Add team** [click] takes name and entity scope.

### Tab 3 — Roles & permissions

Full matrix, 7 roles × 8 permissions, every cell a toggle [click].

| Permission | Super Admin | Entity Admin | Agent Designer | Knowledge Mgr | Reviewer | Live Agent | Analyst |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| View dashboard | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Manage agents | ✓ | ✓ | ✓ | — | — | — | — |
| Publish agents | ✓ | ✓ | — | — | — | — | — |
| Manage knowledge | ✓ | ✓ | — | ✓ | — | — | — |
| Manage routing rules | ✓ | ✓ | — | — | — | — | — |
| Handle escalations | ✓ | — | — | — | — | ✓ | — |
| Manage users & teams | ✓ | — | — | — | — | — | — |
| View analytics | ✓ | ✓ | — | — | ✓ | — | ✓ |

**+ Add custom role** [click] appends a blank role with all permissions off.

**[rule]** Agent Designer can build but not publish. Publishing is an Entity Admin action — separation of duties between authoring and release.

---

## B10. Channel configurations

**Purpose.** Which surfaces the assistant runs on, how each is styled and governed, and how outbound messaging works.

### Tab 1 — Channels

| Channel | Agent | Hours | State |
|---|---|---|---|
| Web widget | SEWA & Utilities Billing Agent | 24/7 | Live [click] |
| WhatsApp | SEWA & Utilities Billing Agent | 24/7 | Live [click] |
| Mobile app | — | — | Disabled [click] |
| Kiosk / IVR | — | — | Disabled [click] |

**Out-of-hours behaviour:** working hours for human handover (`Sun–Thu 08:00–20:00 · Sat 09:00–14:00`), UAE public-holiday auto-sync, a toggle keeping the assistant available 24/7 even when agents are offline, and the message shown when no agent is available.

**[rule]** Disabling a channel stops *new* conversations immediately; open conversations are allowed to finish.

**[rule]** Assistant hours and human-agent hours are separate. The assistant can run 24/7 while escalation is only offered during staffed hours — otherwise users are promised a handover that cannot happen.

### Tab 2 — Web widget studio

| Setting | Options / default |
|---|---|
| Accent colour | 5 swatches; default `#1F6F5C` |
| Launcher position | Bottom right / Bottom left |
| Default state | Docked / Expanded |
| Disclaimer text | Editable |
| Greeting text | Editable |
| Composer placeholder | `Ask SHJ3 Assistant` |
| Allowed domains | `sharjah.ae`, `services.shj.ae` — chips removable, new ones addable |

**Live preview** re-renders on every change — header dot, bubble tint and chip borders all follow the accent colour. **Embed snippet** carries the chosen colour and has a **Copy** button with confirmation feedback.

### Tab 3 — WhatsApp

| Setting | Value |
|---|---|
| Number | +971 800 7342 |
| BSP | Meta Cloud API |
| Opt-in required before first message | On [click] |
| Session window | 24 hours — free-form replies allowed after a user message; a template is required to re-open after this |

| Template | Status |
|---|---|
| `welcome_message` | Approved |
| `bill_reminder` | Approved |
| `appointment_confirmation` | Pending review |

**+ Submit new template** [click] — name and sample body; submitted templates enter as `Pending`.

### Tab 4 — Proactive messaging

| Campaign | Template | Trigger | Audience | Sent | State |
|---|---|---|---|---|---|
| Bill due reminder | `bill_reminder` | 3 days before due date | Opted-in SEWA customers | 4,210 this month | On |
| Appointment confirmation | `appointment_confirmation` | On booking created | Jawaher Centre bookings | — | **Blocked** |
| Payment receipt | `payment_receipt` | On payment settled | All payers | 1,880 this month | On |

**Quiet hours** — no sends 21:00–07:00 [click]

**[rule]** A campaign whose template is not Approved shows **Blocked** and its toggle will not turn on. Approving `appointment_confirmation` in Tab 3 unblocks it — the dependency is enforced, not just described.

**[rule]** Outbound sends require both an approved template and a recorded opt-in, checked at send time rather than only at configuration time.

### Tab 5 — Localization

| Locale | Voice | Direction | Translated | Fallback |
|---|---|---|---|---|
| English | Aria (EN) | LTR | 100% | ✓ |
| Arabic | Layla (AR) | RTL | 82% | Set as fallback [click] |

**[rule]** With the locale gate enabled (B13), an agent bound to Arabic cannot publish until Arabic reaches 100% — otherwise an Arabic-speaking user can receive English replies.

---

## B11. Identity & transactions

**Purpose.** Bind a conversation to a verified person before money moves, and record what happened after it did. This is the screen that closes the gap between "asks for an account number" and "initiates a payment".

### Tab 1 — Verification

| Provider | Type | Note | State |
|---|---|---|---|
| UAE PASS | National digital identity | Returns verified name, Emirates ID hash and mobile | On [click] |
| OTP to registered mobile | Possession factor | Fallback when UAE PASS is unavailable | On [click] |
| Emirates ID scan | Document check | Used for in-person kiosk journeys | Off [click] |

**Account-ownership check** [click] — *"Verify the user actually owns the account number they supply."*

**[rule]** With ownership checking off, a user could look up or pay against an account they do not hold. This is the single most consequential toggle in the prototype.

### Tab 2 — Step-up rules

| Action | Required assurance |
|---|---|
| View bill balance | Anonymous allowed |
| Link a utility account | Verified identity required |
| Initiate a payment | Verified identity + OTP |
| Change registered mobile | Verified identity + OTP |

**[rule]** A flow node that triggers one of these actions pauses for step-up **before** the tool call is made — not after.

### Tab 3 — Payments

| Gateway | Methods | Status |
|---|---|---|
| Sharjah Pay gateway | Card, Apple Pay, bank transfer | Live |
| SEWA direct debit | Bank mandate | Sandbox |

Receipt settings: send in-conversation ✓ · email a PDF copy ✓ · allow refund requests from the assistant ✓

### Tab 4 — Transaction log

| Ref | User | Amount | Service | Status | When |
|---|---|---|---|---|---|
| TXN-88213 | Ahmed R. | AED 412.00 | SEWA bill | Settled | 12 min ago |
| TXN-88210 | Mariam A. | AED 189.50 | Etisalat bill | Settled | 1 hr ago |
| TXN-88204 | Hassan T. | AED 75.00 | Jawaher booking | **Refund requested** | 3 hrs ago |
| TXN-88199 | Yousef M. | AED 240.00 | SEWA bill | Failed | 5 hrs ago |

**Approve refund / Decline** [click] on the pending item resolves it to `Refunded` or back to `Settled`.

### Tab 5 — Identity stitching

| Setting | Options | Default |
|---|---|---|
| Stitch the same person across channels | On / Off | On |
| Stitching key | Verified Emirates ID hash · Mobile number · Never stitch | Verified Emirates ID hash |
| Conversation memory scope | Per verified identity · Per channel session · No memory | Per verified identity |
| Memory retention | 30 days · 90 days · 1 year | 90 days |

**[rule]** Stitching only ever joins **verified** sessions. An anonymous web chat is never merged into a verified WhatsApp identity.

---

## B12. Guardrails & policies

**Purpose.** Central policy inherited by every agent, so a rule change lands everywhere at once rather than requiring per-agent edits.

### Tab 1 — Global policies

| Policy | Detail | Default | Locked |
|---|---|---|---|
| Mask PII in transcripts | Emirates ID, account and card numbers redacted before storage | On | **Yes** |
| Refuse below grounding confidence (60%) | Answer withheld; user offered a human instead | On | No |
| Prompt-injection filter | Blocks instructions embedded in retrieved documents or user uploads | On | **Yes** |
| Block financial advice | Will not advise on payment timing, credit or disputes | On | No |
| Restrict to in-scope government services | Out-of-scope prompts return the service directory | On | No |

**[rule]** Locked policies cannot be toggled or overridden by any role. Attempting to toggle them does nothing — the platform floor is not negotiable per entity.

### Tab 2 — Per-agent overrides

| Agent | Policy | Override | Reason |
|---|---|---|---|
| SEWA & Utilities Billing Agent | Refuse below grounding confidence | 75% | Money movement — stricter than global |
| General FAQ Agent | Restrict to in-scope government services | Disabled | Handles broad wayfinding questions |

**Remove override** [click] returns the agent to global policy.

**[rule]** Overrides are deliberately few and always carry a stated reason. Locked policies never appear here.

---

## B13. Evaluation & testing

**Purpose.** Golden sets, regression runs, and the quality gate standing between an agent and production.

### Tab 1 — Golden sets

| Set | Cases | Owner | Last score |
|---|---|---|---|
| Billing core journeys | 48 | SEWA | 94% |
| Customs enquiries | 32 | Customs | 88% |
| Arabic language parity | 60 | Platform | **71%** |
| Guardrail red-team set | 25 | Platform | 100% |

**Run now** [click] rescores the set live. **Edit cases** [static].

Conversations flagged in the Command centre arrive here via **Add to golden set**, incrementing the *Billing core journeys* count.

### Tab 2 — Regression runs

| Agent | Version | Set | Accuracy | Groundedness | Tool accuracy | Result |
|---|---|---|---|---|---|---|
| SEWA & Utilities Billing | v1.4 | Billing core journeys | 94% | 91% | 97% | Passed |
| Customs Enquiry | v2.1 | Customs enquiries | 88% | 85% | 92% | Passed |
| General FAQ | v3.0 | Arabic language parity | 71% | 69% | 88% | **Failed** |

**Run all suites** [click] prepends a new passing run.

### Tab 3 — Publish gate

| Setting | Default |
|---|---|
| Block publish when a suite fails | On [click] |
| Minimum accuracy | 85% |
| Minimum groundedness | 80% |
| Red-team set must score 100% | On [click] |
| Block publish when a bound locale is below 100% translated | On [click] |

The summary strip reports the **live consequence**:

> Gate is active. **General FAQ Agent v3.0** is currently blocked — Arabic parity at 71% is below the 85% floor.

Switching the gate off changes it to: *"Any agent can be published regardless of test results."*

**[rule]** The gate explains *why* something is blocked rather than only that it is — the blocking set, its score and the threshold it missed are all named.

---

## B14. Governance & ops

**Purpose.** Environment promotion, the immutable change record, live system health, and the privacy posture behind all of it.

### Tab 1 — Environments

| Environment | Agents | Versions | Promotes to |
|---|---|---|---|
| Development | 4 | latest | UAT |
| UAT | 3 | v1.4 / v2.1 / v3.0 | Production |
| Production | 3 | v1.3 / v2.1 / v2.4 | — (Live) |

**Pending promotions**

| Change | Path | Requester | Status |
|---|---|---|---|
| SEWA & Utilities Billing Agent v1.4 | UAT → Production | Sara Al Mazrouei | Awaiting approval |

**Approve / Reject** [click] — either action removes the item **and writes an entry to the audit log in real time**.

**[rule]** Production runs v1.3 while UAT holds v1.4 — the pending promotion is exactly that gap, so the screen tells a coherent story rather than showing arbitrary numbers.

### Tab 2 — Audit log

| Who | What | Environment | When |
|---|---|---|---|
| Sara Al Mazrouei | Published SEWA & Utilities Billing Agent v1.4 | UAT | 2 days ago |
| Ahmed Saeed | Changed global policy: grounding threshold 55% → 60% | Production | 3 days ago |
| Priya Nair | Added knowledge source: Library membership policy | Development | 6 days ago |
| Omar Khan | Exported 42 conversation transcripts | Production | 1 week ago |
| Ahmed Saeed | Granted Entity Admin role to Lina Haddad | Production | 2 weeks ago |

**[rule]** Entries cannot be edited or deleted by any role, including Super Admin. The log covers config changes, publishes, permission grants and data exports.

### Tab 3 — Observability

| Service | p95 latency | Error rate | Status |
|---|---|---|---|
| Sharjah Services Gateway (MCP) | 240 ms | 0.2% | Healthy |
| SEWA bill API | 1,840 ms | 6.1% | **Degraded** |
| Graph RAG retrieval | 310 ms | 0.0% | Healthy |
| WhatsApp BSP | 190 ms | 0.4% | Healthy |

The summary strip points to where the incident is handled: *"SEWA bill API is degraded — its circuit breaker is configured under Tools → Resilience & fallbacks."*

### Tab 4 — Privacy & data

| Setting | Options | Default |
|---|---|---|
| Maintain a consent ledger per user | On / Off | On |
| Honour erasure requests (right to be forgotten) | On / Off | On |
| Transcript retention | 30 days · 90 days · 1 year · 7 years | 90 days |
| Data residency | UAE — Sharjah DC · UAE — Dubai DC · Region-flexible | UAE — Sharjah data centre |

**[rule]** Retention applies to transcripts and derived memory. **Transaction records follow the statutory 7-year rule regardless of this setting** — a deliberate carve-out, since conversation data and financial records have different legal lifetimes.

---

# 6. Cross-module wiring

The prototype is interconnected on purpose, so a demo shows cause and effect rather than isolated screens.

| Action | Consequence | Screens involved |
|---|---|---|
| Bind an MCP tool in wizard step 4 | Reflected in the Tools registry (shared data) | B3 ↔ B5 |
| Approve the `appointment_confirmation` template | Its campaign unblocks and can be switched on | B10 Tab 3 → Tab 4 |
| Reassign a user's team | Team membership chips update | B9 Tab 1 → Tab 2 |
| Approve a pending promotion | Audit log gains an entry immediately | B14 Tab 1 → Tab 2 |
| Click "Add to golden set" on a transcript | Billing core journeys case count increments | B1 → B13 |
| Arabic parity sits at 82% / 71% | Publish gate blocks the bound agent and says why | B10 Tab 5 → B13 Tab 3 |
| SEWA bill API shows Degraded | Its circuit breaker is Open, serving the fallback | B14 Tab 3 ↔ B5 Tab 4 |
| Unresolved source conflict | Lowers grounding confidence, can trip the refusal policy | B6 Tab 4 → B12 |
| Handover node triggers in the flow | Ticket appears with that escalation reason | B7 → B8 |
| Reorder a routing rule | Rule tester returns a different route | B8 within-screen |
| Tool call fails twice | Escalation reason on Ahmed R.'s ticket | B7 → B8 |

---

# 7. Technical notes

## 7.1 Build

| Aspect | Detail |
|---|---|
| Format | Single HTML file, ~151 KB |
| Dependencies | None, beyond a Google Fonts link (IBM Plex Sans / IBM Plex Mono) |
| JavaScript | Vanilla, no framework; delegated event handling with render functions per module |
| State | Plain JS objects in memory; no storage APIs; refresh resets |
| Graph rendering | Inline SVG generated from a node/edge data model, not static markup |

## 7.2 Visual language

| Token | Value | Use |
|---|---|---|
| Paper | `#F6F5F1` | Page background |
| Panel | `#FFFFFF` | Cards and canvases |
| Ink | `#20242B` | Primary text |
| Ink soft | `#5B6270` | Metadata and labels |
| Accent | `#1F6F5C` | Active state, success, primary action |
| Warn | `#B4553F` | Attention states |
| Typefaces | IBM Plex Sans / IBM Plex Mono | Body / metadata and technical values |

Low fidelity is deliberate: reviewers comment on structure and completeness rather than colour and spacing.

## 7.3 Responsiveness

| Breakpoint | Behaviour |
|---|---|
| ≤ 1080 px | KPI grid drops to 2 columns; three-column layouts collapse to single column |
| ≤ 820 px | Sidebar becomes horizontal navigation; two-column forms stack; orchestrator diagram flips vertical |
| ≤ 560 px | KPI grid single column; sub-tab bars scroll horizontally |

## 7.4 Accessibility baseline

- `focus-visible` rings on all interactive elements
- `prefers-reduced-motion` honoured
- Semantic buttons used for controls wherever practical
- Status never carried by colour alone — every badge also carries a text label

## 7.5 Verification performed

| Check | Result |
|---|---|
| Nav items paired to sections | 17 / 17, no orphans, no missing |
| Dead `getElementById` references | None |
| Sub-tab values with a render branch | All |
| JavaScript syntax (`node --check`) | Passes |

---

# 8. Known gaps

Deliberately excluded. Listed so nobody assumes coverage that does not exist.

| Gap | Note |
|---|---|
| Ontology designer | The graph explorer browses entity *instances*; defining entity and relationship *types* is not built |
| Prompt / instruction library | Reusable templates with A/B variants and version history |
| Cost & quota management | Token and API spend per agent, channel and entity; budgets and throttles |
| Notifications & alerting | Who gets told when a breaker trips or a suite fails |
| Kiosk / IVR rendering | Configurable in B10 but not visually mocked the way WhatsApp is |
| Arabic RTL rendering of the assistant UI | Localization is configurable; the assistant itself is not shown mirrored |
| Bulk operations | No multi-select on users, sources or rules |
| Empty and error states | Most lists assume populated data |

---

# 9. Suggested demo path

Roughly 15 minutes, ordered to build the argument rather than tour the menu.

| # | Screen | Show | Point being made |
|---|---|---|---|
| 1 | Launcher | Docked → Expanded → WhatsApp | One assistant, three surfaces, channel-native rendering |
| 2 | Conversation | Step 1 → 4, pointing at the trace and sources rails | Dynamic flow, multi-agent handling, free-text escape |
| 3 | Agent designer | Step 4 → connect the Customs MCP server, bind a discovered tool | The brief's MCP and API integration requirement |
| 4 | Orchestrator | Switch all three execution modes | "Multiple agents for one prompt", with cost/latency trade-offs |
| 5 | Knowledge | Resolve the SEWA tariff conflict, then run the retrieval playground | Graph RAG is governed, not just indexed |
| 6 | Human agent workspace | Open Ahmed R., then reorder a routing rule and run the tester | Escalation carries context; routing is testable before it goes live |
| 7 | Identity & transactions | Ownership check toggle, then the step-up rules | Where the account-number question becomes a controlled transaction |
| 8 | Evaluation | Publish gate blocking General FAQ v3.0 on Arabic parity | Quality is enforced, and it explains itself |
| 9 | Governance | Approve the pending promotion, switch to the audit log | Change control with an immutable record |

**Closing line for the demo:** every screen is fed by the same journey from the brief — Pay Utilities Bills → SEWA → account number — so the platform can be judged as one system rather than nineteen features.
