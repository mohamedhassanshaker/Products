# nextbot-gateway — Gateway Plane (channel ingress + all MCP/model/A2A egress).
# Same pruned multi-stage pattern as apps/web/Dockerfile.
#
# Build context MUST be the monorepo root, e.g.:
#   docker build -f apps/gateway/Dockerfile -t nextbot-gateway:local .

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS pruner
WORKDIR /app
RUN pnpm add -g turbo@2.1.3
COPY . .
RUN turbo prune --scope=nextbot-gateway --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

FROM installer AS builder
WORKDIR /app
COPY --from=pruner /app/out/full/ .
COPY turbo.json tsconfig.base.json ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm add -g turbo@2.1.3 && turbo run build --filter=nextbot-gateway

FROM node:22-slim AS runner
RUN groupadd --system --gid 1001 nextbot && \
    useradd --system --uid 1001 --gid nextbot nextbot
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4001
ENV HOSTNAME=0.0.0.0

COPY --from=builder --chown=nextbot:nextbot /app/apps/gateway/.next/standalone ./
COPY --from=builder --chown=nextbot:nextbot /app/apps/gateway/.next/static ./apps/gateway/.next/static

USER nextbot
EXPOSE 4001

# No dedicated /api/health route exists yet either (flagged, same as apps/web) —
# probes the real root page (`apps/gateway/app/page.tsx`) instead.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||4001) +'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/gateway/server.js"]
