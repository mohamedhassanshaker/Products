import { TestBed } from '@angular/core/testing';
import { StalenessBadgeComponent } from './staleness-badge.component';

describe('StalenessBadgeComponent', () => {
  it('renders nothing when the source is not stale', () => {
    const fixture = TestBed.createComponent(StalenessBadgeComponent);
    fixture.componentRef.setInput('isStale', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.la-staleness-badge')).toBeNull();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('renders the warning icon and text when the source is stale', () => {
    const fixture = TestBed.createComponent(StalenessBadgeComponent);
    fixture.componentRef.setInput('isStale', true);
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.la-staleness-badge');
    expect(badge).not.toBeNull();
    expect(fixture.nativeElement.querySelector('mat-icon').textContent.trim()).toBe('warning');
    expect(fixture.nativeElement.textContent).toContain('Stale — source changed since last index');
  });
});
