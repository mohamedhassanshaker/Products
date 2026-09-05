# ExamLand — single image, single process, single port (HLD §13.1).
# Two runtime roles from the identical image: ROLE=api (HTTP + static Angular dist under /api and
# SPA fallback) and ROLE=worker (background workers, no listener). Selected purely by the ROLE env
# var at container start — never by building a different image.

# ---------------------------------------------------------------------------
# Stage: deps — install the full workspace dependency graph once, shared by both build stages.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /workspace
# `bcrypt` is a native module (node-pre-gyp). Its prebuilt-binary download only covers glibc
# targets, not musl/Alpine, so on node:24-alpine `npm ci` silently falls back to compiling from
# source — which requires a C/C++ toolchain that a bare alpine image does not have (Final Review
# D3 item 5: build failure/GitHub-availability dependency with no fallback). Installing the
# toolchain here makes the source-compile fallback actually succeed, deterministically, with no
# dependency on github.com reachability at build time.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY legacy/api/package.json legacy/api/package.json
COPY legacy/web/package.json legacy/web/package.json
RUN npm ci

# ---------------------------------------------------------------------------
# Stage: build-web — Angular production build (HLD §13.1 "stage build-web").
# ---------------------------------------------------------------------------
FROM deps AS build-web
WORKDIR /workspace
COPY . .
RUN npm run build:legacy-web
# `ng build` (production config) emits to legacy/web/dist/web/browser.
RUN mkdir -p /out/public && cp -r legacy/web/dist/web/browser/. /out/public/

# ---------------------------------------------------------------------------
# Stage: build-api — NestJS production build (HLD §13.1 "stage build-api").
# ---------------------------------------------------------------------------
FROM deps AS build-api
WORKDIR /workspace
COPY . .
RUN npm run build:legacy-api
RUN mkdir -p /out/api && cp -r legacy/api/dist/. /out/api/ && cp -r packages/contracts/dist /out/contracts-dist

# ---------------------------------------------------------------------------
# Stage: prod-deps — production-only node_modules for the runtime image.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS prod-deps
WORKDIR /workspace
# Same bcrypt/musl reasoning as the `deps` stage above (D3 item 5) — this stage runs its own
# `npm ci` against a fresh alpine base, so it needs the toolchain independently.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY legacy/api/package.json legacy/api/package.json
RUN npm ci --omit=dev --workspace=@examland/api --workspace=@examland/contracts --include-workspace-root

# ---------------------------------------------------------------------------
# Stage: runtime
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime
RUN apk add --no-cache curl \
  && addgroup -S examland && adduser -S examland -G examland
WORKDIR /app

COPY --chown=examland:examland --from=prod-deps /workspace/node_modules ./node_modules
# `npm ci` in the prod-deps stage links @examland/contracts into node_modules as an npm-workspace
# symlink pointing at /workspace/packages/contracts — a path that only exists in that build stage,
# not in this runtime image. Replace it with a real directory (package.json + compiled dist) so
# `require('@examland/contracts')` resolves correctly here.
RUN rm -rf ./node_modules/@examland/contracts
COPY --chown=examland:examland --from=build-api /workspace/packages/contracts/package.json ./node_modules/@examland/contracts/package.json
COPY --chown=examland:examland --from=build-api /out/contracts-dist ./node_modules/@examland/contracts/dist
COPY --chown=examland:examland --from=build-api /out/api ./dist/api
COPY --chown=examland:examland --from=build-web /out/public ./dist/public

# `--chown` on each COPY above sets ownership as part of the copy itself (no extra full-tree walk);
# only the two freshly created, still-empty storage/log dirs need an explicit (and here, cheap —
# nothing under them yet) chown.
RUN mkdir -p /app/storage /app/logs && chown examland:examland /app /app/storage /app/logs
VOLUME ["/app/storage", "/app/logs"]

ENV ROLE=api
ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

USER examland

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# ROLE=worker overrides the command via the platform's deployment config (same image, no listener);
# the default CMD below is the ROLE=api path.
CMD ["node", "dist/api/main.js"]
