#!/usr/bin/env bash
# SHJ3 — Helm chart verification (deployment.md §7.8, §7.9, §16.1 RB-22 step 5).
#
# Three real checks against the RENDERED manifest, not the template source —
# `helm template`'s output is what actually reaches a cluster, so that is
# what gets inspected:
#
#   1. §7.8: "the chart references secret names; it contains no secret
#      values." Asserted two ways: zero `kind: Secret` objects anywhere in
#      the render (this chart creates none, by design — every Secret is
#      provisioned out of band), AND none of this repo's own known
#      development-placeholder secret values (.env.example) appear literally
#      in the output, which would be the concrete symptom of a real value
#      having been hardcoded into a template instead of referenced via
#      `secretKeyRef`.
#   2. §7.9: Neo4j Community has no clustering. A chart that appears to
#      configure one while running a single instance is worse than one that
#      never claimed to — grep for `causal_clustering` and `dbms_mode` and
#      fail on a hit, exactly as §7.9's own text specifies.
#   3. §7.1's own consistency rule, exercised end to end here rather than
#      only in isolation: a real `helm template` invocation with matched
#      appVersion/image.tag succeeds — proves the whole rendering path
#      (values -> templates -> the version guard) works together, not just
#      that each piece works alone.
#
# .sh rather than .mjs/.ts, deliberately matching this file's own name as
# deployment.md already gives it verbatim (§7.8, §16.1's RB-22 script list —
# every sibling security-sweep script named there is also .sh) rather than
# introducing a fourth scripting convention into scripts/.
set -euo pipefail

CHART_DIR="infra/helm/shj3"
HELM="${HELM_BIN:-helm}"

if ! command -v "$HELM" >/dev/null 2>&1; then
  echo "verify-chart.sh: '$HELM' not found on PATH. Set HELM_BIN=/path/to/helm.exe if Helm is installed but not on PATH." >&2
  exit 1
fi

# The real release version this render must be internally consistent with —
# read from Chart.yaml itself rather than hardcoded, so this script never
# drifts from whatever the chart's own appVersion currently is.
APP_VERSION="$(grep -E '^appVersion:' "$CHART_DIR/Chart.yaml" | sed -E 's/^appVersion:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/')"
if [[ -z "$APP_VERSION" ]]; then
  echo "verify-chart.sh: could not read appVersion from $CHART_DIR/Chart.yaml" >&2
  exit 1
fi

TMP_OUT="$(mktemp)"
trap 'rm -f "$TMP_OUT"' EXIT

FAILED=0

for values_file in values-development.yaml values-uat.yaml values-production.yaml; do
  echo "verify-chart.sh: rendering $values_file (web.image.tag=ai.image.tag=$APP_VERSION)..."
  if ! "$HELM" template "$CHART_DIR" \
      -f "$CHART_DIR/$values_file" \
      --set "web.image.tag=$APP_VERSION" \
      --set "ai.image.tag=$APP_VERSION" \
      > "$TMP_OUT" 2>&1; then
    echo "verify-chart.sh: FAIL — helm template failed for $values_file:" >&2
    cat "$TMP_OUT" >&2
    FAILED=1
    continue
  fi

  # --- Check 1a: no Secret objects rendered at all (§7.8) ---
  if grep -qE '^kind: Secret$' "$TMP_OUT"; then
    echo "verify-chart.sh: FAIL — $values_file renders a Secret object. This chart must reference secrets by name only (secretRef/secretKeyRef); it must never create one (deployment.md §7.8)." >&2
    FAILED=1
  fi

  # --- Check 1b: no known dev-placeholder secret VALUES leaked in literally ---
  # .env.example's own checked-in placeholders — a real hit here means a
  # literal secret value ended up in a template instead of a secretKeyRef.
  DEV_SECRET_LITERALS=(
    "local-dev-session-secret-not-for-production"
    "Shj3_Local_Dev!2026"
    "shj3_local_dev"
    "local-dev-platform-token-not-for-production"
    "+yddTmNwlSyCtqzv2bABbnYmDiwu9hojxvkrJ73e4U8="
  )
  for literal in "${DEV_SECRET_LITERALS[@]}"; do
    if grep -qF "$literal" "$TMP_OUT"; then
      echo "verify-chart.sh: FAIL — $values_file's rendered output contains a known .env.example placeholder secret value ('$literal'). A real secret VALUE must never appear in chart output; only secretKeyRef references to a name are allowed (deployment.md §7.8)." >&2
      FAILED=1
    fi
  done

  # --- Check 2: no clustering-only Neo4j config (§7.9) ---
  # Comment lines excluded first: this file's own neo4j-sts.yaml carries a
  # real, deliberate `# No dbms_mode / causal_clustering keys...` explanatory
  # comment (surviving into rendered output — Helm strips `{{/* */}}`
  # template comments, not literal YAML `#` comments), which a naive grep
  # matches as a false positive — found by actually running this check
  # against the real chart before trusting it, the same "feed every gate a
  # real case before trusting it" discipline this repo already applies
  # elsewhere (tasks/lessons.md), turned on this script's own first draft.
  if grep -v -E '^\s*#' "$TMP_OUT" | grep -qiE 'causal_clustering|dbms_mode'; then
    echo "verify-chart.sh: FAIL — $values_file's rendered output configures Neo4j clustering (causal_clustering / dbms_mode). Community edition cannot cluster (ADR-0009); a chart that appears to configure a cluster while running a single instance is worse than one that never claimed to (deployment.md §7.9)." >&2
    FAILED=1
  fi

  if [[ "$FAILED" -eq 0 ]]; then
    echo "verify-chart.sh: $values_file — OK (no Secret objects, no leaked dev-secret values, no Neo4j clustering keys)"
  fi
done

if [[ "$FAILED" -ne 0 ]]; then
  echo "verify-chart.sh: one or more checks FAILED — see above." >&2
  exit 1
fi

echo "verify-chart.sh: all checks passed for all three environments."
