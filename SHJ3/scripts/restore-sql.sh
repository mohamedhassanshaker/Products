#!/usr/bin/env bash
# SHJ3 — SQL Server restore (docs/deployment.md §12.4, RB-16).
#
# Restores an artifact produced by scripts/backup-sql.sh into a NEW target
# database inside a running SQL Server container. Never restores over the
# live database by accident: refuses to target a database literally named
# `shj3` unless --confirm-production-database is passed explicitly — the
# same "refusing is the honest answer" stance sql-store-provisioner.ts's own
# module comment states, applied here to the one place a mistake destroys
# the system of record rather than one tenant's schema. deployment.md
# §12.4/RB-16 makes the same rule in prose ("an isolated restore target,
# never the live server"); this script makes it a real refusal, not just
# advice in a runbook nobody reads at 2am.
#
# Why the MOVE clause is derived from RESTORE FILELISTONLY rather than
# guessed: a backup set carries the ORIGINAL database's logical file names
# (e.g. "shj3" / "shj3_log"), not the target database's name. SQL Server's
# RESTORE needs the physical destination path for both files regardless of
# what the target database is called, or it tries to recreate the original
# database's own .mdf/.ldf paths and fails the moment a database with that
# name/path already exists (or, worse, silently overwrites it if it
# doesn't). Reading the real logical names first and mapping them
# explicitly is the only way to target an arbitrary new database name
# safely and repeatably.
#
# Usage:
#   scripts/restore-sql.sh --container <name> --file <path-to.bak> \
#     [--sa-password <password>] [--target-database shj3_drill] \
#     [--confirm-production-database]
set -euo pipefail

# See scripts/backup-sql.sh's identical note: Git Bash (MSYS) on Windows
# rewrites bare POSIX absolute path arguments before they reach docker.exe.
# Scoped per-command (`MSYS_NO_PATHCONV=1 docker exec ...`) below, never
# exported globally — that also breaks `docker cp`'s HOST-side path
# argument, which needs the normal MSYS rewrite. No-op on real POSIX shells.

usage() {
  cat <<'USAGE'
Usage: scripts/restore-sql.sh --container <name> --file <path.bak> [options]

Required:
  --container <name>       Docker container running SQL Server (docker ps).
  --file <path>             Path to a .bak artifact (as produced by
                             scripts/backup-sql.sh) on the HOST filesystem.

Options:
  --sa-password <pw>        SA password. Falls back to $MSSQL_SA_PASSWORD.
  --target-database <name>  Database name to restore INTO (default:
                             shj3_drill). Never the live database name
                             ("shj3") without --confirm-production-database.
  --confirm-production-database
                             Required to target a database literally named
                             "shj3". Absent by design — see this file's own
                             header for why.
  -h, --help                 Show this help.
USAGE
}

CONTAINER=""
SA_PASSWORD="${MSSQL_SA_PASSWORD:-}"
FILE=""
TARGET_DATABASE="shj3_drill"
CONFIRM_PROD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container) CONTAINER="$2"; shift 2 ;;
    --sa-password) SA_PASSWORD="$2"; shift 2 ;;
    --file) FILE="$2"; shift 2 ;;
    --target-database) TARGET_DATABASE="$2"; shift 2 ;;
    --confirm-production-database) CONFIRM_PROD=1; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "restore-sql.sh: unknown argument '$1'" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$CONTAINER" ]]; then
  echo "restore-sql.sh: --container is required (see 'docker ps')." >&2
  usage
  exit 1
fi
if [[ -z "$FILE" ]]; then
  echo "restore-sql.sh: --file <path-to-.bak> is required." >&2
  usage
  exit 1
fi
if [[ ! -f "$FILE" ]]; then
  echo "restore-sql.sh: '$FILE' does not exist on the host." >&2
  exit 1
fi
if [[ -z "$SA_PASSWORD" ]]; then
  echo "restore-sql.sh: SA password required: --sa-password or \$MSSQL_SA_PASSWORD." >&2
  exit 1
fi
if [[ "$TARGET_DATABASE" == "shj3" && "$CONFIRM_PROD" -ne 1 ]]; then
  echo "restore-sql.sh: refusing to restore over a database named 'shj3' without --confirm-production-database." >&2
  echo "restore-sql.sh: restore to an isolated target instead (e.g. --target-database shj3_drill) and point a" >&2
  echo "restore-sql.sh: throwaway app instance at it — deployment.md §12.4 RB-16: 'an isolated restore target, never the live server'." >&2
  exit 1
fi
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "restore-sql.sh: no container named '$CONTAINER' (docker ps to list running containers)." >&2
  exit 1
fi

# Verify the artifact against its own manifest before touching the container,
# if one is sitting alongside it (backup-sql.sh always writes one) — catches
# a silently altered/truncated .bak before spending a real restore on it.
MANIFEST="${FILE}.manifest.json"
if [[ -f "$MANIFEST" ]]; then
  EXPECTED_SHA="$(grep -o '"sha256": *"[^"]*"' "$MANIFEST" | head -1 | sed -E 's/.*"([0-9a-f]{64})".*/\1/')"
  # See scripts/backup-sql.sh's identical fix: strip a leading backslash
  # GNU sha256sum prepends when the filename needed escaping.
  ACTUAL_SHA="$(sha256sum "$FILE" | awk '{print $1}' | sed 's/^\\//')"
  if [[ -n "$EXPECTED_SHA" && "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
    echo "restore-sql.sh: FATAL — '$FILE' does not match its own manifest's sha256 (expected $EXPECTED_SHA, got $ACTUAL_SHA). Refusing to restore a possibly-altered artifact." >&2
    exit 1
  fi
  echo "restore-sql.sh: manifest sha256 verified ($ACTUAL_SHA)."
else
  echo "restore-sql.sh: no manifest found alongside '$FILE' — proceeding without a pre-restore integrity check."
fi

SQLCMD=/opt/mssql-tools18/bin/sqlcmd
REMOTE_DIR=/var/opt/mssql/backup
REMOTE_FILE="$REMOTE_DIR/$(basename "$FILE")"

MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" mkdir -p "$REMOTE_DIR"
docker cp "$FILE" "$CONTAINER:$REMOTE_FILE"

echo "restore-sql.sh: RESTORE FILELISTONLY FROM DISK = N'$REMOTE_FILE' (reading logical file names)"
FILELIST="$(MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" "$SQLCMD" -S localhost -U sa -P "$SA_PASSWORD" -C -h -1 -W -s'|' -Q \
  "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK = N'$REMOTE_FILE';")"

DATA_LOGICAL="$(awk -F'|' '$3=="D"{print $1; exit}' <<<"$FILELIST" | xargs)"
LOG_LOGICAL="$(awk -F'|' '$3=="L"{print $1; exit}' <<<"$FILELIST" | xargs)"

if [[ -z "$DATA_LOGICAL" || -z "$LOG_LOGICAL" ]]; then
  echo "restore-sql.sh: FATAL — could not parse RESTORE FILELISTONLY output; cannot build a safe MOVE clause. Raw output:" >&2
  echo "$FILELIST" >&2
  exit 1
fi
echo "restore-sql.sh: logical files — data='$DATA_LOGICAL' log='$LOG_LOGICAL'"

echo "restore-sql.sh: RESTORE DATABASE [$TARGET_DATABASE] FROM DISK = N'$REMOTE_FILE'"
MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" "$SQLCMD" -S localhost -U sa -P "$SA_PASSWORD" -C -Q \
  "RESTORE DATABASE [$TARGET_DATABASE] FROM DISK = N'$REMOTE_FILE' WITH \
     MOVE N'$DATA_LOGICAL' TO N'/var/opt/mssql/data/${TARGET_DATABASE}.mdf', \
     MOVE N'$LOG_LOGICAL' TO N'/var/opt/mssql/data/${TARGET_DATABASE}_log.ldf', \
     REPLACE, CHECKSUM, STATS=10;"

echo "restore-sql.sh: confirming the restored database is ONLINE"
MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" "$SQLCMD" -S localhost -U sa -P "$SA_PASSWORD" -C -Q \
  "SELECT name, state_desc FROM sys.databases WHERE name = N'$TARGET_DATABASE';"

echo "restore-sql.sh: OK — restored into [$TARGET_DATABASE] on container '$CONTAINER'."
echo "restore-sql.sh: this database is NOT wired into any application config — verify its contents directly (sqlcmd), then drop it when done:"
echo "restore-sql.sh:   docker exec $CONTAINER $SQLCMD -S localhost -U sa -P '***' -C -Q \"DROP DATABASE [$TARGET_DATABASE];\""
