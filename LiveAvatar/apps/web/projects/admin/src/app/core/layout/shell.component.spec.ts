import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatSidenav } from '@angular/material/sidenav';
import { BehaviorSubject, of } from 'rxjs';
import { ShellComponent } from './shell.component';
import { AuthStore } from '../auth/auth.store';

describe('ShellComponent', () => {
  let fixture: ComponentFixture<ShellComponent>;
  let authStore: { user: jest.Mock; roleLabel: jest.Mock; isLoading: jest.Mock; logout: jest.Mock };
  // Drives BreakpointObserver.observe(...) so tests can flip between the
  // desktop (persistent sidenav) and mobile (overlay + hamburger) layouts
  // without depending on jsdom's fixed (and unconfigurable) viewport size.
  let breakpointMatches$: BehaviorSubject<{ matches: boolean }>;

  async function setup() {
    authStore = {
      user: jest.fn(() => ({ id: 'u-1', email: 'op@example.com', roles: ['operator'], tenant_ids: [] })),
      roleLabel: jest.fn(() => 'Operator'),
      isLoading: jest.fn(() => false),
      logout: jest.fn(() => of(undefined)),
    };
    breakpointMatches$ = new BehaviorSubject<{ matches: boolean }>({ matches: true }); // default: desktop (>=1280px)

    await TestBed.configureTestingModule({
      imports: [ShellComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: authStore },
        { provide: BreakpointObserver, useValue: { observe: () => breakpointMatches$ } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await setup();
  });

  it('renders a skip link as the first focusable control', () => {
    const skipLink: HTMLAnchorElement = fixture.nativeElement.querySelector('.la-skip-link');
    expect(skipLink).toBeTruthy();
    expect(skipLink.getAttribute('href')).toBe('#main');
  });

  it('renders the Deployments nav item as a live routable link', () => {
    const el: HTMLElement = fixture.nativeElement;
    const links = Array.from(el.querySelectorAll('a[mat-list-item]'));
    expect(links.some((a) => a.textContent?.trim() === 'Deployments')).toBe(true);
  });

  it('Phase 7 lights up every remaining nav item — no disabled "coming soon" items remain', () => {
    const el: HTMLElement = fixture.nativeElement;
    const disabled = el.querySelectorAll('.la-shell__nav-item--disabled');
    expect(disabled.length).toBe(0);
  });

  it('renders every nav item as a live routable link', () => {
    const el: HTMLElement = fixture.nativeElement;
    const links = Array.from(el.querySelectorAll('a[mat-list-item]')).map((a) => a.textContent?.trim());
    expect(links).toEqual(
      expect.arrayContaining(['Dashboard', 'Deployments', 'Providers', 'Sessions', 'GPU health', 'Alerts', 'Residency']),
    );
  });

  it('shows the user email and role chip', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('op@example.com');
    expect(el.textContent).toContain('Operator');
  });

  it('signs out and navigates to /login', async () => {
    const router = TestBed.inject(Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    await (fixture.componentInstance as unknown as { signOut(): Promise<void> }).signOut();

    expect(authStore.logout).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  describe('responsive shell (D-2, UX_GUIDELINES §1.4/§4.6)', () => {
    it('renders a persistent sidenav with no hamburger at >=1280px', () => {
      breakpointMatches$.next({ matches: true }); // (min-width: 1280px) matches
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.la-shell__hamburger')).toBeNull();
      const sidenav = fixture.debugElement.query(By.directive(MatSidenav)).componentInstance as MatSidenav;
      expect(sidenav.mode).toBe('side');
      expect(sidenav.opened).toBe(true);
    });

    it('collapses to an overlay drawer with a hamburger below 1280px', () => {
      breakpointMatches$.next({ matches: false }); // (min-width: 1280px) does not match
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const hamburger = el.querySelector<HTMLButtonElement>('.la-shell__hamburger');
      expect(hamburger).toBeTruthy();
      expect(hamburger?.getAttribute('aria-label')).toBe('Open navigation');
      const sidenav = fixture.debugElement.query(By.directive(MatSidenav)).componentInstance as MatSidenav;
      expect(sidenav.mode).toBe('over');
      expect(sidenav.opened).toBe(false);
    });

    it('toggles the sidenav open/closed via the hamburger on mobile', () => {
      breakpointMatches$.next({ matches: false });
      fixture.detectChanges();
      const component = fixture.componentInstance as unknown as {
        toggleNav(): void;
        onNavItemActivated(): void;
      };
      const toggleSpy = jest.fn();
      (component as unknown as { sidenav: { toggle: () => void; close: () => void } }).sidenav = {
        toggle: toggleSpy,
        close: jest.fn(),
      };
      component.toggleNav();
      expect(toggleSpy).toHaveBeenCalled();
    });

    it('closes the mobile drawer when a live nav item is activated, but not on desktop', () => {
      breakpointMatches$.next({ matches: false }); // mobile
      fixture.detectChanges();
      const component = fixture.componentInstance as unknown as {
        onNavItemActivated(): void;
      };
      const closeSpy = jest.fn();
      (component as unknown as { sidenav: { close: () => void } }).sidenav = { close: closeSpy };
      component.onNavItemActivated();
      expect(closeSpy).toHaveBeenCalled();

      closeSpy.mockClear();
      breakpointMatches$.next({ matches: true }); // desktop
      fixture.detectChanges();
      component.onNavItemActivated();
      expect(closeSpy).not.toHaveBeenCalled();
    });
  });
});
