import { Inject, Injectable } from '@nestjs/common';
import type { TestCallNodeResultDto, TestCallResponseDto } from '@liveavatar/contracts';
import type { GraphNode } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { TOOL_DEFINITION_REPOSITORY, TOOL_INVOKER, type ToolDefinitionRepositoryPort, type ToolInvokerPort } from '../../tools';
import { ValidateConfigUseCase } from './validate-config.use-case';
import { evaluateCondition, GraphConditionError, type TurnState } from '../domain/graph-condition';
import { resolveOnError } from '../domain/graph-edges';

const MAX_STEPS = 50;
/** Simulator-only hard cap on Loop iterations (Phase 11, BL-043) — independent of the real runtime's guards, so a pathological config can't make a "Run test call" click hang the admin's browser tab either. */
const MAX_SIMULATED_LOOP_ITERATIONS = 10;

/** Mutable state threaded through `runChain`/`runNode` — mirrors `TurnContext.turn_state["_last_llm_output"]`'s role in the real Python interpreter, scoped to one `execute()` call. */
interface ChainState {
  lastLlmText: string | null;
}

/**
 * `POST /tenants/:id/config/test-call` (Phase 9, BL-037). Shared "Test
 * call" harness backend — runs entirely in NestJS as a **structural
 * simulation** of the graph, not a live Python execution (see the plan
 * doc's "Decisions made this phase" for why). Built generically enough
 * that Skills (Phase 13) and the Knowledge playground (Phase 12b) can call
 * this same endpoint shape later, per `UX_SCOPE.md`'s shared-Test-call-
 * harness note — nothing here is graph-Reasoning-tab-specific beyond the
 * input being a whole `AgentConfig`.
 */
@Injectable()
export class TestCallGraphUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly toolDefs: ToolDefinitionRepositoryPort,
    @Inject(TOOL_INVOKER) private readonly toolInvoker: ToolInvokerPort,
    private readonly validator: ValidateConfigUseCase,
  ) {}

  async execute(actor: AdminActor, tenantId: string, input: { config: unknown; utterance: string }): Promise<TestCallResponseDto> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }

    const gateA = this.validator.runSchemaGate(input.config ?? {});
    if (!gateA.schemaValid || !gateA.config.reasoning) {
      return { ok: false, final_text: null, nodes: [], errors: gateA.errors };
    }

    const reasoning = gateA.config.reasoning;
    const nodesById = new Map(reasoning.graph.map((n) => [n.id, n]));
    const results: TestCallNodeResultDto[] = [];
    const turnState: TurnState = { utterance: input.utterance };
    const state: ChainState = { lastLlmText: null };

    const lastNodeType = await this.runChain(reasoning.entry_node_id, nodesById, tenantId, turnState, state, results, { steps: 0 });

    let finalText: string | null = null;
    for (const r of results) {
      if (r.node_type === 'speak' && r.status === 'complete') {
        finalText = r.detail ?? r.summary;
      }
    }
    if (finalText === null && lastNodeType !== 'speak' && lastNodeType !== 'end' && state.lastLlmText) {
      // R-G1 default-case semantics (see plan doc point 3): implicit
      // "speak this node's output, then end" when the foreground chain
      // runs out without an explicit Speak/End node.
      finalText = state.lastLlmText;
    }

    return { ok: true, final_text: finalText, nodes: results, errors: [] };
  }

  /**
   * Walks a bounded chain of nodes starting at `startId`, pushing each
   * node's result into the shared `results` sink (flattened — a Parallel
   * branch's or Loop iteration's node results land in the same ordered
   * array the harness already returns, so "Run test call" shows every node
   * that actually ran). Returns the last node type reached (or `null` if
   * none), used only by the top-level caller for R-G1's implicit-speak
   * semantics (a nested branch/iteration reaching a dangling `next_node_id`
   * does **not** trigger implicit speech — only the outermost chain does).
   * Reused by the main walk, each Parallel branch, and each Loop iteration
   * (mirrors the Python interpreter's `walk_chain` extraction, independently
   * implemented per this codebase's existing per-language graph-logic
   * duplication precedent).
   * @param stepBudget - Mutated in place so a Parallel branch/Loop
   *   iteration's steps count against the same overall `MAX_STEPS` cap the
   *   main walk uses, instead of each nested walk getting its own fresh
   *   budget (which would let a deeply nested config bypass the cap).
   */
  private async runChain(
    startId: string | null,
    nodesById: Map<string, GraphNode>,
    tenantId: string,
    turnState: TurnState,
    state: ChainState,
    results: TestCallNodeResultDto[],
    stepBudget: { steps: number },
  ): Promise<GraphNode['type'] | null> {
    let currentId = startId;
    let lastType: GraphNode['type'] | null = null;
    while (currentId && stepBudget.steps < MAX_STEPS) {
      stepBudget.steps++;
      const node = nodesById.get(currentId);
      if (!node) {
        break; // dangling ref — already reported by Gate A structural checks on a real save, not re-validated here.
      }
      lastType = node.type;
      const { result, next } = await this.runNode(node, tenantId, turnState, state, nodesById, stepBudget, results);
      results.push(result);
      if (node.type === 'llm' && result.status === 'complete') {
        state.lastLlmText = result.detail ?? result.summary;
      }
      currentId = next;
    }
    return lastType;
  }

  private async runNode(
    node: GraphNode,
    tenantId: string,
    turnState: TurnState,
    state: ChainState,
    nodesById: Map<string, GraphNode>,
    stepBudget: { steps: number },
    results: TestCallNodeResultDto[],
  ): Promise<{ result: TestCallNodeResultDto; next: string | null }> {
    switch (node.type) {
      case 'llm': {
        const promptChars = 0; // no real prompt assembly in the simulator (no system_prompt/memory threading here)
        return {
          result: {
            node_id: node.id,
            node_type: 'llm',
            lane: node.lane,
            status: 'complete',
            simulated: true,
            summary: `Would call ${node.provider}/${node.model} with a ${promptChars}-char prompt (simulated, no live vendor call).`,
            detail: `[simulated ${node.provider}/${node.model} response to: "${turnState.utterance}"]`,
          },
          next: node.next_node_id,
        };
      }
      case 'tool': {
        const definition = await this.toolDefs.findByApiRef(tenantId, node.api_ref);
        if (!definition) {
          return {
            result: {
              node_id: node.id,
              node_type: 'tool',
              lane: node.lane,
              status: 'failed',
              simulated: false,
              summary: `Unknown tool api_ref '${node.api_ref}'.`,
            },
            // Phase 10 fix (Phase 9 finding #2): a recognized failure takes
            // on_error, never the node's normal next_node_id.
            next: resolveOnError(node),
          };
        }
        const args = this.resolveArgumentMapping(node.argument_mapping, turnState);
        const invoked = await this.toolInvoker.invoke(definition, args);
        return {
          result: {
            node_id: node.id,
            node_type: 'tool',
            lane: node.lane,
            status: invoked.ok ? 'complete' : 'failed',
            simulated: false,
            summary: invoked.ok ? `${definition.name} responded ${invoked.status ?? ''}`.trim() : `${definition.name} call failed.`,
            detail: invoked.body,
          },
          next: invoked.ok ? node.next_node_id : resolveOnError(node),
        };
      }
      case 'retrieve': {
        return {
          result: {
            node_id: node.id,
            node_type: 'retrieve',
            lane: node.lane,
            status: 'complete',
            simulated: true,
            summary: 'Retrieve is a stub in Phase 9 — no chunks returned (real retrieval lands Phase 12b).',
          },
          next: node.next_node_id,
        };
      }
      case 'router': {
        let chosen = node.default_next_node_id;
        let summary = 'No branch matched — took the default.';
        try {
          for (const branch of node.branches) {
            if (evaluateCondition(branch.condition, turnState)) {
              chosen = branch.next_node_id;
              summary = `Branch '${branch.condition}' matched.`;
              break;
            }
          }
        } catch (err) {
          return {
            result: {
              node_id: node.id,
              node_type: 'router',
              lane: node.lane,
              status: 'failed',
              simulated: false,
              summary: err instanceof GraphConditionError ? err.message : 'Router condition evaluation failed.',
            },
            // Phase 10 fix (Phase 9 finding #2): a recognized failure (a
            // malformed condition) takes on_error, never default_next_node_id.
            next: resolveOnError(node),
          };
        }
        return {
          result: { node_id: node.id, node_type: 'router', lane: node.lane, status: 'complete', simulated: false, summary },
          next: chosen,
        };
      }
      case 'speak': {
        const text = node.mode === 'literal' ? (node.text ?? '') : (state.lastLlmText ?? '');
        return {
          result: {
            node_id: node.id,
            node_type: 'speak',
            lane: node.lane,
            status: 'complete',
            simulated: false,
            summary: 'Spoke the final text.',
            detail: text,
          },
          next: node.next_node_id,
        };
      }
      case 'end': {
        return {
          result: { node_id: node.id, node_type: 'end', lane: node.lane, status: 'complete', simulated: false, summary: 'Turn ended.' },
          next: null,
        };
      }
      case 'parallel': {
        // Structural simulator — no real concurrency to demonstrate, so
        // every branch is walked sequentially; each branch's own node
        // results are flattened into the same ordered `nodes[]` array the
        // harness already returns (via `runChain`'s shared `results` sink).
        let anyFailed = false;
        for (const branch of node.branches) {
          const before = results.length;
          await this.runChain(branch.entry_node_id, nodesById, tenantId, turnState, state, results, stepBudget);
          const branchResults = results.slice(before);
          const lastBranchResult = branchResults[branchResults.length - 1];
          if (!lastBranchResult || lastBranchResult.status === 'failed') {
            anyFailed = true;
          }
        }
        const shouldFail = anyFailed && node.join_policy === 'all' && node.on_branch_error === 'fail';
        return {
          result: {
            node_id: node.id,
            node_type: 'parallel',
            lane: node.lane,
            status: shouldFail ? 'failed' : 'complete',
            simulated: true,
            summary: `Simulated ${node.branches.length} branch(es), join_policy '${node.join_policy}'.`,
          },
          next: shouldFail ? resolveOnError(node) : node.next_node_id,
        };
      }
      case 'loop': {
        const cap = Math.min(node.max_iterations, MAX_SIMULATED_LOOP_ITERATIONS);
        let iterations = 0;
        let conditionHeld = false;
        for (; iterations < cap; iterations++) {
          await this.runChain(node.body_entry_node_id, nodesById, tenantId, turnState, state, results, stepBudget);
          try {
            if (evaluateCondition(node.condition, turnState)) {
              conditionHeld = true;
              iterations++;
              break;
            }
          } catch (err) {
            return {
              result: {
                node_id: node.id,
                node_type: 'loop',
                lane: node.lane,
                status: 'failed',
                simulated: false,
                summary: err instanceof GraphConditionError ? err.message : 'Loop condition evaluation failed.',
              },
              next: resolveOnError(node),
            };
          }
        }
        return {
          result: {
            node_id: node.id,
            node_type: 'loop',
            lane: node.lane,
            status: 'complete',
            simulated: true,
            summary: conditionHeld
              ? `Simulated ${iterations} iteration(s) — condition held.`
              : `Simulated ${iterations} iteration(s) — stopped at the simulator's cap (real guard: max_iterations=${node.max_iterations}).`,
          },
          next: node.next_node_id,
        };
      }
      case 'skill': {
        // Structural simulator — mirrors the `retrieve` stub's precedent
        // exactly (Phase 9): the real executor's lazy internal fetch
        // (`GET /internal/skills/{id}/versions/{version}/body`) is agent-
        // facing only, and no live vendor/LLM call happens in this
        // simulator either way, so there is nothing genuine to demonstrate
        // here beyond "this node would trigger."
        return {
          result: {
            node_id: node.id,
            node_type: 'skill',
            lane: node.lane,
            status: 'complete',
            simulated: true,
            summary: `Would trigger skill '${node.skill_id}'@${node.version} (simulated — body not fetched by the test-call harness).`,
          },
          next: node.next_node_id,
        };
      }
      case 'subagent': {
        // Structural simulator — v1 delegation is one bounded LLM turn
        // against the target tenant's persona (no live vendor call in this
        // simulator either way, same as every other node type here).
        return {
          result: {
            node_id: node.id,
            node_type: 'subagent',
            lane: node.lane,
            status: 'complete',
            simulated: true,
            summary: `Would delegate to tenant '${node.target_tenant_id}' (${node.handback_policy}, simulated — no live call).`,
          },
          next: node.next_node_id,
        };
      }
      case 'handoff': {
        return {
          result: {
            node_id: node.id,
            node_type: 'handoff',
            lane: node.lane,
            status: 'complete',
            simulated: true,
            summary: `Would hand off to '${node.destination}' (simulated — no live alert/transfer).`,
          },
          next: null,
        };
      }
      case 'state': {
        return {
          result: {
            node_id: node.id,
            node_type: 'state',
            lane: node.lane,
            status: 'complete',
            simulated: true,
            summary:
              node.mode === 'write'
                ? `Would set session variable '${node.variable}' (simulated).`
                : `Would read session variable '${node.variable}' (simulated).`,
          },
          next: node.next_node_id,
        };
      }
      case 'hitl': {
        // Structural simulator, same "this node would trigger, nothing
        // genuine to demonstrate" precedent as `skill` above — a real
        // blocking gate pauses a live turn on a human decision (R-H4's
        // unbounded wait), which the test-call harness cannot simulate
        // without actually creating a `HitlDecision` and waiting on a
        // reviewer, so it reports the would-be pause instead.
        return {
          result: {
            node_id: node.id,
            node_type: 'hitl',
            lane: node.lane,
            status: 'complete',
            simulated: true,
            summary: `Would pause for human approval via gate '${node.gate_id}' (simulated — no live decision created by the test-call harness).`,
          },
          next: node.next_node_id,
        };
      }
    }
  }

  private resolveArgumentMapping(mapping: Record<string, string>, turnState: TurnState): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mapping)) {
      if (value.startsWith('$')) {
        const field = value.slice(1).replace(/^state\./, '');
        args[key] = turnState[field] ?? null;
      } else {
        args[key] = value;
      }
    }
    return args;
  }
}

