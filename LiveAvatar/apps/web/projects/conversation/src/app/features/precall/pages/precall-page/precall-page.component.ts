import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CallSessionStore, type MediaErrorKind } from '../../../../core/call-session.store';

/** Error codes mapped to the spec's exact sentences (UX_GUIDELINES §11.8). */
const ERROR_SENTENCES: Record<string, string> = {
  TRANSPORT_UNAVAILABLE: 'Cannot reach the media server. Check your network or try again.',
  CONFIG_INCOMPLETE: 'This assistant is not available right now.',
  TENANT_PAUSED: 'This assistant is not available right now.',
};

/**
 * The media-priming failure sentence, by why it failed and whether a camera
 * was also requested (UX_GUIDELINES §11.8) — deliberately not folded into
 * `ERROR_SENTENCES` above, since those are keyed by a backend error `code`
 * while this is keyed by a local `MediaErrorKind` classification of a raw
 * browser exception (`CallSessionStore.classifyMediaError`). "Allow it in
 * your browser" is only ever true for `denied`; telling someone with no
 * microphone hardware at all (`not_found`) to "allow" it is actively wrong.
 */
const MEDIA_DENIED_SENTENCES: Record<MediaErrorKind, { mic: string; micAndCamera: string }> = {
  denied: {
    mic: 'Microphone access is required to start. Allow the microphone in your browser and retry.',
    micAndCamera: 'Microphone and camera access are required to start. Allow both in your browser and retry.',
  },
  not_found: {
    mic: 'No microphone was found on this device. Connect a microphone and retry.',
    micAndCamera: 'No microphone or camera was found on this device. Connect the missing device(s) and retry.',
  },
  other: {
    mic: 'Microphone access failed unexpectedly. Check your microphone and retry.',
    micAndCamera: 'Microphone or camera access failed unexpectedly. Check your devices and retry.',
  },
};

/**
 * Screen 9 — Pre-call / permissions (FR-CALL-1, UX_GUIDELINES §11). The
 * conversation SPA's entry point (`/c/:slug`) — no login, no chrome, a
 * single-purpose landing page.
 */
@Component({
  selector: 'la-conv-precall-page',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './precall-page.component.html',
  styleUrl: './precall-page.component.scss',
})
export class PrecallPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly store = inject(CallSessionStore);

  /** Per-tab correlation key (FR-AUTH-4 idempotency) — one per component instance, not persisted. */
  private readonly tabKey = crypto.randomUUID();

  /** Browser-unsupported dead end: focus lands on the heading, no form to focus into (UX_GUIDELINES §11.5). */
  @ViewChild('unsupportedHeading') private readonly unsupportedHeading?: ElementRef<HTMLHeadingElement>;

  /** Screen 9 step 3's pre-permission explainer / Join button label (UX_GUIDELINES §11.2/§11.3). */
  protected readonly joinButtonLabel = computed(() => {
    if (this.store.joinPhase() === 'requesting-mic') {
      return this.store.cameraEnabled() ? 'Requesting microphone & camera…' : 'Requesting microphone…';
    }
    if (this.store.joinPhase() === 'issuing-token') {
      return 'Joining…';
    }
    if (this.store.preflightStatus() === 'loading') {
      return 'Checking connection…';
    }
    if (this.store.preflightStatus() === 'error' && this.isRetryableError()) {
      return 'Retry';
    }
    return 'Join call';
  });

  /** Only the transport failure is retryable in place (UX_GUIDELINES §11.3) — config/paused are not. */
  protected readonly isRetryableError = computed(() => this.store.preflightError()?.code === 'TRANSPORT_UNAVAILABLE');

  /** No retry action at all for config-incomplete/paused-tenant (UX_GUIDELINES §11.3). */
  protected readonly preflightErrorSentence = computed(() => {
    const code = this.store.preflightError()?.code;
    return code ? (ERROR_SENTENCES[code] ?? 'This assistant is not available right now.') : null;
  });

  /**
   * Reflects both *why* the media-priming step failed and which device(s)
   * were actually requested (UX_GUIDELINES §11.8) — not a fixed sentence.
   */
  protected readonly micDeniedSentence = computed(() => {
    const kind = this.store.mediaErrorKind() ?? 'denied';
    const sentences = MEDIA_DENIED_SENTENCES[kind];
    return this.store.cameraEnabled() ? sentences.micAndCamera : sentences.mic;
  });

  /** Screen 9 step 3's pre-permission explainer text (UX_GUIDELINES §11.2 step 3), camera-aware for the same reason as {@link micDeniedSentence}. */
  protected readonly preJoinHint = computed(() =>
    this.store.cameraEnabled()
      ? "We'll ask for microphone and camera access to start the call."
      : "We'll ask for microphone access to start the call.",
  );

  protected readonly joinErrorSentence = computed(() => {
    const code = this.store.joinError()?.code;
    return code ? (ERROR_SENTENCES[code] ?? 'This assistant is not available right now.') : null;
  });

  constructor() {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.store.init(slug);

    effect(() => {
      if (!this.store.browserSupported()) {
        queueMicrotask(() => this.unsupportedHeading?.nativeElement.focus());
      }
    });
  }

  /** Screen 9 step 6 — the sole primary action (UX_GUIDELINES §11.2). */
  protected async onJoin(): Promise<void> {
    if (this.store.preflightStatus() === 'error' && !this.isRetryableError()) {
      return;
    }
    if (this.store.preflightStatus() === 'error') {
      await this.store.runPreflight();
      return;
    }
    await this.store.join(this.tabKey);
    if (this.store.session()) {
      const slug = this.route.snapshot.paramMap.get('slug') ?? '';
      // `<base href="/c/">` already supplies the `/c` prefix, so an absolute
      // commands array must NOT repeat it — `app.routes.ts` registers routes
      // starting at `:slug`, not `/c/:slug`. A leading `/c` here resolves
      // against the router's own (already base-relative) URL tree and throws
      // NG04002 (QA Phase 3 D-1: broke the entire Screen 9 -> 10 hand-off).
      await this.router.navigate([slug, 'call'], {
        state: { session: this.store.session(), displayName: this.store.displayName(), cameraEnabled: this.store.cameraEnabled() },
      });
    }
  }

  protected onDisplayNameChange(value: string): void {
    this.store.setDisplayName(value);
  }

  protected onCameraToggle(checked: boolean): void {
    this.store.setCameraEnabled(checked);
  }

  /** Disable Join while busy or on a non-retryable dead-end error (UX_GUIDELINES §11.3). */
  protected readonly joinDisabled = computed(
    () =>
      this.store.joinPhase() !== 'idle' ||
      (this.store.preflightStatus() === 'error' && !this.isRetryableError()),
  );
}
