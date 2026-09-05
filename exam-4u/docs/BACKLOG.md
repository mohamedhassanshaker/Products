# ExamLand — Product Backlog

Authoritative build-order backlog derived from `docs/PRODUCT_SPECIFICATION.md` §7 (MVP Scope vs.
Future Roadmap). `nexus-dev` follows this priority/phase order, merged with any hard technical
dependencies the Architecture phase imposes. Priorities: **P0** = MVP-blocking, **P1** = high
value soon after MVP, **P2** = deferred/future roadmap.

| ID | FR ref(s) | Title | Priority | Phase | Depends on | Rationale |
|---|---|---|---|---|---|---|
| BL-01 | FR-MT-1, FR-MT-2 | Tenant registry & request-time tenant resolution | P0 | 1 | — | Foundational: every other subsystem needs a resolved tenant context before it can do anything; nothing else can be built or tested without this. |
| BL-02 | FR-MT-3, FR-MT-4 | Schema-per-tenant data-access layer & provisioning workflow | P0 | 1 | BL-01 | Unblocks every tenant-scoped feature; the data-access pattern (resolved-tenant handle) is a structural dependency for all subsequent modules, so it ranks with tenant resolution despite being its own FR group. |
| BL-03 | FR-IAM-1, FR-IAM-2 | Authentication & registration | P0 | 1 | BL-02 | Nothing else in the product is reachable without login; must exist before any authenticated feature is testable. |
| BL-04 | FR-IAM-5, FR-IAM-6 | RBAC engine & standard tenant roles | P0 | 1 | BL-03 | Every authorization check in every later feature depends on roles/permissions existing; building it early avoids retrofitting guards into already-built endpoints. |
| BL-05 | FR-MT-9 | Platform Admin console (auth realm + tenant CRUD) | P0 | 1 | BL-01, BL-02 | Platform Admins must be able to create/manage tenants before any tenant can exist in a real environment; structurally separate auth realm is cheapest to build alongside BL-03 rather than bolted on later. |
| BL-06 | FR-IAM-3, FR-IAM-4, FR-IAM-7 | Password recovery, profile, admin user management | P0 | 2 | BL-03, BL-04 | Rounds out the identity subsystem; not needed for the very first login flow but required before Tenant Admins can onboard real users. |
| BL-07 | FR-MT-6, FR-MT-7, FR-MT-8, FR-MT-10 | Per-tenant registration settings, tenant-branded email, tenant-scoped password flows, tenant brand theming (logo + accent override) | P0 | 2 | BL-03, BL-06 | Extends identity/registration with tenant-level configurability; depends on the base auth flows existing first. **Amended**: scope now also covers FR-MT-10 (accent-color override + WCAG-AA contrast validation, layered on `nexus-ux`'s default palette from Dev-3) since it's the same "tenant-configurable presentation" surface as branded email — kept as one item rather than split, since both read/write the same `Tenant` row and ship together naturally. |
| BL-08 | FR-TAX-1, FR-TAX-2, FR-TAX-3, FR-TAX-4 | Taxonomy (Education Level / Stage / Subject) | P0 | 2 | BL-02 | Exam authoring, curricula, and attempts all reference taxonomy scoping; must exist before those subsystems can be meaningfully tested end-to-end. |
| BL-09 | FR-PKG-1, FR-PKG-2, FR-PKG-3, FR-PKG-4, FR-PKG-5, FR-PKG-7 | Feature/package catalog, tenant subscription, usage enforcement, Platform Admin catalog UI | P0 | 2 | BL-05 | Feature-gating must exist before any gated action (exam creation, PDF generation) ships, otherwise those features would ship ungated and require a breaking retrofit. |
| BL-09a | FR-AI-2, FR-AI-3 | Platform Admin AI model allowlist & per-tenant model assignment | P0 | 2 | BL-05 | **New.** Model governance is a Platform Admin config surface in the same family as the package/feature catalog (BL-09) — same admin console, same "curate then assign to tenants" shape — and must exist before any AI-pipeline phase (BL-13+) can resolve which model to call per tenant, so it's sequenced alongside BL-09 rather than deferred to the AI phases themselves. |
| BL-10 | FR-PKG-6 | Stripe billing integration (checkout + webhooks) | P0 | 3 | BL-09 | Needs the package/subscription model (BL-09) in place first; a tenant needs a real way to reach an ACTIVE, paid subscription before usage-gated AI features are viable in production. |
| BL-11 | FR-AUTH-1, FR-AUTH-3, FR-AUTH-5 | Manual (ZIP) exam authoring, module configuration, deletion | P0 | 3 | BL-08 | The simplest path to a live, deliverable Exam Type; establishes the ExamType/Module data shape that every AI-authored path (BL-13+) and exam-taking (BL-16) builds on. |
| BL-12 | FR-CUR-1, FR-CUR-1a, FR-CUR-2, FR-CUR-3 | Curriculum ownership, document ingestion, semantic search | P0 | 3 | BL-08 | Standalone RAG foundation needed before any grounded generation feature (Prompt Practice, lesson generation, exam extraction) can retrieve context. |
| BL-12a | FR-AI-1 | AI subsystem Python service extraction (Google ADK for Python + OpenRouter, internal `AiServicePort`) | P0 | 3 | BL-02, BL-09a | **New — supersedes the prior in-process TypeScript-ADK assumption.** Every AI-pipeline item below (BL-13, BL-14, BL-15, BL-18, BL-25) calls into this service instead of an in-process dependency, so it must exist first; ranks alongside the curriculum/RAG foundation (BL-12) in Phase 3 since both are prerequisite infrastructure rather than user-facing features. Requires a companion architecture amendment (HLD/LLD AI-subsystem section) before implementation — not yet done as of this backlog amendment. |
| BL-13 | FR-PDF-1, FR-PDF-2 (hash-only), FR-PDF-3 | PDF upload, exact-hash dedup, content classification | P0 | 3 | BL-11, BL-12, BL-12a | Entry point of the AI pipeline; must exist before any content-specific generation branch (BL-14/15) can run. Now also depends on BL-12a (AI service extraction) since classification is an LLM call routed through the new Python service. |
| BL-14 | FR-PDF-4, FR-PDF-6, FR-PDF-7, FR-PDF-12 | Lesson generation, reference indexing, subject classification, cost/usage accounting | P0 | 4 | BL-13, BL-12 | Two of the three classification branches plus the cost-control gate that must exist before any generation branch is allowed to run unbounded. |
| BL-15 | FR-PDF-5 | Exam question extraction | P0 | 4 | BL-13, BL-12 | Third classification branch; grouped one phase after BL-14 only because it shares infrastructure (grounding, cost accounting) built there, not because it's less urgent. |
| BL-16 | FR-PDF-8, FR-PDF-9, FR-AUTH-2, FR-AUTH-4 | Review & edit, finalize into Exam Type, curriculum linking | P0 | 4 | BL-14, BL-15, BL-11 | Closes the loop from "AI generated something" to "a live, human-reviewed Exam Type" — the core value proposition of the product; nothing upstream is useful without this. |
| BL-17 | FR-TAKE-1 .. FR-TAKE-9 | Exam taking & adaptive practice (full subsystem) | P0 | 4 | BL-11, BL-16 | The other half of the core value proposition (author → take); depends on Exam Types existing via either authoring path. |
| BL-18 | FR-CUR-4, FR-CUR-5 | Grounded generation wiring, Prompt Practice | P0 | 4 | BL-12, BL-14 | Completes the MVP RAG loop (retrieval already built in BL-12; this wires it into generation and exposes the on-demand practice feature). |
| BL-19 | FR-FILE-1, FR-FILE-2 | Signed file delivery, range support | P0 | 3 | BL-02 | Required underpinning for avatars, question images, and source documents surfaced anywhere in the UI; sequenced early since several P0 features (profile pictures, document review) depend on it existing. |
| BL-20 | FR-REL-1, FR-REL-3 | Outbox pattern, stale session recovery | P0 | 4 | BL-13 | Stale-session recovery specifically needs processing sessions (BL-13) to exist; outbox is cheap to build alongside it and is a prerequisite for reliable async side effects across the whole system. |
| BL-21 | FR-MT-5 (automatic path) | Sequential migration rollout mechanism (internal) | P0 | 2 | BL-02 | Needed as soon as the tenant schema shape starts changing across phases; kept P0 because without it every later schema change has no safe rollout path across existing tenants. |
| BL-22 | FR-PDF-2 (semantic fingerprint tier) | Semantic-fingerprint deduplication | P1 | 5 | BL-13 | Cost-saving enhancement over the P0 exact-hash dedup; valuable but the pipeline is fully functional without it. |
| BL-23 | FR-PDF-10 | Append to existing AI-authored Exam Type | P1 | 5 | BL-16 | Natural follow-on to finalize; deferred since initial authoring (BL-16) already delivers the core value, and append is an efficiency feature on top. |
| BL-24 | FR-PDF-11, FR-FILE-3 (rich cases) | Image extraction & question-image association | P1 | 5 | BL-16, BL-19 | Enhances question quality/fidelity but exam authoring and taking both function fully without images. |
| BL-25 | FR-PDF-13, FR-REL-2 (full) | Full-bank lesson assessment with resumable generation | P1 | 5 | BL-14, BL-20 | A distinct, larger generation mode; depends on the watermark/resumability groundwork and lesson-generation infra already existing. |
| BL-26 | FR-CUR-6 | Adaptive Lesson Practice (bank-first, diversity selection) | P1 | 5 | BL-17, BL-18 | Builds on both the question bank (from exam taking/authoring) and the RAG/practice infra; a genuine enhancement over Prompt Practice, not a blocker for MVP viability. |
| BL-27 | FR-AUTH-6, FR-PDF-7 (standalone trigger) | Retroactive subject re-mapping as a standalone action | P1 | 5 | BL-15, BL-16 | The automatic classification pass ships in BL-14/15; this adds the explicit reviewer-triggered re-run UI/endpoint as a quality-of-life follow-up. |
| BL-28 | FR-MT-5 (operator tooling) | Cross-tenant migration rollout as a dedicated ops tool | P1 | 5 | BL-21 | Upgrades the internal mechanism (BL-21) into a documented, dry-run-capable operator workflow; not needed until the tenant count/migration cadence justifies dedicated tooling. |
| BL-29 | (RAG quality) | Reranking / relevance floor + hybrid search for retrieval | P2 | 6 | BL-12 | Deferred quality enhancement; current pure cosine-similarity retrieval is functional for MVP. |
| BL-30 | (RAG quality) | "Find similar questions" reviewer tool | P2 | 6 | BL-16 | Nice-to-have built on the already-existing question-bank vector index; no product-blocking need. |
| BL-31 | (Lesson Practice) | Multi-document synthesis for Lesson Practice | P2 | 6 | BL-26 | Enhancement over single-document-scoped practice; explicitly deferred per spec §7.3. |
| BL-32 | (Quality feedback loop) | Confidence-threshold recalibration from review feedback | P2 | 6 | BL-16 | Requires accumulated review-edit data before it's even meaningful; naturally sequenced last. |
| BL-33 | (Quality assurance) | Generation-quality evaluation harness | P2 | 6 | BL-14, BL-15 | Internal tooling to support future prompt-tuning; not user-facing, deferred. |
| BL-34 | (UX) | Streaming/granular progress feedback for long-running jobs | P2 | 6 | BL-13, BL-25 | Perceived-responsiveness improvement; coarse status polling is sufficient for MVP/P1. |
| BL-35 | (RAG quality) | Image-aware RAG (vision captioning into retrieval) | P2 | 6 | BL-24 | Depends on image handling (BL-24) existing first; explicitly deferred per spec §7.3. |
| BL-36 | (Billing) | Self-serve tenant plan upgrades | P2 | 6 | BL-10 | Current Platform-Admin-initiated checkout is sufficient for MVP; self-serve is a growth-stage convenience. |
| BL-37 | (Billing) | Multi-tier add-ons, annual billing, coupon/promo codes | P2 | 6 | BL-10 | Explicitly out of scope for the current billing integration per spec §9.4. |
| BL-38 | (Reliability/scale) | Durable multi-consumer job queue for background workers | P2 | 6 | BL-20 | Deferred scaling response; interval-based single-process workers are the accepted MVP/P1 design until load justifies the change. |
| BL-39 | (Compliance/ops) | Localization (non-English content/UI) | P2 | 6 | — | Out of scope per spec §9.4; listed for roadmap completeness only. |
| BL-40 | (Content ingestion) | Scanned/OCR PDF ingestion | P2 | 6 | BL-13 | Out of scope per spec §9.4; listed for roadmap completeness only. |
| BL-41 | (Proctoring) | Live/video proctoring, richer anti-cheating measures | P2 | 6 | BL-17 | Out of scope per spec §9.4; listed for roadmap completeness only. |
| BL-42 | (IAM hardening) | Forced password change on first login for admin-created users | P2 | 6 | BL-06 | Minor security hardening explicitly deferred per spec §7.3. |

## Phase summary

- **Phase 1** — Tenancy foundation, base auth, RBAC, Platform Admin console (BL-01..05).
- **Phase 2** — Identity rounding-out, tenant registration/branding (incl. brand theming,
  FR-MT-10), taxonomy, package/billing catalog & enforcement, AI model allowlist & tenant
  assignment (BL-09a), internal migration mechanism (BL-06..09, BL-09a, BL-21).
- **Phase 3** — Stripe billing, manual exam authoring, curriculum/RAG foundation, AI subsystem
  Python service extraction (BL-12a), PDF pipeline entry point, signed file delivery
  (BL-10..13, BL-12a, BL-19).
- **Phase 4** — Full AI generation branches, review/finalize loop, exam taking & adaptive
  practice, grounded generation/Prompt Practice, reliability core (BL-14..18, BL-20).
- **Phase 5 (P1)** — Semantic dedup, append, image handling, full-bank assessment, adaptive
  lesson practice, standalone re-mapping trigger, ops-grade migration tooling (BL-22..28).
- **Phase 6 (P2)** — All future-roadmap items (BL-29..42), tackled opportunistically after MVP
  and P1 are stable in production.
