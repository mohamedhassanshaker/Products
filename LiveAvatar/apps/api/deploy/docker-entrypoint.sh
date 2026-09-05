#!/bin/sh
# Runs the two independent Nest applications (public :8080, cluster-only
# :8081 — apps/api/src/main.ts and main-internal.ts) as sibling processes in
# one container, per HLD §8.1's single "web" container. If either process
# exits, this script exits (non-zero) so the container is considered failed
# and Kubernetes/Docker restarts it — there is no supported "half up" state.
set -eu

node dist/main.js &
PUBLIC_PID=$!

node dist/main-internal.js &
INTERNAL_PID=$!

shutdown() {
  kill -TERM "$PUBLIC_PID" "$INTERNAL_PID" 2>/dev/null || true
  wait "$PUBLIC_PID" 2>/dev/null || true
  wait "$INTERNAL_PID" 2>/dev/null || true
  exit 0
}
trap shutdown TERM INT

while kill -0 "$PUBLIC_PID" 2>/dev/null && kill -0 "$INTERNAL_PID" 2>/dev/null; do
  sleep 2
done

echo "docker-entrypoint: one of the two web processes exited, shutting down container" >&2
kill -TERM "$PUBLIC_PID" "$INTERNAL_PID" 2>/dev/null || true
exit 1
