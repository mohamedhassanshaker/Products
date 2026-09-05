# nextbot-widget-embed — the embeddable widget's own static build target (Phase 8):
# `nextbot.js` loader + the iframe-hosted widget SPA. Neither output depends on Next.js
# or on apps/web's build — pure Vite static assets served by nginx.
#
# Build context MUST be the monorepo root, e.g.:
#   docker build -f apps/widget-embed/Dockerfile -t nextbot-widget-embed:local .

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS pruner
WORKDIR /app
RUN pnpm add -g turbo@2.1.3
COPY . .
RUN turbo prune --scope=nextbot-widget-embed --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

FROM installer AS builder
WORKDIR /app
COPY --from=pruner /app/out/full/ .
COPY turbo.json tsconfig.base.json ./
RUN pnpm add -g turbo@2.1.3 && turbo run build --filter=nextbot-widget-embed

# ---- runtime: static file server only, no Node/toolchain in the final image ----
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner
COPY apps/widget-embed/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/widget-embed/dist-widget /usr/share/nginx/html/widget
COPY --from=builder /app/apps/widget-embed/dist-loader /usr/share/nginx/html/loader

# nginxinc/nginx-unprivileged already runs as a non-root `nginx` user and listens
# on 8080 by default.
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:8080/loader/nextbot.js || exit 1
