import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StatusChipComponent } from './status-chip.component';

describe('StatusChipComponent', () => {
  let fixture: ComponentFixture<StatusChipComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StatusChipComponent] }).compileComponents();
    fixture = TestBed.createComponent(StatusChipComponent);
  });

  function setInputs(tone: 'success' | 'caution' | 'neutral' | 'error', icon: string, label: string): void {
    fixture.componentRef.setInput('tone', tone);
    fixture.componentRef.setInput('icon', icon);
    fixture.componentRef.setInput('label', label);
    fixture.detectChanges();
  }

  it('renders the icon and label for an active/success chip', () => {
    setInputs('success', 'check_circle', 'Active');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Active');
    expect(el.textContent).toContain('check_circle');
    expect(el.querySelector('.la-status-chip--success')).toBeTruthy();
  });

  it('renders a caution chip for paused status', () => {
    setInputs('caution', 'pause_circle', 'Paused');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Paused');
    expect(el.querySelector('.la-status-chip--caution')).toBeTruthy();
  });
});
