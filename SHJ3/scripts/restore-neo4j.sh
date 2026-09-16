#!/usr/bin/env bash
# SHJ3 — Neo4j restore (docs/deployment.md §12.5, RB-17).
#
# Restores an artifact produced by scripts/backup-neo4j.sh into a target
# Neo4j container. Read RB-17 first: this is an OPTIMISATION, never a
# recovery dependency (ADR-0009 — the graph is a derived store; re-index is
# the primary recovery path). Never run this for a single-tenant problem —
# Community is single-database, so a load overwrites EVERY tenant's graph at
# once, rolling one entity's data backwards to fix another's. That is the
# sharpest real difference from scripts/restore-sql.sh, which restores into
# an independently-NAMED new database and can therefore leave the original
# untouched: Neo4j Community has exactly one user database, always called
# "neo4j", so there is no equivalent "restore to a differently-named target"
# escape hatch — a load always replaces the WHOLE, ONLY database the target
# container runs.
#
# Because a per-database-name safety check (restore-sql.sh's own
# `--target-database`) has no equivalent here, the safety boundary in this
# script is the CONTAINER instead: it refuses to load into a container that
# is part of the real, shared `shj3` Docker Compose project — the one
# actually serving citizens/staff — without --confirm-production-container.
# This is checked structurally, not by guessing a name: every container
# started by `docker compose` (docker-compose.yml's own `name: shj3` at its
# top) carries a `com.docker.compose.project=shj3` label; a standalone
# `docker run` container (an isolated drill instance, exactly as this
# script's own review entry describes running) carries no such label at all.
# Confirmed for real against both the actual shared `shj3-neo4j-1` container
# (label present) and an isolated drill container (label absent).
#
# Why the MOVE-clause equivalent doesn't exist here: SQL Server's restore
# needs an explicit file-path remap because a differently-named target
# database still carries the ORIGINAL database's physical file names.
# Neo4j's load has no such step — `--overwrite-destination` replaces the
# one, fixed-name "neo4j" database's files outright; there is no name to
# remap.
#
# Usage:
#   scripts/restore-neo4j.sh --container <name> --dump-dir <path> \
#     [--confirm-production-container]
#
# --dump-dir must be a directory containing "neo4j.dump" exactly as
# scripts/backup-neo4j.sh produces it (neo4j-admin requires that literal
# filename — it is not a free-form path the way SQL Server's .bak is).
set -euo pipefail

# See scripts/backup-neo4j.sh's identical note: Git Bash (MSYS) on Windows
# rewrites bare POSIX absolute-path arguments — including ones passed as a
# `docker run` COMMAND ARGUMENT — before they reach docker.exe. Scoped
# per-command (`MSYS_NO_PATHCONV=1`) on exactly the calls that embed a
# container-internal path; host-side `-v host:container` source paths are
# left to the normal MSYS conversion. No-op on real POSIX shells.

usage() {
  cat <<'USAGE'
Usage: scripts/restore-neo4j.sh --container <name> --dump-dir <path> [options]

Required:
  --container <name>   Docker container to restore INTO. STOPPED for the
                        duration of the load and started again automatically
                        before this script exits. Its ENTIRE Neo4j database
                        is replaced — every tenant, not one.
  --dump-dir <path>    Host directory containing "neo4j.dump" (as produced
                        by scripts/backup-neo4j.sh).

Options:
  --confirm-production-container
                        Required when --container is part of the real,
                        shared `shj3` Docker Compose project (detected via
                        the `com.docker.compose.project=shj3` container
                        label). Absent by design — see this file's own
                        header for why.
  -h, --help             Show this help.
USAGE
}

CONTAINER=""
DUMP_DIR=""
CONFIRM_PROD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container) CONTAINER="$2"; shift 2 ;;
    --dump-dir) DUMP_DIR="$2"; shift 2 ;;
    --confirm-production-container) CONFIRM_PROD=1; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "restore-neo4j.sh: unknown argument '$1'" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$CONTAINER" ]]; then
  echo "restore-neo4j.sh: --container is required (see 'docker ps')." >&2
  usage
  exit 1
fi
if [[ -z "$DUMP_DIR" ]]; then
  echo "restore-neo4j.sh: --dump-dir <path-to-directory-containing-neo4j.dump> is required." >&2
  usage
  exit 1
fi

DATABASE="neo4j"
DUMP_FILE="$DUMP_DIR/${DATABASE}.dump"
if [[ ! -f "$DUMP_FILE" ]]; then
  echo "restore-neo4j.sh: '$DUMP_FILE' does not exist — --dump-dir must contain a file named exactly '${DATABASE}.dump' (neo4j-admin's own requirement, not a free-form filename)." >&2
  exit 1
fi
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "restore-neo4j.sh: no container named '$CONTAINER' (docker ps to list running containers)." >&2
  exit 1
fi

# Refuse the real, shared compose project's container without an explicit
# confirmation flag — a load here would silently roll back EVERY tenant's
# graph for whoever is actually being served by it. Checked structurally via
# the compose project label, not by guessing a container name.
PROJECT_LABEL="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$CONTAINER" 2>/dev/null || true)"
if [[ "$PROJECT_LABEL" == "shj3" && "$CONFIRM_PROD" -ne 1 ]]; then
  echo "restore-neo4j.sh: refusing to restore into '$CONTAINER' — it belongs to the real, shared 'shj3' Docker Compose project (com.docker.compose.project=shj3) without --confirm-production-container." >&2
  echo "restore-neo4j.sh: restore into an isolated, disposable container instead — a load replaces the WHOLE database, every tenant, not one (ADR-0009/RB-17)." >&2
  exit 1
fi

# Verify the artifact against its own manifest before touching anything, if
# one is sitting alongside it (backup-neo4j.sh always writes one) — catches
# a silently altered/truncated dump before spending a real restore on it.
MANIFEST="${DUMP_FILE}.manifest.json"
if [[ -f "$MANIFEST" ]]; then
  EXPECTED_SHA="$(grep -o '"sha256": *"[^"]*"' "$MANIFEST" | head -1 | sed -E 's/.*"([0-9a-f]{64})".*/\1/')"
  # See scripts/backup-neo4j.sh's identical fix: strip a leading backslash
  # GNU sha256sum prepends when the filename needed escaping.
  ACTUAL_SHA="$(sha256sum "$DUMP_FILE" | awk '{print $1}' | sed 's/^\\//')"
  if [[ -n "$EXPECTED_SHA" && "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
    echo "restore-neo4j.sh: FATAL — '$DUMP_FILE' does not match its own manifest's sha256 (expected $EXPECTED_SHA, got $ACTUAL_SHA). Refusing to restore a possibly-altered artifact." >&2
    exit 1
  fi
  echo "restore-neo4j.sh: manifest sha256 verified ($ACTUAL_SHA)."
else
  echo "restore-neo4j.sh: no manifest found alongside '$DUMP_FILE' — proceeding without a pre-restore integrity check."
fi

IMAGE="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")"
DATA_VOLUME="$(docker inspect --format '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Name }}{{ end }}{{ end }}' "$CONTAINER")"
if [[ -z "$DATA_VOLUME" ]]; then
  echo "restore-neo4j.sh: could not resolve a named volume mounted at /data on container '$CONTAINER'." >&2
  exit 1
fi

# Second, independent check on the artifact itself (neo4j-admin's own
# corruption detection, not just our sha256) — runs against the dump file
# alone, before anything is stopped. Confirmed for real: this exits 1 with
# "Truncated source" against a corrupted archive, and — the sharper gotcha —
# exits 0 with NO output at all if the directory lacks the exact
# "<database>.dump" filename. Exit code alone is never trusted; the expected
# "Database: neo4j" line is.
echo "restore-neo4j.sh: pre-flight verify (neo4j-admin database load --info) before touching '$CONTAINER'."
INFO_OUT="$(MSYS_NO_PATHCONV=1 docker run --rm -v "$DUMP_DIR:/backups" "$IMAGE" \
  neo4j-admin database load --from-path=/backups --info "$DATABASE")"
echo "$INFO_OUT"
if ! grep -q "^Database: $DATABASE" <<<"$INFO_OUT"; then
  echo "restore-neo4j.sh: FATAL — artifact did not verify (neo4j-admin printed no valid archive metadata). Refusing to restore." >&2
  exit 1
fi

echo "restore-neo4j.sh: stopping '$CONTAINER' — Neo4j Community requires the database offline to load into it."
docker stop "$CONTAINER" >/dev/null

echo "restore-neo4j.sh: neo4j-admin database load $DATABASE <- $DUMP_FILE (image $IMAGE, volume $DATA_VOLUME)"
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$DATA_VOLUME:/data" \
  -v "$DUMP_DIR:/backups" \
  "$IMAGE" \
  neo4j-admin database load "$DATABASE" --from-path=/backups --overwrite-destination

echo "restore-neo4j.sh: starting '$CONTAINER' back up."
docker start "$CONTAINER" >/dev/null

echo "restore-neo4j.sh: OK — restored into '$CONTAINER' from $DUMP_FILE."
echo "restore-neo4j.sh: this replaced the ENTIRE database — every tenant's graph is now at the dump's timestamp. Verify contents directly (cypher-shell) before resuming shj3-ai/shj3-worker traffic against it."
