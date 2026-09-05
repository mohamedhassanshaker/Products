import type { HandoffNode, HitlNode, LoopNode, ParallelNode, RetrieveNode, SkillNode, StateNode, SubAgentNode } from '@liveavatar/contracts';
import { NODE_TYPES, createDefaultNode, generateBranchId, generateNodeId } from './node-factory';

describe('NODE_TYPES', () => {
  it('includes the Phase 11 parallel/loop, Phase 13 skill, Phase 14 hitl, and Phase 15 subagent/handoff/state node types alongside the Phase 9 six', () => {
    expect(NODE_TYPES).toEqual([
      'llm',
      'tool',
      'retrieve',
      'router',
      'speak',
      'end',
      'parallel',
      'loop',
      'skill',
      'hitl',
      'subagent',
      'handoff',
      'state',
    ]);
  });
});

describe('generateNodeId', () => {
  it('generates the first id for a type with no existing nodes', () => {
    expect(generateNodeId([], 'parallel')).toBe('parallel-1');
    expect(generateNodeId([], 'loop')).toBe('loop-1');
  });

  it('skips ids already used by that type prefix', () => {
    expect(generateNodeId(['parallel-1', 'parallel-2', 'llm-1'], 'parallel')).toBe('parallel-3');
    expect(generateNodeId(['loop-1'], 'loop')).toBe('loop-2');
  });
});

describe('generateBranchId', () => {
  it('generates branch-1 for an empty branch list', () => {
    expect(generateBranchId([])).toBe('branch-1');
  });

  it('skips ids already used within this node\'s own branch list', () => {
    expect(generateBranchId(['branch-1', 'branch-2'])).toBe('branch-3');
  });
});

describe('createDefaultNode', () => {
  it('builds a Parallel node with an empty branch list flagged for the inspector to fill in', () => {
    const node = createDefaultNode('parallel', 'parallel-1') as ParallelNode;
    expect(node.type).toBe('parallel');
    expect(node.branches).toEqual([]);
    expect(node.join_policy).toBe('all');
    expect(node.on_branch_error).toBe('continue_partial');
    expect(node.next_node_id).toBeNull();
    expect(node.on_error).toEqual({ action: 'degrade' });
    expect(node.on_deadline).toEqual({ action: 'degrade' });
    expect(node.name).toBe('Parallel node');
  });

  it('builds a Retrieve node with a schema-valid default budget_ms (Phase 12b)', () => {
    const node = createDefaultNode('retrieve', 'retrieve-1') as RetrieveNode;
    expect(node.type).toBe('retrieve');
    expect(node.source_refs).toEqual([]);
    expect(node.top_k).toBe(5);
    expect(node.budget_ms).toBe(400);
    expect(node.next_node_id).toBeNull();
  });

  it('builds a Loop node with a self-referential body-entry placeholder and mandatory guards', () => {
    const node = createDefaultNode('loop', 'loop-1') as LoopNode;
    expect(node.type).toBe('loop');
    expect(node.body_entry_node_id).toBe('loop-1');
    expect(node.condition).toBe('');
    expect(node.max_iterations).toBe(3);
    expect(node.max_duration_ms).toBe(10000);
    expect(node.max_cost).toBe(30);
    expect(node.next_node_id).toBeNull();
    expect(node.name).toBe('Loop node');
  });

  it('builds a Skill node with a schema-valid default budget_ms and version "latest" (Phase 13)', () => {
    const node = createDefaultNode('skill', 'skill-1') as SkillNode;
    expect(node.type).toBe('skill');
    expect(node.skill_id).toBe('');
    expect(node.version).toBe('latest');
    expect(node.budget_ms).toBe(1500);
    expect(node.next_node_id).toBeNull();
    expect(node.name).toBe('Skill node');
  });

  it('builds a HITL node with a blank gate_id and no budget_ms field (Phase 14, R-H4 unbounded)', () => {
    const node = createDefaultNode('hitl', 'hitl-1') as HitlNode;
    expect(node.type).toBe('hitl');
    expect(node.gate_id).toBe('');
    expect(node.next_node_id).toBeNull();
    expect(node.name).toBe('HITL node');
    expect('budget_ms' in node).toBe(false);
  });

  it('builds a Sub-agent node with a blank target_tenant_id and a schema-valid default budget_ms (Phase 15, BL-058)', () => {
    const node = createDefaultNode('subagent', 'subagent-1') as SubAgentNode;
    expect(node.type).toBe('subagent');
    expect(node.target_tenant_id).toBe('');
    expect(node.handback_policy).toBe('speak_and_return');
    expect(node.budget_ms).toBe(4000);
    expect(node.next_node_id).toBeNull();
    expect(node.name).toBe('Sub-agent node');
  });

  it('builds a Handoff node with blank destination/context_summary and no next_node_id field (Phase 15, BL-059, terminal like End)', () => {
    const node = createDefaultNode('handoff', 'handoff-1') as HandoffNode;
    expect(node.type).toBe('handoff');
    expect(node.destination).toBe('');
    expect(node.context_summary).toBe('');
    expect(node.name).toBe('Handoff node');
    expect('next_node_id' in node).toBe(false);
  });

  it('builds a State node defaulting to write mode with blank variable/value (Phase 15, BL-060)', () => {
    const node = createDefaultNode('state', 'state-1') as StateNode;
    expect(node.type).toBe('state');
    expect(node.mode).toBe('write');
    expect(node.variable).toBe('');
    expect(node.value).toBe('');
    expect(node.next_node_id).toBeNull();
    expect(node.name).toBe('State node');
  });
});
