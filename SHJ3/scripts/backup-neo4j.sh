#!/usr/bin/env bash
# SHJ3 — Neo4j backup (docs/deployment.md §12.5, RB-17; tasks/todo.md Phase C).
#
# The real, minimal backup mechanism for Neo4j — an OPTIMISATION, not a
# recovery dependency (ADR-0009: the graph is a derived store, rebuildable by
# re-index; a restore is merely faster than a full re-index when a dump
# happens to exist and is fresh enough). Not a placeholder: this is the exact
# command sequence run for real, end to end, against an isolated, disposable
# Neo4j container as part of building this script — see this script's own
# review entry in tasks/todo.md for that drill's real result.
#
# Why this differs in shape from scripts/backup-sql.sh, and why that
# difference is real rather than a stylistic choice:
#
#   SQL Server backs up ONLINE (`BACKUP DATABASE` runs against a live,
#   serving database). Neo4j Community cannot: `neo4j-admin database dump`
#   refuses outright ("The database is in use. Stop database ... and try
#   again.") against a database mounted in a running server, and Community
#   has no Enterprise `STOP DATABASE <name>` administration command to quiesce
#   just the one database while the server keeps running — confirmed for
#   real: `cypher-shell -d system "STOP DATABASE neo4j;"` returns
#   "Unsupported administration command" on this exact pinned image
#   (neo4j:5.26-community). deployment.md §12.5's own pre-existing prose
#   assumed that command works in Community; it does not, and is corrected
#   here and in that doc alongside this script — a doc's worked example
#   drifting from the real, tested system it describes (see
#   tasks/lessons.md's "a doc's worked example can be stale relative to an
#   already-tested sibling" entry, now a second instance of that exact
#   pattern, in the same file, for the same store).
#
#   The only way to quiesce the ONE database Community ever runs is to stop
#   the whole server process — which, in this image's foreground-console
#   entrypoint, means stopping the whole CONTAINER. This script therefore:
#     1. `docker stop` the target container (a real, logged outage —
#        retrieval degrades to vector-only for the duration, ADR-0009's own
#        already-accepted design, not a new risk introduced here).
#     2. Runs `neo4j-admin database dump` in a THROWAWAY container that
#        mounts the SAME data volume (read-write — the image's own
#        entrypoint chowns /data before running any command, including
#        neo4j-admin, and fails outright on a read-only mount; confirmed by
#        hitting that failure directly) plus a HOST-bound directory for the
#        artifact, so the dump lands on the host in one step with no
#        `docker cp` needed (unlike SQL, where the backup is produced INSIDE
#        the live container's own filesystem and must be copied out
#        afterwards).
#     3. `docker start`s the target container back up immediately — before
#        this script's own verification step, to keep the outage as short as
#        possible; verification runs against the dump file alone and needs
#        no live database.
#     4. Verifies the artifact via `neo4j-admin database load --info`
#        (reads and validates the archive's metadata without loading or
#        touching any database — the closest real analogue to SQL's
#        `RESTORE VERIFYONLY`). This is NOT a no-op safety theatre check:
#        confirmed for real that `--info` against a TRUNCATED/corrupted dump
#        exits 1 with "Truncated source", so it genuinely detects damage.
#        Also confirmed a sharper, easy-to-miss gotcha: `--info` against a
#        DIRECTORY THAT DOES NOT CONTAIN A FILE NAMED EXACTLY `<database>.dump`
#        (e.g. `neo4j` for this store) exits 0 with NO output at all —
#        silent, false-looking success. This script never trusts the exit
#        code alone for that reason: it also greps stdout for the literal
#        "Database: neo4j" line `--info` prints on a real, found, valid
#        archive, the same "never trust exit 0 alone — grep the expected
#        content" discipline backup-sql.sh already applies to
#        RESTORE VERIFYONLY's "is valid" text.
#     5. Writes a small JSON manifest alongside the dump (sha256, size,
#        timestamp) — identical purpose and shape to backup-sql.sh's own.
#
#   A second, real consequence of the exact-filename requirement above:
#   `neo4j-admin` always names its output `<database>.dump` (here,
#   `neo4j.dump`) and `load --from-path` looks for that exact name inside the
#   directory it is given — it is NOT a free-form filename the way SQL
#   Server's .bak path is. This script therefore cannot flatten every run
#   into one directory with a timestamped filename the way backup-sql.sh
#   does; each run gets its OWN timestamped subdirectory
#   (`<out-dir>/<label>-<stamp>/neo4j.dump`), preserving the label/timestamp
#   in the path instead of the filename.
#
#   No SA/database password is needed anywhere in this script (unlike SQL) —
#   `neo4j-admin database dump` is a local filesystem tool operating directly
#   on the (stopped) database's store files, not a network/Bolt operation.
#
# Deliberately NOT built here, named plainly: off-host/off-cluster
# replication to a second copy (same real, separate gap backup-sql.sh names
# for SQL Server); a `--all-databases`/per-tenant dump split — Community is
# single-database, so this is necessarily all-or-nothing across every tenant,
# exactly as deployment.md §12.5 already states for restore.
#
# Usage:
#   scripts/backup-neo4j.sh --container <docker-container-name> \
#     [--out-dir ./backups/neo4j] [--label manual]
set -euo pipefail

# Same Git Bash (MSYS) path-rewriting gotcha backup-sql.sh documents and
# fixes, confirmed to reproduce identically here: any bare POSIX absolute
# path handed to a non-MSYS binary (docker.exe) — including a CONTAINER-
# internal path passed as a `docker run`/`docker exec` COMMAND ARGUMENT, not
# just `docker exec` itself — gets silently rewritten into a Windows host
# path first. Scoped with a per-command `MSYS_NO_PATHCONV=1` prefix on every
# docker invocation that embeds a container-internal path (/data, /backups
# as seen INSIDE a container); host-side `-v host:container` source paths and
# `--out-dir` are left to the normal MSYS conversion, which is what makes
# them resolve to real Windows paths correctly. A no-op on real POSIX shells.

usage() {
  cat <<'USAGE'
Usage: scripts/backup-neo4j.sh --container <name> [options]

Required:
  --container <name>   Docker container running Neo4j (docker ps). STOPPED
                        for the duration of the dump (Community has no
                        online backup) and started again automatically
                        before this script exits.

Options:
  --out-dir <path>      Host directory backups are written under (default:
                         ./backups/neo4j). Each run gets its own
                         "<label>-<timestamp>/neo4j.dump" subdirectory —
                         neo4j-admin requires that exact filename.
  --label <text>        Free-text label embedded in the subdirectory name
                         (default: manual).
  -h, --help             Show this help.
USAGE
}

CONTAINER=""
OUT_DIR="./backups/neo4j"
LABEL="manual"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container) CONTAINER="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "backup-neo4j.sh: unknown argument '$1'" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$CONTAINER" ]]; then
  echo "backup-neo4j.sh: --container is required (see 'docker ps')." >&2
  usage
  exit 1
fi
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "backup-neo4j.sh: no container named '$CONTAINER' (docker ps to list running containers)." >&2
  exit 1
fi

DATABASE="neo4j" # Community's one and only user database — never configurable per tenant (ADR-0009).
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# The throwaway dump/load container must run the SAME image the target
# container runs, not a hardcoded tag — this script works against whatever
# version is actually deployed, not an assumed one (this pass confirmed the
# real syntax against neo4j:5.26-community specifically; a different pinned
# version could differ).
IMAGE="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")"

# The data volume backing /data — resolved from the container's own mounts
# rather than assumed, so this script works against any container regardless
# of its compose/Helm-assigned volume name.
DATA_VOLUME="$(docker inspect --format '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Name }}{{ end }}{{ end }}' "$CONTAINER")"
if [[ -z "$DATA_VOLUME" ]]; then
  echo "backup-neo4j.sh: could not resolve a named volume mounted at /data on container '$CONTAINER'." >&2
  exit 1
fi

DEST_DIR="$OUT_DIR/${LABEL}-${STAMP}"
mkdir -p "$DEST_DIR"

echo "backup-neo4j.sh: stopping '$CONTAINER' — Neo4j Community has no online backup (neo4j-admin requires the database offline)."
echo "backup-neo4j.sh: graph-grounded retrieval degrades to vector-only for the duration (ADR-0009's own accepted design)."
docker stop "$CONTAINER" >/dev/null

echo "backup-neo4j.sh: neo4j-admin database dump $DATABASE -> $DEST_DIR/$DATABASE.dump (image $IMAGE, volume $DATA_VOLUME)"
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$DATA_VOLUME:/data" \
  -v "$DEST_DIR:/backups" \
  "$IMAGE" \
  neo4j-admin database dump "$DATABASE" --to-path=/backups --overwrite-destination

echo "backup-neo4j.sh: starting '$CONTAINER' back up."
docker start "$CONTAINER" >/dev/null

DUMP_FILE="$DEST_DIR/${DATABASE}.dump"
if [[ ! -f "$DUMP_FILE" ]]; then
  echo "backup-neo4j.sh: FATAL — dump did not produce the expected '$DUMP_FILE'." >&2
  exit 1
fi

echo "backup-neo4j.sh: verifying the artifact (neo4j-admin database load --info) — an unverified backup is not a backup."
VERIFY_OUT="$(MSYS_NO_PATHCONV=1 docker run --rm -v "$DEST_DIR:/backups" "$IMAGE" \
  neo4j-admin database load --from-path=/backups --info "$DATABASE")"
echo "$VERIFY_OUT"

# neo4j-admin's --info silently exits 0 with NO output at all when the
# directory does not contain the exact "<database>.dump" file it expects —
# confirmed for real. Exit code alone is not proof; grep the actual content
# it prints on a genuine, found, valid archive.
if ! grep -q "^Database: $DATABASE" <<<"$VERIFY_OUT"; then
  echo "backup-neo4j.sh: FATAL — artifact did not verify (neo4j-admin printed no valid archive metadata). Not writing a manifest for it." >&2
  exit 1
fi

# See scripts/backup-sql.sh's identical fix: GNU sha256sum prepends a literal
# '\' to its WHOLE output line when the hashed path needs escaping (a
# backslash or newline) — always strip it defensively.
SHA256="$(sha256sum "$DUMP_FILE" | awk '{print $1}' | sed 's/^\\//')"
SIZE_BYTES="$(wc -c < "$DUMP_FILE" | tr -d ' ')"
MANIFEST="${DUMP_FILE}.manifest.json"

cat > "$MANIFEST" <<JSON
{
  "database": "$DATABASE",
  "label": "$LABEL",
  "takenAtUtc": "$STAMP",
  "sourceContainer": "$CONTAINER",
  "sourceImage": "$IMAGE",
  "file": "$(basename "$DUMP_FILE")",
  "sha256": "$SHA256",
  "sizeBytes": $SIZE_BYTES,
  "infoVerify": "pass"
}
JSON

echo "backup-neo4j.sh: OK"
echo "backup-neo4j.sh:   artifact: $DUMP_FILE ($SIZE_BYTES bytes, sha256=$SHA256)"
echo "backup-neo4j.sh:   manifest: $MANIFEST"
