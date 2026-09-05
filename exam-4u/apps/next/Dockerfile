# ExamLand — apps/next (the Next.js/Chakra rewrite target). Multi-stage: deps -> build -> runtime.
#
# Wired into `docker-compose.next.yml` (Phase 10 sub-slice "10a") as both the `web` (ROLE=web) and
# `worker` (ROLE=worker) service image — migration plan: "same image, ROLE env var selects
# `node server.js` (web) vs `node worker.js` (worker)". This Dockerfile is fully separate from the
# existing root `docker/Dockerfile` (which still builds/serves the legacy NestJS+Angular stack,
# untouched, unaffected by anything in this file).
#
# **ROLE=worker judgment call** (Phase 10, documented in
# `docs/plans/nextjs-rewrite-phase10-plan.md`): `next build`'s `output: 'standalone'` file-tracer only
# traces/bundles what the Next.js app itself imports — `src/server/workers/worker-entrypoint.ts` is
# never imported by any route/page, so it is invisible to that trace and has no compiled JS
# equivalent anywhere. Rather than adding a second bundler (esbuild/tsc) purely to produce a
# `worker.js` artifact, the runtime stage below also copies the full `deps` stage `node_modules`
# (which already contains `tsx`, a devDependency, from that stage's `npm ci`) plus the TS source tree
# and tsconfig files, and runs the worker directly via `tsx` (which resolves this app's `@/*` path
# alias from `tsconfig.json` natively, no extra config). This makes the image meaningfully larger than
# a pure standalone-only image would be — an accepted, documented trade for this dispatch's scope
# (not introducing a new build toolchain) rather than a hidden cost.
#
# `python3 make g++` toolchain is intentionally OMITTED here (unlike `docker/Dockerfile`'s `deps`
# stage): that toolchain exists solely because `bcrypt` is a native module with no musl/Alpine
# prebuilt binary. Phase 0's dependency set has no native modules requiring compilation on Alpine
# (`mysql2`/`typeorm`/`zod`/`pino`/`@chakra-ui/react` are all pure-JS or ship musl-compatible
# prebuilts). Re-add the identical toolchain here the moment a future phase adds `bcrypt` (password
# hashing) or another native dependency — see `docker/Dockerfile`'s own comment for the exact
# reasoning to port forward at that point.

# ---------------------------------------------------------------------------
# Stage: deps — install the full workspace dependency graph once (npm workspaces monorepo, so this
# stage needs the whole repo's package.json files, not just apps/next's own).
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/next/package.json apps/next/package.json
RUN npm ci

# ---------------------------------------------------------------------------
# Stage: build — compiles packages/contracts (apps/next's only workspace dependency), then the
# Next.js production build itself (`output: 'standalone'`, next.config.ts).
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /workspace
COPY . .
RUN npm run build -w packages/contracts
# `next build` evaluates `instrumentation.ts`'s `register()` (env validation) while collecting page
# data at BUILD time (verified this dispatch — Next 15's `/_not-found` page-data collection step runs
# it), not only at container-start time. These are throwaway BUILD-time-only placeholder values (this
# `ENV` only applies to this intermediate `build` stage, never copied into the final `runtime` stage
# below) satisfying `env.schema.ts`'s deployed-environment required-field/cross-check guards purely so
# the build can complete; the REAL values are supplied by `docker-compose.next.yml`'s `environment:`
# block at container start, and `instrumentation.ts`'s `register()` re-validates against those for real
# every time the container actually boots.
ENV NODE_ENV=production
ENV DB_HOST=build-time-placeholder
ENV DB_USER=build-time-placeholder
ENV JWT_TENANT_SECRET=build-time-placeholder-tenant
ENV JWT_PLATFORM_SECRET=build-time-placeholder-platform
ENV FILE_SIGNING_SECRET=build-time-placeholder-files
ENV EMBEDDINGS_PROVIDER=openai-compatible
RUN npm run build -w apps/next

# ---------------------------------------------------------------------------
# Stage: runtime — the standalone server bundle + static assets (ROLE=web), PLUS (Phase 10) the full
# `deps`-stage `node_modules` + TS source tree so `tsx` can run `worker-entrypoint.ts` directly
# (ROLE=worker) — see this file's own header comment for why no second bundler was introduced instead.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime
RUN apk add --no-cache curl \
  && addgroup -S examland && adduser -S examland -G examland
WORKDIR /app

# Monorepo standalone output nests under the workspace's own path (apps/next/), matching
# `npm run build -w apps/next`'s working directory inside the `build` stage — verified against a
# real `next build` output during Phase 0 (docs/plans/nextjs-rewrite-phase0-plan.md).
COPY --chown=examland:examland --from=build /workspace/apps/next/.next/standalone ./
# Static assets (JS/CSS chunks, images) are deliberately NOT part of the standalone trace — Next.js
# always requires copying these two directories in on top, per its own `output: 'standalone'` docs.
COPY --chown=examland:examland --from=build /workspace/apps/next/.next/static ./apps/next/.next/static
COPY --chown=examland:examland --from=build /workspace/apps/next/public ./apps/next/public

# ROLE=worker support (Phase 10) — full workspace `node_modules` (incl. `tsx`) + the TS source/config
# `tsx` needs to execute `worker-entrypoint.ts` directly, with its `@/*` path alias resolved via
# `apps/next/tsconfig.json`. This duplicates some of what `.next/standalone` already copied above
# (a slimmer, traced `node_modules` subset for ROLE=web); both co-exist here since it's the same image
# serving both roles.
COPY --chown=examland:examland --from=deps /workspace/node_modules ./node_modules
# `.next/standalone`'s own file-tracer already copied a TRIMMED `next` package under
# `apps/next/node_modules/next` (containing only `dist/**`, no root-level `server.js`/`document.js`
# shim files a normal npm install ships) — Node's module resolution finds that nearer, incomplete
# copy before ever reaching the full one at `/app/node_modules/next` above, so `ROLE=worker`'s
# `import { NextResponse } from 'next/server'` (`server/common/http/error-envelope.ts`) failed with
# `Cannot find module 'next/server'` even though the full package sits one directory up (found by
# actually running the built image, not assumed). Overwriting the trimmed copy with the full,
# deps-stage install fixes this for both roles without affecting `ROLE=web` (Next's own standalone
# `server.js` never re-resolves its own package from disk at runtime).
COPY --chown=examland:examland --from=deps /workspace/apps/next/node_modules/next ./apps/next/node_modules/next
COPY --chown=examland:examland --from=deps /workspace/tsconfig.base.json ./tsconfig.base.json
COPY --chown=examland:examland --from=build /workspace/apps/next/src ./apps/next/src
# `scripts/seed.ts` (Phase 10, `docker compose run --rm web npm run seed`) and the other one-off
# `tsx`-run scripts already living here (`provision-demo-tenant.ts`, etc.) — same "not traced by
# `next build`, needs the real TS source + `tsx`" reasoning as the worker entrypoint above.
COPY --chown=examland:examland --from=build /workspace/apps/next/scripts ./apps/next/scripts
COPY --chown=examland:examland --from=build /workspace/apps/next/tsconfig.json ./apps/next/tsconfig.json
COPY --chown=examland:examland --from=build /workspace/apps/next/package.json ./apps/next/package.json
COPY --chown=examland:examland --from=build /workspace/packages/contracts ./packages/contracts

RUN mkdir -p /app/logs && chown examland:examland /app/logs
VOLUME ["/app/logs"]

# **Real, previously-undiscovered bug, found by Phase 10 sub-slice "10b1"'s own e2e suite** (the first
# time this app's file-upload paths were exercised against a genuinely fresh, cold-volume container
# rather than a dev host process): `STORAGE_ROOT=/app/storage` (docker-compose.next.yml) is backed by
# a Docker named volume (`examland_next_app_storage`) that Docker creates root-owned by default on
# first mount — this image runs as the non-root `examland` user (`USER examland` below), so the local
# storage adapter's own `mkdir('/app/storage/tenants', {recursive: true})` genuinely failed with
# `EACCES: permission denied` on every real upload (`POST /api/curricula/:id/documents`,
# `POST /api/pdf-processing/upload`, `POST /api/exam-types/zip` — every one of them, since they all
# share the same local storage adapter/root). `/app/logs` above already had this exact
# mkdir-then-chown fix; `/app/storage` was simply missing it — an oversight from whichever earlier
# phase first introduced `STORAGE_ROOT`, invisible until a real, unprivileged container actually tried
# to write to it (a bind-mounted dev host directory never surfaces this, since the host user typically
# already owns it).
RUN mkdir -p /app/storage && chown examland:examland /app/storage
VOLUME ["/app/storage"]

ENV NODE_ENV=production
ENV PORT=3000
# Selects which process this container runs — `web` (default, `node server.js`) or `worker`
# (`tsx worker-entrypoint.ts`) — see `docker-entrypoint.sh` below.
ENV ROLE=web
# Next.js's standalone `server.js` binds to `process.env.HOSTNAME || '0.0.0.0'` — but Docker always
# sets `HOSTNAME` to the container ID by default, which resolves only to the container's bridge-
# network IP, not its loopback interface. That still lets the *host* reach the app through Docker's
# port mapping (it routes to the real bridge IP), but breaks anything that curls `localhost` from
# *inside* the container — exactly what this file's own `HEALTHCHECK` below does. Verified in Phase
# 0 by actually running the built image: without this override, the healthcheck never succeeds
# (docs/plans/nextjs-rewrite-phase0-plan.md).
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

COPY --chown=examland:examland apps/next/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Final `WORKDIR` switch to `apps/next` (Phase 10) — makes `docker compose run --rm web npm run seed`
# (the exact command the migration plan's own doc specifies) work with NO extra flags: `npm run seed`
# resolves against whatever directory is the shell's cwd, and only `apps/next/package.json` (not the
# root workspace `package.json`, which has no `seed` script) declares that script. All of
# `docker-entrypoint.sh`'s own paths are written relative to THIS directory accordingly (`server.js`,
# `../../node_modules/.bin/tsx`, `src/server/workers/worker-entrypoint.ts`).
WORKDIR /app/apps/next

USER examland

# Liveness only (HLD-equivalent §12 convention this app follows) — meaningless for ROLE=worker (no
# HTTP listener at all), so `docker-compose.next.yml`'s `worker` service explicitly disables this
# (`healthcheck: disable: true`), same pattern as the legacy root `docker-compose.yml`'s own `worker`
# service.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# `docker-entrypoint.sh` branches on `$ROLE`: `node apps/next/server.js` (the standalone bundle's own
# entry, nested at the workspace-relative path `apps/next/` — matches `next build`'s trace output,
# verified in Phase 0) for `web`, or `tsx apps/next/src/server/workers/worker-entrypoint.ts` for
# `worker` (see this file's header comment for why `tsx` rather than a second compiled bundle).
CMD ["/app/docker-entrypoint.sh"]
