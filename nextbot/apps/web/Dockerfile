# nextbot-web — Control Plane (5 Admin Console portals + /api/v1 config APIs).
# Multi-stage pnpm/Turborepo build: prune -> install pruned deps -> build -> slim
# standalone runtime. Never ships the full monorepo source/node_modules tree.
#
# Build context MUST be the monorepo root, e.g.:
#   docker build -f apps/web/Dockerfile -t nextbot-web:local .

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# ---- 1. prune: compute the minimal workspace subset nextbot-web needs ----
FROM base AS pruner
WORKDIR /app
RUN pnpm add -g turbo@2.1.3
COPY . .
RUN turbo prune --scope=nextbot-web --docker

# ---- 2. install: install only the pruned workspace's dependencies ----
FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# ---- 3. build: bring in pruned source, build with Next standalone output ----
FROM installer AS builder
WORKDIR /app
COPY --from=pruner /app/out/full/ .
COPY turbo.json tsconfig.base.json ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm add -g turbo@2.1.3 && turbo run build --filter=nextbot-web

# ---- 4. runtime: slim, non-root, only the standalone server output ----
FROM node:22-slim AS runner
RUN groupadd --system --gid 1001 nextbot && \
    useradd --system --uid 1001 --gid nextbot nextbot
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone output already includes a pruned node_modules (incl. the
# @node-rs/argon2 native binary Next's file tracer detects via `require`,
# per next.config.mjs's serverExternalPackages/webpack-externals notes) and a
# server.js entry point — no full monorepo node_modules is ever copied in.
COPY --from=builder --chown=nextbot:nextbot /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextbot:nextbot /app/apps/web/.next/static ./apps/web/.next/static

# `KNOWLEDGE_UPLOAD_STORE_ROOT` (docker-compose.yml) mounts the
# `nextbot-knowledge-uploads-data` named volume here, shared with `worker`. Docker
# materializes a brand-new named volume as `root:root 0755`, and `putUpload()`'s
# first filesystem call is a recursive `mkdir` under this path — so without
# creating and chowning it to the `nextbot` user *before* the volume is mounted
# (same pre-creation + chown pattern docker/tools.Dockerfile already uses for its
# own `/seed-output` mount), every `Upload`-kind knowledge source is a hard EACCES
# at runtime under `USER nextbot` below (2026-09-01 Final Review DEFECT-1 fix).
RUN mkdir -p /data/knowledge-uploads && chown -R nextbot:nextbot /data/knowledge-uploads

USER nextbot
EXPOSE 3000

# apps/web has no dedicated /api/health route yet (flagged back to the
# orchestrator — see docs/deployment/DEPLOYMENT.md "Known gaps"). This probes the
# real, existing `/login` page instead of inventing an endpoint that doesn't exist.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3000) +'/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
