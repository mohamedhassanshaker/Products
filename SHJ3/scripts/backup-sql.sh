#!/usr/bin/env bash
# SHJ3 — SQL Server backup (docs/deployment.md §12, RB-16; tasks/todo.md Phase C).
#
# The real, minimal backup mechanism for the ONE store with a real backup
# obligation (deployment.md §12.1: Neo4j/Qdrant are derived and rebuildable,
# Redis is deliberately unbacked by ADR-0003 rule 2). Not a placeholder: this
# is the exact command sequence run for real, end to end, against an
# isolated SQL Server container as part of building this script — see
# docs/deployment.md §12.4's dated review note for that drill's real result.
#
# What this does, in order, and why:
#   1. BACKUP DATABASE ... WITH COMPRESSION, CHECKSUM  — a full backup,
#      page-checksummed so a corrupt page is detected at backup time, not
#      discovered mid-restore during an actual incident.
#   2. RESTORE VERIFYONLY ... WITH CHECKSUM — an unverified backup is not a
#      backup (deployment.md §8.4/§12.4's own stated rule). This script
#      REFUSES to copy the artifact out if verification does not report
#      "is valid" — a silently corrupt .bak sitting in the backup directory
#      is worse than no backup, because it looks like coverage that isn't
#      there.
#   3. `docker cp` the verified artifact onto the HOST filesystem — a backup
#      that lives only inside the same container/volume as the database it
#      protects is not a real backup (it dies with the volume it was meant
#      to protect against). This is what makes the artifact restorable
#      independently of the source container's fate.
#   4. A small JSON manifest alongside the .bak (sha256, size, timestamp) —
#      cheap provenance so a restore can confirm the artifact it is about to
#      use has not been silently altered since it was taken.
#
# Deliberately NOT built here, and named plainly rather than left to be
# discovered: off-host / off-cluster replication to a second copy
# (deployment.md §12.2's "second availability zone" requirement — this
# script produces one local artifact, not a redundant pair), and the
# `RESTORE ... WITH STOPAT` / transaction-log-shipping machinery needed for
# the 15-minute RPO deployment.md §12.3 targets — this is a full-backup-only
# mechanism. Both are real, legitimate follow-on work, out of this pass's
# scope (see tasks/todo.md's review entry for this work).
#
# Usage:
#   scripts/backup-sql.sh --container <docker-container-name> \
#     [--sa-password <password>] [--database shj3] [--out-dir ./backups/sql] \
#     [--label manual]
#
# SA password: --sa-password, or the MSSQL_SA_PASSWORD env var (matching
# docker-compose.yml's own variable name). Never hardcode it in a call site
# that gets committed anywhere.
set -euo pipefail

# Git Bash (MSYS) on Windows silently rewrites any bare POSIX absolute path
# argument (e.g. /opt/mssql-tools18/...) into a Windows path before handing
# it to a non-MSYS executable like docker.exe — confirmed directly: every
# `docker exec ... /opt/...` call below fails with "exec: \"C:/Program
# Files/Git/opt/...\": no such file or directory" without it. Scoped with a
# per-command `MSYS_NO_PATHCONV=1` prefix on exactly the `docker exec` calls
# below (which embed CONTAINER-internal paths that must NOT be rewritten),
# never exported globally — exporting it for the whole script also breaks
# `docker cp`'s HOST-side destination path (found the same way: it needs
# the normal MSYS rewrite to become a real Windows path, or `docker cp`
# fails with "invalid output path"). A no-op on real POSIX shells either way.

usage() {
  cat <<'USAGE'
Usage: scripts/backup-sql.sh --container <name> [options]

Required:
  --container <name>       Docker container running SQL Server (docker ps).

Options:
  --sa-password <pw>       SA password. Falls back to $MSSQL_SA_PASSWORD.
  --database <name>        Database to back up (default: shj3).
  --out-dir <path>         Host directory to place the verified .bak in
                            (default: ./backups/sql).
  --label <text>           Free-text label embedded in the filename
                            (default: manual). Use the migration name for a
                            pre-migration backup (deployment.md §8.4).
  -h, --help                Show this help.
USAGE
}

CONTAINER=""
SA_PASSWORD="${MSSQL_SA_PASSWORD:-}"
DATABASE="shj3"
OUT_DIR="./backups/sql"
LABEL="manual"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container) CONTAINER="$2"; shift 2 ;;
    --sa-password) SA_PASSWORD="$2"; shift 2 ;;
    --database) DATABASE="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "backup-sql.sh: unknown argument '$1'" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$CONTAINER" ]]; then
  echo "backup-sql.sh: --container is required (see 'docker ps')." >&2
  usage
  exit 1
fi
if [[ -z "$SA_PASSWORD" ]]; then
  echo "backup-sql.sh: SA password required: --sa-password or \$MSSQL_SA_PASSWORD." >&2
  exit 1
fi
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "backup-sql.sh: no container named '$CONTAINER' (docker ps to list running containers)." >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SQLCMD=/opt/mssql-tools18/bin/sqlcmd
REMOTE_DIR=/var/opt/mssql/backup
REMOTE_FILE="$REMOTE_DIR/${DATABASE}-${LABEL}-${STAMP}.bak"

MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" mkdir -p "$REMOTE_DIR"

echo "backup-sql.sh: BACKUP DATABASE [$DATABASE] -> $REMOTE_FILE (in container '$CONTAINER')"
MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" "$SQLCMD" -S localhost -U sa -P "$SA_PASSWORD" -C -Q \
  "BACKUP DATABASE [$DATABASE] TO DISK = N'$REMOTE_FILE' WITH COMPRESSION, CHECKSUM, STATS=10;"

echo "backup-sql.sh: RESTORE VERIFYONLY $REMOTE_FILE"
VERIFY_OUT="$(MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" "$SQLCMD" -S localhost -U sa -P "$SA_PASSWORD" -C -Q \
  "RESTORE VERIFYONLY FROM DISK = N'$REMOTE_FILE' WITH CHECKSUM;")"
echo "$VERIFY_OUT"

if ! grep -q "is valid" <<<"$VERIFY_OUT"; then
  echo "backup-sql.sh: FATAL — backup did not verify. An unverified backup is not a backup (deployment.md §8.4). Not copying it to $OUT_DIR." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
LOCAL_FILE="$OUT_DIR/$(basename "$REMOTE_FILE")"
docker cp "$CONTAINER:$REMOTE_FILE" "$LOCAL_FILE"

# `sed 's/^\\//'` strips the leading backslash GNU sha256sum prepends to the
# WHOLE output line when the filename needs escaping (a backslash or newline
# in the path) — found for real: an out-dir path containing backslashes
# (e.g. a bare Windows-style path passed to this bash script) produced a
# hash string with a literal backslash baked into it, silently wrong. Always
# strip it; harmless when it was never there.
SHA256="$(sha256sum "$LOCAL_FILE" | awk '{print $1}' | sed 's/^\\//')"
SIZE_BYTES="$(wc -c < "$LOCAL_FILE" | tr -d ' ')"
MANIFEST="${LOCAL_FILE}.manifest.json"

cat > "$MANIFEST" <<JSON
{
  "database": "$DATABASE",
  "label": "$LABEL",
  "takenAtUtc": "$STAMP",
  "sourceContainer": "$CONTAINER",
  "file": "$(basename "$LOCAL_FILE")",
  "sha256": "$SHA256",
  "sizeBytes": $SIZE_BYTES,
  "restoreVerifyOnly": "pass"
}
JSON

echo "backup-sql.sh: OK"
echo "backup-sql.sh:   artifact: $LOCAL_FILE ($SIZE_BYTES bytes, sha256=$SHA256)"
echo "backup-sql.sh:   manifest: $MANIFEST"
