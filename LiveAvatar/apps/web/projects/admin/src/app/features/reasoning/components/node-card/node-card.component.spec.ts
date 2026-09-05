import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import type { GraphNode, LoopNode } from '@liveavatar/contracts';
import { NodeCardComponent } from './node-card.component';

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

function routerNode(): GraphNode {
  return {
    id: 'router-1',
    type: 'router',
    name: 'Intent router',
    lane: 'foreground',
    on_error: { action: 'degrade' },
    on_deadline: { action: 'degrade' },
    branches: [{ condition: "utterance == 'refund'", next_node_id: 'llm-1' }],
    default_next_node_id: 'llm-1',
  } as GraphNode;
}

function parallelNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'parallel-1',
    type: 'parallel',
    name: 'Fan out',
    lane: 'foreground',
    on_error: { action: 'degrade' },
    on_deadline: { action: 'degrade' },
    branches: [{ id: 'branch-1', entry_node_id: 'llm-1' }],
    join_policy: 'all',
    on_branch_error: 'continue_partial',
    next_node_id: null,
    ...overrides,
  } as GraphNode;
}

function loopNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'loop-1',
    type: 'loop',
    name: 'Retry loop',
    lane: 'foreground',
    on_error: { action: 'degrade' },
    on_deadline: { action: 'degrade' },
    body_entry_node_id: 'llm-1',
    condition: "utterance == 'done'",
    max_iterations: 3,
    max_duration_ms: 10000,
    max_cost: 30,
    next_node_id: null,
    ...overrides,
  } as GraphNode;
}

describe('NodeCardComponent', () => {
  let fixture: ComponentFixture<NodeCardComponent>;
  let component: NodeCardComponent;

  async function setup(node: GraphNode, allNodes: GraphNode[] = [node]) {
    await TestBed.configureTestingModule({ imports: [NodeCardComponent, NoopAnimationsModule] }).compileComponents();
    fixture = TestBed.createComponent(NodeCardComponent);
    component = fixture.componentInstance;
    component.node = node;
    component.allNodes = allNodes;
    fixture.detectChanges();
  }

  it('renders as a listitem with the node name and type', async () => {
    await setup(llmNode());
    const article: HTMLElement = fixture.nativeElement.querySelector('.la-node-card');
    expect(article.textContent).toContain('Answer');
    expect(article.textContent).toContain('LLM');
  });

  it('shows "—" for latency (no real computation exists this phase)', async () => {
    await setup(llmNode());
    expect(fixture.nativeElement.querySelector('.la-node-card__latency').textContent.trim()).toBe('—');
  });

  it('shows "Not run" test status when no test result is provided', async () => {
    await setup(llmNode());
    expect(component.testStatusLabel()).toBe('Not run');
  });

  it('shows Passed/Failed based on the test result status', async () => {
    await setup(llmNode());
    component.testResult = { node_id: 'llm-1', node_type: 'llm', lane: 'foreground', status: 'complete', simulated: true, summary: 'x' };
    fixture.detectChanges();
    expect(component.testStatusLabel()).toBe('Passed');

    component.testResult = { node_id: 'llm-1', node_type: 'llm', lane: 'foreground', status: 'failed', simulated: false, summary: 'x' };
    fixture.detectChanges();
    expect(component.testStatusLabel()).toBe('Failed');
  });

  it('renders Router branches as a nested role="list"/"listitem" structure', async () => {
    const router = routerNode();
    await setup(router, [router, llmNode()]);
    const nested = fixture.nativeElement.querySelector('.la-node-card__branches');
    expect(nested.getAttribute('role')).toBe('list');
    const items = fixture.nativeElement.querySelectorAll('.la-node-card__branch[role="listitem"]');
    // one explicit branch + the always-rendered default row
    expect(items.length).toBe(2);
    expect(nested.textContent).toContain("utterance == 'refund'");
    expect(nested.textContent).toContain('Answer');
  });

  it('emits editNode when the card body is clicked', async () => {
    await setup(llmNode());
    const spy = jest.spyOn(component.editNode, 'emit');
    fixture.nativeElement.querySelector('.la-node-card__main').click();
    expect(spy).toHaveBeenCalled();
  });

  it('emits jumpToNode with the branch target id', async () => {
    const router = routerNode();
    await setup(router, [router, llmNode()]);
    const spy = jest.spyOn(component.jumpToNode, 'emit');
    fixture.nativeElement.querySelector('.la-node-card__branch-target').click();
    expect(spy).toHaveBeenCalledWith('llm-1');
  });

  it('renders a Parallel node\'s branches as a nested role="list" and shows its join policy', async () => {
    const parallel = parallelNode();
    await setup(parallel, [parallel, llmNode()]);
    const article: HTMLElement = fixture.nativeElement.querySelector('.la-node-card');
    expect(article.textContent).toContain('join: all');
    const nested = fixture.nativeElement.querySelector('.la-node-card__branches');
    expect(nested.getAttribute('role')).toBe('list');
    expect(nested.textContent).toContain('branch-1');
    expect(nested.textContent).toContain('Answer');
  });

  it('emits jumpToNode with a Parallel branch\'s entry node id', async () => {
    const parallel = parallelNode();
    await setup(parallel, [parallel, llmNode()]);
    const spy = jest.spyOn(component.jumpToNode, 'emit');
    fixture.nativeElement.querySelector('.la-node-card__branch-target').click();
    expect(spy).toHaveBeenCalledWith('llm-1');
  });

  it('renders a Loop node\'s walked body preview, condition, and guard summary', async () => {
    const loop = loopNode();
    const second = llmNode({ id: 'llm-2', name: 'Follow-up', next_node_id: null });
    const first = llmNode({ id: 'llm-1', name: 'Answer', next_node_id: 'llm-2' });
    await setup(loop, [loop, first, second]);
    const article: HTMLElement = fixture.nativeElement.querySelector('.la-node-card');
    expect(article.textContent).toContain("Stops when");
    expect(article.textContent).toContain("utterance == 'done'");
    expect(article.textContent).toContain('max 3 iterations');
    expect(article.textContent).toContain('10000ms');
    expect(article.textContent).toContain('cost ≤ 30');
    const nested = fixture.nativeElement.querySelector('.la-node-card__branches');
    expect(nested.getAttribute('role')).toBe('list');
    expect(nested.textContent).toContain('Answer');
    expect(nested.textContent).toContain('Follow-up');
  });

  it('walks a Loop body preview bounded to 10 steps and never throws on a dangling reference', async () => {
    const loop = loopNode({ body_entry_node_id: 'missing-node' } as Partial<GraphNode>);
    await setup(loop, [loop]);
    expect(component.loopBodyPreview(loop as LoopNode)).toEqual(['missing-node']);
  });

  function subagentNode(overrides: Partial<GraphNode> = {}): GraphNode {
    return {
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
      ...overrides,
    } as GraphNode;
  }

  function handoffNode(overrides: Partial<GraphNode> = {}): GraphNode {
    return {
      id: 'handoff-1',
      type: 'handoff',
      name: 'Escalate',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      destination: 'billing-queue',
      context_summary: '',
      ...overrides,
    } as GraphNode;
  }

  function stateNode(overrides: Partial<GraphNode> = {}): GraphNode {
    return {
      id: 'state-1',
      type: 'state',
      name: 'Save name',
      lane: 'foreground',
      on_error: { action: 'degrade' },
      on_deadline: { action: 'degrade' },
      mode: 'write',
      variable: 'caller_name',
      value: '$llm-1',
      next_node_id: null,
      ...overrides,
    } as GraphNode;
  }

  it('shows a Sub-agent node\'s target tenant and handback policy in its meta line (Phase 15, BL-058)', async () => {
    await setup(subagentNode());
    const article: HTMLElement = fixture.nativeElement.querySelector('.la-node-card');
    expect(article.textContent).toContain('target: tenant-uuid-1');
    expect(article.textContent).toContain('handback: speak and return');
  });

  it('includes a Sub-agent node\'s next_node_id in nextNodeId()', async () => {
    await setup(subagentNode({ next_node_id: 'llm-1' }), [subagentNode({ next_node_id: 'llm-1' }), llmNode()]);
    expect(component.nextNodeId()).toBe('llm-1');
  });

  it('shows a Handoff node\'s destination in its meta line and has no next_node_id (Phase 15, BL-059)', async () => {
    await setup(handoffNode());
    const article: HTMLElement = fixture.nativeElement.querySelector('.la-node-card');
    expect(article.textContent).toContain('destination: billing-queue');
    expect(component.nextNodeId()).toBeUndefined();
  });

  it('shows a State node\'s variable and mode in its meta line (Phase 15, BL-060)', async () => {
    await setup(stateNode());
    const article: HTMLElement = fixture.nativeElement.querySelector('.la-node-card');
    expect(article.textContent).toContain('caller_name (write)');
  });

  it('includes a State node\'s next_node_id in nextNodeId()', async () => {
    await setup(stateNode({ next_node_id: 'llm-1' }), [stateNode({ next_node_id: 'llm-1' }), llmNode()]);
    expect(component.nextNodeId()).toBe('llm-1');
  });
});
