# nextbot-worker — Observability/batch plane (Phase 18 recurring jobs: git-sweep,
# idle-sweep, audit-sync, health-check, retention-purge). No HTTP server, no Next
# build step — this app's own package.json convention (`"start": "tsx src/main.ts"`,
# no "build" script) is a `tsx`-run TS entry point; the Docker image follows that
# same convention rather than inventing a bundling step this app doesn't use anywhere
# else (dev or CI).
#
# Build context MUST be the monorepo root, e.g.:
#   docker build -f apps/worker/Dockerfile -t nextbot-worker:local .

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS pruner
WORKDIR /app
RUN pnpm add -g turbo@2.1.3
COPY . .
RUN turbo prune --scope=nextbot-worker --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
# `tsx` is a devDependency (this app has no build step) so dev deps are needed at
# runtime here — unlike apps/web/apps/gateway's standalone-output images, which
# strip dev toolchain entirely.
RUN pnpm install --frozen-lockfile

FROM installer AS runner
WORKDIR /app
COPY --from=pruner /app/out/full/ .

# procps provides `pgrep`, used by HEALTHCHECK below (not present in the -slim base).
RUN apt-get update && apt-get install -y --no-install-recommends procps && \
    rm -rf /var/lib/apt/lists/*

# A recursive chown over /app (the pruned monorepo's node_modules, still multiple
# GB) is expensive and unnecessary here too (same reasoning as docker/tools.Dockerfile):
# files pnpm installs as root are already world-readable/executable, which is all
# `nextbot` needs to run `tsx`/`pnpm` against them read-only. Only this user's own
# home/cache dir (where corepack/pnpm write at runtime, e.g. its corepack shim
# cache) actually needs to be writable by `nextbot` — `useradd --create-home`
# already makes /home/nextbot owned by nextbot, so no extra chown is needed there
# either.
RUN groupadd --system --gid 1001 nextbot && \
    useradd --system --uid 1001 --gid nextbot --create-home --home-dir /home/nextbot nextbot

# `KNOWLEDGE_UPLOAD_STORE_ROOT` (docker-compose.yml) mounts the
# `nextbot-knowledge-uploads-data` named volume here, shared with `web`. Docker
# materializes a brand-new named volume as `root:root 0755`, and the ingestion
# pipeline's `getUpload()` (via `stage-ingest-parse-chunk.ts`) needs to read (and
# `web`'s `putUpload()` needs to have been able to `mkdir`/write) under this path —
# so it must be created and chowned to the `nextbot` user *before* the volume is
# mounted (same pre-creation + chown pattern docker/tools.Dockerfile already uses
# for its own `/seed-output` mount), otherwise every `Upload`-kind knowledge source
# is a hard EACCES at runtime under `USER nextbot` below (2026-09-01 Final Review
# DEFECT-1 fix).
RUN mkdir -p /data/knowledge-uploads && chown -R nextbot:nextbot /data/knowledge-uploads

USER nextbot
ENV HOME=/home/nextbot

ENV NODE_ENV=production

# No HTTP surface to probe — liveness is "the scheduler process is still running".
# `scheduler.ts` is expected to keep a Node event-loop timer registered for as long
# as the process should stay up, so a simple process-alive check is a faithful
# proxy here (flagged: a real `/healthz` or heartbeat file the scheduler touches
# per tick would be a better signal — not built yet, see DEPLOYMENT.md).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD pgrep -f "tsx.*src/main.ts" > /dev/null || exit 1

CMD ["pnpm", "--filter", "nextbot-worker", "run", "start"]
