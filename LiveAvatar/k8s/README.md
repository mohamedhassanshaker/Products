# Kubernetes manifests

Staging/production target per HLD §8.2 ("Kubernetes: `web` Deployment (HPA),
`agent` Deployment (session-count-driven replicas), `livekit` StatefulSet or
operator-managed, managed Postgres + Redis, projected Secret volumes").

Deployment model is **SaaS (Multi-Tenant)** with **row-level** tenant
isolation enforced entirely at the application layer (Prisma `tenantGuard`
extension + `TenantScopeGuard`, HLD §4.1) — there is deliberately **no**
per-tenant namespace or per-tenant infrastructure here. All tenants share one
`liveavatar` namespace, one `web` Deployment, one `agent` Deployment, one
Postgres, one Redis. The security boundary this layer *does* own is the
public/internal split: `:8081` must never be reachable from outside the
cluster (NFR-3), enforced here by both a ClusterIP-only Service and a
`NetworkPolicy`, not by convention alone.

Managed Postgres/Redis (RDS/Cloud SQL/ElastiCache/Memorystore or equivalent)
are assumed, per HLD §8.2 — this directory does not include StatefulSets for
them. If you genuinely need in-cluster Postgres/Redis, adapt
`docker-compose.yml`'s service definitions rather than starting from
scratch, and add PodDisruptionBudgets/backups yourself; that is a bigger
operational commitment than this repo's own deploy scope covers.

## Apply order

```
kubectl apply -f namespace.yaml
kubectl apply -f serviceaccount.yaml
kubectl apply -f configmap-web.yaml -f configmap-agent.yaml
kubectl apply -f secret-web.yaml -f secret-agent.yaml   # after filling in real refs — see below
kubectl apply -f livekit.yaml
kubectl apply -f migrate-job.yaml && kubectl wait --for=condition=complete job/liveavatar-migrate -n liveavatar --timeout=300s
kubectl apply -f web-deployment.yaml -f web-service.yaml -f web-hpa.yaml -f web-ingress.yaml
kubectl apply -f agent-deployment.yaml
kubectl apply -f networkpolicy.yaml
```

## Secrets

`secret-web.yaml` / `secret-agent.yaml` ship as **placeholders** —
`stringData` values read `REPLACE_ME_...`. This repo does not name a
specific secret-management tool (Vault, sealed-secrets, cloud KMS) because
neither the HLD nor the ADR picks one; **this is an open question for the
orchestrator/user before a real production deploy** (see
`docs/deployment/DEPLOYMENT.md`'s "Open questions" section). Until then,
replace the placeholders with real values via whatever mechanism your
cluster already uses (`kubectl create secret` from a local file/CI secret
store, a SealedSecret, an ExternalSecret pointing at Vault/AWS Secrets
Manager/etc.) — never commit real values into these YAML files.

Per-provider vendor credentials (`ProviderCredential.credential_ref`) are
**not** Kubernetes Secret env vars — they are files under `SECRETS_DIR`,
projected from a Secret volume (`secret-provider-credentials.yaml`), one key
per `credential_ref` (LLD §5.3). Populate that Secret's keys to match the
`credential_ref` values tenants actually reference in their published Agent
Builder config.
