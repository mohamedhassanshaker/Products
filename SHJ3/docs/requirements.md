# SHJ3 — Requirements Baseline (moved)

> **This file has moved.** The requirements baseline is now split by module in [`requirements/`](./requirements/), because a single 754-line file covering 17 modules, cross-module invariants, non-functional requirements, tenant isolation and risks had grown too large to review or diff per module. All IDs are unchanged and permanent — an ID assigned here means exactly the same thing in its new home.

**Start here → [`requirements/README.md`](./requirements/README.md)**, the index: purpose, ID scheme, scope, actors, source-brief traceability, and a table of contents to every module file.

Quick links, if you already know what you're looking for:

| Was here | Now here |
|---|---|
| §1–4 (purpose, scope, actors, source-brief traceability) | [`requirements/README.md`](./requirements/README.md) |
| §5.1 `platform` | [`requirements/platform.md`](./requirements/platform.md) |
| §5.2 `iam` | [`requirements/iam.md`](./requirements/iam.md) |
| §5.3 `conversation` | [`requirements/conversation.md`](./requirements/conversation.md) |
| §5.4 `agents` | [`requirements/agents.md`](./requirements/agents.md) |
| §5.5 `orchestration` — **now also includes the Pipeline Designer** (FR-ORCH-15 onward), a delivery-added drag-and-drop, versioned, loop-capable multi-agent graph engine that supersedes the flat `executionMode` enum per tenant once activated | [`requirements/orchestration.md`](./requirements/orchestration.md) |
| §5.6 `tools` | [`requirements/tools.md`](./requirements/tools.md) |
| §5.7 `knowledge` | [`requirements/knowledge.md`](./requirements/knowledge.md) |
| §5.8 `flows` | [`requirements/flows.md`](./requirements/flows.md) |
| §5.9 `handover` | [`requirements/handover.md`](./requirements/handover.md) |
| §5.10 `channels` | [`requirements/channels.md`](./requirements/channels.md) |
| §5.11 `verification` | [`requirements/verification.md`](./requirements/verification.md) |
| §5.12 `payments` | [`requirements/payments.md`](./requirements/payments.md) |
| §5.13 `governance` | [`requirements/governance.md`](./requirements/governance.md) |
| §5.14 `evaluation` | [`requirements/evaluation.md`](./requirements/evaluation.md) |
| §5.15 `analytics` | [`requirements/analytics.md`](./requirements/analytics.md) |
| §5.16 `theming` | [`requirements/theming.md`](./requirements/theming.md) |
| §5.17 `userguide` | [`requirements/userguide.md`](./requirements/userguide.md) |
| §6 cross-module integration requirements | [`requirements/cross-module.md`](./requirements/cross-module.md) |
| §7 non-functional requirements (`SEC` `PERF` `A11Y` `I18N` `OBS` `DATA` `OPS`) | [`requirements/non-functional.md`](./requirements/non-functional.md) |
| §8 tenant isolation requirements | [`requirements/tenant-isolation.md`](./requirements/tenant-isolation.md) |
| §9 risks and open questions | [`requirements/risks.md`](./requirements/risks.md) |
| §10 glossary | [`requirements/glossary.md`](./requirements/glossary.md) |

Every other document in `docs/` that links to `requirements.md#some-anchor` still resolves here; follow the table above to the section's new home. New links from other documents should point directly at the relevant file under `requirements/`.
