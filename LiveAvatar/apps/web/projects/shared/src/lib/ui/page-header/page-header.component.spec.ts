import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PageHeaderComponent } from './page-header.component';

describe('PageHeaderComponent', () => {
  let fixture: ComponentFixture<PageHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PageHeaderComponent] }).compileComponents();
    fixture = TestBed.createComponent(PageHeaderComponent);
  });

  it('renders a single h1 with the title', () => {
    fixture.componentRef.setInput('title', 'Deployments');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const headings = el.querySelectorAll('h1');
    expect(headings.length).toBe(1);
    expect(headings[0].textContent).toContain('Deployments');
  });

  it('omits the subtitle paragraph when not provided', () => {
    fixture.componentRef.setInput('title', 'Deployments');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.la-page-header__subtitle')).toBeNull();
  });

  it('renders the subtitle when provided', () => {
    fixture.componentRef.setInput('title', 'Deployments');
    fixture.componentRef.setInput('subtitle', 'All tenants');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.la-page-header__subtitle')?.textContent).toContain('All tenants');
  });
});
