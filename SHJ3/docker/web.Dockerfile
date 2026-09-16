# syntax=docker/dockerfile:1
# SHJ3 — shj3-web (Next.js App Router: UI + BFF + config API). Owns the SQL
# Server schema. Built from the monorepo root (docker-compose.yml's
# `context: .`), because a pnpm workspace's install needs every workspace
# member's manifest present, and @shj3/tokens ships TypeScript source rather
# than a prebuilt dist/ (transpiled by Next itself — see next.config.ts's
# `transpilePackages` comment), so its source has to travel with this image.
#
# ---------------------------------------------------------------------------
# The Linux-vs-Windows `next build` question this Dockerfile answers
# ---------------------------------------------------------------------------
# This dev machine has a real, reproducible `next build` failure
# (prisma/prisma#27934, vercel/next.js#62281): `EPERM: operation not
# permitted, scandir 'C:\Users\<user>\Application Data'` inside Next's
# FlightClientEntryPlugin, triggered by ADR-0011's custom Prisma generator
# `output` path being reachable from a Server Action, specific to a Windows
# legacy per-user profile junction on a non-C:\ drive — see
# `apps/web/src/app/[locale]/settings/appearance/reset/actions.ts`'s doc
# comment for the full account. Verified empirically (not assumed) with a
# throwaway `node:22-slim` image running this exact pipeline end to end,
# including the one route that reproduces the bug on Windows: it built
# clean. The failure is Windows-host-specific and does not reproduce inside
# this Linux image — recorded in tasks/lessons.md. The `build` stage below is
# therefore trusted at face value, with no workaround baked in for a bug that
# does not exist in the environment this Dockerfile actually runs in.
#
# A second, smaller finding from that same test: Prisma's engine postinstall
# could not detect the libssl/openssl version on bare `node:22-slim` and
# defaulted to "openssl-1.1.x" — a build-time warning that would risk a
# runtime engine/library mismatch if left uncorrected (that default may not
# match whatever OpenSSL this image actually ships). Fixed at the root below
# by installing `openssl` explicitly, exactly as Prisma's own warning
# instructs, so detection succeeds and the correct engine binary is used.

ARG NODE_IMAGE=node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

# =============================================================================
# base — shared foundation. OpenSSL for Prisma's engine (build AND runtime:
# the query-engine binary dynamically links against it), ca-certificates for
# every outbound TLS call this service and its build step make (registry
# fetches, and at runtime SQL Server/Redis/model-provider TLS), corepack for
# a pinned pnpm with no separate install step.
# =============================================================================
FROM ${NODE_IMAGE} AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

# =============================================================================
# deps — install once, cached until a manifest changes. Deliberately copies
# ONLY manifests (not source) so editing application code never invalidates
# this layer. Every workspace member's package.json must be present: pnpm's
# single workspace lockfile resolves against all of them at once, not just
# @shj3/web's.
# =============================================================================
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/tokens/package.json ./packages/tokens/package.json
RUN pnpm install --frozen-lockfile

# =============================================================================
# dev — what docker-compose.yml's `web` service (`target: dev`) actually
# runs: `next dev` against bind-mounted live source (apps/web, packages,
# prisma are all volume-mounted over this image's copies at compose-up time —
# see docker-compose.yml's own comment on the matching anonymous-volume
# carve-out for prisma/generated/, required for a Windows host specifically).
# Generating the Prisma clients at IMAGE BUILD time (not container start)
# means the anonymous volume's first-run seed content is already the correct
# Linux engine binary — no regenerate-on-every-`compose up` cost.
# =============================================================================
FROM deps AS dev
COPY . .
ENV NODE_ENV=development
# Generate-time only: `prisma generate` never opens a connection, it only
# reads the schema file to know which engine/provider to emit code for. A
# real DATABASE_URL arrives via docker-compose.yml's `environment:` block at
# container start, long after this layer is baked.
ENV DATABASE_URL="sqlserver://placeholder:1433;database=placeholder;user=sa;password=placeholder;encrypt=true;trustServerCertificate=true"
RUN pnpm db:generate
EXPOSE 3000
# Not inherited from `runtime` below — sibling stages, both FROM `deps`, so each
# needs its own HEALTHCHECK. Found the same way `ai.Dockerfile`'s `dev` stage gap
# was: a real `docker compose up` refusing a `service_healthy` dependent with
# "no healthcheck configured" for this exact stage.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/healthz').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["pnpm", "--filter", "@shj3/web", "dev"]

# =============================================================================
# build — the real production build. Same DATABASE_URL placeholder reasoning
# as `dev`. This is the stage the Linux-vs-Windows test above validated.
# =============================================================================
FROM deps AS build
WORKDIR /app
COPY . .
ENV NODE_ENV=production
ENV DATABASE_URL="sqlserver://placeholder:1433;database=placeholder;user=sa;password=placeholder;encrypt=true;trustServerCertificate=true"
RUN pnpm db:generate
RUN pnpm --filter @shj3/web build

# =============================================================================
# runtime — production image. Fresh from `base` rather than layered on
# `build`, so no pnpm/corepack machinery or workspace manifests no longer
# needed at runtime ship in the final image; only the built output, the
# generated Prisma clients (ADR-0011's output path lives outside
# node_modules, so it needs its own copy), and the node_modules pnpm's
# symlink layout actually resolves `next` and native addons through.
# =============================================================================
FROM base AS runtime

ARG VERSION=0.1.0
ARG GIT_SHA=unknown
# No CI/CD in this project (ADR-0008) — there is no pipeline that supplies
# these automatically yet. A future release script is the intended real
# caller: `docker build --build-arg VERSION=$(node -p "require('./package.json').version") --build-arg GIT_SHA=$(git rev-parse HEAD) ...`.
# Defaults keep a bare `docker build` with no --build-arg honest rather than
# silently unlabelled.
LABEL org.opencontainers.image.title="shj3-web" \
      org.opencontainers.image.description="SHJ3 UI + BFF + config API" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.source="https://github.com/shj3/shj3"

RUN groupadd -g 10001 shj3 && useradd -u 10001 -g 10001 -M -s /usr/sbin/nologin shj3

WORKDIR /app
COPY --chown=shj3:shj3 --from=build /app/node_modules ./node_modules
COPY --chown=shj3:shj3 --from=build /app/packages ./packages
COPY --chown=shj3:shj3 --from=build /app/prisma/platform/schema.prisma ./prisma/platform/schema.prisma
COPY --chown=shj3:shj3 --from=build /app/prisma/tenant/schema.prisma ./prisma/tenant/schema.prisma
COPY --chown=shj3:shj3 --from=build /app/prisma/generated ./prisma/generated
COPY --chown=shj3:shj3 --from=build /app/apps/web ./apps/web

USER shj3:shj3
WORKDIR /app/apps/web
ENV NODE_ENV=production
EXPOSE 3000

# Liveness only (route.ts's own doc comment: no store dependency, on
# purpose — a downstream blip must not restart a healthy process). 15s
# interval/timeout mirror shj3-ai's HEALTHCHECK for one consistent rhythm
# across both images; start-period is far shorter than shj3-ai's because
# Next's own server has no model-client warmup to wait through.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/healthz').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node_modules/.bin/next", "start", "-p", "3000"]
