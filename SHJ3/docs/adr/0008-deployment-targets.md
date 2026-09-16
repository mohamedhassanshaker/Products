# ADR-0008 — Docker, Compose and Helm; no CI/CD yet

- **Status:** Accepted (with an open risk)
- **Date:** 2026-09-08
- **Deciders:** Product owner, architecture

## Context

Phase C of this project's delivery process requires selecting deployment targets and implementing all of them. The product owner selected:

- **Docker + Docker Compose**
- **Kubernetes (Helm chart)**

and explicitly declined **CI/CD** ("skip CI/CD for now"). Bare VM / IIS / systemd was not selected.

What must be deployed (ADR-0001, ADR-0003): two application runtimes (`shj3-web`, `shj3-ai`), a worker entrypoint, and four stores (SQL Server, Neo4j Enterprise, Qdrant, Redis) — the last of which multiplies by tenant count under ADR-0002.

The tension: this project's own Code Quality Rules state *"linter + formatter + pre-commit hooks configured in the first commit; CI fails on lint, type, or test errors"*, and Phase D requires an E2E suite that *"must run in CI with no manual steps"*. Declining CI/CD contradicts both. That contradiction is accepted here, but it is recorded rather than glossed over, because the mitigation is materially weaker than the rule it replaces.

## Decision

### Selected and implemented

**1. Docker** — multi-stage, non-root images for both runtimes.

- Distinct build and runtime stages; no build toolchain in the final image.
- Runs as a non-root UID; read-only root filesystem; no shell in the runtime layer where practical.
- Pinned base image digests, not floating tags — a floating tag makes a "reproducible build" a fiction.
- `HEALTHCHECK` on both images.
- Images carry a version label matching the release, so a running pod is traceable to a commit.

**2. Docker Compose** — full-stack local and staging parity.

- One `docker compose up` brings up both runtimes, the worker, and all four stores seeded with the wireframe's sample data (the four agents, four knowledge sources, five users, the seeded conflicts and the open SEWA breaker).
- Seed data is *deterministic*, because Phase D's E2E tests depend on it and the wireframe's cross-module wiring only demonstrates correctly from a known starting state.
- Local development is not a reduced configuration: all four stores, both runtimes, real tenant provisioning for at least two tenants — since ADR-0002's isolation guarantee cannot be exercised against a single-tenant environment.

**3. Kubernetes via Helm** — the production target.

- One chart, values per environment: `development`, `uat`, `production`, mirroring B14 tab 1 so the product's promotion flow and the operational promotion flow are the same three environments.
- Liveness, readiness and startup probes on every deployment. `shj3-ai` needs a generous startup probe — model client initialisation is slow, and an aggressive probe will restart-loop it.
- Resource requests and limits on everything. `shj3-ai` gets substantially larger limits than `shj3-web` (ADR-0001's whole justification is their different resource shape).
- Independent HPAs: `shj3-web` on CPU, `shj3-ai` on concurrency.
- Secrets as Kubernetes secrets, never in values files, never in the chart. The chart references secret names; it does not contain secrets.
- NetworkPolicies: only `shj3-web` may reach `shj3-ai`; only `shj3-ai` may reach Neo4j and Qdrant (ADR-0003's ownership rule, enforced by the network rather than by convention).
- PodDisruptionBudgets and a rolling strategy that does not drop in-flight conversation turns.
- Stateful stores as StatefulSets in development; managed instances expected in production.

### Not implemented

**Bare VM / IIS / systemd** — not selected. Should on-premise VM hosting later prove mandatory for the Sharjah data centre, that is a new ADR, and the container images do not carry over to IIS without work.

**CI/CD** — declined. Mitigations, which are the only enforcement that will exist:

1. **Pre-commit hooks are mandatory and load-bearing.** Format, lint, typecheck, module-boundary check, the Prisma→SQLAlchemy drift check (ADR-0005 rule 4), and unit tests on changed packages. With no CI, a bypassed hook is an unreviewed schema change.
2. **One verification command.** `pnpm verify` and `make verify` each run the full gate — lint, typecheck, unit, integration, E2E, security scan. A reviewer runs one command; there is no ambiguity about what "green" means.
3. **The suite is written CI-ready.** No manual steps, no interactive prompts, deterministic seeds, containerised dependencies. Adding a pipeline later must be a YAML file, not a test-suite refactor. This is the specific thing that would be expensive to retrofit, so it is respected now.
4. **Release is a scripted, versioned artefact.** `scripts/release.sh` builds, tags and pushes both images with the same version. Manual `docker build` from a laptop is not a release path.

## Consequences

### Positive

- Compose parity means a developer runs the same four stores and two runtimes as production, so tenancy and multi-store behaviour are exercised locally rather than discovered in UAT.
- Helm environments matching B14's Dev→UAT→Production means the promotion screen reflects reality; the audit entry written on approval corresponds to an actual deployment.
- NetworkPolicies convert two architectural rules — no third deployable reaching the derived stores, web never touching Neo4j/Qdrant — into infrastructure the code cannot violate.
- Writing the suite CI-ready keeps the cost of adding a pipeline at roughly one afternoon.

### Negative

- **RISK-002 (open, medium→high):** nothing enforces quality on a shared branch. A commit that fails lint, typecheck or tests can land, and the schema-drift check — the sole protection against the ADR-0005 corruption scenario — can be bypassed with `--no-verify`. This is the project's own non-negotiable rule being waived. It should be revisited **before a second person commits to this repository**; with one committer the risk is contained by discipline, and with two it is not.
- No automated image build, so image provenance depends on a human running the release script.
- No automated security scanning of dependencies or images on a schedule; container CVEs will be found late.
- Four stores × N tenants is significant operational surface with no pipeline automating provisioning; tenant onboarding is a runbook, not a button.

### Follow-up

- `deployment.md` carries the runbook: provisioning a tenant across four stores, running an N-tenant migration and resuming a partial failure, rollback, and backup scope (SQL Server and Neo4j backed up; Qdrant rebuildable; Redis not backed up per ADR-0003).
- Neo4j **Enterprise** licensing must be confirmed commercially — ADR-0002 depends on multi-database, which Community does not provide (RISK-003).
- When CI is adopted, prefer Azure DevOps if hosting lands on Azure and Entra ID (ADR-0006) is chosen for staff SSO, since the approval-gate model maps directly onto B14's promotion approvals.
