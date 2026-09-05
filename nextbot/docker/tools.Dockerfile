# nextbot-tools — shared image for the docker-compose one-shot init jobs
# (`migrate`, `seed`). Not a deployable application plane: it installs the full
# monorepo (not pruned per-app, unlike apps/*/Dockerfile) because both jobs need
# cross-cutting workspace packages (`@nextbot/db`, `@nextbot/tenancy`,
# `@nextbot/iam`, `@nextbot/contracts`) and are run once per `docker compose up`,
# not scaled/redeployed like a real service — the extra image size/build time
# trade-off is deliberate and acceptable for an init job.
#
# Build context MUST be the monorepo root, e.g.:
#   docker build -f docker/tools.Dockerfile -t nextbot-tools:local .
FROM node:22-slim AS tools
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# A recursive chown over the full (unpruned) monorepo node_modules is expensive
# (multiple GB) and unnecessary: files pnpm installs as root are already
# world-readable/executable, which is all `nextbot` needs to run them — only the
# working directory (for SEED_CREDENTIALS.md) and this user's own home/cache
# actually need to be writable by `nextbot`, so only those are chowned.
RUN groupadd --system --gid 1001 nextbot && \
    useradd --system --uid 1001 --gid nextbot --create-home --home-dir /home/nextbot nextbot && \
    mkdir -p /seed-output && chown nextbot:nextbot /app /seed-output /home/nextbot
USER nextbot
ENV HOME=/home/nextbot

ENV NODE_ENV=production
CMD ["pnpm", "run", "db:migrate"]
