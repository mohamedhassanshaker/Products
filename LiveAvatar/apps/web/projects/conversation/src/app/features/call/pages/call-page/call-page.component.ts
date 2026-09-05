import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { PublicSessionResponse } from '@liveavatar/contracts';
import { PublicApiService } from '@liveavatar/web-shared';
import { LiveKitRoomService } from '../../../../core/livekit-room.service';

/** FR-AVATAR-5 client-facing wait window (UX_GUIDELINES §12.1 step 4). */
const AVATAR_WAIT_BANNER_MS = 15_000;

/** LiveKit SDK reconnect budget before the user is bounced to Screen 9 (FR-CALL-2). */
const RECONNECT_TIMEOUT_MS = 30_000;

/** How long the "Connection lost" takeover message displays before redirecting (UX_GUIDELINES §12.2). */
const RECONNECT_FAILED_DISPLAY_MS = 2_000;

/** Router-state payload handed off from Screen 9 (UX_GUIDELINES §11.2 step 10). */
interface CallNavigationState {
  session: PublicSessionResponse;
  displayName: string;
  cameraEnabled: boolean;
}

/**
 * Screen 10 — Live conversation (FR-CALL-2, FR-TRANSPORT-2,
 * UX_GUIDELINES §12). Reached only from a successful Screen 9 join; redirects
 * back to Screen 9 if reloaded with no in-memory session state.
 */
@Component({
  selector: 'la-conv-call-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './call-page.component.html',
  styleUrl: './call-page.component.scss',
})
export class CallPageComponent implements AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly publicApi = inject(PublicApiService);
  protected readonly liveKit = inject(LiveKitRoomService);

  @ViewChild('avatarVideo') private readonly videoRef?: ElementRef<HTMLVideoElement>;

  private readonly navState = (this.router.getCurrentNavigation()?.extras.state ??
    (history.state as CallNavigationState | undefined)) as CallNavigationState | undefined;

  protected readonly cameraOn = signal(false);
  /**
   * Whether the user opted into the camera on Screen 9 (UX_GUIDELINES §12.2:
   * the camera toggle is "only rendered if the user opted in on Screen 9").
   * Fixed value for this component's lifetime — Screen 9's choice, not a
   * live toggle of the control's visibility (QA Phase 3 D-4).
   */
  protected readonly cameraOptedIn = Boolean(this.navState?.cameraEnabled);
  /** FR-CALL-3: captions default **on**. Session-local only, not persisted (no account to persist to). */
  protected readonly captionsOn = signal(true);
  protected readonly ending = signal(false);
  /** `CALL_RECONNECT_FAILED` full-screen takeover (UX_GUIDELINES §12.2/§12.8). */
  protected readonly reconnectFailed = signal(false);
  private readonly showAvatarWaitBanner = signal(false);
  private avatarWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Local 1s UI tick for the HITL hold progress indicator (A8.7) — independent of any network call, just moves the bar. */
  private readonly now = signal(Date.now());
  private hitlTickTimer: ReturnType<typeof setInterval> | null = null;

  /** `connected, waiting for avatar` state (UX_GUIDELINES §12.2) — calm, not an error. */
  protected readonly waitingForAvatar = computed(
    () => this.liveKit.connectionState() === 'connected' && !this.liveKit.hasAvatarVideo() && this.showAvatarWaitBanner(),
  );

  /** `aria-live` status text (UX_GUIDELINES §12.5) — one line, updated as the state machine moves. */
  protected readonly statusText = computed(() => {
    const state = this.liveKit.connectionState();
    if (state === 'connecting') {
      return 'Connecting…';
    }
    if (state === 'reconnecting') {
      return 'Reconnecting…';
    }
    if (state === 'connected' && !this.liveKit.hasAvatarVideo()) {
      return 'Still connecting you to your avatar…';
    }
    if (state === 'connected') {
      return 'Connected.';
    }
    return 'Disconnected.';
  });

  /**
   * A8.7 "Getting approval" state (R-H5 — the caller is always told what
   * is being waited on and roughly how long; silence during a gate is
   * never acceptable). This banner is additive to the existing
   * hold-treatment speech (`_speak()`, already reused server-side for
   * this — `ARCHITECTURE_NOTES.md` §6.2) — a visual reinforcement, not a
   * replacement for it. Elapsed/percent are computed off `now()`, a local
   * 1s tick, so the progress bar moves without polling anything.
   */
  protected readonly hitlHold = this.liveKit.hitlHold;
  protected readonly hitlHoldElapsedSeconds = computed(() => {
    const hold = this.hitlHold();
    return hold ? Math.max(0, Math.floor((this.now() - hold.startedAt) / 1000)) : 0;
  });
  protected readonly hitlHoldProgressPercent = computed(() => {
    const hold = this.hitlHold();
    if (!hold?.slaSeconds) {
      return null;
    }
    return Math.min(100, (this.hitlHoldElapsedSeconds() / hold.slaSeconds) * 100);
  });

  /** A8.7 "Deferred outcome" state — a previously-deferred approval's result banner (UC-H2). */
  protected readonly hitlDeferredOutcome = this.liveKit.hitlDeferredOutcome;

  constructor() {
    if (!this.navState?.session) {
      // `<base href="/c/">` already supplies `/c` — no leading `/c` segment
      // here (QA Phase 3 D-1, same root cause/fix as the other 4 call sites).
      void this.router.navigate([this.slug()]);
    }
    this.cameraOn.set(Boolean(this.navState?.cameraEnabled));

    effect(() => {
      const state = this.liveKit.connectionState();
      if (state === 'reconnecting') {
        this.startReconnectTimer();
      } else {
        this.clearReconnectTimer();
      }
      if (state === 'connected' && this.liveKit.hasAvatarVideo()) {
        this.clearAvatarWaitTimer();
      }
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const session = this.navState?.session;
    if (!session || !this.videoRef) {
      return;
    }
    this.startAvatarWaitTimer();
    this.hitlTickTimer = setInterval(() => this.now.set(Date.now()), 1000);
    await this.liveKit.connect(session.ws_url, session.token, this.cameraOn(), this.videoRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.clearAvatarWaitTimer();
    this.clearReconnectTimer();
    if (this.hitlTickTimer !== null) {
      clearInterval(this.hitlTickTimer);
    }
    void this.liveKit.disconnect();
  }

  /** Screen 10 mute/unmute (FR-CALL-2). */
  protected async onToggleMute(): Promise<void> {
    await this.liveKit.setMuted(!this.liveKit.muted());
  }

  /** FR-CALL-3 captions toggle — the reserved control-bar slot from UX_GUIDELINES §12.1 step 4. */
  protected onToggleCaptions(): void {
    this.captionsOn.set(!this.captionsOn());
  }

  /** Optional camera toggle (UX_GUIDELINES §12.2, authored/non-spec). */
  protected async onToggleCamera(): Promise<void> {
    const next = !this.cameraOn();
    this.cameraOn.set(next);
    await this.liveKit.setCameraEnabled(next);
  }

  /**
   * Deliberate end-call (UX_GUIDELINES §12.1 step 6/§12.2 "Ending"). Always
   * available, never confirm-gated (§12.4) — an intentional divergence from
   * the admin SPA's destructive-action confirm pattern.
   */
  protected async onEndCall(): Promise<void> {
    this.ending.set(true);
    const session = this.navState?.session;
    await this.liveKit.disconnect();
    if (session) {
      // Fast path (LLD §8.3) — the LiveKit `room_finished` webhook remains
      // authoritative for the session's terminal status, so a failure here
      // never blocks navigation; it only means this call can't reach the
      // post-call summary screen (BL-025), since `summary_token` is only
      // ever handed back on this response, never re-issuable afterward.
      this.publicApi.endSession(session.session_id, { token: session.token }).subscribe({
        next: (response) => {
          if (response.summary_token) {
            void this.router.navigate([this.slug(), 'summary', session.session_id, response.summary_token]);
          } else {
            void this.router.navigate([this.slug()]);
          }
        },
        error: () => {
          void this.router.navigate([this.slug()]);
        },
      });
      return;
    }
    await this.router.navigate([this.slug()]);
  }

  private slug(): string {
    return this.route.snapshot.paramMap.get('slug') ?? '';
  }

  private startAvatarWaitTimer(): void {
    this.avatarWaitTimer = setTimeout(() => this.showAvatarWaitBanner.set(true), AVATAR_WAIT_BANNER_MS);
  }

  private clearAvatarWaitTimer(): void {
    if (this.avatarWaitTimer !== null) {
      clearTimeout(this.avatarWaitTimer);
      this.avatarWaitTimer = null;
    }
  }

  /** FR-CALL-2: 30s failed reconnect → `CALL_RECONNECT_FAILED`, a new session on Screen 9. */
  private startReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectFailed.set(true);
      // Fire-and-forget: the takeover message and the redirect timer below
      // must not wait on disconnect() completing (kept synchronous with the
      // timer firing rather than chained after an `await`, so the whole
      // sequence is a single, deterministically fakeAsync-testable
      // callback chain of timers, not a timer-then-microtask-then-timer one).
      void this.liveKit.disconnect();
      setTimeout(() => {
        void this.router.navigate([this.slug()]);
      }, RECONNECT_FAILED_DISPLAY_MS);
    }, RECONNECT_TIMEOUT_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
