import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import type { PublicSessionResponse } from '@liveavatar/contracts';
import { PublicApiService, toAppClientError, type AppClientError } from '@liveavatar/web-shared';
import { isBrowserSupported } from './browser-capability';

/** Screen 9 preflight lifecycle (UX_GUIDELINES §11.3). */
export type PreflightStatus = 'idle' | 'loading' | 'ok' | 'error';

/** Session-scoped call state (UX_GUIDELINES §11.1's `CallSessionStore`).
 * Deliberately never persisted to `localStorage` — a LiveKit token is a
 * short-TTL bearer credential and should not outlive the tab (§11.1).
 */
/** Screen 9 "Join call" busy sub-phase (UX_GUIDELINES §11.3 distinct busy labels). */
export type JoinPhase = 'idle' | 'requesting-mic' | 'issuing-token';

/**
 * Why the media-priming step failed — `getUserMedia` throws the same shape
 * of rejection for genuinely different situations, and only one of them
 * ("denied") is fixed by the caller allowing something in their browser.
 * `not_found` (no microphone/camera hardware at all) and `other` (device
 * busy, OS-level failure, unsatisfiable constraints) need their own wording
 * — telling someone with no microphone to "allow" it is actively wrong.
 */
export type MediaErrorKind = 'denied' | 'not_found' | 'other';

interface CallSessionState {
  slug: string | null;
  displayName: string;
  cameraEnabled: boolean;
  browserSupported: boolean;
  preflightStatus: PreflightStatus;
  preflightError: AppClientError | null;
  micDenied: boolean;
  mediaErrorKind: MediaErrorKind | null;
  joinPhase: JoinPhase;
  joinError: AppClientError | null;
  session: PublicSessionResponse | null;
}

const initialState: CallSessionState = {
  slug: null,
  displayName: '',
  cameraEnabled: false,
  browserSupported: true,
  preflightStatus: 'idle',
  preflightError: null,
  micDenied: false,
  mediaErrorKind: null,
  joinPhase: 'idle',
  joinError: null,
  session: null,
};

/** Default display name when the end user leaves the field blank (FR-AUTH-4). */
const DEFAULT_DISPLAY_NAME = 'Guest';

/**
 * Session-scoped call state (UX_GUIDELINES §11.1). Owns the Screen 9→10
 * hand-off: preflight result, mic/camera choices, and the issued LiveKit
 * tokens, in memory only.
 */
export const CallSessionStore = signalStore(
  { providedIn: 'root' },
  withState<CallSessionState>(initialState),
  withMethods((store) => {
    const publicApi = inject(PublicApiService);

    return {
      /**
       * Screen 9 entry (UX_GUIDELINES §11.2 step 1-2). Runs the
       * browser-support feature-detect first — if it fails, preflight is not
       * even attempted (§11.2 step 2).
       * @param slug - Tenant's public deployment slug from the route
       */
      init(slug: string): void {
        const browserSupported = isBrowserSupported();
        patchState(store, { ...initialState, slug, browserSupported });
        if (browserSupported) {
          void this.runPreflight();
        }
      },

      /** `GET /public/deployments/{slug}/preflight` (FR-CALL-1 step 2). */
      async runPreflight(): Promise<void> {
        const slug = store.slug();
        if (!slug) {
          return;
        }
        patchState(store, { preflightStatus: 'loading', preflightError: null });
        try {
          await firstValueFrom(publicApi.preflight(slug));
          patchState(store, { preflightStatus: 'ok' });
        } catch (err) {
          patchState(store, { preflightStatus: 'error', preflightError: asClientError(err) });
        }
      },

      /** Clamped, silently — no validation error is ever shown for this field (UX_GUIDELINES §11.2 step 4). */
      setDisplayName(value: string): void {
        patchState(store, { displayName: value.slice(0, 40) });
      },

      /** Camera is optional and off by default (UX_GUIDELINES §11.1). */
      setCameraEnabled(value: boolean): void {
        patchState(store, { cameraEnabled: value });
      },

      /**
       * Screen 9 "Join call" (FR-CALL-1 steps 6-10). Requests microphone
       * (and, when the caller opted in via the camera toggle, camera)
       * permission first (only on this explicit tap, never on page load —
       * UX_GUIDELINES §11.2 step 7), then mints the conversation token.
       * @param tabKey - Per-tab correlation key for FR-AUTH-4 idempotency
       */
      async join(tabKey: string): Promise<void> {
        const slug = store.slug();
        if (!slug) {
          return;
        }
        patchState(store, { joinPhase: 'requesting-mic', micDenied: false, mediaErrorKind: null, joinError: null });

        try {
          await requestMediaPermissions(store.cameraEnabled());
        } catch (err) {
          patchState(store, { joinPhase: 'idle', micDenied: true, mediaErrorKind: classifyMediaError(err) });
          return;
        }

        patchState(store, { joinPhase: 'issuing-token' });
        try {
          const session = await firstValueFrom(
            publicApi.createSession({
              slug,
              display_name: store.displayName().trim() || DEFAULT_DISPLAY_NAME,
              tab_key: tabKey,
            }),
          );
          patchState(store, { joinPhase: 'idle', session });
        } catch (err) {
          patchState(store, { joinPhase: 'idle', joinError: asClientError(err) });
        }
      },
    };
  }),
);

/**
 * Requests mic (and, when opted in, camera) permission via a bare
 * `getUserMedia` call, then immediately releases the track(s). This is a
 * permission-priming step only — the LiveKit JS SDK acquires its own
 * published track(s) after the room connection is established (Screen 10);
 * this call exists solely so the browser's native permission prompt(s) fire
 * at the moment UX_GUIDELINES §11.2 step 7 requires, for every device the
 * caller opted into up front rather than surprising them with a second
 * prompt mid-connect on Screen 10.
 * @param cameraEnabled - Whether to also request camera permission (mirrors the "Turn on camera" toggle)
 */
async function requestMediaPermissions(cameraEnabled: boolean): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: cameraEnabled });
  stream.getTracks().forEach((track) => track.stop());
}

/** Names browsers actually throw from `getUserMedia` per the spec — https://www.w3.org/TR/mediacapture-streams/#dom-mediadevices-getusermedia. */
const DENIED_ERROR_NAMES = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError']);
const NOT_FOUND_ERROR_NAMES = new Set(['NotFoundError', 'DevicesNotFoundError']);

/** @param err - Whatever `requestMediaPermissions` rejected with */
function classifyMediaError(err: unknown): MediaErrorKind {
  const name = err instanceof DOMException ? err.name : undefined;
  if (name && DENIED_ERROR_NAMES.has(name)) {
    return 'denied';
  }
  if (name && NOT_FOUND_ERROR_NAMES.has(name)) {
    return 'not_found';
  }
  return 'other';
}

/** @param err - Unknown thrown value from an HttpClient observable */
function asClientError(err: unknown): AppClientError {
  if (err && typeof err === 'object' && 'code' in err) {
    return err as AppClientError;
  }
  return toAppClientError(err as never);
}
