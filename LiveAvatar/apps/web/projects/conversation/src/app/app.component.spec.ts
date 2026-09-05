import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';

describe('AppComponent (Phase 3: router-outlet shell, no chrome)', () => {
  let fixture: ComponentFixture<AppComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
  });

  it('renders only a router outlet — no admin chrome, no nav', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('nav')).toBeNull();
    expect(el.querySelector('router-outlet')).not.toBeNull();
  });
});
