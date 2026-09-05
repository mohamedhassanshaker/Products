import { Injectable, signal } from '@angular/core';
import { Room, RoomEvent, Track, type RemoteTrack, type TranscriptionSegment } from 'livekit-client';

/** Screen 10 connection lifecycle (UX_GUIDELINES §12.2). */
export type CallConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Mic-level poll interval — a calm ~10Hz cadence per UX_GUIDELINES §12.4. */
const MIC_LEVEL_POLL_MS = 100;

/**
 * Thin wrapper around the LiveKit JS SDK (FR-CALL-2, FR-TRANSPORT-2). The
 * only file in `apps/web` that imports `livekit-client` (LLD §3.2 — "the
 * conversation SPA only"); the `call` feature depends on this service's
 * signals, never the SDK directly, so a future SDK version bump or swap is
 * contained to one file.
 */
@Injectable({ providedIn: 'root' })
export class LiveKitRoomService {
  private room: Room | null = null;
  private micLevelHandle: ReturnType<typeof setInterval> | null = null;

  private readonly _connectionState = signal<CallConnectionState>('disconnected');
  private readonly _hasAvatarVideo = signal(false);
  private readonly _muted = signal(false);
  private readonly _micLevel = signal(0);
  /**
   * FR-CALL-3 live captions — sourced from STT partials/finals the agent
   * forwards over the room's built-in LiveKit transcription channel
   * (`RoomEvent.TranscriptionReceived`, the JS SDK's standard decode of the
   * `lk.transcription` data-channel topic `livekit-agents` publishes to;
   * see `apps/agent/src/avatar_agent/adapters/transport/livekit.py`'s
   * `publish_transcription`). Caption text is never sent to any extra
   * remote service (FR-CALL-3) — it only ever flows LiveKit room -> this
   * signal -> the DOM.
   */
  private readonly _captionText = signal('');
  private readonly _captionsAvailable = signal(false);
  /**
   * HITL hold state (A8.7's "Getting approval" state, R-H5) — set from the
   * `hitl` room data-channel topic. `docs/v2/ARCHITECTURE_NOTES.md` §6.2
   * flags a push channel (SSE, or LiveKit room data messages, since the
   * agent is already a room participant) as "a reasonable fast-follow,
   * explicitly not required for v1" for decision *delivery* to the
   * agent — the same mechanism doubles as the cheapest way to tell this
   * SPA a gate has opened, since v1 otherwise has no live channel to the
   * browser for this at all. Until the agent side (`apps/agent`, out of
   * this phase's scope) actually publishes on this topic, these signals
   * simply never flip and the caller only ever hears the hold-treatment
   * speech via the existing `_speak()` path — this is additive UI, not a
   * replacement for it (R-H5's actual requirement is satisfied by speech
   * either way). Message shape: `{type: 'hold_start', message?, sla_seconds?}`
   * / `{type: 'hold_end'}` / `{type: 'deferred_outcome', message?}`.
   */
  private readonly _hitlHold = signal<{ message: string; slaSeconds: number | null; startedAt: number } | null>(null);
  private readonly _hitlDeferredOutcome = signal<string | null>(null);

  /** Screen 10's `aria-live` status region drives off this (UX_GUIDELINES §12.5). */
  readonly connectionState = this._connectionState.asReadonly();
  /** Drives the "still connecting you to your avatar…" banner (FR-AVATAR-5 client half, §12.2). */
  readonly hasAvatarVideo = this._hasAvatarVideo.asReadonly();
  readonly muted = this._muted.asReadonly();
  readonly micLevel = this._micLevel.asReadonly();
  /** Latest partial/final caption line (FR-CALL-3). */
  readonly captionText = this._captionText.asReadonly();
  /**
   * `false` while STT is unreachable/unproven for this session (FR-CALL-3:
   * "If STT down, hide captions and show 'Captions unavailable.'").
   *
   * QA fix (phase4-conversation-captions D-2): this used to default `true`
   * and never flip `false` anywhere, so the spec's fallback text could
   * never actually surface. No dedicated real-time "STT health" channel
   * exists to the browser yet (a phase-4 scope decision, see the plan
   * doc's deviation log), so this is wired to the best signal actually
   * available — whether a live transcription stream has been proven to
   * exist this call: starts `false` on every `connect()` (STT not proven
   * yet), flips `true` the moment the first `TranscriptionReceived` event
   * arrives, and flips back to `false` on `Reconnecting`/`disconnect()`
   * (the room's own audio path, and therefore STT, is necessarily
   * interrupted). A brief `false` right after connecting before the
   * agent's first transcription is expected and correct, not a bug — the
   * template only renders the caption box once the connection itself is
   * `connected`, so this reads as "captions unavailable" for a moment,
   * not an empty box (see the caption container's own guard, D-3).
   */
  readonly captionsAvailable = this._captionsAvailable.asReadonly();
  /** Non-null while a HITL gate is holding the turn (A8.7 "Getting approval" state). */
  readonly hitlHold = this._hitlHold.asReadonly();
  /** Non-null after a deferred approval's outcome message arrives (A8.7 "Deferred outcome" state) — cleared on the next `connect()`. */
  readonly hitlDeferredOutcome = this._hitlDeferredOutcome.asReadonly();

  /**
   * Connects to the room, publishes the local mic (and camera, if opted
   * into on Screen 9), and attaches the first remote video track it
   * subscribes to onto `videoElement` (the avatar surface, FR-CALL-2).
   * @param wsUrl - LiveKit `ws_url` from the issued session
   * @param token - LiveKit room-scoped user token
   * @param cameraEnabled - Whether to also publish the local camera
   * @param videoElement - `<video>` element the avatar track attaches to
   */
  async connect(wsUrl: string, token: string, cameraEnabled: boolean, videoElement: HTMLVideoElement): Promise<void> {
    const room = new Room();
    this.room = room;
    this._connectionState.set('connecting');
    this._hasAvatarVideo.set(false);
    this._captionsAvailable.set(false);
    this._hitlHold.set(null);
    this._hitlDeferredOutcome.set(null);

    room.on(RoomEvent.Reconnecting, () => {
      this._connectionState.set('reconnecting');
      this._captionsAvailable.set(false);
    });
    room.on(RoomEvent.Reconnected, () => this._connectionState.set('connected'));
    room.on(RoomEvent.Disconnected, () => this._connectionState.set('disconnected'));
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video) {
        track.attach(videoElement);
        this._hasAvatarVideo.set(true);
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video) {
        this._hasAvatarVideo.set(false);
      }
    });
    room.on(RoomEvent.TranscriptionReceived, (segments: TranscriptionSegment[]) => {
      const latest = segments.at(-1);
      if (latest) {
        this._captionText.set(latest.text);
        this._captionsAvailable.set(true);
      }
    });
    room.on(RoomEvent.DataReceived, (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic !== 'hitl') {
        return;
      }
      this.onHitlDataMessage(payload);
    });

    await room.connect(wsUrl, token);
    this._connectionState.set('connected');

    await room.localParticipant.setMicrophoneEnabled(true);
    if (cameraEnabled) {
      await room.localParticipant.setCameraEnabled(true);
    }
    this.startMicLevelPolling();
  }

  /** Screen 10 mute/unmute (FR-CALL-2) — stops/resumes publishing the local audio track. */
  async setMuted(muted: boolean): Promise<void> {
    if (this.room) {
      await this.room.localParticipant.setMicrophoneEnabled(!muted);
    }
    this._muted.set(muted);
  }

  /** Screen 10 optional camera toggle (UX_GUIDELINES §12.2, an authored/non-spec control). */
  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (this.room) {
      await this.room.localParticipant.setCameraEnabled(enabled);
    }
  }

  /** End-call (FR-CALL-2) — always available, never blocked by another in-flight state. */
  async disconnect(): Promise<void> {
    this.stopMicLevelPolling();
    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }
    this._connectionState.set('disconnected');
    this._hasAvatarVideo.set(false);
    this._captionText.set('');
    this._captionsAvailable.set(false);
    this._hitlHold.set(null);
  }

  /**
   * Decodes a `topic: 'hitl'` data message (see `_hitlHold`'s doc comment
   * for the shape and why this listener exists ahead of the agent side
   * actually publishing anything). Malformed/unrecognized payloads are
   * ignored rather than thrown — a best-effort UI enhancement should never
   * be able to break the call.
   */
  private onHitlDataMessage(payload: Uint8Array): void {
    try {
      const message = JSON.parse(new TextDecoder().decode(payload)) as {
        type?: string;
        message?: string;
        sla_seconds?: number;
      };
      if (message.type === 'hold_start') {
        this._hitlHold.set({
          message: message.message ?? 'Still waiting on approval — thanks for bearing with me.',
          slaSeconds: typeof message.sla_seconds === 'number' ? message.sla_seconds : null,
          startedAt: Date.now(),
        });
      } else if (message.type === 'hold_end') {
        this._hitlHold.set(null);
      } else if (message.type === 'deferred_outcome') {
        this._hitlHold.set(null);
        this._hitlDeferredOutcome.set(
          message.message ?? "I couldn't get that approved right now, but I've submitted it. You'll hear about the outcome soon.",
        );
      }
    } catch {
      // Ignored — see doc comment above.
    }
  }

  /**
   * Polls the local participant's speaking level so the mic-level meter
   * shows real input (UX_GUIDELINES §12.4/§12.5 — a deaf/HoH visual signal
   * that the mic is live). Degrades to a flat 0 rather than throwing if the
   * SDK build in use doesn't expose `audioLevel`.
   */
  private startMicLevelPolling(): void {
    this.micLevelHandle = setInterval(() => {
      const level = this.muted() ? 0 : (this.room?.localParticipant.audioLevel ?? 0);
      this._micLevel.set(level);
    }, MIC_LEVEL_POLL_MS);
  }

  private stopMicLevelPolling(): void {
    if (this.micLevelHandle !== null) {
      clearInterval(this.micLevelHandle);
      this.micLevelHandle = null;
    }
    this._micLevel.set(0);
  }
}
