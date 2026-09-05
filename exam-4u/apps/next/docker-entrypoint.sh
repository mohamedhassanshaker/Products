#!/bin/sh
# ExamLand apps/next — single-image, two-role entrypoint (Phase 10 sub-slice "10a", migration plan's
# "same image, ROLE env var selects `node server.js` (web) vs `node worker.js` (worker)"). See
# `Dockerfile`'s own header comment for why the worker path runs via `tsx` against the TS source tree
# rather than a second compiled bundle. Runs with cwd `/app/apps/next` (the Dockerfile's final
# `WORKDIR`) — every path below is relative to that.
set -e

if [ "$ROLE" = "worker" ]; then
  echo "docker-entrypoint: ROLE=worker -> starting background workers via tsx" >&2
  # `tsx` resolves the `@/*` path alias via the nearest `tsconfig.json` to its CURRENT WORKING
  # DIRECTORY, not the entry file's location — this script's cwd is already `apps/next` (this
  # directory's own `tsconfig.json` has the `@/*` -> `./src/*` mapping), found only by actually
  # running the built image (an earlier attempt invoked `tsx` from `/app`, which crashed with
  # `MODULE_NOT_FOUND: @/server/config`).
  exec ../../node_modules/.bin/tsx src/server/workers/worker-entrypoint.ts
else
  echo "docker-entrypoint: ROLE=${ROLE:-web} -> starting the Next.js standalone server" >&2
  exec node server.js
fi
