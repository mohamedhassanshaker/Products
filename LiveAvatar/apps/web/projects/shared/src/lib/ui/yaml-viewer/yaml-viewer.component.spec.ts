import { TestBed } from '@angular/core/testing';
import { YamlViewerComponent } from './yaml-viewer.component';

describe('YamlViewerComponent', () => {
  it('renders the given yaml text verbatim', () => {
    const fixture = TestBed.createComponent(YamlViewerComponent);
    fixture.componentRef.setInput('yaml', 'version: 1\n');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('version: 1');
  });
});
