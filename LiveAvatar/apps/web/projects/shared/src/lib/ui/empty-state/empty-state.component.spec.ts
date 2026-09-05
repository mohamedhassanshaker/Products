import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmptyStateComponent } from './empty-state.component';

describe('EmptyStateComponent', () => {
  let fixture: ComponentFixture<EmptyStateComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EmptyStateComponent] }).compileComponents();
    fixture = TestBed.createComponent(EmptyStateComponent);
  });

  it('renders title and body, with no role=alert for the success variant', () => {
    fixture.componentRef.setInput('title', 'No deployments yet');
    fixture.componentRef.setInput('body', 'Create a deployment to configure providers and start conversations.');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('No deployments yet');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('sets role=alert for the error variant', () => {
    fixture.componentRef.setInput('variant', 'error');
    fixture.componentRef.setInput('title', 'Could not load deployments');
    fixture.componentRef.setInput('body', 'Try again.');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('omits the action button when no actionLabel is given', () => {
    fixture.componentRef.setInput('title', 't');
    fixture.componentRef.setInput('body', 'b');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it('emits action when the button is clicked', () => {
    fixture.componentRef.setInput('title', 't');
    fixture.componentRef.setInput('body', 'b');
    fixture.componentRef.setInput('actionLabel', 'Create deployment');
    fixture.detectChanges();

    const emitted = jest.fn();
    fixture.componentInstance.action.subscribe(emitted);

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.textContent).toContain('Create deployment');
    button.click();

    expect(emitted).toHaveBeenCalledTimes(1);
  });
});
