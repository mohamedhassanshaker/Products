-- BE2 fix (QA 2026-08-15 backend pass, significant): defense-in-depth DB-level
-- enforcement of the LLD's own SUM(traffic_split_pct) = 100 invariant for active
-- deployments per (tenant_id, agent_definition_id, environment). The primary fix for
-- the check-then-act promotion race that produced duplicate active Production
-- deployments is the optimistic-concurrency guard added to
-- `updateAgentDefinitionVersionStatus` (agent-definition-repository.ts) — this trigger
-- is the backstop so a bug anywhere else in this codebase (a future bulk update, a
-- different code path than promote-version-service.ts) can never silently violate the
-- invariant either.
CREATE OR REPLACE FUNCTION enforce_deployment_traffic_split_invariant() RETURNS trigger AS $$
DECLARE
  total_pct integer;
BEGIN
  IF NEW.is_active THEN
    SELECT COALESCE(SUM(traffic_split_pct), 0) INTO total_pct
    FROM deployment
    WHERE tenant_id = NEW.tenant_id
      AND agent_definition_id = NEW.agent_definition_id
      AND environment = NEW.environment
      AND is_active = true
      AND id <> NEW.id;

    total_pct := total_pct + NEW.traffic_split_pct;

    IF total_pct > 100 THEN
      RAISE EXCEPTION 'deployment traffic_split_pct invariant violated: active rows for tenant %, agent %, environment % would sum to % (> 100)',
        NEW.tenant_id, NEW.agent_definition_id, NEW.environment, total_pct
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deployment_traffic_split_guard ON deployment;
CREATE TRIGGER deployment_traffic_split_guard
  AFTER INSERT OR UPDATE ON deployment
  FOR EACH ROW
  EXECUTE FUNCTION enforce_deployment_traffic_split_invariant();
