import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { SessionDetailPageComponent } from './session-detail-page.component';
import { SessionLogsService } from '../../services/session-logs.service';

function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    tenant_id: 't1',
    tenant_slug: 'acme',
    started_at: '2026-01-01T00:00:00.000Z',
    duration_ms: 60000,
    status: 'ended',
    provider_stack: { transport: 'livekit', stt: null, llm: null, llm_fallback: null, tts: null, avatar: null },
    error_code: null,
    transcript_purged: false,
    room_name: 'acme_s1',
    participant_identities: ['user_s1', 'agent_s1'],
    recording_present: false,
    residency_snapshot: { send_to_remote_llm: 'prompt_text_only', retain_transcripts_days: 90, recordings_enabled: false },
    summary_status: 'ready',
    ...overrides,
  };
}

describe('SessionDetailPageComponent (Screen 5 detail, FR-SESS-2/3)', () => {
  let fixture: ComponentFixture<SessionDetailPageComponent>;
  let sessionLogs: { detail: jest.Mock; transcript: jest.Mock; hops: jest.Mock };
  let router: { navigate: jest.Mock };

  function setup(
    detailResult: unknown = of(makeDetail()),
    transcriptResult: unknown = of({ items: [{ seq: 0, role: 'user', text: 'hi', started_at: '2026-01-01T00:00:00.000Z', ended_at: null }] }),
    hopsResult: unknown = of({ cycles: [{ utterance_seq: 0, stt: { total_ms: 120 } }] }),
  ) {
    sessionLogs = { detail: jest.fn().mockReturnValue(detailResult), transcript: jest.fn().mockReturnValue(transcriptResult), hops: jest.fn().mockReturnValue(hopsResult) };
    router = { navigate: jest.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      imports: [SessionDetailPageComponent, NoopAnimationsModule],
      providers: [
        { provide: SessionLogsService, useValue: sessionLogs },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 's1' }) } } },
      ],
    });
    fixture = TestBed.createComponent(SessionDetailPageComponent);
    fixture.detectChanges();
  }

  it('fetches session, transcript, and hops independently on init', () => {
    setup();
    expect(sessionLogs.detail).toHaveBeenCalledWith('s1');
    expect(sessionLogs.transcript).toHaveBeenCalledWith('s1');
    expect(sessionLogs.hops).toHaveBeenCalledWith('s1');
  });

  it('renders header metadata, transcript, and latency once loaded', () => {
    setup();
    expect(fixture.nativeElement.textContent).toContain('acme_s1');
    expect(fixture.nativeElement.textContent).toContain('user_s1, agent_s1');
    expect(fixture.nativeElement.textContent).toContain('hi');
    expect(fixture.nativeElement.textContent).toContain('120ms');
  });

  it('shows the full-page 404 empty-state for SESSION_NOT_FOUND (identical for missing/cross-tenant)', () => {
    setup(throwError(() => ({ code: 'SESSION_NOT_FOUND', message: 'Session not found.', status: 404 })));
    expect(fixture.nativeElement.textContent).toContain('Session not found.');
  });

  it('shows the transcript-purged state distinctly, without blocking the other panels', () => {
    setup(of(makeDetail()), throwError(() => ({ status: 410, code: 'TRANSCRIPT_PURGED', message: 'Transcript was deleted per the retention policy.' })));
    expect(fixture.nativeElement.textContent).toContain('Transcript was deleted per the retention policy.');
    expect(fixture.nativeElement.textContent).toContain('acme_s1');
  });

  it('shows "no transcript recorded" for a genuinely empty, non-purged transcript', () => {
    setup(of(makeDetail()), of({ items: [] }));
    expect(fixture.nativeElement.textContent).toContain('No transcript was recorded for this session.');
  });

  it('shows "no utterance cycles recorded" when hops is empty', () => {
    setup(of(makeDetail()), undefined, of({ cycles: [] }));
    expect(fixture.nativeElement.textContent).toContain('No utterance cycles recorded for this session.');
  });

  it('renders em-dash (not 0) for a hop the API omitted from a cycle', () => {
    setup(of(makeDetail()), undefined, of({ cycles: [{ utterance_seq: 0, stt: { total_ms: 120 } }] }));
    const component = fixture.componentInstance;
    expect(component.hopCell({ utterance_seq: 0, stt: { total_ms: 120 } }, 'llm')).toBe('—');
    expect(component.hopCell({ utterance_seq: 0, stt: { total_ms: 120 } }, 'stt')).toBe('120ms');
  });

  it('navigates back to the sessions list', () => {
    setup();
    fixture.componentInstance.backToSessions();
    expect(router.navigate).toHaveBeenCalledWith(['/sessions']);
  });

  it('renders a node trace section grouped by cycle when hops carry node executions (BL-039)', () => {
    setup(
      of(makeDetail()),
      undefined,
      of({
        cycles: [
          {
            utterance_seq: 0,
            stt: { total_ms: 120 },
            nodes: [
              { node_id: 'llm-1', node_type: 'llm', lane: 'foreground', total_ms: 400, provider_key: 'openai' },
              { node_id: 'end-1', node_type: 'end', lane: 'foreground' },
            ],
          },
        ],
      }),
    );
    expect(fixture.nativeElement.textContent).toContain('Node trace');
    expect(fixture.nativeElement.textContent).toContain('llm-1');
    expect(fixture.nativeElement.textContent).toContain('400ms');
    expect(fixture.componentInstance.nodeTraceSummary()).toBe('2 node executions across 1 cycle.');
  });

  it('omits the node trace section entirely when no cycle recorded any nodes', () => {
    setup(of(makeDetail()), undefined, of({ cycles: [{ utterance_seq: 0, stt: { total_ms: 120 } }] }));
    expect(fixture.nativeElement.textContent).not.toContain('Node trace');
  });
});
