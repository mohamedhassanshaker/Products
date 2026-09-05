import { ComponentFixture, TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { PublicApiService } from '@liveavatar/web-shared';
import { CallPageComponent } from './call-page.component';
import { LiveKitRoomService, type CallConnectionState } from '../../../../core/livekit-room.service';

function makeSession() {
  return { session_id: 's1', room_name: 'acme_s1', ws_url: 'ws://x', token: 'tok', expires_at: 'now' };
}

describe('CallPageComponent (Screen 10, FR-CALL-2)', () => {
  let fixture: ComponentFixture<CallPageComponent>;
  let router: { navigate: jest.Mock; getCurrentNavigation: jest.Mock };
  let liveKit: {
    connect: jest.Mock;
    disconnect: jest.Mock;
    setMuted: jest.Mock;
    setCameraEnabled: jest.Mock;
    connectionState: ReturnType<typeof signal<CallConnectionState>>;
    hasAvatarVideo: ReturnType<typeof signal<boolean>>;
    muted: ReturnType<typeof signal<boolean>>;
    micLevel: ReturnType<typeof signal<number>>;
    captionText: ReturnType<typeof signal<string>>;
    captionsAvailable: ReturnType<typeof signal<boolean>>;
    hitlHold: ReturnType<typeof signal<{ message: string; slaSeconds: number | null; startedAt: number } | null>>;
    hitlDeferredOutcome: ReturnType<typeof signal<string | null>>;
  };
  let publicApi: { endSession: jest.Mock };

  function setHistoryState(state: unknown) {
    Object.defineProperty(window.history, 'state', { value: state, configurable: true });
  }

  /** Builds the fixture and flushes the `ngAfterViewInit` connect() microtask (fakeAsync context required). */
  function setup(state: unknown = { session: makeSession(), displayName: 'Alice', cameraEnabled: false }) {
    setHistoryState(state);
    router = { navigate: jest.fn().mockResolvedValue(true), getCurrentNavigation: jest.fn().mockReturnValue(null) };
    const connectionState = signal<CallConnectionState>('connecting');
    const hasAvatarVideo = signal(false);
    const muted = signal(false);
    const micLevel = signal(0);
    const captionText = signal('');
    const captionsAvailable = signal(true);
    const hitlHold = signal<{ message: string; slaSeconds: number | null; startedAt: number } | null>(null);
    const hitlDeferredOutcome = signal<string | null>(null);
    liveKit = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      setMuted: jest.fn().mockImplementation(async (m: boolean) => muted.set(m)),
      setCameraEnabled: jest.fn().mockResolvedValue(undefined),
      connectionState: connectionState as never,
      hasAvatarVideo: hasAvatarVideo as never,
      muted: muted as never,
      micLevel: micLevel as never,
      captionText: captionText as never,
      captionsAvailable: captionsAvailable as never,
      hitlHold: hitlHold as never,
      hitlDeferredOutcome: hitlDeferredOutcome as never,
    };
    publicApi = { endSession: jest.fn().mockReturnValue(of({ status: 'ended' })) };

    TestBed.configureTestingModule({
      imports: [CallPageComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: LiveKitRoomService, useValue: liveKit },
        { provide: PublicApiService, useValue: publicApi },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ slug: 'acme' }) } } },
      ],
    });
    fixture = TestBed.createComponent(CallPageComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    return { connectionState, hasAvatarVideo, muted, captionText, captionsAvailable, hitlHold, hitlDeferredOutcome };
  }

  /**
   * Same wiring as {@link setup}, but outside `fakeAsync` — used only by
   * tests that call a component method directly instead of going through
   * `fixture.detectChanges()`'s `ngAfterViewInit`/timer machinery.
   */
  function setupWithoutFakeAsync() {
    setHistoryState({ session: makeSession(), displayName: 'Alice', cameraEnabled: false });
    router = { navigate: jest.fn().mockResolvedValue(true), getCurrentNavigation: jest.fn().mockReturnValue(null) };
    liveKit = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      setMuted: jest.fn().mockResolvedValue(undefined),
      setCameraEnabled: jest.fn().mockResolvedValue(undefined),
      connectionState: signal<CallConnectionState>('connected') as never,
      hasAvatarVideo: signal(false) as never,
      muted: signal(false) as never,
      micLevel: signal(0) as never,
      captionText: signal('') as never,
      captionsAvailable: signal(true) as never,
      hitlHold: signal(null) as never,
      hitlDeferredOutcome: signal(null) as never,
    };
    publicApi = { endSession: jest.fn().mockReturnValue(of({ status: 'ended' })) };

    TestBed.configureTestingModule({
      imports: [CallPageComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: LiveKitRoomService, useValue: liveKit },
        { provide: PublicApiService, useValue: publicApi },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ slug: 'acme' }) } } },
      ],
    });
    fixture = TestBed.createComponent(CallPageComponent);
  }

  afterEach(() => {
    setHistoryState(undefined);
  });

  it('redirects to Screen 9 when there is no in-memory session state', fakeAsync(() => {
    // Explicit `undefined` would re-trigger the parameter default (standard
    // JS default-parameter semantics) instead of simulating "no session" —
    // `null` is a distinct value that still fails the component's
    // `!this.navState?.session` check.
    setup(null);
    // `<base href="/c/">` already supplies `/c` — the commands array must NOT
    // repeat it (QA Phase 3 D-1).
    expect(router.navigate).toHaveBeenCalledWith(['acme']);
    expect(liveKit.connect).not.toHaveBeenCalled();
    flush();
  }));

  it('connects to LiveKit with the session ws_url/token/cameraEnabled on view init', fakeAsync(() => {
    setup();
    expect(liveKit.connect).toHaveBeenCalledWith('ws://x', 'tok', false, expect.any(HTMLVideoElement));
    flush();
  }));

  it('shows the connecting overlay while connectionState is connecting', fakeAsync(() => {
    setup();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Connecting…');
    flush();
  }));

  it('mute toggles the local audio track via LiveKitRoomService', fakeAsync(() => {
    const { connectionState } = setup();
    connectionState.set('connected');
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.la-call__control--mute');
    button.click();
    tick();
    fixture.detectChanges();
    expect(liveKit.setMuted).toHaveBeenCalledWith(true);
    flush();
  }));

  it('end call button is enabled and wired to onEndCall', fakeAsync(() => {
    setup();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.la-call__control--end');
    expect(button.disabled).toBe(false);
    flush();
  }));

  it('end call disconnects, ends the session, and navigates to the post-call summary screen with the minted token', async () => {
    // Invoked directly (bypassing DOM click dispatch) — the async chain here
    // is several awaits deep (disconnect -> endSession subscribe -> navigate)
    // and plain async/await is a more reliable way to verify it than
    // reasoning about zone.js/fakeAsync microtask-flush granularity.
    setupWithoutFakeAsync();
    publicApi.endSession.mockReturnValue(of({ status: 'ended', summary_token: 'sum-tok', summary_token_expires_at: '2026-01-01T00:30:00.000Z' }));
    const component = fixture.componentInstance as unknown as { onEndCall(): Promise<void> };
    await component.onEndCall();
    expect(liveKit.disconnect).toHaveBeenCalled();
    expect(publicApi.endSession).toHaveBeenCalledWith('s1', { token: 'tok' });
    expect(router.navigate).toHaveBeenCalledWith(['acme', 'summary', 's1', 'sum-tok']);
  });

  it('end call falls back to the pre-call screen when the fast-path end returns no summary_token (a duplicate end-call)', async () => {
    setupWithoutFakeAsync();
    publicApi.endSession.mockReturnValue(of({ status: 'ended' }));
    const component = fixture.componentInstance as unknown as { onEndCall(): Promise<void> };
    await component.onEndCall();
    expect(router.navigate).toHaveBeenCalledWith(['acme']);
  });

  it('end call falls back to the pre-call screen when the fast-path end request fails (webhook remains authoritative)', async () => {
    setupWithoutFakeAsync();
    publicApi.endSession.mockReturnValue(throwError(() => new Error('network')));
    const component = fixture.componentInstance as unknown as { onEndCall(): Promise<void> };
    await component.onEndCall();
    expect(router.navigate).toHaveBeenCalledWith(['acme']);
  });

  it('shows the "still connecting" banner after 15s with no avatar track, and hides it once one arrives', fakeAsync(() => {
    const { connectionState, hasAvatarVideo } = setup();
    connectionState.set('connected');
    fixture.detectChanges();
    tick(15_000);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Still connecting you to your avatar…');

    hasAvatarVideo.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Still connecting you to your avatar…');
    flush();
  }));

  it('shows the reconnect-failed takeover after 30s, then redirects to Screen 9 2s later', fakeAsync(() => {
    const { connectionState } = setup();
    connectionState.set('reconnecting');
    fixture.detectChanges();
    tick(30_000);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Connection lost. Return to the start screen to rejoin.');
    expect(liveKit.disconnect).toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();

    tick(2_000);
    expect(router.navigate).toHaveBeenCalledWith(['acme']);
    flush();
  }));

  it('camera toggle calls setCameraEnabled with the flipped state (rendered because Screen 9 opted in)', fakeAsync(() => {
    setup({ session: makeSession(), displayName: 'Alice', cameraEnabled: true });
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.la-call__control--camera');
    button.click();
    tick();
    // Camera opted in on Screen 9 means it starts ON (`cameraOn` is seeded
    // from `navState.cameraEnabled`), so the first toggle click turns it off.
    expect(liveKit.setCameraEnabled).toHaveBeenCalledWith(false);
    flush();
  }));

  it('camera toggle is not rendered at all when Screen 9 did not opt in (QA Phase 3 D-4)', fakeAsync(() => {
    setup({ session: makeSession(), displayName: 'Alice', cameraEnabled: false });
    const button: HTMLButtonElement | null = fixture.nativeElement.querySelector('.la-call__control--camera');
    expect(button).toBeNull();
    flush();
  }));

  it('mic-level meter width tracks LiveKitRoomService.micLevel (QA Phase 3 D-3)', fakeAsync(() => {
    const { connectionState } = setup({ session: makeSession(), displayName: 'Alice', cameraEnabled: true });
    connectionState.set('connected');
    fixture.detectChanges();
    liveKit.micLevel.set(0.5);
    fixture.detectChanges();
    const fill: HTMLElement = fixture.nativeElement.querySelector('.la-call__mic-meter-fill');
    expect(fill.style.width).toBe('50%');
    flush();
  }));

  describe('HITL caller-side hold UX (A8.7)', () => {
    it('shows the "Getting approval" card with the hold message while hitlHold is set', fakeAsync(() => {
      const { connectionState, hitlHold } = setup();
      connectionState.set('connected');
      hitlHold.set({ message: 'Let me get that approved.', slaSeconds: 45, startedAt: Date.now() });
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.textContent).toContain('Getting approval');
      expect(el.textContent).toContain('Usually takes under a minute');
      expect(el.textContent).toContain('Let me get that approved.');
      flush();
    }));

    it('hides the "Getting approval" card once hitlHold clears', fakeAsync(() => {
      const { connectionState, hitlHold } = setup();
      connectionState.set('connected');
      hitlHold.set({ message: 'Waiting…', slaSeconds: null, startedAt: Date.now() });
      fixture.detectChanges();
      hitlHold.set(null);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.la-call__banner--hitl')).toBeNull();
      flush();
    }));

    it('shows the deferred-outcome banner once set', fakeAsync(() => {
      const { connectionState, hitlDeferredOutcome } = setup();
      connectionState.set('connected');
      hitlDeferredOutcome.set("I've submitted it. You'll get a text within the hour.");
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain("You'll get a text within the hour.");
      flush();
    }));
  });

  describe('live captions (FR-CALL-3, BL-017)', () => {
    it('are on by default and render the latest caption text once connected', fakeAsync(() => {
      const { connectionState, captionText } = setup();
      connectionState.set('connected');
      captionText.set('Hello, how can I help?');
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Hello, how can I help?');
      flush();
    }));

    it('are not rendered before the call is connected (e.g. during "Connecting…")', fakeAsync(() => {
      const { captionText } = setup();
      captionText.set('should not show yet');
      fixture.detectChanges();
      const captions: HTMLElement | null = fixture.nativeElement.querySelector('.la-call__captions');
      expect(captions).toBeNull();
      flush();
    }));

    it('the toggle button hides captions and flips its own label/aria-pressed state', fakeAsync(() => {
      const { connectionState, captionText } = setup();
      connectionState.set('connected');
      captionText.set('Some caption text');
      fixture.detectChanges();

      const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.la-call__control--captions');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      expect(toggle.textContent).toContain('Captions on');

      toggle.click();
      fixture.detectChanges();

      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      expect(toggle.textContent).toContain('Captions off');
      expect(fixture.nativeElement.querySelector('.la-call__captions')).toBeNull();
      flush();
    }));

    it('shows "Captions unavailable." instead of stale text when the source is down', fakeAsync(() => {
      const { connectionState, captionText, captionsAvailable } = setup();
      connectionState.set('connected');
      captionText.set('a previous line');
      captionsAvailable.set(false);
      fixture.detectChanges();
      const captions: HTMLElement = fixture.nativeElement.querySelector('.la-call__captions');
      expect(captions.textContent?.trim()).toBe('Captions unavailable.');
      flush();
    }));

    it('does not render an empty caption box the instant the call connects, before any text has arrived (QA D-3 fix)', fakeAsync(() => {
      const { connectionState, captionText, captionsAvailable } = setup();
      connectionState.set('connected');
      captionText.set('');
      captionsAvailable.set(true); // STT proven up, but no caption text has arrived yet
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.la-call__captions')).toBeNull();
      flush();
    }));

    it('does render (with the unavailable message) when connected with no text and captions not yet proven available', fakeAsync(() => {
      const { connectionState, captionText, captionsAvailable } = setup();
      connectionState.set('connected');
      captionText.set('');
      captionsAvailable.set(false);
      fixture.detectChanges();
      const captions: HTMLElement = fixture.nativeElement.querySelector('.la-call__captions');
      expect(captions.textContent?.trim()).toBe('Captions unavailable.');
      flush();
    }));
  });
});
