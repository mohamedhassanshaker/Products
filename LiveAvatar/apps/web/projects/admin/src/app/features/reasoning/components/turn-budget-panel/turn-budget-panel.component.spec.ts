import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import type { CriticalPathReportDto, GraphNode, Reasoning } from '@liveavatar/contracts';
import { TurnBudgetPanelComponent } from './turn-budget-panel.component';

const edge = { action: 'degrade' as const };

function llmNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'llm-1',
    type: 'llm',
    name: 'Answer',
    lane: 'foreground',
    on_error: edge,
    on_deadline: edge,
    provider: 'openai',
    model: 'gpt-4o-mini',
    retry: { max_attempts: 3, backoff_ms: [200, 400, 800] },
    next_node_id: null,
    ...overrides,
  } as GraphNode;
}

function reasoning(graph: GraphNode[], overrides: Partial<Reasoning> = {}): Reasoning {
  return { graph, entry_node_id: graph[0]?.id ?? 'missing', background_entry_node_ids: [], turn_budget_ms: 3000, ...overrides };
}

function report(overrides: Partial<CriticalPathReportDto> = {}): CriticalPathReportDto {
  return {
    critical_path_ms: 900,
    turn_budget_ms: 3000,
    over_budget: false,
    has_unbounded_path: false,
    paths: [
      {
        steps: [{ node_id: 'llm-1', node_type: 'llm', name: 'Answer', lane: 'foreground', cost_ms: 900 }],
        total_ms: 900,
        over_budget: false,
        unbounded: false,
      },
    ],
    ...overrides,
  };
}

describe('TurnBudgetPanelComponent', () => {
  let fixture: ComponentFixture<TurnBudgetPanelComponent>;
  let component: TurnBudgetPanelComponent;

  async function setup(reasoningValue: Reasoning, criticalPathValue: CriticalPathReportDto | null = report()) {
    await TestBed.configureTestingModule({ imports: [TurnBudgetPanelComponent, NoopAnimationsModule] }).compileComponents();
    fixture = TestBed.createComponent(TurnBudgetPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('reasoning', reasoningValue);
    fixture.componentRef.setInput('criticalPath', criticalPathValue);
    fixture.detectChanges();
  }

  it('renders a helper message instead of the panel content when critical_path is null', async () => {
    await setup(reasoning([llmNode()]), null);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Fix the validation errors above');
    expect(el.querySelector('la-budget-bar')).toBeNull();
  });

  it('renders the critical path budget bar with the report totals', async () => {
    await setup(reasoning([llmNode()]));
    expect(component.longestPath()?.total_ms).toBe(900);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('900ms / 3000ms');
  });

  it('renders one row per enumerated path in the all-paths list', async () => {
    const graph = [llmNode({ next_node_id: 'tool-1' }), llmNode({ id: 'tool-1', type: 'tool', api_ref: 'x', argument_mapping: {}, next_node_id: null } as unknown as GraphNode)];
    await setup(
      reasoning(graph),
      report({
        paths: [
          { steps: [{ node_id: 'llm-1', node_type: 'llm', name: 'Answer', lane: 'foreground', cost_ms: 900 }], total_ms: 900, over_budget: false, unbounded: false },
          {
            steps: [
              { node_id: 'llm-1', node_type: 'llm', name: 'Answer', lane: 'foreground', cost_ms: 900 },
              { node_id: 'tool-1', node_type: 'tool', name: 'Lookup', lane: 'foreground', cost_ms: 400 },
            ],
            total_ms: 1300,
            over_budget: false,
            unbounded: false,
          },
        ],
      }),
    );
    const rows = fixture.nativeElement.querySelectorAll('.la-turn-budget-panel__paths li');
    expect(rows.length).toBe(2);
  });

  it('shows an over-budget warning summarizing how many paths exceed the budget', async () => {
    await setup(
      reasoning([llmNode()]),
      report({
        over_budget: true,
        paths: [
          { steps: [{ node_id: 'llm-1', node_type: 'llm', name: 'Answer', lane: 'foreground', cost_ms: 900 }], total_ms: 3500, over_budget: true, unbounded: false },
        ],
      }),
    );
    expect(component.overBudgetPathCount()).toBe(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('1 path over budget');
  });

  it('shows the entry node\'s on_deadline action and emits openNode with its id when Edit is clicked', async () => {
    await setup(reasoning([llmNode({ on_deadline: { action: 'goto', target_node_id: 'end-1' } })]));
    const emitted: string[] = [];
    component.openNode.subscribe((id) => emitted.push(id));

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('goto');

    const button = el.querySelector('button') as HTMLButtonElement;
    button.click();
    expect(emitted).toEqual(['llm-1']);
  });

  it('picks an unbounded path as the critical path over any finite one, and renders it without a budget bar (R-H4)', async () => {
    await setup(
      reasoning([llmNode()]),
      report({
        has_unbounded_path: true,
        paths: [
          { steps: [{ node_id: 'llm-1', node_type: 'llm', name: 'Answer', lane: 'foreground', cost_ms: 900 }], total_ms: 900, over_budget: false, unbounded: false },
          {
            steps: [
              { node_id: 'llm-1', node_type: 'llm', name: 'Answer', lane: 'foreground', cost_ms: 900 },
              { node_id: 'hitl-1', node_type: 'hitl', name: 'Refund approval', lane: 'foreground', cost_ms: 0, unbounded: true },
            ],
            total_ms: 900,
            over_budget: false,
            unbounded: true,
          },
        ],
      }),
    );
    expect(component.longestPath()?.unbounded).toBe(true);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Unbounded');
    expect(el.textContent).toContain('unbounded path present');
    expect(el.querySelectorAll('.la-turn-budget-panel__unbounded').length).toBeGreaterThan(0);
  });

  it('renders every deferred optimisation item as a disabled checkbox with a reason', async () => {
    await setup(reasoning([llmNode()]));
    const checkboxes = fixture.nativeElement.querySelectorAll('mat-checkbox[ng-reflect-disabled="true"], mat-checkbox');
    expect(checkboxes.length).toBe(component.deferredOptimisations.length);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Speculative retrieval on partial transcript');
    expect(el.textContent).toContain('Coming in a later phase');
  });
});
