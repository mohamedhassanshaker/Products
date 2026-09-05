import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Root shell (LLD §3.2). No chrome, no nav — every screen in this SPA
 * (pre-call, live conversation, the Screen 11 stand-in) is a full-page,
 * single-purpose route (UX_GUIDELINES §11.4/§12.3).
 */
@Component({
  selector: 'la-conversation-root',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet />`,
})
export class AppComponent {}
