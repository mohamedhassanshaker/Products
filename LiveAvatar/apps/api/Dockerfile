# syntax=docker/dockerfile:1.7
#
# Control-plane image (HLD §8.1 "web"): NestJS modular monolith + both
# compiled Angular SPAs (admin, conversation), served by
# `@nestjs/serve-static` from inside the Nest process (LLD §5.1). One image,
# per ADR-001 §4 ("Two images. Not one... not seven").
#
# Build context MUST be the repo root (pnpm workspace), e.g.:
#   docker build -f apps/api/Dockerfile -t liveavatar/web:<tag> .
#
# Runs two Node processes in one container (public :8080 + cluster-only
# :8081 — two independent NestFactory.create() calls, LLD §5.1/§5.9) via
# docker-entrypoint.sh, so a Kubernetes Service can point only the public
# port at an Ingress and keep :8081 ClusterIP-only (NFR-3).

ARG NODE_VERSION=22.16-alpine

FROM node:${NODE_VERSION} AS build
# Installed directly via npm rather than `corepack prepare` — the corepack
# version bundled with this node:alpine tag fails pnpm's package signature
# verification against the current npm registry signing key (observed live
# during this image's own build validation), a corepack/registry compat
# issue unrelated to this project.
RUN npm install --global pnpm@11.20.0
WORKDIR /workspace

# `prisma generate` (invoked by `pnpm --filter @liveavatar/api build`) loads
# prisma.config.ts, which resolves DATABASE_URL from the environment even
# though `generate` never opens a connection. This is a build-time-only
# placeholder — never a real credential, never used at runtime (the real
# DATABASE_URL is injected at container start via Secret/env, see
# docker-compose.yml / k8s/secret-web.yaml).
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

# Install deps first (better layer caching): copy only manifests.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# Now the real sources.
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY apps/web apps/web

RUN pnpm --filter @liveavatar/contracts build
# `prisma generate`'s engine-binary download occasionally hits a transient
# DNS/network blip (observed live during this image's own build validation)
# — retry a few times before failing the whole build over one flaky fetch.
RUN --network=default \
    for i in 1 2 3 4 5; do \
      pnpm --filter @liveavatar/api build && break; \
      echo "prisma generate/nest build attempt $i failed, retrying in 5s..." >&2; \
      sleep 5; \
      if [ "$i" = 5 ]; then exit 1; fi; \
    done
RUN pnpm --filter @liveavatar/web build

# Reinstall production-only dependencies in place. `pnpm prune --prod` was
# tried first (observed live during this image's own build validation) and
# turned out to wipe every per-package node_modules entirely rather than
# just devDependencies (reflect-metadata and other real runtime deps ended
# up missing, `node dist/main.js` failed with MODULE_NOT_FOUND) — a
# `--frozen-lockfile --prod` reinstall is the reliable way to get exactly
# the production dependency set per workspace package. `CI=true` skips
# pnpm's interactive confirmation prompt (no TTY in a Docker build).
RUN rm -rf node_modules apps/api/node_modules apps/web/node_modules packages/contracts/node_modules \
 && CI=true pnpm install --frozen-lockfile --prod

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    INTERNAL_PORT=8081 \
    LOG_DIR=/app/apps/api/logs \
    SECRETS_DIR=/app/apps/api/secrets
RUN apk add --no-cache curl \
 && addgroup -g 10001 -S app && adduser -u 10001 -S app -G app

WORKDIR /app
COPY --from=build --chown=app:app /workspace/node_modules ./node_modules
COPY --from=build --chown=app:app /workspace/package.json ./package.json
COPY --from=build --chown=app:app /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=app:app /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=app:app /workspace/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build --chown=app:app /workspace/apps/api/dist ./apps/api/dist
# `prisma/seed.ts` is run directly via `tsx` (not through compiled `dist/`)
# and imports the generated Prisma client by its raw `src/generated/prisma`
# path (`prisma.config.ts`'s generator `output`, gitignored, produced by
# `prisma generate` at build time) — copy it alongside `dist/` so the
# pre-deploy seed step (docker-compose.yml's `migrate` service,
# k8s/migrate-job.yaml) can actually run it.
COPY --from=build --chown=app:app /workspace/apps/api/src/generated ./apps/api/src/generated
COPY --from=build --chown=app:app /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=app:app /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=app:app /workspace/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build --chown=app:app /workspace/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=app:app /workspace/apps/web/dist/admin/browser ./apps/api/public/admin/browser
COPY --from=build --chown=app:app /workspace/apps/web/dist/conversation/browser ./apps/api/public/conversation/browser
COPY --chown=app:app apps/api/deploy/docker-entrypoint.sh /app/docker-entrypoint.sh

RUN mkdir -p /app/apps/api/logs /app/apps/api/secrets \
 && chown -R app:app /app/apps/api/logs /app/apps/api/secrets \
 && chmod +x /app/docker-entrypoint.sh

WORKDIR /app/apps/api
USER app

EXPOSE 8080 8081

# Liveness/readiness matches the real, existing GET /api/health route
# (apps/api/src/modules/platform/interface/health.controller.ts). The
# internal (:8081) app has no health route of its own yet (flagged in
# docs/deployment/DEPLOYMENT.md) — the entrypoint script exits the container
# if either the public or internal process dies, so this single check is
# still an accurate liveness signal for the whole container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
