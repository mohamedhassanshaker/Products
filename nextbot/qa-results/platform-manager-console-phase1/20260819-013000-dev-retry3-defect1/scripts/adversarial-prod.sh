#!/usr/bin/env bash
# Adversarial verification for NFR-11 Defect 1 (QA retry 3).
# Group A: real guarded /api/internal/ops/** paths, denied via wrong token.
# Group B: genuinely-missing /api/** paths elsewhere in the app.
# Both groups vary in depth/segment-count/segment-length.
BASE=http://127.0.0.1:3212
OUT=advprod
rm -rf "$OUT"; mkdir -p "$OUT"

GUARDED=(
  "/api/internal/ops/tenants"
  "/api/internal/ops/tenants/11111111-1111-1111-1111-111111111111"
  "/api/internal/ops/tenants/a"
  "/api/internal/ops/tenants/a-considerably-longer-tenant-identifier-value"
  "/api/internal/ops/tenants/22222222-2222-2222-2222-222222222222"
)
MISSING=(
  "/api/v1/aaa"
  "/api/v1/bbb/ccc/ddd"
  "/api/nope"
  "/api/v1/x/y/z/w/v/u"
  "/api/a-much-longer-genuinely-missing-path-segment-name-here"
)

i=0
for p in "${GUARDED[@]}"; do
  i=$((i+1))
  curl -s --http1.1 -D "$OUT/A$i.h" -o "$OUT/A$i.b" \
    -H "Authorization: Bearer definitely-the-wrong-token" \
    -H "X-Forwarded-For: 10.0.0.5, 203.0.113.1" "$BASE$p"
  echo "A$i $p -> $(head -1 "$OUT/A$i.h" | tr -d '\r') len=$(wc -c < "$OUT/A$i.b")"
done

i=0
for p in "${MISSING[@]}"; do
  i=$((i+1))
  curl -s --http1.1 -D "$OUT/B$i.h" -o "$OUT/B$i.b" "$BASE$p"
  echo "B$i $p -> $(head -1 "$OUT/B$i.h" | tr -d '\r') len=$(wc -c < "$OUT/B$i.b")"
done

# --- the four denial reasons, all against the SAME guarded path ---
# D1 unconfigured env is exercised separately (needs a server without the env set).
curl -s --http1.1 -D "$OUT/D_wrongtoken.h" -o "$OUT/D_wrongtoken.b" \
  -H "Authorization: Bearer nope" -H "X-Forwarded-For: 10.0.0.5, 203.0.113.1" \
  "$BASE/api/internal/ops/tenants"
curl -s --http1.1 -D "$OUT/D_badip.h" -o "$OUT/D_badip.b" \
  -H "Authorization: Bearer adversarial-verify-operator-token" \
  -H "X-Forwarded-For: 198.51.100.7, 203.0.113.1" \
  "$BASE/api/internal/ops/tenants"
# no credential at all, from an allowed IP (neither header nor cookie present)
curl -s --http1.1 -D "$OUT/D_nocreds.h" -o "$OUT/D_nocreds.b" \
  -H "X-Forwarded-For: 10.0.0.5, 203.0.113.1" \
  "$BASE/api/internal/ops/tenants"
# a wrong token carried by the ops session cookie instead of the header
curl -s --http1.1 -D "$OUT/D_badcookie.h" -o "$OUT/D_badcookie.b" \
  -H "Cookie: nb_ops_session=not-the-token" \
  -H "X-Forwarded-For: 10.0.0.5, 203.0.113.1" \
  "$BASE/api/internal/ops/tenants"
# rate limit: 30/60s on ops-api:<ip>; burn the window from a distinct IP then capture.
for n in $(seq 1 34); do
  curl -s -o /dev/null --http1.1 -H "Authorization: Bearer nope" \
    -H "X-Forwarded-For: 10.0.0.99, 203.0.113.1" "$BASE/api/internal/ops/tenants"
done
curl -s --http1.1 -D "$OUT/D_ratelimited.h" -o "$OUT/D_ratelimited.b" \
  -H "Authorization: Bearer adversarial-verify-operator-token" \
  -H "X-Forwarded-For: 10.0.0.99, 203.0.113.1" \
  "$BASE/api/internal/ops/tenants"

# --- success path must still work ---
curl -s --http1.1 -D "$OUT/OK.h" -o "$OUT/OK.b" \
  -H "Authorization: Bearer adversarial-verify-operator-token" \
  -H "X-Forwarded-For: 10.0.0.5, 203.0.113.1" "$BASE/api/internal/ops/tenants"
echo "OK -> $(head -1 "$OUT/OK.h" | tr -d '\r') len=$(wc -c < "$OUT/OK.b")"

# --- other HTTP verbs on a missing api path vs a denied guarded path ---
for m in POST PUT PATCH DELETE OPTIONS; do
  curl -s --http1.1 -X $m -D "$OUT/V_${m}_missing.h" -o "$OUT/V_${m}_missing.b" "$BASE/api/nope-$m"
  curl -s --http1.1 -X $m -D "$OUT/V_${m}_guarded.h" -o "$OUT/V_${m}_guarded.b" \
    -H "Authorization: Bearer nope" -H "X-Forwarded-For: 10.0.0.5, 203.0.113.1" \
    "$BASE/api/internal/ops/tenants"
done

# --- same verb sweep against the [id] guarded route (different route file) ---
for m in GET HEAD POST PUT PATCH DELETE OPTIONS; do
  EXTRA=""; [ "$m" = "HEAD" ] && EXTRA="--head"
  curl -s --http1.1 $EXTRA -X $m -D "$OUT/W_${m}_missing.h" -o "$OUT/W_${m}_missing.b" "$BASE/api/v1/nope2-$m/sub"
  curl -s --http1.1 $EXTRA -X $m -D "$OUT/W_${m}_guarded.h" -o "$OUT/W_${m}_guarded.b" \
    -H "Authorization: Bearer nope" -H "X-Forwarded-For: 10.0.0.5, 203.0.113.1" \
    "$BASE/api/internal/ops/tenants/33333333-3333-3333-3333-333333333333"
done
