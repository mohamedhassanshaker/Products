# syntax=docker/dockerfile:1.7
#
# Agent image (HLD §8.1 "agent"): the LiveKit Agents worker (STT -> LLM ->
# TTS -> avatar loop). CPU-only base per HLD's own table ("CUDA base only if
# an in-process GPU adapter is enabled") — production default addresses
# GPU-hosted STT/TTS/avatar over the network via ProviderCredential.endpoint_url
# (operator-provisioned, ADR-001 §4/HLD §2.1); this image does not itself
# assume or require a GPU. If an operator later needs true in-process GPU
# inference (e.g. a local bitHuman/faster-whisper model on the same node),
# that is a separate CUDA-base variant, not this default image.
#
# Build context is this directory:
#   docker build -f apps/agent/Dockerfile -t liveavatar/agent:<tag> apps/agent

ARG PYTHON_VERSION=3.12-slim

FROM python:${PYTHON_VERSION} AS build
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /build

# Native build deps for compiled wheels (ctranslate2/onnxruntime transitively
# via faster-whisper, PyAV, etc.) — build stage only, not shipped at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      libsndfile1-dev \
      libturbojpeg0-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .

FROM python:${PYTHON_VERSION} AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SECRETS_DIR=/app

# Runtime-only shared libs the installed wheels dlopen (soundfile ->
# libsndfile, bitHuman's PyTurboJPEG -> libturbojpeg, faster-whisper's
# ctranslate2 -> libgomp); curl for HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libsndfile1 \
      libturbojpeg0 \
      libgomp1 \
      curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 agent \
    && useradd --uid 10001 --gid agent --create-home --shell /usr/sbin/nologin agent

WORKDIR /app
COPY --from=build /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=build /usr/local/bin /usr/local/bin
COPY --chown=agent:agent src ./src

RUN mkdir -p /app/secrets && chown -R agent:agent /app

USER agent
WORKDIR /app/src

# livekit-agents' own health-check HTTP server (WorkerOptions.port,
# `prod_default=8081` when run via the `start` subcommand — see
# livekit.agents.worker/WorkerOptions and cli/_legacy.py). No custom
# endpoint invented: this is the framework's own existing health route.
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8081/ || exit 1

ENTRYPOINT ["python", "-m", "avatar_agent", "start"]
