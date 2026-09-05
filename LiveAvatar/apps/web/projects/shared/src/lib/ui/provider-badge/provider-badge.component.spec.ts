import { TestBed } from '@angular/core/testing';
import { ProviderBadgeComponent } from './provider-badge.component';

describe('ProviderBadgeComponent', () => {
  it('renders the display name', () => {
    const fixture = TestBed.createComponent(ProviderBadgeComponent);
    fixture.componentRef.setInput('displayName', 'OpenAI');
    fixture.componentRef.setInput('hosting', 'remote');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('OpenAI');
  });
});
