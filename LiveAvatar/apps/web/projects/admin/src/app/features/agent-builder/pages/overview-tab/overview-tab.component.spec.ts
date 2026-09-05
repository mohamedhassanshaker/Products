import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { OverviewTabComponent } from './overview-tab.component';
import { AgentBuilderStore } from '../../store/agent-builder.store';
import { ReasoningStore } from '../../../reasoning/store/reasoning.store';
import { ToolsStore } from '../../../tools/store/tools.store';
import { SkillsLibraryStore } from '../../../skills/store/skills-library.store';
import { KnowledgeSourcesStore } from '../../../knowledge/store/knowledge-sources.store';
import { HitlGatesStore } from '../../../hitl/store/hitl-gates.store';

const DEFAULT_DYNAMICS = {
  barge_in: { enabled: true, sensitivity: 'medium' as const },
  endpointing_silence_ms: 700,
  verbosity: 'balanced' as const,
  no_input: { timeout_ms: 8000, max_reprompts: 2 },
  call_limits: { max_turn_tokens: 200, max_turn_seconds: 20 },
};

describe('OverviewTabComponent', () => {
  let fixture: ComponentFixture<OverviewTabComponent>;
  let component: OverviewTabComponent;
  let builder: { validateResult: jest.Mock; dynamics: jest.Mock; draft: jest.Mock };
  let reasoning: { reasoning: jest.Mock };
  let tools: { items: jest.Mock; attachedRefs: jest.Mock };
  let skills: { items: jest.Mock };
  let knowledge: { items: jest.Mock };
  let hitl: { items: jest.Mock };

  beforeEach(async () => {
    builder = {
      validateResult: jest.fn(() => ({ valid: true, errors: [], resolved: {}, redacted_yaml: '' })),
      dynamics: jest.fn(() => DEFAULT_DYNAMICS),
      draft: jest.fn(() => ({})),
    };
    reasoning = { reasoning: jest.fn(() => null) };
    tools = { items: jest.fn(() => []), attachedRefs: jest.fn(() => new Set<string>()) };
    skills = { items: jest.fn(() => []) };
    knowledge = { items: jest.fn(() => []) };
    hitl = { items: jest.fn(() => []) };

    await TestBed.configureTestingModule({
      imports: [OverviewTabComponent],
      providers: [
        { provide: AgentBuilderStore, useValue: builder },
        { provide: ReasoningStore, useValue: reasoning },
        { provide: ToolsStore, useValue: tools },
        { provide: SkillsLibraryStore, useValue: skills },
        { provide: KnowledgeSourcesStore, useValue: knowledge },
        { provide: HitlGatesStore, useValue: hitl },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1' }) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OverviewTabComponent);
    component = fixture.componentInstance;
  });

  it('reasoningNodeCount is 0 and entry is null when reasoning() is absent (fresh tenant)', () => {
    fixture.detectChanges();
    expect(component.reasoningNodeCount()).toBe(0);
    expect(component.reasoningEntryNode()).toBeNull();
  });

  it('reasoningNodeCount/reasoningEntryNode reflect the reasoning graph', () => {
    reasoning.reasoning.mockReturnValue({
      graph: [{ id: 'llm-1', type: 'llm', name: 'Answer' }, { id: 'end-1', type: 'end', name: 'End' }],
      entry_node_id: 'llm-1',
    });
    fixture.detectChanges();
    expect(component.reasoningNodeCount()).toBe(2);
    expect(component.reasoningEntryNode()).toBe('Answer');
  });

  it('pipelineRows reflects the shared validate result resolved layers', () => {
    builder.validateResult.mockReturnValue({
      valid: true,
      errors: [],
      resolved: { transport: { provider: 'livekit', hosting: 'self_hosted', has_secret: true, feature_gaps: null } },
      redacted_yaml: '',
    });
    fixture.detectChanges();
    const rows = component.pipelineRows();
    expect(rows.find((r) => r.layer === 'transport')).toMatchObject({ provider: 'livekit' });
    expect(rows.find((r) => r.layer === 'stt')).toMatchObject({ provider: null });
  });

  it('surfaces the consequential-tool-ungated warning from the shared validate result', () => {
    builder.validateResult.mockReturnValue({
      valid: false,
      errors: [{ code: 'CONFIG_CONSEQUENTIAL_TOOL_UNGATED', message: 'x' }],
      resolved: {},
      redacted_yaml: '',
    });
    tools.items.mockReturnValue([{ api_ref: 't1', consequential: true, name: 'refund' }]);
    fixture.detectChanges();
    expect(component.consequentialUngatedCount()).toBe(1);
    expect(component.consequentialToolsCount()).toBe(1);
  });

  it('surfaces the stale-knowledge-source count from KnowledgeSourcesStore', () => {
    knowledge.items.mockReturnValue([
      { id: 'k1', name: 'a', chunk_count: 10, is_stale: true },
      { id: 'k2', name: 'b', chunk_count: 5, is_stale: false },
    ]);
    fixture.detectChanges();
    expect(component.knowledgeSourceCount()).toBe(2);
    expect(component.knowledgeChunkCount()).toBe(15);
    expect(component.staleKnowledgeCount()).toBe(1);
  });

  it('surfaces the HITL-reviewer-coverage-missing count from the shared validate result', () => {
    builder.validateResult.mockReturnValue({
      valid: false,
      errors: [{ code: 'HITL_REVIEWER_COVERAGE_MISSING', message: 'x' }],
      resolved: {},
      redacted_yaml: '',
    });
    hitl.items.mockReturnValue([{ id: 'g1', gate_type: 'blocking' }]);
    fixture.detectChanges();
    expect(component.hitlGateCount()).toBe(1);
    expect(component.hitlUncoveredCount()).toBe(1);
  });

  it('dynamics()/sttLanguage() feed the Behaviour card from the shared AgentBuilderStore', () => {
    builder.draft.mockReturnValue({ stt: { language: 'en-US' } });
    fixture.detectChanges();
    expect(component.dynamics().barge_in.enabled).toBe(true);
    expect(component.sttLanguage()).toBe('en-US');
  });
});
