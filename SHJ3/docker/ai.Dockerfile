# syntax=docker/dockerfile:1
# SHJ3 — shj3-ai (agent runtime + Graph RAG; sole writer of Neo4j and
# Qdrant). ONE image, two workloads (ADR-0001 constraint 1: background work
# is a replica of shj3-ai with another role, never a third deployable) —
# `docker-compose.yml`'s `worker` service builds this same file and
# differs only in the `SHJ3_AI_ROLE` env var, which `shj3_ai/entrypoint.py`
# (new — see its own doc comment) dispatches on. Built from the monorepo
# root because docker-compose.yml's `context: .` is shared with
# `docker/web.Dockerfile`; this file only ever COPYs from `apps/ai/`.

ARG UV_IMAGE=ghcr.io/astral-sh/uv:python3.12-bookworm-slim@sha256:e5b65587bce7de595f299855d7385fe7fca39b8a74baa261ba1b7147afa78e58
ARG PYTHON_RUNTIME_IMAGE=python:3.12-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254

# =============================================================================
# deps — third-party dependencies only, cached until pyproject.toml/uv.lock
# change. `--no-install-project` is uv's own documented Docker pattern:
# installing the LOCAL project needs src/ present, which would invalidate
# this (expensive) layer on every source edit if done here.
#
# Base image bundles Python 3.12 + a matching uv build in one place (uv
# 0.9.30, confirmed by running it directly rather than guessing a version
# to `pip install` — deployment.md's own draft named a `pip install
# uv==0.4.27` pattern, but pinning a nine-months-stale uv release when the
# project's actual apps/ai/.venv runs Python 3.12.14 today would be pinning
# an assumption instead of a checked fact).
# =============================================================================
FROM ${UV_IMAGE} AS deps
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
WORKDIR /app
COPY apps/ai/pyproject.toml apps/ai/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# =============================================================================
# dev — docker-compose.yml's `ai`/`worker` services (`target: dev`)
# bind-mount ./apps/ai over /app, so the real source arrives at container
# start; this stage only needs a ready venv, dev extras included (ruff/
# mypy/pytest — parity with how this project actually runs its Python gate,
# `make verify`, against the same venv the app itself runs in).
#
# Installs the local project too (`uv sync --frozen`, no `--no-install-project`) —
# found necessary by actually running this: without it `shj3_ai` sits on disk as
# plain files but is never installed into the venv, so `python -m shj3_ai.
# entrypoint` fails with `ModuleNotFoundError: No module named 'shj3_ai'` the
# moment a real container starts, not a hypothetical.
#
# B-5: this stage was missing the exact same real runtime requirement the
# `runtime` stage below documents at length (`libodbc.so.2` + the SQL Server
# driver, dynamically loaded by `pyodbc` at CONNECT time, not at import or
# build time) — the two stages had silently drifted apart, one carrying the
# ODBC install and the other not. Found live, not by re-reading the
# Dockerfile: the real `ai` container (already running, already reported
# `healthy` — `/healthz` never touches SQL) 500'd on the first real request
# that opened a SQL Server connection, with `ImportError: libodbc.so.2:
# cannot open shared object file`, confirmed directly with `docker exec ...
# python -c "import pyodbc"` before touching this file. Every prior wave's
# live-infra proof against `shj3-ai`'s real SQL-touching endpoints must have
# run against an image built before this stage lost the install (or run
# against the host's own `.venv` instead) — this is the first time B-5's own
# new endpoint made a plain HTTP call the first one to exercise a fresh dev
# image's SQL path end to end. Installed identically to the `runtime` stage
# (same packages, same Microsoft apt feed) rather than deriving `dev` from
# `runtime` or vice versa, since the two stages intentionally diverge in
# every other way (dev extras vs. none, uv vs. no uv, root vs. non-root) and
# unifying them would be a larger, riskier refactor than this wave's own
# scope.
FROM deps AS dev
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl gnupg \
  && curl -sSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
  && curl -sSL https://packages.microsoft.com/config/debian/12/prod.list \
       > /etc/apt/sources.list.d/mssql-release.list \
  && apt-get update \
  && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 unixodbc ca-certificates \
  && apt-get purge -y --auto-remove curl gnupg \
  && rm -rf /var/lib/apt/lists/*
COPY apps/ai/src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen
ENV PATH="/app/.venv/bin:${PATH}"
EXPOSE 8000
# HEALTHCHECK is NOT inherited from `runtime` below — Dockerfile stages only inherit
# from their own `FROM`, and this stage's is `deps`, a sibling of `runtime`, not an
# ancestor. Found by running this for real: `docker compose`'s `condition:
# service_healthy` (which `init`/`web` depend on `ai` for) refused to proceed with
# "container ... has no healthcheck configured" the first time this stage ran without
# its own copy. Same test command as `runtime`'s (see that stage's own comment on
# timing); this is the one `worker` (same image, `SHJ3_AI_ROLE=worker`) explicitly
# disables in docker-compose.yml, for the reason given there.
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz',timeout=4).status==200 else 1)"]
CMD ["python", "-m", "shj3_ai.entrypoint"]

# =============================================================================
# build — installs the real local project on top of the cached deps layer.
# =============================================================================
FROM deps AS build
COPY apps/ai/src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# =============================================================================
# runtime — fresh base: no uv, no build cache mounts, no dev extras.
#
# Microsoft's ODBC Driver 18 is a REAL runtime requirement, not a build one.
# Verified rather than assumed: apps/ai/uv.lock's pyodbc==5.3.0 entry lists a
# manylinux2014_x86_64 wheel for cp312 (this platform), so `uv sync` above
# never compiled anything against ODBC headers — but that wheel dynamically
# loads libodbc.so.2 and the specific SQL Server driver at CONNECT time, and
# SHJ3_SQL_DSN names `driver=ODBC+Driver+18+for+SQL+Server` explicitly. Without
# this the image would build and boot cleanly and only fail the moment it
# tried to open a real database connection — the exact "looks right but
# isn't" gap this project's CLAUDE.md rules out, so it is installed for real
# rather than left to be found later.
# =============================================================================
FROM ${PYTHON_RUNTIME_IMAGE} AS runtime

ARG VERSION=0.1.0
ARG GIT_SHA=unknown
# No CI/CD in this project (ADR-0008) — no pipeline supplies these
# automatically yet. Intended real caller: a future release script passing
# `--build-arg VERSION=$(...) --build-arg GIT_SHA=$(git rev-parse HEAD)`.
LABEL org.opencontainers.image.title="shj3-ai" \
      org.opencontainers.image.description="SHJ3 agent runtime and Graph RAG service" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.source="https://github.com/shj3/shj3"

# msodbcsql18 has no Debian-repo package; Microsoft publishes its own apt
# feed. curl/gnupg are transient (fetch the key + repo list) and removed
# again afterward; ca-certificates is installed explicitly alongside the
# real payload so it survives that cleanup regardless of apt's dependency
# bookkeeping for the transient tools.
#
# No `sed` rewrite of the fetched prod.list: checked its real content directly
# (curl the URL below) before writing this rather than assuming its shape —
# Microsoft's own file already carries `signed-by=/usr/share/keyrings/
# microsoft-prod.gpg` inside its one bracketed options group, the exact path
# the `gpg --dearmor` step below writes to. An earlier version of this step
# tried to insert a second `[signed-by=...]` group via `sed`, producing a
# double-bracket line ("Malformed entry ... URI parse") — found by actually
# running this build, not by re-reading the Dockerfile.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl gnupg \
  && curl -sSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
  && curl -sSL https://packages.microsoft.com/config/debian/12/prod.list \
       > /etc/apt/sources.list.d/mssql-release.list \
  && apt-get update \
  && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 unixodbc ca-certificates \
  && apt-get purge -y --auto-remove curl gnupg \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 10001 shj3 && useradd -u 10001 -g 10001 -M -s /usr/sbin/nologin shj3

WORKDIR /app
COPY --chown=shj3:shj3 --from=build /app/.venv ./.venv
COPY --chown=shj3:shj3 --from=build /app/src ./src
COPY --chown=shj3:shj3 apps/ai/pyproject.toml ./pyproject.toml

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SHJ3_RELEASE_VERSION=${VERSION} \
    SHJ3_GIT_SHA=${GIT_SHA}

USER shj3:shj3
EXPOSE 8000

# start-period=120s: SHJ3_AI_MODEL_INIT_TIMEOUT_S defaults to 90s (LiteLLM
# router construction + provider handshakes, .env.example's own comment) —
# this must exceed that, mirroring deployment.md §5.3/§7.4's own budget, so a
# slow-but-healthy cold start is never mistaken for a crash.
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz',timeout=4).status==200 else 1)"]

ENTRYPOINT ["python", "-m", "shj3_ai.entrypoint"]
