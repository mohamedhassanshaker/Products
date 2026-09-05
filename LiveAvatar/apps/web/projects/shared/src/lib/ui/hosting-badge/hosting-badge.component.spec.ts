import { TestBed } from '@angular/core/testing';
import { HostingBadgeComponent } from './hosting-badge.component';

describe('HostingBadgeComponent', () => {
  it('shows the self-hosted icon/label', async () => {
    const fixture = TestBed.createComponent(HostingBadgeComponent);
    fixture.componentRef.setInput('hosting', 'self_hosted');
    fixture.detectChanges();
    expect(fixture.componentInstance.icon()).toBe('dns');
    expect(fixture.componentInstance.label()).toBe('Self-hosted');
  });

  it('shows the remote icon/label', async () => {
    const fixture = TestBed.createComponent(HostingBadgeComponent);
    fixture.componentRef.setInput('hosting', 'remote');
    fixture.detectChanges();
    expect(fixture.componentInstance.icon()).toBe('cloud');
    expect(fixture.componentInstance.label()).toBe('Remote');
  });
});
