import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { GpuPageComponent } from './gpu-page.component';
import { GpuService } from '../../services/gpu.service';
import { TenantsApiService } from '@liveavatar/web-shared';

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    hostname: 'gpu-1',
    role: 'stt',
    gpu_util_pct: 40,
    mem_util_pct: 30,
    healthy: true,
    last_heartbeat_at: '2026-01-01T00:00:00.000Z',
    autoscaler: 'not_configured',
    ...overrides,
  };
}

describe('GpuPageComponent (Screen 6, FR-GPU-1/2/3)', () => {
  let fixture: ComponentFixture<GpuPageComponent>;
  let gpu: { list: jest.Mock };

  function setup(listResult: unknown = of({ items: [makeNode()], total: 1 })) {
    gpu = { list: jest.fn().mockReturnValue(listResult) };
    TestBed.configureTestingModule({
      imports: [GpuPageComponent, NoopAnimationsModule],
      providers: [
        { provide: GpuService, useValue: gpu },
        { provide: TenantsApiService, useValue: { list: jest.fn().mockReturnValue(of({ items: [], total: 0, page: 1, page_size: 25 })) } },
      ],
    });
    fixture = TestBed.createComponent(GpuPageComponent);
    fixture.detectChanges();
  }

  it('fetches nodes on init with no filters', () => {
    setup();
    expect(gpu.list).toHaveBeenCalledWith({ role: undefined, tenant_id: undefined });
  });

  it('renders a card per node', () => {
    setup();
    expect(fixture.nativeElement.textContent).toContain('gpu-1');
  });

  it('shows the true-empty state (no nodes reporting) with no filters active', () => {
    setup(of({ items: [], total: 0 }));
    expect(fixture.nativeElement.textContent).toContain('No GPU nodes are reporting');
  });

  it('shows the filtered-empty state distinctly when a filter narrows to zero', () => {
    setup(of({ items: [], total: 0 }));
    fixture.componentInstance.roleControl.setValue('avatar');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No matching nodes');
  });

  it('shows a load error and can retry', () => {
    setup(throwError(() => ({ code: 'INTERNAL_ERROR', message: 'boom' })));
    expect(fixture.nativeElement.textContent).toContain('Could not load GPU nodes');
    gpu.list.mockReturnValue(of({ items: [makeNode()], total: 1 }));
    fixture.componentInstance.retry();
    expect(gpu.list).toHaveBeenCalledTimes(2);
  });

  it('re-fetches with the selected role and tenant filters', () => {
    setup();
    gpu.list.mockClear();
    fixture.componentInstance.roleControl.setValue('tts');
    fixture.componentInstance.onTenantChange('t1');
    expect(gpu.list).toHaveBeenCalledWith({ role: 'tts', tenant_id: 't1' });
  });

  it('maps roles to distinct icons', () => {
    setup();
    const component = fixture.componentInstance;
    expect(component.roleIcon('stt')).toBe('mic');
    expect(component.roleIcon('tts')).toBe('record_voice_over');
    expect(component.roleIcon('avatar')).toBe('face');
  });

  it('maps roles to the spec display label, not the raw enum value (QA D-2)', () => {
    setup();
    const component = fixture.componentInstance;
    expect(component.roleLabel('stt')).toBe('STT');
    expect(component.roleLabel('tts')).toBe('TTS');
    expect(component.roleLabel('avatar')).toBe('Avatar');
  });

  it('renders the mapped role label on the card, not the raw enum value (QA D-2)', () => {
    setup(of({ items: [makeNode({ role: 'tts' })], total: 1 }));
    expect(fixture.nativeElement.textContent).toContain('TTS');
  });

  it('clearFilters resets the role/tenant filters and re-fetches', () => {
    setup();
    fixture.componentInstance.roleControl.setValue('tts');
    fixture.componentInstance.onTenantChange('t1');
    gpu.list.mockClear();
    fixture.componentInstance.clearFilters();
    expect(fixture.componentInstance.roleControl.value).toBe('all');
    expect(gpu.list).toHaveBeenCalledWith({ role: undefined, tenant_id: undefined });
  });
});
