import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { SessionsListPageComponent } from './sessions-list-page.component';
import { SessionLogsService } from '../../services/session-logs.service';
import { AuthStore } from '../../../../core/auth/auth.store';
import { TenantsApiService } from '@liveavatar/web-shared';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1234567-aaaa-bbbb-cccc-ddddeeeeffff',
    tenant_id: 't1',
    tenant_slug: 'acme',
    started_at: '2026-01-01T00:00:00.000Z',
    duration_ms: 65000,
    status: 'ended',
    provider_stack: { transport: 'livekit', stt: 'deepgram', llm: 'openai', llm_fallback: null, tts: 'fish-speech', avatar: 'bithuman' },
    error_code: null,
    transcript_purged: false,
    ...overrides,
  };
}

describe('SessionsListPageComponent (Screen 5 list, FR-SESS-1)', () => {
  let fixture: ComponentFixture<SessionsListPageComponent>;
  let sessionLogs: { list: jest.Mock };
  let router: { navigate: jest.Mock };

  function setup(isOperator: boolean, listResult: unknown = of({ items: [makeRow()], total: 1, page: 1, page_size: 25 })) {
    sessionLogs = { list: jest.fn().mockReturnValue(listResult) };
    router = { navigate: jest.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      imports: [SessionsListPageComponent, NoopAnimationsModule],
      providers: [
        { provide: SessionLogsService, useValue: sessionLogs },
        { provide: Router, useValue: router },
        { provide: AuthStore, useValue: { isOperator: () => isOperator } },
        { provide: TenantsApiService, useValue: { list: jest.fn().mockReturnValue(of({ items: [], total: 0, page: 1, page_size: 25 })) } },
      ],
    });
    fixture = TestBed.createComponent(SessionsListPageComponent);
    fixture.detectChanges();
  }

  it('an operator with no tenant chosen fetches immediately with no tenant scoping', () => {
    setup(true);
    expect(sessionLogs.list).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: undefined }));
  });

  it('an admin with no tenant chosen does not fetch at all (FR-SESS-1 required scope)', () => {
    setup(false);
    expect(sessionLogs.list).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Choose a deployment');
  });

  it('an admin fetches once a tenant is chosen', () => {
    setup(false);
    fixture.componentInstance.onTenantChange('t1');
    expect(sessionLogs.list).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 't1' }));
  });

  it('renders rows once fetched', () => {
    setup(true);
    expect(fixture.nativeElement.textContent).toContain('acme');
  });

  it('shows an empty state with Clear filters when filters narrow results to zero', () => {
    setup(true, of({ items: [], total: 0, page: 1, page_size: 25 }));
    fixture.componentInstance.searchControl.setValue('nope');
    expect(fixture.nativeElement.textContent).toContain('No sessions found');
  });

  it('shows a load error and can retry', () => {
    setup(true, throwError(() => ({ code: 'SESS_RANGE_INVALID', message: 'boom' })));
    expect(fixture.nativeElement.textContent).toContain('Could not load sessions');
    sessionLogs.list.mockReturnValue(of({ items: [makeRow()], total: 1, page: 1, page_size: 25 }));
    fixture.componentInstance.retry();
    expect(sessionLogs.list).toHaveBeenCalledTimes(2);
  });

  it('opens the detail page on row click', () => {
    setup(true);
    fixture.componentInstance.openDetail(makeRow() as never);
    expect(router.navigate).toHaveBeenCalledWith(['sessions', 's1234567-aaaa-bbbb-cccc-ddddeeeeffff']);
  });

  it('status filter change resets to page 1 and refetches', () => {
    setup(true);
    sessionLogs.list.mockClear();
    fixture.componentInstance.statusControl.setValue('failed');
    expect(sessionLogs.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', page: 1 }));
  });

  it('onPageEvent updates page/pageSize and refetches', () => {
    setup(true);
    sessionLogs.list.mockClear();
    fixture.componentInstance.onPageEvent({ pageIndex: 2, pageSize: 50, length: 100, previousPageIndex: 1 });
    expect(fixture.componentInstance.page()).toBe(3);
    expect(fixture.componentInstance.pageSize()).toBe(50);
    expect(sessionLogs.list).toHaveBeenCalledWith(expect.objectContaining({ page: 3, page_size: 50 }));
  });

  it('clearFilters resets search/status/page and refetches', () => {
    setup(true);
    fixture.componentInstance.searchControl.setValue('x', { emitEvent: false });
    fixture.componentInstance.statusControl.setValue('failed', { emitEvent: false });
    sessionLogs.list.mockClear();
    fixture.componentInstance.clearFilters();
    expect(fixture.componentInstance.searchControl.value).toBe('');
    expect(fixture.componentInstance.statusControl.value).toBe('all');
    expect(sessionLogs.list).toHaveBeenCalledWith(expect.objectContaining({ q: undefined, status: undefined, page: 1 }));
  });

  it('formats duration as m:ss or h:mm:ss, and em-dash for null', () => {
    setup(true);
    expect(fixture.componentInstance.duration(65000)).toBe('1:05');
    expect(fixture.componentInstance.duration(3665000)).toBe('1:01:05');
    expect(fixture.componentInstance.duration(null)).toBe('—');
  });

  it('providerStackSummary renders the full stack, not just the LLM (QA D-7)', () => {
    setup(true);
    const summary = fixture.componentInstance.providerStackSummary({
      transport: 'livekit',
      stt: 'deepgram',
      llm: 'openai',
      llm_fallback: null,
      tts: 'fish-speech',
      avatar: 'bithuman',
    });
    expect(summary).toBe('livekit · deepgram · openai · fish-speech · bithuman');
  });

  it('providerStackSummary falls back to an em dash when every category is null (QA D-7)', () => {
    setup(true);
    const summary = fixture.componentInstance.providerStackSummary({
      transport: null,
      stt: null,
      llm: null,
      llm_fallback: null,
      tts: null,
      avatar: null,
    });
    expect(summary).toBe('—');
  });

  it('renders the full provider stack in the table, not only the LLM (QA D-7)', () => {
    setup(true);
    expect(fixture.nativeElement.textContent).toContain('livekit · deepgram · openai · fish-speech · bithuman');
  });
});
