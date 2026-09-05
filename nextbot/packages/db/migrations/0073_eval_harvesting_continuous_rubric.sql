-- Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-16/17/18, LLD §14.9.3) —
-- eval harvesting from production, continuous runs against the currently-deployed
-- Production version, and rubric/judge grading + regression baselines. Every new
-- column is additive with a default that preserves each pre-existing row's exact
-- prior meaning (`source = 'Authored'`, `gate_mode = 'AbsoluteThreshold'`,
-- `run_kind = 'PrePromotion'`, `regressed = false`).

CREATE TYPE eval_case_source AS ENUM ('Authored', 'HarvestedConversation', 'HarvestedEscalation', 'HarvestedApprovalDenial', 'SkillDerived');
CREATE TYPE eval_gate_mode AS ENUM ('AbsoluteThreshold', 'RegressionBaseline', 'Both');
CREATE TYPE eval_run_kind AS ENUM ('PrePromotion', 'Continuous', 'Manual');

ALTER TABLE eval_suite ADD COLUMN gate_mode eval_gate_mode NOT NULL DEFAULT 'AbsoluteThreshold';
ALTER TABLE eval_suite ADD COLUMN regression_baseline_version_id uuid REFERENCES agent_definition_version (id);

ALTER TABLE eval_case ADD COLUMN rubric jsonb;
ALTER TABLE eval_case ADD COLUMN judge_route_version_id uuid REFERENCES model_route_version (id);
ALTER TABLE eval_case ADD COLUMN source eval_case_source NOT NULL DEFAULT 'Authored';
ALTER TABLE eval_case ADD COLUMN source_ref text;
ALTER TABLE eval_case ADD COLUMN skill_version_id uuid REFERENCES skill_version (id);

ALTER TABLE eval_run ADD COLUMN run_kind eval_run_kind NOT NULL DEFAULT 'PrePromotion';
ALTER TABLE eval_run ADD COLUMN baseline_run_id uuid REFERENCES eval_run (id);
ALTER TABLE eval_run ADD COLUMN regressed boolean NOT NULL DEFAULT false;

ALTER TABLE eval_case_result ADD COLUMN rubric_scores jsonb;
ALTER TABLE eval_case_result ADD COLUMN groundedness_score real;
ALTER TABLE eval_case_result ADD COLUMN citation_precision real;

-- Continuous-run regression comparison (`eval-service.ts#findPriorContinuousRun`)
-- — the most recent prior Continuous run for a (suite, version) pair.
CREATE INDEX eval_run_tenant_suite_version_kind_idx ON eval_run (tenant_id, eval_suite_id, agent_definition_version_id, run_kind);
