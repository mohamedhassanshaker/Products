import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import type { GraphNode } from '@liveavatar/contracts';
import { NodeInspectorComponent, type NodeInspectorData } from './node-inspector.component';

function llmNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'llm-1',
    type: 'llm',
    name: 'Answer',
    lane: 'foreground',
    on_error: { action: 'degrade' },
    on_deadline: { action: 'degrade' },
    provider: 'openai',
    model: 'gpt-4o-mini',
    retry: { max_attempts: 3, backoff_ms: [200, 400, 800] },
    next_node_id: null,
    ...overrides,
  } as GraphNode;
}

function retrieveNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'retrieve-1',
    type: 'retrieve',
    name: 'Search',
    lane: 'foreground',
    on_error: { action: 'degrade' },
    on_deadline: { action: 'degrade' },
    source_refs: ['src-1'],
    top_k: 5,
    budget_ms: 400,
    next_node_id: null,
    ...overrides,
  } as GraphNode;
}

function endNode(): GraphNode {
  return {
    id: 'end-1',
    type: 'end',
    name: 'End',
    lane: 'foreground',
    on_error: { action: 'end_turn' },
    on_deadline: { action: 'end_turn' },
  } as GraphNode;
}

describe('NodeInspectorComponent', () => {
  let fixture: ComponentFixture<NodeInspectorComponent>;
  let component: NodeInspectorComponent;
  let dialogRef: { close: jest.Mock };

  async function setup(
    data: Omit<NodeInspectorData, 'skills' | 'gates' | 'tenants'> & {
      skills?: NodeInspectorData['skills'];
      gates?: NodeInspectorData['gates'];
      tenants?: NodeInspectorData['tenants'];
    },
  ) {
    dialogRef = { close: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [NodeInspectorComponent, NoopAnimationsModule],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { skills: [], gates: [], tenants: [], ...data } satisfies NodeInspectorData },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NodeInspectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('seeds LLM fields from the node and requires provider + model to save', async () => {
    await setup({ node: llmNode(), otherNodes: [endNode()], definitions: [], credentials: [], tools: [] });
    expect(component.llmProvider()).toBe('openai');
    expect(component.llmModel()).toBe('gpt-4o-mini');
    expect(component.canSave()).toBe(true);

    component.llmModel.set('');
    expect(component.canSave()).toBe(false);
  });

  it('requires an on_error target when the action is "goto"', async () => {
    await setup({ node: llmNode(), otherNodes: [endNode()], definitions: [], credentials: [], tools: [] });
    expect(component.canSave()).toBe(true);
    component.onErrorAction.set('goto');
    expect(component.canSave()).toBe(false);
    component.onErrorTarget.set('end-1');
    expect(component.canSave()).toBe(true);
  });

  it('onSave closes the dialog with the rebuilt LLM node', async () => {
    await setup({ node: llmNode(), otherNodes: [endNode()], definitions: [], credentials: [], tools: [] });
    component.name.set('Renamed answer');
    component.llmModel.set('gpt-4o');
    component.onSave();
    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'llm-1', type: 'llm', name: 'Renamed answer', model: 'gpt-4o', provider: 'openai' }),
    );
  });

  it('seeds Retrieve fields from the node, including budget_ms (Phase 12b), and rebuilds it on save', async () => {
    await setup({ node: retrieveNode(), otherNodes: [endNode()], definitions: [], credentials: [], tools: [] });
    expect(component.retrieveSourceRefs()).toBe('src-1');
    expect(component.retrieveTopK()).toBe(5);
    expect(component.retrieveBudgetMs()).toBe(400);

    component.retrieveBudgetMs.set(250);
    component.onSave();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'retrieve-1', type: 'retrieve', source_refs: ['src-1'], top_k: 5, budget_ms: 250 }),
    );
  });

  it('defaults a brand-new Retrieve node\'s budget_ms to 400, the schema default, when none is seeded', async () => {
    const retrieveWithoutBudget = {
      id: 'retrieve-1',
      type: 'retrieve',
      name: 'Search',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      source_refs: [],
      top_k: 5,
      next_node_id: null,
    } as unknown as GraphNode;
    await setup({ node: retrieveWithoutBudget, otherNodes: [], definitions: [], credentials: [], tools: [] });
    expect(component.retrieveBudgetMs()).toBe(400);
  });

  it('seeds Skill fields from the node (Phase 13) and rebuilds it on save', async () => {
    const skill = {
      id: 'skill-1',
      type: 'skill',
      name: 'Refunds',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      skill_id: 'skill-uuid-1',
      version: 1,
      budget_ms: 1500,
      next_node_id: null,
    } as unknown as GraphNode;
    await setup({
      node: skill,
      otherNodes: [endNode()],
      definitions: [],
      credentials: [],
      tools: [],
      skills: [{ id: 'skill-uuid-1', tenant_id: 't-1', name: 'Refunds', slug: 'refunds', draft_version: null, published_version: { id: 'v1', version_number: 2, status: 'published', name: 'Refunds', description: 'x', instructions: 'y', trigger_mode: 'model', tools: [], knowledge_filters: { source_refs: [] }, budget_ms: 1500, hitl_gate_id: null, environments: [], published_at: null, created_by: null, created_at: '' }, used_by_agent_count: 0, created_at: '', updated_at: '' }],
    });

    expect(component.skillId()).toBe('skill-uuid-1');
    expect(component.skillVersion()).toBe('1');
    expect(component.skillBudgetMs()).toBe(1500);
    expect(component.publishedVersionNumberFor('skill-uuid-1')).toBe(2);

    component.skillVersion.set('latest');
    component.skillBudgetMs.set(2000);
    component.onSave();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'skill-1', type: 'skill', skill_id: 'skill-uuid-1', version: 'latest', budget_ms: 2000 }),
    );
  });

  it('a brand-new Skill node cannot be saved until a skill is selected', async () => {
    const skill = {
      id: 'skill-1',
      type: 'skill',
      name: 'Skill node',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      skill_id: '',
      version: 'latest',
      budget_ms: 1500,
      next_node_id: null,
    } as unknown as GraphNode;
    await setup({ node: skill, otherNodes: [], definitions: [], credentials: [], tools: [], skills: [] });
    expect(component.canSave()).toBe(false);

    component.skillId.set('skill-uuid-1');
    expect(component.canSave()).toBe(true);
  });

  it('seeds HITL fields from the node (Phase 14) and rebuilds it on save', async () => {
    const hitl = {
      id: 'hitl-1',
      type: 'hitl',
      name: 'Refund approval',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      gate_id: 'gate-uuid-1',
      next_node_id: null,
    } as unknown as GraphNode;
    await setup({
      node: hitl,
      otherNodes: [endNode()],
      definitions: [],
      credentials: [],
      tools: [],
      gates: [
        {
          id: 'gate-uuid-1',
          tenant_id: 't-1',
          attachment_kind: 'tool',
          attachment_ref: 'issue_refund',
          trigger_condition: {},
          gate_type: 'blocking',
          reviewer_group_id: 'group-1',
          sla_seconds: 45,
          hold_treatment_text: 'Let me get that approved.',
          timeout_behavior: 'defer_to_async',
          escalate_to_group_id: null,
          auto_approve_ack_text: null,
          notify_channels: ['in_app'],
          environments: ['dev', 'staging', 'production'],
          status: 'active',
          created_at: '',
          updated_at: '',
        },
      ],
    });

    expect(component.hitlGateId()).toBe('gate-uuid-1');
    expect(component.canSave()).toBe(true);

    component.hitlNextNodeId.set('end-1');
    component.onSave();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'hitl-1', type: 'hitl', gate_id: 'gate-uuid-1', next_node_id: 'end-1' }),
    );
  });

  it('a brand-new HITL node cannot be saved until a gate is selected', async () => {
    const hitl = {
      id: 'hitl-1',
      type: 'hitl',
      name: 'HITL node',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      gate_id: '',
      next_node_id: null,
    } as unknown as GraphNode;
    await setup({ node: hitl, otherNodes: [], definitions: [], credentials: [], tools: [], gates: [] });
    expect(component.canSave()).toBe(false);

    component.hitlGateId.set('gate-uuid-1');
    expect(component.canSave()).toBe(true);
  });

  it('onCancel closes the dialog with undefined', async () => {
    await setup({ node: llmNode(), otherNodes: [], definitions: [], credentials: [], tools: [] });
    component.onCancel();
    expect(dialogRef.close).toHaveBeenCalledWith(undefined);
  });

  it('an End node has no extra required fields and always canSave (edges default valid)', async () => {
    await setup({ node: endNode(), otherNodes: [llmNode()], definitions: [], credentials: [], tools: [] });
    expect(component.canSave()).toBe(true);
  });

  it('Router requires at least one complete branch and a default target', async () => {
    const router = {
      id: 'router-1',
      type: 'router',
      name: 'Router',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      branches: [],
      default_next_node_id: 'llm-1',
    } as unknown as GraphNode;
    await setup({ node: router, otherNodes: [llmNode(), endNode()], definitions: [], credentials: [], tools: [] });
    expect(component.canSave()).toBe(false);

    component.addBranch();
    expect(component.canSave()).toBe(false);
    component.updateBranchCondition(0, "utterance == 'refund'");
    component.updateBranchTarget(0, 'llm-1');
    expect(component.canSave()).toBe(true);

    component.removeBranch(0);
    expect(component.branches()).toHaveLength(0);
  });

  it('Speak in literal mode requires text; llm_output mode does not', async () => {
    const speak = {
      id: 'speak-1',
      type: 'speak',
      name: 'Speak',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      mode: 'literal',
      interruptible: true,
      next_node_id: null,
    } as unknown as GraphNode;
    await setup({ node: speak, otherNodes: [endNode()], definitions: [], credentials: [], tools: [] });
    expect(component.canSave()).toBe(false);
    component.speakText.set('Let me check that.');
    expect(component.canSave()).toBe(true);
    component.speakMode.set('llm_output');
    component.speakText.set('');
    expect(component.canSave()).toBe(true);
  });

  function parallelNode(overrides: Partial<GraphNode> = {}): GraphNode {
    return {
      id: 'parallel-1',
      type: 'parallel',
      name: 'Fan out',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      branches: [],
      join_policy: 'all',
      on_branch_error: 'continue_partial',
      next_node_id: null,
      ...overrides,
    } as unknown as GraphNode;
  }

  function loopNode(overrides: Partial<GraphNode> = {}): GraphNode {
    return {
      id: 'loop-1',
      type: 'loop',
      name: 'Retry loop',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      body_entry_node_id: 'loop-1',
      condition: '',
      max_iterations: 3,
      max_duration_ms: 10000,
      max_cost: 30,
      next_node_id: null,
      ...overrides,
    } as unknown as GraphNode;
  }

  it('Parallel requires at least one branch with a target; empty branches blocks save', async () => {
    await setup({ node: parallelNode(), otherNodes: [llmNode(), endNode()], definitions: [], credentials: [], tools: [] });
    expect(component.canSave()).toBe(false);

    component.addParallelBranch();
    expect(component.canSave()).toBe(false);
    expect(component.parallelBranches()[0].id).toBe('branch-1');

    component.updateParallelBranchEntry(0, 'llm-1');
    expect(component.canSave()).toBe(true);

    component.removeParallelBranch(0);
    expect(component.parallelBranches()).toHaveLength(0);
    expect(component.canSave()).toBe(false);
  });

  it('Parallel with join_policy quorum requires a valid quorum_n (1..branch count)', async () => {
    await setup({ node: parallelNode(), otherNodes: [llmNode(), endNode()], definitions: [], credentials: [], tools: [] });
    component.addParallelBranch();
    component.updateParallelBranchEntry(0, 'llm-1');
    component.joinPolicy.set('quorum');
    expect(component.canSave()).toBe(false); // no quorum_n yet

    component.quorumN.set(0);
    expect(component.canSave()).toBe(false); // below range

    component.quorumN.set(2);
    expect(component.canSave()).toBe(false); // above branch count (1)

    component.quorumN.set(1);
    expect(component.canSave()).toBe(true);
  });

  it('Parallel onSave produces a correctly-shaped ParallelNode', async () => {
    await setup({ node: parallelNode(), otherNodes: [llmNode(), endNode()], definitions: [], credentials: [], tools: [] });
    component.addParallelBranch();
    component.updateParallelBranchEntry(0, 'llm-1');
    component.updateParallelBranchBudget(0, 500);
    component.joinPolicy.set('first_success');
    component.onBranchError.set('fail');
    component.parallelNextNodeId.set('end-1');
    component.onSave();
    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'parallel-1',
        type: 'parallel',
        branches: [{ id: 'branch-1', entry_node_id: 'llm-1', budget_ms: 500 }],
        join_policy: 'first_success',
        on_branch_error: 'fail',
        next_node_id: 'end-1',
      }),
    );
  });

  it('never offers best_of as a join_policy option', async () => {
    await setup({ node: parallelNode(), otherNodes: [llmNode()], definitions: [], credentials: [], tools: [] });
    const html = fixture.nativeElement.innerHTML as string;
    expect(html).not.toContain('best_of');
  });

  it('Loop blocks save on an empty condition or a non-positive guard', async () => {
    const loop = loopNode({ body_entry_node_id: 'llm-1' });
    await setup({ node: loop, otherNodes: [llmNode(), endNode()], definitions: [], credentials: [], tools: [] });
    expect(component.canSave()).toBe(false); // condition empty

    component.loopCondition.set("utterance == 'done'");
    expect(component.canSave()).toBe(true);

    component.loopMaxIterations.set(0);
    expect(component.canSave()).toBe(false);
    component.loopMaxIterations.set(3);

    component.loopMaxDurationMs.set(-1);
    expect(component.canSave()).toBe(false);
    component.loopMaxDurationMs.set(10000);

    component.loopMaxCost.set(-1);
    expect(component.canSave()).toBe(false);
    component.loopMaxCost.set(0);
    expect(component.canSave()).toBe(true);
  });

  it('Loop onSave produces a correctly-shaped LoopNode', async () => {
    const loop = loopNode({ body_entry_node_id: 'llm-1', condition: "utterance == 'done'" });
    await setup({ node: loop, otherNodes: [llmNode(), endNode()], definitions: [], credentials: [], tools: [] });
    component.loopNextNodeId.set('end-1');
    component.onSave();
    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'loop-1',
        type: 'loop',
        body_entry_node_id: 'llm-1',
        condition: "utterance == 'done'",
        max_iterations: 3,
        max_duration_ms: 10000,
        max_cost: 30,
        next_node_id: 'end-1',
      }),
    );
  });

  it('seeds Sub-agent fields from the node (Phase 15, BL-058) and rebuilds it on save', async () => {
    const subagent = {
      id: 'subagent-1',
      type: 'subagent',
      name: 'Delegate to billing',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      target_tenant_id: 'tenant-uuid-1',
      handback_policy: 'speak_and_return',
      budget_ms: 4000,
      next_node_id: null,
    } as unknown as GraphNode;
    await setup({
      node: subagent,
      otherNodes: [endNode()],
      definitions: [],
      credentials: [],
      tools: [],
      tenants: [{ id: 'tenant-uuid-1', name: 'Billing Co', slug: 'billing-co', status: 'active', provider_stack_summary: '', updated_at: '' }],
    });

    expect(component.subagentTargetTenantId()).toBe('tenant-uuid-1');
    expect(component.subagentHandbackPolicy()).toBe('speak_and_return');
    expect(component.subagentBudgetMs()).toBe(4000);
    expect(component.canSave()).toBe(true);

    component.subagentHandbackPolicy.set('silent_return');
    component.subagentBudgetMs.set(2000);
    component.subagentNextNodeId.set('end-1');
    component.onSave();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'subagent-1',
        type: 'subagent',
        target_tenant_id: 'tenant-uuid-1',
        handback_policy: 'silent_return',
        budget_ms: 2000,
        next_node_id: 'end-1',
      }),
    );
  });

  it('a brand-new Sub-agent node cannot be saved until a target tenant is selected', async () => {
    const subagent = {
      id: 'subagent-1',
      type: 'subagent',
      name: 'Sub-agent node',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      target_tenant_id: '',
      handback_policy: 'speak_and_return',
      budget_ms: 4000,
      next_node_id: null,
    } as unknown as GraphNode;
    await setup({ node: subagent, otherNodes: [], definitions: [], credentials: [], tools: [], tenants: [] });
    expect(component.canSave()).toBe(false);

    component.subagentTargetTenantId.set('tenant-uuid-1');
    expect(component.canSave()).toBe(true);

    component.subagentBudgetMs.set(0);
    expect(component.canSave()).toBe(false);
  });

  it('Handoff requires a destination, has no next-node field, and is terminal like End', async () => {
    const handoff = {
      id: 'handoff-1',
      type: 'handoff',
      name: 'Escalate',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      destination: '',
      context_summary: '',
    } as unknown as GraphNode;
    await setup({ node: handoff, otherNodes: [endNode()], definitions: [], credentials: [], tools: [] });
    expect(component.canSave()).toBe(false);

    component.handoffDestination.set('billing-queue');
    component.handoffContextSummary.set('Caller disputes a charge.');
    expect(component.canSave()).toBe(true);
    component.onSave();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'handoff-1', type: 'handoff', destination: 'billing-queue', context_summary: 'Caller disputes a charge.' }),
    );
    expect(dialogRef.close).not.toHaveBeenCalledWith(expect.objectContaining({ next_node_id: expect.anything() }));
  });

  it('State requires a variable, and a value only in write mode', async () => {
    const state = {
      id: 'state-1',
      type: 'state',
      name: 'Save name',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      mode: 'write',
      variable: '',
      value: '',
      next_node_id: null,
    } as unknown as GraphNode;
    await setup({ node: state, otherNodes: [endNode()], definitions: [], credentials: [], tools: [] });
    expect(component.canSave()).toBe(false);

    component.stateVariable.set('caller_name');
    expect(component.canSave()).toBe(false); // write mode still needs a value

    component.stateValue.set('$llm-1');
    expect(component.canSave()).toBe(true);

    component.stateMode.set('read');
    component.stateValue.set('');
    expect(component.canSave()).toBe(true); // read mode never needs a value
  });

  it('State onSave omits value in read mode and includes it in write mode', async () => {
    const state = {
      id: 'state-1',
      type: 'state',
      name: 'State node',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      mode: 'write',
      variable: 'caller_name',
      value: 'Alex',
      next_node_id: null,
    } as unknown as GraphNode;
    await setup({ node: state, otherNodes: [endNode()], definitions: [], credentials: [], tools: [] });

    component.stateMode.set('read');
    component.onSave();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ mode: 'read', variable: 'caller_name', value: undefined }));
  });

  it('Tool requires an api_ref and valid argument-mapping JSON', async () => {
    const tool = {
      id: 'tool-1',
      type: 'tool',
      name: 'Lookup',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      api_ref: '',
      argument_mapping: {},
      next_node_id: null,
    } as unknown as GraphNode;
    await setup({ node: tool, otherNodes: [endNode()], definitions: [], credentials: [], tools: [] });
    expect(component.canSave()).toBe(false);
    component.toolApiRef.set('lookup_order');
    expect(component.canSave()).toBe(true);
    component.onToolArgumentMappingChange('{not valid json');
    expect(component.canSave()).toBe(false);
  });
});
