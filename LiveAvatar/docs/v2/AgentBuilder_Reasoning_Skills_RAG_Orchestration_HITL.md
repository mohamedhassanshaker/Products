# Agent Builder — Reasoning, Skills, RAG, Orchestration & HITL
### Replaces §A1.4 of the Functional Specification v2.0

**Why this document exists:** the previous Agent Builder wireframe modelled the agent as a **linear media pipeline** — STT → LLM → TTS → avatar, with one box for "LLM" and a text area for the system prompt. That is a *speech* architecture, not an *agent* architecture. It has no tools surfaced in the builder, no skills, no retrieval pipeline, no orchestration, and no human-in-the-loop.

This document specifies the missing layer using the same Logic → Use case → Wireframe format.

---

## Contents

| § | Feature |
|---|---|
| **A3** | The reasoning layer — replacing the single LLM node with an orchestration graph |
| **A4** | Latency governance — the constraint that makes voice orchestration different |
| **A5** | Skills |
| **A6** | Tools in the builder |
| **A7** | RAG pipeline |
| **A8** | Human-in-the-loop |
| **A9** | The complete revised Agent Builder |

---

## A3. The reasoning layer

### A3.1 The problem with one LLM box

```
  BEFORE (v2.0 draft — a media pipeline)

   STT ──▶ ┌──────────────┐ ──▶ TTS ──▶ Avatar
           │  LLM         │
           │  + prompt    │
           │  + memory    │
           │  + rag       │
           └──────────────┘
           one call, one model, one shot

  AFTER (v2.1 — a reasoning graph inside the turn)

   STT ──▶ ┌────────────────────────────────────────────────┐ ──▶ TTS ──▶ Avatar
           │  ORCHESTRATION GRAPH                           │
           │                                                │
           │   ┌──────┐   ┌────────┐   ┌──────┐             │
           │   │Router│──▶│Retrieve│──▶│ LLM  │──▶ speak    │
           │   └──┬───┘   └────────┘   └──────┘             │
           │      │       ┌────────────────────┐            │
           │      ├──────▶│ Skill: refunds     │            │
           │      │       │  ├ tool: lookup    │            │
           │      │       │  ├ HITL: approve   │            │
           │      │       │  └ tool: issue     │            │
           │      │       └────────────────────┘            │
           │      └──────▶│ Sub-agent: billing │            │
           │              └────────────────────┘            │
           └────────────────────────────────────────────────┘
```

The LLM box does not disappear — it becomes **one node type among several**, and a simple agent still has a graph of exactly one LLM node. Nothing gets harder for the simple case.

### A3.2 Node types

| Node | Purpose | Key settings |
|---|---|---|
| **LLM** | A reasoning or generation step | Provider chain, model, prompt, temperature, output mode (speech / structured / silent) |
| **Retrieve** | Query the RAG pipeline | Source set, top-k, rerank, threshold, latency budget |
| **Tool** | Invoke a registered tool | Tool, argument mapping, timeout, on-failure |
| **Skill** | Invoke a packaged capability (§A5) | Skill + version, input mapping |
| **Sub-agent** | Delegate to another agent with its own persona and tools | Agent, handback policy, budget |
| **Router** | Branch on classification or an expression | Classifier prompt or rule set, branches, default |
| **Parallel** | Fan out, then join | Branches, join policy, per-branch budget |
| **Loop** | Repeat until a condition holds | Condition, max iterations, max duration, max cost |
| **HITL** | Pause for a human decision (§A8) | Gate type, reviewers, SLA, timeout behaviour |
| **Speak** | Emit speech immediately, without waiting for the graph | Text or template, interruptible |
| **Handoff** | Transfer to a human | Destination, context summary |
| **State** | Read or write session variables | Variable, value, scope |
| **End** | Terminate the turn | — |

### A3.3 Orchestration patterns

**Sequential** — the default. Each node's output feeds the next.

```
  [Retrieve] ──▶ [LLM: answer] ──▶ [Speak]
```

**Parallel** — fan out, join on a policy. Used when several independent lookups are needed and the turn budget cannot afford them serially.

```
                 ┌──▶ [Tool: order status] ──┐
  [LLM: plan] ──▶├──▶ [Tool: shipping ETA] ──┼──▶ [Join: all] ──▶ [LLM: compose] ──▶ [Speak]
                 └──▶ [Retrieve: policy]   ──┘
```

| Join policy | Behaviour |
|---|---|
| `all` | Wait for every branch. Turn cost = slowest branch. |
| `first_success` | Take the first branch that succeeds; cancel the rest. |
| `quorum(n)` | Proceed when n branches have returned. |
| `best_of` | Run branches, have a judge node pick. Expensive — flagged in the builder. |
| `all_settled` | Wait for all, but proceed with partial results if some fail. |

**Loop** — iterate until a condition is met, with hard guards.

```
  [Loop: until answer_is_grounded OR max 3]
     ├─ [Retrieve: refine query]
     ├─ [LLM: draft answer]
     └─ [LLM: check grounding] ──▶ condition
```

**Router** — classify, then branch. The most common pattern in a real support agent.

```
  [Router: intent]
     ├─ "order status"  ──▶ [Skill: order-tracking]
     ├─ "refund"        ──▶ [Skill: refunds]
     ├─ "complaint"     ──▶ [Handoff]
     └─ default         ──▶ [Retrieve] ──▶ [LLM]
```

**Sub-agent** — delegation with its own prompt, tools, and budget, returning control when done.

```
  [Router] ──▶ [Sub-agent: billing-specialist]  budget 4s, hands back with a result
```

### A3.4 Logic

| Rule | Statement |
|---|---|
| **R-G1** | Every agent has exactly one **turn graph**. A minimal agent's graph is a single LLM node; the builder ships that as the default so simple agents stay simple. |
| **R-G2** | Every node declares a **lane**: `foreground` (the caller is waiting; counts against the turn budget) or `background` (runs after the agent has spoken; may update state or interject on a later turn). |
| **R-G3** | The **sum of foreground node budgets along the longest path must not exceed the turn budget.** The builder computes this continuously and blocks publish if the critical path exceeds it. This is the single most important constraint in voice orchestration. |
| **R-G4** | Every loop requires all three guards: max iterations, max duration, and max cost. A loop without guards cannot be saved. |
| **R-G5** | Graph cycles are permitted only inside an explicit Loop node. Arbitrary back-edges are rejected at validation. |
| **R-G6** | Sub-agent nesting is limited to 2 levels. Deeper delegation is a design smell in a latency-bounded system and is blocked at validation. |
| **R-G7** | Every node has an `on_error` and an `on_deadline` edge. Unhandled node failure falls through to the graph's terminal degradation, never to silence. |
| **R-G8** | The graph is part of the ConfigVersion and is therefore immutable, versioned, diffable, and rollback-able like any other config (§A1). |
| **R-G9** | Every node execution is recorded on the session with inputs, outputs, latency, cost, and lane — rendered in the Session detail waterfall. |

**Node execution state machine**

```
   PENDING ──▶ RUNNING ──success──▶ COMPLETE
                  │
                  ├── deadline reached ──▶ TIMED_OUT ──▶ take on_deadline edge
                  ├── error ─────────────▶ FAILED    ──▶ take on_error edge
                  └── cancelled (join won elsewhere) ─▶ CANCELLED
```

### A3.5 Use cases

**UC-G1 — Building a router-based support agent**
*Actor:* Tenant Admin

1. Admin opens the **Reasoning** tab. The canvas shows the default single LLM node.
2. Drags a **Router** node before it and defines four intents.
3. Attaches the existing `order-tracking` skill to the first branch, `refunds` to the second.
4. Points the "complaint" branch at a **Handoff** node.
5. Leaves the default branch as Retrieve → LLM.
6. The **latency budget panel** on the right recalculates: critical path is Router 180 ms → Skill 1,900 ms → Speak, total 2,080 ms against a 2,500 ms turn budget. Green.
7. Admin adds a second tool to the refunds skill. The panel turns amber — critical path is now 2,640 ms.
8. Admin changes the two tool calls inside the skill from sequential to **parallel** with `join: all`. Critical path drops to 2,180 ms. Green again.
9. Runs Test call; the eval suite passes; publishes.

*Outcome:* a branching agent whose latency was designed rather than discovered in production.

**UC-G2 — A background node that doesn't cost the caller anything**
*Actor:* Tenant Admin

1. The business wants every call logged to their CRM with a summary.
2. Admin adds a **Tool** node `crm_log_interaction` and sets its lane to **background**.
3. The builder moves it below the foreground lane divider on the canvas and excludes it from the critical path calculation.
4. At runtime the agent speaks its answer, and the CRM write happens afterwards without the caller waiting on it.
5. If the CRM write fails, the session records the failure and an alert fires — but the conversation was never affected.

### A3.6 Wireframe — Reasoning graph canvas

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  ‹ Agents  Acme / Support   [dev│staging│●production]  v13   [Save] [⚡Test] [Publish]    │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ [ Pipeline │ ●Reasoning │ Skills │ Tools │ Knowledge │ Dynamics │ HITL │ Privacy ]        │
├─────────────────────────────────────────────────────────┬────────────────────────────────┤
│  ADD ▾  ⊞ LLM  ⊟ Tool  ⊙ Retrieve  ◈ Skill  ⇄ Router    │  TURN BUDGET      2,500 ms     │
│         ⇉ Parallel  ↻ Loop  ⏸ HITL  ▶ Speak  ↗ Handoff  │  ┌──────────────────────────┐  │
│                                                          │  │ CRITICAL PATH   2,080 ms │  │
│  ┌────────── FOREGROUND — caller is waiting ───────────┐ │  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░  83%   │  │
│  │                                                     │ │  │                          │  │
│  │            ┌─────────────┐                          │ │  │ STT endpoint      300 ms │  │
│  │            │ ⇄ Router    │  180ms                   │ │  │ ⇄ Router          180 ms │  │
│  │            │   intent    │                          │ │  │ ◈ Skill:refunds 1,340 ms │  │
│  │            └──┬──┬──┬──┬─┘                          │ │  │   ├ ⊟ lookup      410 ms │  │
│  │     ┌─────────┘  │  │  └─────────┐                  │ │  │   └ ⊞ compose     930 ms │  │
│  │     ▼            ▼  ▼            ▼                  │ │  │ ▶ TTS first audio 260 ms │  │
│  │ ┌────────┐ ┌────────┐ ┌────────┐ ┌───────────────┐  │ │  │ ─────────────────────────│  │
│  │ │◈ Skill │ │◈ Skill │ │↗Handoff│ │ ⊙ Retrieve    │  │ │  │ Headroom          420 ms │  │
│  │ │ order- │ │ refunds│ │        │ │   policy-kb   │  │ │  └──────────────────────────┘  │
│  │ │tracking│ │        │ │        │ └───────┬───────┘  │ │                                │
│  │ │  620ms │ │ 1340ms │ │        │   340ms │          │ │  ⚠ 2 paths over budget         │
│  │ └────┬───┘ └───┬────┘ └────────┘         ▼          │ │   [ show ▸ ]                   │
│  │      │         │              ┌──────────────────┐  │ │                                │
│  │      └────┬────┴──────────────│ ⊞ LLM  compose   │  │ │  VALIDATION            0 err   │
│  │           │                   │   gpt-4o-mini    │  │ │  ✓ no unguarded loops          │
│  │           │                   │      930ms       │  │ │  ✓ nesting depth 1/2           │
│  │           │                   └────────┬─────────┘  │ │  ✓ all nodes have on_error     │
│  │           └────────────┬───────────────┘            │ │  ⚠ Router default → Retrieve   │
│  │                        ▼                            │ │    has no on_deadline edge     │
│  │                 ┌────────────┐                      │ │                                │
│  │                 │ ▶ Speak    │                      │ │  ESTIMATED COST                │
│  │                 └────────────┘                      │ │  $0.019 / turn                 │
│  └─────────────────────────────────────────────────────┘ │  $0.048 / min                  │
│  ┌────────── BACKGROUND — runs after the agent speaks ──┐ │                                │
│  │   ┌──────────────────┐   ┌────────────────────────┐  │ │  [ Simulate a turn ▸ ]         │
│  │   │ ⊟ crm_log        │   │ ⊞ LLM: extract intent  │  │ │                                │
│  │   │   not on path    │   │   for analytics        │  │ │                                │
│  │   └──────────────────┘   └────────────────────────┘  │ │                                │
│  └─────────────────────────────────────────────────────┘ │                                │
│                                        [ − ] 80% [ + ]   │                                │
└─────────────────────────────────────────────────────────┴────────────────────────────────┘
```

### A3.7 Wireframe — Node inspector

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ⇉ Parallel node — "gather order context"                          [ ✕ ]     │
├──────────────────────────────────────────────────────────────────────────────┤
│  Lane          (●) Foreground — caller waits   ( ) Background                │
│  Budget        [ 900 ] ms       ⓘ Longest branch determines the cost.        │
│                                                                              │
│  BRANCHES                                                      [ + Branch ]  │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ ⊟ Tool  lookup_order        est. 410 ms   ▓▓▓▓▓░░░░░  [⚙] [✕]         │  │
│  │ ⊟ Tool  shipping_eta        est. 380 ms   ▓▓▓▓░░░░░░  [⚙] [✕]         │  │
│  │ ⊙ Retrieve  returns-policy  est. 340 ms   ▓▓▓▓░░░░░░  [⚙] [✕]         │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  JOIN POLICY   [ All branches must return                            ▾ ]     │
│                 ⓘ Turn cost = slowest branch (410 ms), not the sum.          │
│                   Sequential would cost 1,130 ms — over budget.              │
│                                                                              │
│  If a branch fails  [ Continue with partial results               ▾ ]        │
│  If budget exceeded [ Proceed with whatever returned              ▾ ]        │
│                     └▶ on_deadline edge  ──▶ [ ⊞ LLM: compose         ▾ ]    │
│                                                                              │
│  ┌── Timing preview ──────────────────────────────────────────────────────┐  │
│  │  0ms            200            400            600            900       │  │
│  │  lookup_order   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇ 410                                  │  │
│  │  shipping_eta   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇ 380                                    │  │
│  │  returns-policy ▇▇▇▇▇▇▇▇▇▇▇▇▇ 340                                      │  │
│  │  join ─────────────────────────▲ 410ms   headroom 490ms                │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                      [ Cancel ]  [ Apply ]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## A4. Latency governance

**This is the section that makes voice orchestration different from text-agent orchestration.**

A text agent can spend 40 seconds in a ReAct loop and nobody minds. A voice agent that spends 4 seconds has already lost the caller. Every orchestration feature below exists in text-agent frameworks; almost none of them ship with the guardrails a live conversation requires. That gap is where a voice-agent platform earns its keep.

### A4.1 Logic

| Rule | Statement |
|---|---|
| **R-G10** | The turn budget is declared per agent. The builder continuously computes the **critical path** — the longest chain of foreground node budgets — and shows headroom. Publish is blocked when the critical path exceeds the turn budget. |
| **R-G11** | **Speculative retrieval:** Retrieve nodes may start on the *partial* transcript before endpointing fires. If the final transcript differs materially the result is discarded. Typically recovers 200–400 ms at the cost of some wasted queries. |
| **R-G12** | **Speculative speech:** a Speak node may be placed before a slow branch to emit an acknowledgement ("Let me check that order…") while the graph runs. This is distinct from filler — it is intentional, scripted, and contextual. |
| **R-G13** | **Deadline degradation:** when the turn budget is at risk, in-flight foreground nodes are cut and the graph takes the `on_deadline` edge — answer with what is available, promise a follow-up, or hand off. It never simply waits. |
| **R-G14** | Background-lane nodes are excluded from the critical path and may not emit speech in the current turn. They may write state, call tools, or queue an interjection for the next turn. |
| **R-G15** | The Session detail waterfall renders the graph execution, so a slow turn is attributable to a specific node rather than to "the LLM". |

**Budget allocation**

```
  TURN BUDGET 2,500 ms  =  the caller's tolerance before it feels broken

  ├─ 300 ms  endpointing        (dynamics.endpointing_silence_ms)
  ├─ 1,940 ms graph critical path  ◀── what the builder governs
  └─ 260 ms  TTS time-to-first-audio

  If the graph exceeds its share:
     900 ms  → filler audio begins (caller hears something)
   1,940 ms  → soft deadline: cut optional branches
   2,500 ms  → hard deadline: take on_deadline edge, answer with what exists
```

### A4.2 Use case

**UC-G3 — A graph that would have shipped 6 seconds of silence**
*Actor:* Tenant Editor

1. Editor builds a research-style graph: Retrieve → LLM draft → LLM critique → Retrieve refine → LLM final.
2. The budget panel shows critical path 6,240 ms against a 2,500 ms turn budget — 250% over. The canvas highlights the four nodes on the offending path in red.
3. The builder suggests three fixes inline: move the critique to background, parallelise the two retrievals, or drop the refine loop.
4. Editor moves the critique node to the **background lane** — it now runs after the agent speaks, and its output improves the *next* turn.
5. Editor parallelises the two Retrieve nodes with `join: all`.
6. Critical path falls to 2,180 ms. Green.
7. Editor adds a **Speak** node before the parallel block: *"Let me pull that up."* Caller-perceived wait drops to under a second.

*Outcome:* the same reasoning quality, restructured to fit a conversation — a decision the builder made visible rather than leaving to production.

### A4.3 Wireframe — Turn budget panel (expanded)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Turn budget                                                    [ ✕ ]        │
├──────────────────────────────────────────────────────────────────────────────┤
│  Target turn budget   [ 2500 ] ms     ⓘ Above ~2.5s callers perceive a stall.│
│                                                                              │
│  CRITICAL PATH — longest foreground chain                                    │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ 0        500      1000     1500     2000     2500ms                    │  │
│  │ ├────────┼────────┼────────┼────────┼────────┤                         │  │
│  │ ▓▓▓ endpointing 300                                                    │  │
│  │    ▓▓ ⇄ Router 180                                                     │  │
│  │      ▓▓▓▓ ⊟ lookup_order 410                                           │  │
│  │           ▓▓▓▓▓▓▓▓▓ ⊞ LLM compose 930                                  │  │
│  │                     ▓▓ ▶ TTS 260                                       │  │
│  │                       ░░░░ headroom 420                                │  │
│  │                                          ▲ filler at 900ms             │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ALL PATHS                                                                   │
│   ✓ Router → order-tracking → Speak            1,360 ms   ▓▓▓▓▓░░░  54%      │
│   ✓ Router → refunds → Speak                   2,080 ms   ▓▓▓▓▓▓▓░  83%      │
│   ⚠ Router → default → Retrieve → LLM → Speak  2,610 ms   ▓▓▓▓▓▓▓▓▓ 104%     │
│      └ over by 110 ms   [ suggest fixes ▸ ]                                  │
│   ✓ Router → Handoff                             420 ms   ▓░░░░░░░  17%      │
│                                                                              │
│  OPTIMISATIONS                                                               │
│   [●] Speculative retrieval on partial transcript      saves ~280 ms         │
│       ⓘ Starts retrieval before the caller finishes. Discards on mismatch.   │
│   [●] Pre-synthesise Speak nodes at publish            saves ~180 ms         │
│   [ ] Cache retrieval results for 60s                  saves ~200 ms         │
│                                                                              │
│  WHEN THE HARD DEADLINE IS HIT                                               │
│   [ Answer with whatever has returned, note the gap        ▾ ]               │
│   Alternatives: promise a follow-up · hand off · ask a clarifying question   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## A5. Skills

### A5.1 What a skill is, and why voice needs it more than chat does

A **skill** is a packaged capability: a trigger description, a body of instructions, and the tools, knowledge sources, and optional sub-graph it needs to do one job well.

```
  SKILL: refunds
  ├─ name          refunds
  ├─ description   "Handle refund requests, eligibility checks and processing"
  │                 ▲ this is the ONLY part in the base prompt
  ├─ instructions  full procedure, edge cases, escalation rules, tone
  │                 ▲ injected only when the skill triggers
  ├─ tools         check_eligibility, issue_refund
  ├─ knowledge     returns-policy source, filtered to refund sections
  ├─ hitl          approval required when amount > 500
  └─ graph         optional sub-graph for multi-step handling
```

The reason this matters more in voice than in chat: **prompt size drives time-to-first-token**, and TTFT is on the critical path of every single turn. An agent with twelve procedures crammed into one system prompt pays for all twelve on every turn, including "what are your opening hours". Progressive disclosure — description in the base prompt, body loaded on trigger — is a latency optimisation, not just an organisational nicety.

### A5.2 Logic

| Rule | Statement |
|---|---|
| **R-S1** | Only a skill's `name` and `description` occupy the base system prompt. The instruction body, its tools, and its knowledge filters are injected **only when the skill is triggered**. |
| **R-S2** | Triggering is either **model-decided** (the LLM selects from descriptions, like tool selection) or **router-decided** (a Router node routes to it deterministically). Router-decided is faster and more predictable; model-decided is more flexible. The builder makes the trade-off explicit. |
| **R-S3** | Skills are versioned and immutable per version, like config. An agent references a specific version or a floating "latest" — with the builder warning that "latest" means an upstream edit changes behaviour without a publish. |
| **R-S4** | Skills are **shareable across agents within a tenant**, and — for Platform Operators — publishable to a platform library for all tenants. A skill defined once serves the support agent and the sales agent. |
| **R-S5** | A skill declares its own latency budget. The builder counts it on the critical path of any branch that can reach it. |
| **R-S6** | A skill may declare an HITL gate, which applies wherever the skill is used, so an approval requirement cannot be lost by attaching the skill to a different agent. |
| **R-S7** | Base-prompt cost is displayed live: number of attached skills, tokens consumed by their descriptions, and the resulting effect on TTFT. |
| **R-S8** | A skill can be disabled per environment, so a risky new procedure can run in staging without touching production. |

**Skill resolution at runtime**

```
  base prompt contains:  skill names + descriptions only  (~15 tokens each)
        │
        ├─ Router node routes to "refunds"        → deterministic, 0 extra LLM call
        └─ LLM selects "refunds" from descriptions → 1 selection call, ~200ms
        │
        ▼
  INJECT: refunds.instructions
          refunds.tools become callable
          refunds.knowledge filter applied to retrieval
          refunds.hitl gate armed
        │
        ▼
  execute skill body (its own sub-graph, or plain LLM turn with those resources)
        │
        ▼
  RELEASE: instructions and tools leave context on skill exit
```

### A5.3 Use cases

**UC-S1 — Twelve procedures without paying for twelve on every turn**
*Actor:* Tenant Admin

1. The agent's system prompt has grown to 4,200 tokens covering twelve procedures. p95 TTFT is 940 ms and rising.
2. Admin opens **Skills**, clicks *Extract from prompt*.
3. The builder proposes twelve skill candidates from the prompt's structure and shows the token cost of each.
4. Admin accepts ten, keeping two genuinely global instructions in the base prompt.
5. Base prompt drops to 680 tokens plus 10 descriptions (~150 tokens).
6. The budget panel shows p95 TTFT estimated at 520 ms — 420 ms recovered on **every turn of every call**.
7. Eval suite passes unchanged; publish proceeds.

**UC-S2 — One skill, two agents, one approval rule**
*Actor:* Tenant Admin

1. Both the support and sales agents need refund handling.
2. Admin builds the `refunds` skill once, including the HITL gate for amounts over 500.
3. Attaches it to both agents.
4. A month later, finance lowers the approval threshold to 200. Admin edits the skill, publishes `v3`.
5. Both agents pick it up on their next publish — and the pinned-version warning tells the admin exactly which agents are affected before they commit.

*Outcome:* the approval rule cannot drift between agents, because it lives with the capability rather than with each agent's prompt.

### A5.4 Wireframe — Skills library

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  Skills — Acme                                    [ Tenant │ Platform ]   [ + New skill ] │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  🔍 [                                    ]   Used by [ All agents ▾ ]                     │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ SKILL              VER   TOOLS  KNOWLEDGE  HITL   BUDGET   USED BY      TRIGGERS 7d│  │
│  ├────────────────────────────────────────────────────────────────────────────────────┤  │
│  │ ◈ refunds          v3     2      1 source  ✓ >500  1,340ms  Support,Sales    412   │  │
│  │ ◈ order-tracking   v7     2      —         —         620ms  Support        1,904   │  │
│  │ ◈ appointment      v2     3      —         ✓ always 1,880ms  Sales             88   │  │
│  │ ◈ tech-triage      v1     1      2 sources —       1,120ms  Support           240   │  │
│  │ ◈ escalation       v4     —      1 source  —         380ms  Support,Sales     61   │  │
│  ├────────────────────────────────────────────────────────────────────────────────────┤  │
│  │ PLATFORM LIBRARY — published by the platform operator                              │  │
│  │ ◈ kyc-verification v2     3      —         ✓ always 2,100ms  —          [ adopt ]  │  │
│  │ ◈ payment-capture  v5     2      —         ✓ always 1,640ms  —          [ adopt ]  │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│  BASE PROMPT COST — Support agent                                                        │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Core instructions           680 tok  ▓▓▓▓                                          │  │
│  │ Skill descriptions ×5        78 tok  ▓                                             │  │
│  │ ─────────────────────────────────────────────────────────────────────────────────  │  │
│  │ Total base                  758 tok      est. TTFT 520 ms  ✓                       │  │
│  │ ⓘ Skill bodies (4,100 tok combined) load only when triggered.                      │  │
│  │   Without progressive disclosure this would be 4,858 tok → est. TTFT 940 ms.       │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### A5.5 Wireframe — Skill editor

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  ◈ refunds  v3                                    [ Test ] [ Save draft ] [ Publish v4 ]  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  Name         [ refunds                                    ]                              │
│  Description  [ Handle refund requests, eligibility checks and processing              ]  │
│               ⓘ 12 tokens. This is the ONLY text in the base prompt — the model uses     │
│                 it to decide when to load this skill. Be specific about when to trigger. │
│                                                                                          │
│  TRIGGERING   (●) Model decides from the description    ( ) Router node only              │
│               ⓘ Model-decided adds ~200 ms selection latency but handles phrasing         │
│                 you didn't anticipate. Router is faster and deterministic.                │
│                                                                                          │
│  INSTRUCTIONS                                                       1,840 tokens          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ You are handling a refund request. Follow this order:                              │  │
│  │ 1. Confirm the order reference before anything else.                               │  │
│  │ 2. Call check_eligibility. Do not estimate eligibility yourself.                    │  │
│  │ 3. If eligible and under 500, call issue_refund and confirm the amount aloud.      │  │
│  │ 4. If 500 or over, tell the caller you need a quick approval, then wait.           │  │
│  │ 5. Never promise a timeline the policy source does not state.                       │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│  TOOLS                                          KNOWLEDGE                                │
│  ┌───────────────────────────────────┐          ┌──────────────────────────────────────┐ │
│  │ ⊟ check_eligibility  410ms  [⚙][✕]│          │ ⊙ returns-policy                     │ │
│  │ ⊟ issue_refund       620ms  [⚙][✕]│          │   filter: section = "refunds"        │ │
│  │ [ + Attach tool ]                 │          │   top-k 3 · threshold 0.75  [⚙][✕]   │ │
│  └───────────────────────────────────┘          │ [ + Attach source ]                  │ │
│                                                 └──────────────────────────────────────┘ │
│  HUMAN APPROVAL                                                                          │
│   [●] Required when  [ amount ][ > ][ 500 ]                                              │
│   Reviewers  [ finance-approvers        ▾ ]   SLA [ 45 ] s                               │
│   While waiting, caller hears  [ Let me get that approved — about 30 seconds.       ]    │
│   On timeout  [ Defer: end call, approve async, notify caller            ▾ ]             │
│   ⓘ This gate travels with the skill. Any agent using it inherits the approval rule.     │
│                                                                                          │
│  BUDGET        [ 1340 ] ms      ⓘ Counted on the critical path of any branch reaching it │
│  Environments  [✓] dev   [✓] staging   [✓] production                                    │
│                                                                                          │
│  ┌── TEST ────────────────────────────────────────────────────────────────────────────┐  │
│  │ Caller says: [ I want a refund on order 4821, it arrived broken            ] [Run] │  │
│  │                                                                                    │  │
│  │ ✓ Skill triggered (model-decided, 190 ms)                                          │  │
│  │ ✓ check_eligibility(ref=4821) → eligible, amount 640.00        410 ms              │  │
│  │ ⏸ HITL gate armed — 640 > 500 → approval required                                  │  │
│  │ ▶ "That's eligible. Let me get that approved — about 30 seconds."                  │  │
│  │   Total to first audio: 1,180 ms ✓                                                 │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## A6. Tools in the builder

Tools were specified in §C4 of the main document but never surfaced in the builder. They appear in three places:

| Where | Purpose |
|---|---|
| **Tools tab** | The registry — define, test, monitor (wireframe in §C4.3 of the main spec). |
| **Reasoning canvas** | A Tool node placed explicitly in the graph, with a lane and a budget. |
| **Skill editor** | Tools attached to a skill, callable only while that skill is active. |
| **Agent-level attach panel** | Tools always available to the base LLM without a skill or a graph node. |

### A6.1 Logic

| Rule | Statement |
|---|---|
| **R-T1** | A tool reaches the model through exactly one of three routes: attached at agent level (always available), attached to a skill (available only while that skill is loaded), or placed as a graph node (invoked deterministically, not model-decided). The builder shows which route each tool takes. |
| **R-T2** | Agent-level tools cost base-prompt tokens on every turn, exactly like skill descriptions. The builder displays that cost and warns above a configurable count (default 8). |
| **R-T3** | Every tool declares a lane. A background tool never blocks speech. |
| **R-T4** | A tool marked **consequential** (writes, payments, bookings, cancellations) requires either an HITL gate or an explicit written acknowledgement that it may fire autonomously. This is a deliberate friction point. |
| **R-T5** | Tools carry a per-session invocation cap and a per-turn cap; the per-turn cap prevents a single turn from looping the budget away. |

### A6.2 Wireframe — Tools attach panel (Agent Builder)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  Tools — Acme / Support                                                                  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  ALWAYS AVAILABLE — in the base prompt, costs tokens on every turn                       │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ ⊟ lookup_order       410ms  fg   read       28 tok   [ ⚙ ] [ detach ]              │  │
│  │ ⊟ check_stock        380ms  fg   read       24 tok   [ ⚙ ] [ detach ]              │  │
│  │ ⊟ crm_log            —      bg   write      22 tok   [ ⚙ ] [ detach ]              │  │
│  │ ────────────────────────────────────────────────────────────────────────────────── │  │
│  │ 3 tools · 74 tokens · est. +40 ms TTFT on every turn            ✓ under limit (8)  │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                            [ + Attach ]  │
│                                                                                          │
│  VIA SKILLS — loaded only when the skill triggers, no base-prompt cost                   │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ ◈ refunds        →  check_eligibility, issue_refund ⚠consequential                 │  │
│  │ ◈ appointment    →  find_slots, book_slot ⚠consequential, send_confirmation        │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│  IN THE GRAPH — invoked deterministically by a node, never model-decided                 │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ ⊟ shipping_eta   node "gather order context"  ⇉ parallel branch 2                  │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│  ⚠ CONSEQUENTIAL TOOLS — 3 tools can change state in your systems                        │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ issue_refund        ✓ HITL gate: amount > 500                                      │  │
│  │ book_slot           ✓ HITL gate: always                                            │  │
│  │ cancel_order        ⚠ NO GATE — will fire autonomously                             │  │
│  │                       [ Add approval gate ]  or  [ Acknowledge autonomous use ]    │  │
│  │                       ⓘ Publish to production is blocked until one is chosen.      │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## A7. RAG pipeline

### A7.1 The problem with "RAG: on"

The v1 builder had RAG as part of a "behaviour" block, and the v2.0 draft reduced it to `sources`, `top_k`, `min_score`. That is a retrieval *setting*, not a pipeline. Retrieval quality in production is decided by chunking strategy, query rewriting, hybrid weighting, and reranking — none of which were exposed.

```
  INGESTION (offline, per source)
   Source ──▶ Parse ──▶ Clean ──▶ Chunk ──▶ Enrich ──▶ Embed ──▶ Index
                                    ▲                              │
                            the decision that                vector + keyword
                            determines quality

  RETRIEVAL (online, on the critical path — budgeted)
   Query ──▶ Rewrite ──▶ Hybrid search ──▶ Filter ──▶ Rerank ──▶ Threshold ──▶ Compress ──▶ Inject
              ▲            ▲                            ▲                        ▲
        conversation   vector + BM25              cross-encoder            token cap
        context                                   (costs 150-300ms)
```

### A7.2 Logic

| Rule | Statement |
|---|---|
| **R-R1** | Ingestion is configurable per source: parser, cleaning rules, chunking strategy (fixed / semantic / heading-aware), chunk size, overlap, metadata enrichment, embedding model. |
| **R-R2** | Re-indexing is required when chunking or the embedding model changes. The builder warns and shows the cost and duration before committing. |
| **R-R3** | Retrieval runs on the critical path and therefore carries a hard **budget**. Each stage's contribution is shown; exceeding the budget returns whatever has been retrieved so far rather than blocking the turn. |
| **R-R4** | Hybrid search weighting between vector and keyword is configurable. Pure vector search reliably fails on exact identifiers — order numbers, SKUs, policy codes — which is precisely what callers say out loud. |
| **R-R5** | **Query rewriting** uses conversation context, because a caller's third utterance is "what about the other one" and that retrieves nothing on its own. Rewriting costs latency and is therefore optional and budgeted. |
| **R-R6** | **Reranking** is a distinct, optional stage with its own budget, because a cross-encoder adds 150–300 ms and is worth it for some agents and not others. |
| **R-R7** | Retrieved chunks below the score threshold are **dropped, not passed with a low score**, and the event is recorded as a knowledge gap (feeding §D3's gap report). |
| **R-R8** | Injection has a token cap. Retrieved context inflates the prompt and therefore TTFT; the builder shows that cost. |
| **R-R9** | A **retrieval playground** lets an operator run a query against the live index and see every stage's output — pre-rerank and post-rerank scores, what was filtered, what was injected. Retrieval failures are otherwise invisible and get misdiagnosed as prompt problems. |
| **R-R10** | Speculative prefetch (R-G11) applies to retrieval: start on the partial transcript, discard on mismatch. |

### A7.3 Use case

**UC-R1 — "The agent can't find our refund policy"**
*Actor:* Tenant Admin

1. The knowledge gap report shows 18 unanswered asks for "refund after 30 days".
2. Admin opens the **Retrieval playground** and runs that exact query.
3. Stage output shows: vector search returned the shipping policy, not refunds; BM25 returned the right chunk at rank 4; the reranker was off; threshold 0.75 dropped everything.
4. Diagnosis: the source was chunked at a fixed 512 tokens, splitting the refund table across three chunks so no single chunk scored well.
5. Admin changes that source to **heading-aware chunking**, and raises hybrid keyword weight from 0.2 to 0.4.
6. Re-index runs — 4 minutes, $0.80, shown before committing.
7. Replays the query: the refund chunk now returns at rank 1, score 0.89.
8. Runs the eval suite; the two previously failing `no_hallucination` cases now pass.

*Outcome:* a retrieval defect diagnosed as a retrieval defect, in minutes, instead of being treated as a prompt problem for weeks.

### A7.4 Wireframe — RAG pipeline builder

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  Knowledge — Acme / Support                       [ Sources │ ●Pipeline │ Playground ]    │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  INGESTION — per source, offline                                                         │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ SOURCE            TYPE      CHUNKS   STRATEGY        EMBEDDED      LAST INDEXED    │  │
│  │ ⊙ returns-policy  upload      184    heading-aware   text-3-large  2h ago      [⚙] │  │
│  │ ⊙ product-docs    crawl     2,410    semantic        text-3-large  1d ago      [⚙] │  │
│  │ ⊙ faq             upload       96    fixed 512/64    text-3-large  6d ago  ⚠   [⚙] │  │
│  │                                                       └ stale, source changed      │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│  ┌─ Editing: returns-policy ──────────────────────────────────────────────────────────┐  │
│  │ Parser      [ PDF — layout aware        ▾ ]                                        │  │
│  │ Clean       [✓] strip headers/footers  [✓] drop boilerplate  [ ] lowercase         │  │
│  │ Chunking    ( ) Fixed  ( ) Semantic  (●) Heading-aware                             │  │
│  │             Max size [ 800 ] tok   Overlap [ 100 ] tok   Keep tables whole [✓]     │  │
│  │             ⓘ Heading-aware keeps policy sections and tables intact. Fixed-size    │  │
│  │               chunking splits tables and is the most common cause of retrieval     │  │
│  │               failures on policy documents.                                        │  │
│  │ Enrich      [✓] section path  [✓] document title  [✓] last-modified date           │  │
│  │ Embed       [ text-embedding-3-large     ▾ ]  3,072 dims                           │  │
│  │ ⚠ Changing chunking or the embedding model requires a re-index.                    │  │
│  │   Estimated: 184 chunks · ~4 min · $0.80          [ Re-index ]                     │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│  RETRIEVAL — online, on the critical path            budget [ 400 ] ms                   │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                                    │  │
│  │  ① QUERY REWRITE            [●] on    est.  120 ms  ▓▓▓                            │  │
│  │     [ Rewrite using the last 3 turns of conversation           ▾ ]                 │  │
│  │     ⓘ Without this, "what about the other one" retrieves nothing.                  │  │
│  │                                                                                    │  │
│  │  ② HYBRID SEARCH            always on  est.   60 ms  ▓▓                            │  │
│  │     Vector  ▓▓▓▓▓▓▓░░░ 0.6      Keyword (BM25)  ▓▓▓░░░░░░░ 0.4                     │  │
│  │     ⓘ Raise keyword weight when callers say exact identifiers aloud —              │  │
│  │       order numbers, SKUs, policy codes. Pure vector search misses them.           │  │
│  │     Candidates  [ 20 ]                                                             │  │
│  │                                                                                    │  │
│  │  ③ METADATA FILTER          [●] on    est.    5 ms  ▏                              │  │
│  │     [ section ][ = ][ refunds ]     [ + condition ]                                │  │
│  │                                                                                    │  │
│  │  ④ RERANK                   [●] on    est.  180 ms  ▓▓▓▓▓                          │  │
│  │     Model [ cross-encoder ▾ ]   Keep top [ 3 ] of 20                               │  │
│  │     ⓘ The largest single quality gain and the largest single latency cost.         │  │
│  │                                                                                    │  │
│  │  ⑤ THRESHOLD                min score [ 0.75 ]                                     │  │
│  │     Below threshold → [ Drop and log as a knowledge gap            ▾ ]             │  │
│  │                                                                                    │  │
│  │  ⑥ INJECT                   token cap [ 1200 ]   est. +85 ms TTFT                  │  │
│  │     Format [ Numbered with source citations   ▾ ]   [✓] cite in summary            │  │
│  │                                                                                    │  │
│  │  ─────────────────────────────────────────────────────────────────────────────     │  │
│  │  TOTAL  365 ms of a 400 ms budget    ▓▓▓▓▓▓▓▓▓░  91%    ✓                          │  │
│  │  [●] Speculative prefetch on partial transcript          recovers ~280 ms          │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### A7.5 Wireframe — Retrieval playground

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  Knowledge                                       [ Sources │ Pipeline │ ●Playground ]     │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  Query  [ refund after 30 days                                              ]  [ Run ]   │
│  Conversation context (optional)                                                         │
│  [ caller: my order arrived broken / agent: I'm sorry to hear that              ]        │
│                                                                                          │
│  ① REWRITE                                                                    118 ms     │
│     → "refund eligibility for a damaged order more than 30 days after delivery"          │
│                                                                                          │
│  ② HYBRID SEARCH — 20 candidates                                               58 ms     │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ #  SOURCE          SECTION              VECTOR  BM25   BLEND                       │  │
│  │ 1  returns-policy  Refunds › Damaged     0.81   0.74    0.78                       │  │
│  │ 2  returns-policy  Refunds › Timeframe   0.77   0.88    0.81                       │  │
│  │ 3  faq             Shipping delays       0.74   0.21    0.53                       │  │
│  │ …17 more                                                                           │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│  ③ FILTER  section = refunds → 20 reduced to 11                                  4 ms    │
│                                                                                          │
│  ④ RERANK — top 3 of 11                                                        176 ms    │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ RANK  WAS  SOURCE          SECTION              SCORE   Δ                          │  │
│  │  1     2   returns-policy  Refunds › Timeframe   0.89   ▲1                         │  │
│  │  2     1   returns-policy  Refunds › Damaged     0.86   ▼1                         │  │
│  │  3     7   returns-policy  Refunds › Exceptions  0.79   ▲4  ← reranker found this  │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│  ⑤ THRESHOLD 0.75 — 3 pass, 0 dropped                                                    │
│  ⑥ INJECT — 3 chunks, 780 tokens of a 1,200 cap                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ [1] Refunds › Timeframe — Standard refunds are available within 30 days of         │  │
│  │     delivery. Damaged goods are exempt from this limit…                            │  │
│  │ [2] Refunds › Damaged — …                                                          │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│  TOTAL 356 ms of 400 ms budget ✓        [ Save as eval case ]  [ Compare to v12 ▸ ]      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## A8. Human-in-the-loop

### A8.1 Why voice HITL is a different problem

In a text agent, an approval gate is easy: the agent pauses, a human clicks approve, the agent continues. The user sees a spinner and gets on with their day.

**In voice, the caller is on the line.** A 45-second approval is 45 seconds of a human being holding a phone. This means most HITL patterns from text-agent frameworks are unusable as-is, and the platform must offer a graduated set:

| Gate type | Caller experience | Use when |
|---|---|---|
| **Blocking approval** | Agent explains, plays hold treatment, waits | Fast decisions (<60 s) with staffed reviewers, on high-value actions |
| **Supervisor whisper** | Caller hears nothing; a human watches live and sends private guidance to the agent | Training, high-risk accounts, new agent rollout |
| **Pre-speech review** | Agent pauses briefly before saying something in a sensitive category | Regulated advice, pricing commitments, legal statements |
| **Deferred approval** | Agent says "I've submitted this for approval, you'll get a text within the hour", call ends normally | The default for anything slow — this is the one most teams forget to build |
| **Post-hoc review** | No caller impact at all; a human reviews the transcript afterwards | Sampling for quality, regulatory record-keeping |

**The important design position:** deferred approval should be the *default* recommendation in the builder, and blocking approval should require the operator to confirm they have staffed reviewers within the SLA. A blocking gate with nobody watching is worse than no gate — it produces dead air and an abandoned call.

### A8.2 Logic

| Rule | Statement |
|---|---|
| **R-H1** | Every HITL gate declares: trigger condition, gate type, reviewer group, SLA, hold treatment, and timeout behaviour. All six are mandatory; a gate cannot be saved partially specified. |
| **R-H2** | Timeout behaviour is one of `auto_approve`, `auto_deny`, `escalate to a wider group`, or `defer to async`. `auto_approve` on a consequential tool requires an explicit written acknowledgement, because it means the gate does nothing under load — exactly when it matters most. |
| **R-H3** | A **blocking** gate cannot be published to production unless the reviewer group has at least one member and a configured notification channel. The builder checks reviewer coverage at publish time. |
| **R-H4** | Blocking gates count against the turn budget as an *unbounded* node. The builder marks the path as unbounded rather than pretending to estimate it, and requires a hold treatment and an SLA. |
| **R-H5** | The caller is always told **what** is being waited on and **roughly how long**. Silence during an approval is never acceptable; hold treatment is mandatory. |
| **R-H6** | The reviewer sees full context — the transcript so far, the proposed action with its exact arguments, the caller's identity if known, retrieved sources, and the model's stated reasoning — and can **approve, deny, or edit-and-approve**. Edit-and-approve is what makes the gate useful rather than merely obstructive. |
| **R-H7** | Every decision is recorded with reviewer identity, decision, edits made, latency, and justification, and is auditable (§D4). |
| **R-H8** | Supervisor whisper is invisible to the caller. Guidance enters the agent's context as a system-level instruction for the next turn only. |
| **R-H9** | Deferred approvals survive the call: the action queues, the caller is notified of the outcome through their configured channel, and the follow-up is tracked to completion. |
| **R-H10** | HITL metrics — gate hit rate, approval rate, median decision latency, timeout rate, caller abandonment during a gate — are first-class and alertable. A gate whose callers abandon is a broken gate. |

**Blocking gate flow**

```
  Graph reaches HITL node
        │
        ├─▶ agent speaks the hold treatment       ← caller knows what's happening
        ├─▶ notify reviewer group (push, Slack, email, console)
        ├─▶ start SLA timer
        │
        ├─ reviewer APPROVES ────────▶ continue graph with original arguments
        ├─ reviewer EDITS + APPROVES ▶ continue graph with edited arguments
        ├─ reviewer DENIES ──────────▶ take on_deny edge (explain, offer alternative)
        │
        └─ SLA EXPIRES ──▶ auto_approve | auto_deny | escalate | defer
                                                             │
                                                             └─▶ agent: "I've submitted
                                                                 this — you'll hear within
                                                                 the hour." Call ends
                                                                 normally, action queued.
```

### A8.3 Use cases

**UC-H1 — A refund above the approval threshold, approved live**
*Actor:* Caller, Reviewer

1. Caller requests a refund. The `refunds` skill runs `check_eligibility` → eligible, 640.00.
2. The skill's gate triggers (amount > 500). The graph pauses at the HITL node.
3. Agent: *"That's eligible. Let me get that approved — about 30 seconds."*
4. The finance reviewer group is notified. The **reviewer console** shows the transcript, the proposed `issue_refund(order=4821, amount=640.00)`, the eligibility result, and the policy chunk that was retrieved.
5. Reviewer edits the amount to 590.00 (shipping not refundable), adds a note, and approves — 22 seconds elapsed.
6. Graph resumes with the edited arguments. Agent: *"Approved — 590 refunded, minus shipping. It'll be back in 3–5 days."*
7. Session records the gate, the reviewer, the edit, and 22 s latency. Caller was informed throughout.

**UC-H2 — Nobody is watching at 2 a.m.**
*Actor:* Caller, System

1. Same refund, same gate, but at 02:14 with no reviewer online.
2. Agent plays the hold treatment. The SLA of 45 s expires.
3. Timeout behaviour is `defer to async` — the configured default.
4. Agent: *"I can't get that approved right now, but I've submitted it. You'll get a text within the hour either way."*
5. Call ends normally with a proper summary. The action sits in the approval queue.
6. At 09:02 the reviewer approves. The caller receives the notification. The follow-up is tracked to closure.

*Contrast:* with `auto_approve` the refund would have fired unreviewed at 2 a.m. — the gate would have been theatre. With `auto_deny` the caller would have been refused for a staffing reason. Deferral is the only answer that respects both the control and the caller.

**UC-H3 — Supervising a newly-launched agent**
*Actor:* Supervisor

1. A new sales agent goes live. The Tenant Admin enables **supervisor whisper** for the first week on all sessions.
2. A supervisor watches the live console: transcript streaming, the agent's next planned action, retrieved sources.
3. The agent is about to quote a discount outside policy. The supervisor types: *"Standard discount is 10%, don't offer more."*
4. The guidance enters the agent's context for the next turn only. The agent adjusts. **The caller hears nothing unusual.**
5. Whisper events are logged and reviewed at week's end, and the recurring ones become eval cases and prompt fixes.

### A8.4 Wireframe — HITL configuration

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  Human-in-the-loop — Acme / Support                                        [ + Add gate ] │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  ACTIVE GATES                                                                            │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ TRIGGER                      TYPE        REVIEWERS        SLA    7D HITS  APPROVED │  │
│  │ issue_refund amount > 500    blocking    finance (4)      45s        41      88%   │  │
│  │ book_slot                    blocking    scheduling (2)   30s        88      97%   │  │
│  │ cancel_order                 deferred    ops (6)          4h         12     100%   │  │
│  │ pricing statements           pre-speech  sales-lead (1)   15s         7      71%   │  │
│  │ all sessions (first 7 days)  whisper     supervisors (3)   —        204       —    │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│  ┌─ Editing: issue_refund amount > 500 ───────────────────────────────────────────────┐  │
│  │ TRIGGER      [ Tool: issue_refund ▾ ]  when [ amount ][ > ][ 500 ]                 │  │
│  │                                                                                    │  │
│  │ GATE TYPE                                                                          │  │
│  │  (●) Blocking      caller waits on the line                                        │  │
│  │  ( ) Deferred      action queues, caller notified later      ← recommended default │  │
│  │  ( ) Pre-speech    review before the agent says it                                 │  │
│  │  ( ) Whisper       supervisor guides silently                                      │  │
│  │  ( ) Post-hoc      no caller impact, reviewed afterwards                           │  │
│  │                                                                                    │  │
│  │  ⚠ Blocking gates put a live caller on hold. Confirm reviewer coverage:            │  │
│  │    finance group · 4 members · median response 22s · coverage Mon–Fri 08:00–18:00  │  │
│  │    ⚠ 31% of this gate's triggers in the last 7 days fell outside coverage hours.   │  │
│  │      Those callers waited the full 45s SLA before the timeout fired.               │  │
│  │      [ Switch to deferred outside coverage hours ]  ← recommended                  │  │
│  │                                                                                    │  │
│  │ REVIEWERS    [ finance-approvers ▾ ]   Notify via [ Slack ][ Push ][ Console ]     │  │
│  │ SLA          [ 45 ] seconds                                                        │  │
│  │                                                                                    │  │
│  │ WHAT THE CALLER HEARS                                                              │  │
│  │  On entry   [ That's eligible. Let me get that approved — about 30 seconds.    ]   │  │
│  │  Hold       ( ) Silence  ✕ not permitted   (●) Periodic reassurance  ( ) Music     │  │
│  │             [ Still waiting on approval — thanks for bearing with me.          ]   │  │
│  │             every [ 15 ] s                                                         │  │
│  │  Approved   [ Approved — {amount} will be refunded within 3–5 days.            ]   │  │
│  │  Denied     [ I wasn't able to get that approved. Let me explain the options.  ]   │  │
│  │                                                                                    │  │
│  │ ON TIMEOUT   ( ) Approve automatically  ⚠ requires written acknowledgement         │  │
│  │              ( ) Deny automatically                                                │  │
│  │              ( ) Escalate to [ finance-managers ▾ ] for another [ 30 ] s           │  │
│  │              (●) Defer: submit for async approval, notify caller later             │  │
│  │                  Notify caller via [ SMS ▾ ]  within [ 1 ] hour                    │  │
│  │                                                                                    │  │
│  │ Reviewer may  [✓] approve  [✓] deny  [✓] edit arguments then approve              │  │
│  │               [✓] require a justification note on deny                             │  │
│  │                                                                                    │  │
│  │ ┌── Last 7 days ────────────────────────────────────────────────────────────────┐  │  │
│  │ │ Triggered 41 · approved 36 (12 edited) · denied 2 · timed out 3               │  │  │
│  │ │ Median decision 22s · p95 41s · caller abandonment during gate 4.9% ⚠         │  │  │
│  │ └───────────────────────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### A8.5 Wireframe — Reviewer console

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  Approvals                                    ● 2 waiting    ⏱ oldest 18s      [ 🔔 on ]  │
├─────────────────────────────────┬────────────────────────────────────────────────────────┤
│  QUEUE                          │  ses_9c14 · Acme/Support · caller "Sarah M."           │
│                                 │  ⏱ 18s of 45s   ▓▓▓▓▓▓░░░░░░░░░░                       │
│  ● ses_9c14   refund $640       │                                                        │
│    18s ⏱ ▓▓▓▓░░░░               │  PROPOSED ACTION                                       │
│                                 │  ┌──────────────────────────────────────────────────┐  │
│  ● ses_9c88   refund $1,240     │  │ issue_refund                                     │  │
│    4s  ⏱ ▓░░░░░░░               │  │   order   4821                                   │  │
│                                 │  │   amount  [ 640.00 ]  ← editable                 │  │
│  ─────────────────────────      │  │   reason  "arrived damaged"                      │  │
│  RECENT                         │  └──────────────────────────────────────────────────┘  │
│  ✓ ses_9b02  $780   approved    │                                                        │
│  ✎ ses_9a77  $520   edited      │  WHY THE AGENT PROPOSED THIS                           │
│  ✕ ses_9a31  $2,100 denied      │  check_eligibility → eligible · damaged-goods exemption │
│                                 │  Source [1] Refunds › Damaged (0.86)      [ view ▸ ]   │
│                                 │                                                        │
│                                 │  TRANSCRIPT                              [ 🔊 listen ] │
│                                 │  ┌──────────────────────────────────────────────────┐  │
│                                 │  │ caller  My order arrived broken                  │  │
│                                 │  │ agent   I'm sorry — can I take the order number? │  │
│                                 │  │ caller  4821                                     │  │
│                                 │  │ agent   Thanks. Checking eligibility…            │  │
│                                 │  │ agent   That's eligible. Let me get that         │  │
│                                 │  │         approved — about 30 seconds.  ◀ waiting  │  │
│                                 │  └──────────────────────────────────────────────────┘  │
│                                 │                                                        │
│                                 │  CALLER CONTEXT                                        │
│                                 │  3 prior calls · 2 prior refunds (total $310) ⚠        │
│                                 │  Account since 2024 · CSAT avg 4.6                     │
│                                 │                                                        │
│                                 │  Note  [ Shipping not refundable — reduced to 590 ]    │
│                                 │                                                        │
│                                 │  [ ✕ Deny ]   [ ✎ Edit & approve ]   [ ✓ Approve ]     │
│                                 │                                                        │
│                                 │  ⓘ On timeout in 27s this defers to async approval.    │
└─────────────────────────────────┴────────────────────────────────────────────────────────┘
```

### A8.6 Wireframe — Supervisor whisper console

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  Live monitoring — Acme / Sales                                       ● 3 live sessions   │
├─────────────────────────────────┬────────────────────────────────────────────────────────┤
│  LIVE                           │  ses_9d40 · 3:12 · caller "Tom R."       ● whisper on  │
│  ● ses_9d40  3:12  Sales   👁    │  ⓘ The caller cannot see or hear anything on this page.│
│  ● ses_9d41  1:04  Sales        │                                                        │
│  ● ses_9d44  0:22  Support      │  TRANSCRIPT — live                                     │
│                                 │  ┌──────────────────────────────────────────────────┐  │
│  ALERTS                         │  │ caller  Can you do better than 10% off?          │  │
│  ⚠ ses_9d40 discount discussion │  │ agent   Let me see what I can do…                │  │
│                                 │  └──────────────────────────────────────────────────┘  │
│                                 │                                                        │
│                                 │  AGENT'S NEXT PLANNED TURN            ⏸ held 2.1s      │
│                                 │  ┌──────────────────────────────────────────────────┐  │
│                                 │  │ "I can offer 15% if you commit to annual         │  │
│                                 │  │  billing today."                                 │  │
│                                 │  │  ⚠ pricing statement — outside 10% policy        │  │
│                                 │  └──────────────────────────────────────────────────┘  │
│                                 │                                                        │
│                                 │  WHISPER — private guidance, next turn only            │
│                                 │  [ Standard discount is 10%. Don't offer more —   ]    │
│                                 │  [ offer the extended trial instead.              ]    │
│                                 │                    [ Send whisper ]  [ Let it go ]     │
│                                 │                                                        │
│                                 │  QUICK ACTIONS                                         │
│                                 │  [ Hold agent ]  [ Join the call ]  [ Take over ]      │
│                                 │                                                        │
│                                 │  SESSION  v13 · 6 turns · $0.21 · p95 turn 1.4s        │
└─────────────────────────────────┴────────────────────────────────────────────────────────┘
```

### A8.7 Wireframe — Caller-side experience during a gate

```
  BLOCKING GATE — the caller must know what is happening

  ┌────────────────────────────────────────────────────────────┐
  │  ACME SUPPORT                       ●●●○      ⏱ 03:41      │
  ├────────────────────────────────────────────────────────────┤
  │                                                            │
  │                 ┌──────────────────────┐                   │
  │                 │   [ avatar video ]   │                   │
  │                 └──────────────────────┘                   │
  │                                                            │
  │   ┌──────────────────────────────────────────────────────┐ │
  │   │  ⏸  Getting approval                                  │ │
  │   │     Usually takes under a minute                      │ │
  │   │     ▓▓▓▓▓▓▓▓░░░░░░░░  22s                             │ │
  │   └──────────────────────────────────────────────────────┘ │
  │                                                            │
  │   💬 "Still waiting on approval — thanks for bearing        │
  │       with me."                                            │
  │                                                            │
  │   ⓘ The agent explains, gives an estimate, and reassures   │
  │     periodically. Silence during a gate is never used.     │
  └────────────────────────────────────────────────────────────┘

  DEFERRED OUTCOME — the call ends normally

  ┌────────────────────────────────────────────────────────────┐
  │   💬 "I couldn't get that approved right now, but I've      │
  │       submitted it. You'll get a text within the hour       │
  │       either way."                                          │
  │                                                            │
  │   PENDING                                                  │
  │    ⏳ Refund of $640 on order 4821 — awaiting approval      │
  │       We'll text +971 •• ••• 4412                          │
  └────────────────────────────────────────────────────────────┘
```

---

## A9. The complete revised Agent Builder

### A9.1 Tab structure

The v1 builder was one page with six provider dropdowns. The v2.1 builder is eight tabs, because the agent now has eight genuinely distinct concerns.

| Tab | Contains | Was in v1? |
|---|---|---|
| **Pipeline** | Transport, STT, TTS, avatar chains with fallbacks and budgets | Partly — single dropdowns, no chains |
| **Reasoning** | The orchestration graph, node inspector, turn budget panel | No |
| **Skills** | Attached skills, base-prompt cost, trigger mode | No |
| **Tools** | Agent-level tools, consequential-tool review, routing summary | No |
| **Knowledge** | RAG sources, ingestion pipeline, retrieval pipeline, playground | Only as "RAG" in behaviour |
| **Dynamics** | Barge-in, endpointing, verbosity, no-input, call limits | No |
| **HITL** | Approval gates, reviewer groups, hold treatment, timeout policy | No |
| **Privacy** | Residency, redaction, retention — per agent | Separate screen |

### A9.2 Wireframe — Builder overview tab

The overview replaces the v1 single-page layout and is what an operator sees on open.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Agents   Acme / Support   [dev│staging│●production]  v13   [Save][⚡Test][Diff][Publish]│
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ [ ●Overview │ Pipeline │ Reasoning │ Skills │ Tools │ Knowledge │ Dynamics │ HITL │ … ]  │
├────────────────────────────────────────────────────────┬─────────────────────────────────┤
│                                                        │  TURN BUDGET     2,080/2,500 ms │
│  ┌── MEDIA PIPELINE ────────────────────────────────┐  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░  83%  ✓      │
│  │ Transport  LiveKit                          ✓    │  │                                 │
│  │ STT        Deepgram → faster-whisper         ✓    │  │  BASE PROMPT        758 tok     │
│  │ TTS        ElevenLabs → Fish Speech          ✓    │  │   core 680 · skills 78          │
│  │ Avatar     bitHuman → static portrait        ✓    │  │   est. TTFT 520 ms  ✓           │
│  │                                        [ edit ▸ ] │  │                                 │
│  └──────────────────────────────────────────────────┘  │  EST. COST                      │
│                                                        │   $0.019/turn  $0.048/min       │
│  ┌── REASONING ─────────────────────────────────────┐  │                                 │
│  │      ⇄ Router ──┬─▶ ◈ order-tracking             │  │  VALIDATION           0 errors  │
│  │                 ├─▶ ◈ refunds  ⏸ gate            │  │  ✓ chains complete              │
│  │                 ├─▶ ↗ Handoff                    │  │  ✓ credentials resolve          │
│  │                 └─▶ ⊙ Retrieve ─▶ ⊞ LLM          │  │  ✓ critical path in budget      │
│  │  background: ⊟ crm_log, ⊞ intent-extract         │  │  ✓ loops guarded                │
│  │                                        [ edit ▸ ] │  │  ⚠ cancel_order has no gate     │
│  └──────────────────────────────────────────────────┘  │    → blocks production publish   │
│                                                        │                                 │
│  ┌── CAPABILITIES ──────────────────────────────────┐  │  LAST EVAL          2 min ago   │
│  │ Skills     5 attached · 78 tok base cost         │  │   16/18 ⚠  p95 1.44s            │
│  │ Tools      3 always-on · 5 via skills · 1 node   │  │   2 new failures                │
│  │            ⚠ 1 consequential tool ungated        │  │   [ view ▸ ]                    │
│  │ Knowledge  3 sources · 2,690 chunks · 1 stale ⚠  │  │                                 │
│  │ HITL       5 gates · 1 blocking outside coverage │  │  [ ⚡ Test call ]                │
│  │                                        [ edit ▸ ] │  │  [ 🔍 Simulate a turn ]         │
│  └──────────────────────────────────────────────────┘  │                                 │
│                                                        │  LIVE YAML             [ copy ] │
│  ┌── BEHAVIOUR ─────────────────────────────────────┐  │  ┌───────────────────────────┐  │
│  │ Greeting   "Hi, thanks for calling…"             │  │  │ reasoning:                │  │
│  │ Barge-in   enabled, medium                       │  │  │   graph:                  │  │
│  │ Endpoint   700 ms (ar: 850 ms)                   │  │  │     - id: router          │  │
│  │ Max turn   200 tok / 20 s                        │  │  │       type: router        │  │
│  │ Languages  en, ar                                │  │  │       branches:           │  │
│  │                                        [ edit ▸ ] │  │  │         - intent: refund  │  │
│  └──────────────────────────────────────────────────┘  │  │           to: skill:refunds│ │
│                                                        │  └───────────────────────────┘  │
└────────────────────────────────────────────────────────┴─────────────────────────────────┘
```

### A9.3 Validation rules added by this document

| ID | Rule | Blocks |
|---|---|---|
| **V-1** | Foreground critical path ≤ turn budget | Production publish |
| **V-2** | Every loop has iteration, duration, and cost guards | Save |
| **V-3** | Sub-agent nesting ≤ 2 levels | Save |
| **V-4** | No graph cycle outside a Loop node | Save |
| **V-5** | Every node has `on_error`; every foreground node has `on_deadline` | Production publish |
| **V-6** | Every consequential tool has a gate or a written autonomous-use acknowledgement | Production publish |
| **V-7** | Every blocking gate has ≥1 reviewer, a notification channel, a hold treatment, and a timeout policy | Production publish |
| **V-8** | `auto_approve` timeout on a consequential tool requires written acknowledgement | Production publish |
| **V-9** | Every knowledge source is indexed and not stale relative to its origin | Warn; blocks if referenced by a skill in a published path |
| **V-10** | Retrieval stage budgets sum ≤ retrieval budget | Save |
| **V-11** | Base prompt + skill descriptions + always-on tool schemas ≤ configured token ceiling | Warn |
| **V-12** | Every skill referenced by the graph exists and is enabled in the target environment | Publish |

### A9.4 What this changes in the rest of the specification

| Section | Change |
|---|---|
| §2 Config schema | `llm:` becomes `reasoning: { graph: [...] }`; adds `skills:`, `knowledge.pipeline:`, `hitl:` |
| §A2 Publish gates | G2 gains V-1 through V-12 |
| §C1 Failover | Chains still apply per provider; nodes add `on_error` and `on_deadline` on top |
| §D2 Session detail | The turn waterfall renders **graph node execution**, not just pipeline legs |
| §D3 Evaluation | Assertions extend to node-level: `node_reached`, `skill_triggered`, `gate_fired`, `retrieval_grounded` |
| §D4 Audit | Adds skill publish, gate configuration change, and every reviewer decision |
| §G3 Screen inventory | Adds Skills library, Skill editor, Knowledge pipeline, Retrieval playground, Reviewer console, Supervisor console |

---

*This document replaces §A1.4. Every addition traces to a capability the agent needs to be an agent rather than a speech pipeline: it can reason in steps, package procedures, retrieve deliberately, delegate, and pause for a human — all inside a turn budget a live caller will tolerate.*
