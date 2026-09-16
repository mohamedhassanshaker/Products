{{/*
Shared named templates. Every other template in this chart calls into here
rather than repeating label/name/checksum logic — one place to get the
selector labels right, since HPAs, PDBs and NetworkPolicies all select on
them by exact value (deployment.md §7.5-§7.7's own shown YAML: `app:
shj3-web`, `app: shj3-ai`, `app in (shj3-ai, shj3-worker)`, `app: neo4j`,
`app: qdrant`) — a label typo here breaks scaling, disruption budgets and
network isolation simultaneously, silently.
*/}}

{{- define "shj3.name" -}}
{{- .Chart.Name -}}
{{- end -}}

{{/*
Release-scoped resource-name prefix. Every template composes its own
resource name as `{{ include "shj3.fullname" . }}-<workload>` (e.g.
`-web`, `-ai`, `-neo4j`) rather than hardcoding `shj3-*`, so two releases of
this chart in the same cluster (e.g. a second namespace) never collide on
plain resource names within a namespace, and so the same fullname is reused
consistently as the DNS-reachable Service name components construct for each
other (e.g. configmap-ai.yaml's default SHJ3_NEO4J_URI).
*/}}
{{- define "shj3.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "shj3.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end -}}

{{/*
Common labels for any object. Takes a dict: {root: $, component: "shj3-web"}.
`component` is deliberately the bare workload name (`shj3-web`, `shj3-ai`,
`shj3-worker`, `neo4j`, `qdrant`, `sqlserver`, `redis`) — it becomes the plain
`app` label's value, which is the literal string every NetworkPolicy/HPA/PDB
selector in deployment.md §7 matches against. Do not "improve" this into
`app.kubernetes.io/name` only — that label also exists below, but `app` is
the one the spec's own selectors use, so it has to exist verbatim too.
*/}}
{{- define "shj3.labels" -}}
helm.sh/chart: {{ include "shj3.chart" .root }}
{{ include "shj3.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
{{- end -}}

{{- define "shj3.selectorLabels" -}}
app: {{ .component }}
app.kubernetes.io/name: {{ .component }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{/*
appVersion / image.tag consistency guard — deployment.md §7.1's own stated
rule, implemented for real rather than left as a comment: "`Chart.yaml`'s
`appVersion` is set by `scripts/release.sh` and must equal the image tag.
`helm upgrade` with a mismatched `appVersion` and `image.tag` is rejected by
a `fail` in `_helpers.tpl` — that mismatch is how a 'deployed the wrong
thing' incident starts."

Checks BOTH images this chart deploys (`shj3-web`, `shj3-ai` — `shj3-worker`
reuses `.Values.ai.image` by construction, ADR-0001 constraint 1, so it needs
no separate check) against `.Chart.AppVersion`, and separately checks neither
tag is empty: `values-production.yaml`'s own inline comment already states
the convention this enforces — "tag injected by release.sh; empty = fail".
With no `scripts/release.sh` yet (ADR-0008, RISK-002 — no CI), EVERY values
file in this chart ships `image.tag: ""` by default, in every environment,
deliberately not just production: a real deploy passes the real tag
explicitly (`--set web.image.tag=X --set ai.image.tag=X`, matching
Chart.yaml's `appVersion`) until a release script exists to do it. Applying
the same strict rule uniformly, rather than relaxing it for development, is
the point — a mismatch is exactly as much an incident in development as
production, and a carved-out exception in the one environment engineers
touch constantly is the version of this guard most likely to bit-rot unused.

Called once each from `templates/config/configmap-web.yaml` and
`templates/config/configmap-ai.yaml` — both unconditional in every
environment this chart supports, so the guard fires on every single
`helm template`/`helm upgrade`, not just on environments that happen to
render a particular optional resource.
*/}}
{{- define "shj3.checkVersionConsistency" -}}
{{- if not .Values.web.image.tag -}}
{{- fail (printf "web.image.tag is empty. Chart.yaml appVersion is %q — set web.image.tag to the same release version (scripts/release.sh's future job; until it exists, pass --set web.image.tag=%s explicitly)." .Chart.AppVersion .Chart.AppVersion) -}}
{{- end -}}
{{- if not .Values.ai.image.tag -}}
{{- fail (printf "ai.image.tag is empty. Chart.yaml appVersion is %q — set ai.image.tag to the same release version (also used by shj3-worker)." .Chart.AppVersion) -}}
{{- end -}}
{{- if ne .Values.web.image.tag .Chart.AppVersion -}}
{{- fail (printf "web.image.tag (%s) does not match Chart.yaml's appVersion (%s). A mismatch here is exactly how a \"deployed the wrong thing\" incident starts (deployment.md §7.1) — align both before helm upgrade." .Values.web.image.tag .Chart.AppVersion) -}}
{{- end -}}
{{- if ne .Values.ai.image.tag .Chart.AppVersion -}}
{{- fail (printf "ai.image.tag (%s) does not match Chart.yaml's appVersion (%s). shj3-worker reuses this same tag, so this one check covers both Deployments." .Values.ai.image.tag .Chart.AppVersion) -}}
{{- end -}}
{{- end -}}

{{/*
ConfigMap-change checksum — forces a rollout when a ConfigMap's rendered
content changes, so a config edit is never sitting unread until an unrelated
deploy happens along (§7.8: "A ConfigMap or Secret change alone does NOT
restart pods... carry checksum/config and checksum/secret annotations").
Fully static/renderable at template time — no cluster needed — because the
ConfigMap's content is something THIS chart defines and can see.
Takes a dict: {context: $, templatePath: "/config/configmap-web.yaml"}.
*/}}
{{- define "shj3.configChecksum" -}}
{{- include (print .context.Template.BasePath .templatePath) .context | sha256sum -}}
{{- end -}}

{{/*
Secret-change checksum — same rollout-forcing purpose as above, but for a
Secret this chart does NOT create (§7.8: secrets are referenced by name,
created out of band). There is nothing in the chart's own render to hash, so
this reads the LIVE secret's data via Helm's `lookup` and hashes that
instead — the documented pattern for exactly this situation (a chart that
consumes, but does not own, a Secret's content).

Honest behaviour with no live cluster: `lookup` returns an empty result
during `helm template`/`helm lint`/`--dry-run` with no cluster connection
(exactly this repo's own current sandboxed state — see tasks/todo.md's Phase
C review) or before the Secret has ever been created out of band. Both cases
fall back to a fixed, constant placeholder string rather than erroring or
producing a value that would vary run-to-run — a template output that
changed on every render with no cluster would make `helm template`'s output
nondeterministic, which `scripts/verify-chart.sh` (§7.8) and `helm diff`
both depend on NOT happening. Against a real cluster with the secret already
applied, this hashes its real, current data — a genuine rotation (§16.5's
`kubectl create secret ... | kubectl apply -f -` followed by this
annotation changing) is what actually forces the rollout `rollout restart`
would otherwise have to do by hand.
Takes a dict: {context: $, namespace: "shj3-production", name: "shj3-web-secrets"}.
*/}}
{{- define "shj3.secretChecksum" -}}
{{- $secret := lookup "v1" "Secret" .namespace .name -}}
{{- if $secret -}}
{{- $secret.data | toYaml | sha256sum -}}
{{- else -}}
{{- "not-yet-created-out-of-band" | sha256sum -}}
{{- end -}}
{{- end -}}
