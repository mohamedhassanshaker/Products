import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Value } from '@sinclair/typebox/value';
import { AgentConfigSchema, type Reasoning } from '@liveavatar/contracts';
import { validateGraphRules } from './graph-rules';
import { validateGraphStructure } from './graph-structure';

/**
 * The CI cross-language contract test (ADR-001 §1/§7, LLD §6.3), TypeScript
 * half. Runs the exact same fixture corpus
 * (`apps/agent/fixtures/agent-config/{valid,invalid}`) the Python side's
 * `apps/agent/tests/contracts/test_agent_config_contract.py` runs, through
 * the canonical TypeBox `AgentConfigSchema`. Divergence between the two
 * validators on any fixture is exactly the drift risk ADR-001 names as "the
 * single most important test in the repo" — this file (plus its Python
 * sibling) is that test. Both files must be kept in the same fixture
 * directory and updated together.
 */
const FIXTURES_DIR = join(__dirname, '..', '..', '..', '..', '..', 'agent', 'fixtures', 'agent-config');

function fixtureFiles(subdir: 'valid' | 'invalid'): string[] {
  const dir = join(FIXTURES_DIR, subdir);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => join(dir, f));
}

function loadYaml(path: string): unknown {
  return parseYaml(readFileSync(path, 'utf-8'));
}

/**
 * `Value.Check(AgentConfigSchema, ...)` plus the cross-field rules
 * `schema.ts`'s own docstring documents as living in the *validator*, not
 * the schema (`backoff_ms.length === max_attempts` per `llm`-type graph
 * node, `rag.index_ref` required when `rag.enabled`, and — Phase 9,
 * BL-035 — `reasoning.graph`'s referential integrity via
 * `validateGraphStructure`, plus — Phase 11, BL-042/043 — V-2/V-4 via
 * `validateGraphRules`) — `ValidateConfigUseCase.runSchemaGate` applies
 * the identical checks in production. The Pydantic mirror enforces all
 * of these as `@model_validator`s directly on the model, so this helper is
 * what makes the two sides comparable on a fixture-by-fixture basis
 * despite that structural difference.
 */
function acceptsAgentConfig(value: unknown): boolean {
  if (!Value.Check(AgentConfigSchema, value)) {
    return false;
  }
  const v = value as {
    reasoning?: Reasoning;
    knowledge?: {
      pipeline?: {
        rewrite?: { budget_ms?: number };
        hybrid_search?: { budget_ms?: number };
        metadata_filter?: { budget_ms?: number };
        threshold?: { budget_ms?: number };
        inject?: { budget_ms?: number };
      };
    };
  };
  for (const node of v.reasoning?.graph ?? []) {
    if (node.type === 'llm' && node.retry.backoff_ms.length !== node.retry.max_attempts) {
      return false;
    }
  }
  if (validateGraphStructure(v.reasoning).length > 0) {
    return false;
  }
  // Phase 12b (BL-045/047): V-10 (retrieval stage budgets) joins V-2/V-4 here.
  if (validateGraphRules(v.reasoning, v.knowledge?.pipeline).length > 0) {
    return false;
  }
  return true;
}

describe('agent-config cross-language contract (shared fixture corpus)', () => {
  const validFiles = fixtureFiles('valid');
  const invalidFiles = fixtureFiles('invalid');

  it('has a non-empty fixture corpus (guards against a vacuously-passing suite)', () => {
    expect(validFiles.length).toBeGreaterThanOrEqual(3);
    expect(invalidFiles.length).toBeGreaterThanOrEqual(5);
  });

  it.each(validFiles.map((f) => [f] as const))('accepts valid fixture %s', (path) => {
    expect(acceptsAgentConfig(loadYaml(path))).toBe(true);
  });

  it.each(invalidFiles.map((f) => [f] as const))('rejects invalid fixture %s', (path) => {
    expect(acceptsAgentConfig(loadYaml(path))).toBe(false);
  });
});
