import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BudgetBarComponent } from './budget-bar.component';

describe('BudgetBarComponent', () => {
  let fixture: ComponentFixture<BudgetBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BudgetBarComponent] }).compileComponents();
    fixture = TestBed.createComponent(BudgetBarComponent);
  });

  function setInputs(usedMs: number, totalMs: number, label?: string): void {
    fixture.componentRef.setInput('usedMs', usedMs);
    fixture.componentRef.setInput('totalMs', totalMs);
    if (label !== undefined) {
      fixture.componentRef.setInput('label', label);
    }
    fixture.detectChanges();
  }

  it('renders a success tone well under budget', () => {
    setInputs(500, 2500);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.la-budget-bar--success')).toBeTruthy();
    expect(el.textContent).toContain('500ms / 2500ms');
    expect(el.textContent).toContain('20% of budget');
  });

  it('renders a caution tone at or above 80% of budget', () => {
    setInputs(2100, 2500); // 84%
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.la-budget-bar--caution')).toBeTruthy();
  });

  it('renders an error tone and an "over budget" message when used exceeds total', () => {
    setInputs(2610, 2500);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.la-budget-bar--error')).toBeTruthy();
    expect(el.textContent).toContain('over budget by 110ms');
  });

  it('sets ARIA progressbar attributes for the current percentage', () => {
    setInputs(1250, 2500);
    const track = fixture.nativeElement.querySelector('.la-budget-bar__track') as HTMLElement;
    expect(track.getAttribute('role')).toBe('progressbar');
    expect(track.getAttribute('aria-valuenow')).toBe('50');
  });

  it('clamps the visual fill to 100% even when over budget, without clamping the reported percent text', () => {
    setInputs(5000, 2500); // 200%
    const fill = fixture.nativeElement.querySelector('.la-budget-bar__fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('200%');
  });

  it('renders the optional label when provided, and omits it otherwise', () => {
    setInputs(500, 2500, 'Router → refunds → Speak');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Router → refunds → Speak');

    setInputs(500, 2500, '');
    expect(fixture.nativeElement.querySelector('.la-budget-bar__label')).toBeNull();
  });

  it('treats a zero total_ms as 0% rather than dividing by zero', () => {
    setInputs(0, 0);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('0% of budget');
  });
});
