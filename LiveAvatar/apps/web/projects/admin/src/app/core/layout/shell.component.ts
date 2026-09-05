import { ChangeDetectionStrategy, Component, ViewChild, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { AuthStore } from '../auth/auth.store';

/**
 * UX_GUIDELINES §1.4/§4.6 — below this width the sidenav collapses to a
 * temporary/overlay drawer behind a hamburger toggle; at or above it, the
 * sidenav is persistent and always open.
 */
const DESKTOP_BREAKPOINT = '(min-width: 1280px)';

interface NavItem {
  label: string;
  route: string;
  live: boolean;
}

/**
 * Authenticated admin chrome (UX_GUIDELINES §4, §1.5): persistent sidenav +
 * toolbar, skip link, full IA shown with future screens disabled rather
 * than hidden (recognition over recall).
 */
@Component({
  selector: 'la-shell',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    MatIconModule,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatMenuModule,
    MatButtonModule,
    MatTooltipModule,
    MatProgressBarModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  protected readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly breakpointObserver = inject(BreakpointObserver);

  /**
   * True below the 1280px desktop breakpoint (D-2 fix). Drives both the
   * sidenav's `mode` ('over' vs 'side') and whether the toolbar hamburger
   * is rendered at all.
   */
  protected readonly isMobile = toSignal(
    this.breakpointObserver.observe(DESKTOP_BREAKPOINT).pipe(map((state) => !state.matches)),
    { initialValue: false },
  );

  /**
   * Phase 7 (BL-020..024) lights up every remaining nav item. Alerts/Residency
   * route to their picker/index pages here (UX_GUIDELINES §16.1/§17.1) — the
   * real, tenant-scoped screens are reached from there, or from a Deployments
   * row action, exactly like Agent Builder's own precedent.
   */
  protected readonly navItems: NavItem[] = [
    { label: 'Dashboard', route: '/dashboard', live: true },
    { label: 'Deployments', route: '/deployments', live: true },
    { label: 'Providers', route: '/providers', live: true },
    { label: 'Sessions', route: '/sessions', live: true },
    { label: 'GPU health', route: '/gpu', live: true },
    { label: 'Alerts', route: '/alerts', live: true },
    { label: 'Residency', route: '/residency', live: true },
    // Phase 14 (BL-052..057) — reviewer console, a separate top-level nav
    // item from the HITL config tab (`docs/v2/UX_SCOPE.md`: "reviewers are
    // often a different persona than the tenant admin who configures
    // gates"). Always-visible rather than gated on "tenant has >=1 active
    // gate" — that condition needs a cross-tenant gate-count check with
    // nowhere natural to run it for a nav item with no tenant context yet
    // (the same reason every other tenant-scoped item here, e.g. Alerts/
    // Residency, is unconditionally live and routes through its own
    // picker page instead of being conditionally hidden).
    { label: 'Approvals', route: '/approvals', live: true },
  ];

  /** The sidenav itself, so the hamburger and nav-item clicks can open/close it on mobile. */
  @ViewChild('sidenav') private readonly sidenav?: MatSidenav;

  /** Toggles the overlay drawer; only reachable via the hamburger, which only renders below 1280px. */
  protected toggleNav(): void {
    void this.sidenav?.toggle();
  }

  /**
   * On phone/tablet, choosing a live nav item closes the overlay drawer
   * (UX_GUIDELINES §4.1 step 4). On desktop the sidenav is persistent, so
   * this is a no-op there.
   */
  protected onNavItemActivated(): void {
    if (this.isMobile()) {
      void this.sidenav?.close();
    }
  }

  protected async signOut(): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        this.authStore.logout().subscribe({ next: () => resolve(), error: () => reject() });
      });
    } finally {
      await this.router.navigate(['/login']);
    }
  }
}
