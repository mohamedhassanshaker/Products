import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { PublicApiService } from '@liveavatar/web-shared';
import { CallSessionStore } from './call-session.store';
import * as browserCapability from './browser-capability';

describe('CallSessionStore (UX_GUIDELINES §11.1)', () => {
  let publicApi: { preflight: jest.Mock; createSession: jest.Mock };

  function setupMediaDevices(behavior: 'grant' | 'deny') {
    const stopMock = jest.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia:
          behavior === 'grant'
            ? jest.fn().mockResolvedValue({ getTracks: () => [{ stop: stopMock }] })
            : jest.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError')),
      },
    });
    return { stopMock };
  }

  beforeEach(() => {
    publicApi = { preflight: jest.fn(), createSession: jest.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: PublicApiService, useValue: publicApi }],
    });
    jest.spyOn(browserCapability, 'isBrowserSupported').mockReturnValue(true);
  });

  it('init runs preflight in the background and marks it ok on success', async () => {
    publicApi.preflight.mockReturnValue(
      of({ deployment: { slug: 'acme', name: 'Acme' }, transport: { reachable: true, ws_url: 'ws://x' }, config: { complete: true }, avatar: {} }),
    );
    const store = TestBed.inject(CallSessionStore);
    store.init('acme');
    await Promise.resolve();
    await Promise.resolve();
    expect(store.preflightStatus()).toBe('ok');
    expect(store.slug()).toBe('acme');
  });

  it('init does not run preflight when the browser is unsupported', () => {
    jest.spyOn(browserCapability, 'isBrowserSupported').mockReturnValue(false);
    const store = TestBed.inject(CallSessionStore);
    store.init('acme');
    expect(publicApi.preflight).not.toHaveBeenCalled();
    expect(store.browserSupported()).toBe(false);
  });

  it('marks preflight error with the mapped client error on failure', async () => {
    publicApi.preflight.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 422, error: { error: { code: 'CONFIG_INCOMPLETE', message: 'x', details: {} } } })),
    );
    const store = TestBed.inject(CallSessionStore);
    store.init('acme');
    await Promise.resolve();
    await Promise.resolve();
    expect(store.preflightStatus()).toBe('error');
    expect(store.preflightError()?.code).toBe('CONFIG_INCOMPLETE');
  });

  it('setDisplayName clamps to 40 characters', () => {
    const store = TestBed.inject(CallSessionStore);
    store.setDisplayName('a'.repeat(50));
    expect(store.displayName()).toHaveLength(40);
  });

  it('setCameraEnabled toggles camera state', () => {
    const store = TestBed.inject(CallSessionStore);
    store.setCameraEnabled(true);
    expect(store.cameraEnabled()).toBe(true);
  });

  it('join sets micDenied and does not call createSession when mic permission is denied', async () => {
    setupMediaDevices('deny');
    const store = TestBed.inject(CallSessionStore);
    store.init('acme');
    await store.join('tab-1');
    expect(store.micDenied()).toBe(true);
    expect(store.mediaErrorKind()).toBe('denied');
    expect(store.joinPhase()).toBe('idle');
    expect(publicApi.createSession).not.toHaveBeenCalled();
  });

  it('join classifies a missing-device failure as mediaErrorKind "not_found", not "denied"', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: jest.fn().mockRejectedValue(new DOMException('Requested device not found', 'NotFoundError')) },
    });
    const store = TestBed.inject(CallSessionStore);
    store.init('acme');
    await store.join('tab-1');
    expect(store.micDenied()).toBe(true);
    expect(store.mediaErrorKind()).toBe('not_found');
  });

  it('join classifies an unrecognized getUserMedia failure as mediaErrorKind "other"', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: jest.fn().mockRejectedValue(new DOMException('Could not start video source', 'NotReadableError')) },
    });
    const store = TestBed.inject(CallSessionStore);
    store.init('acme');
    await store.join('tab-1');
    expect(store.mediaErrorKind()).toBe('other');
  });

  it('join stops the priming mic track and mints a session on success', async () => {
    const { stopMock } = setupMediaDevices('grant');
    publicApi.createSession.mockReturnValue(
      of({ session_id: 's1', room_name: 'acme_s1', ws_url: 'ws://x', token: 'tok', expires_at: 'now' }),
    );
    const store = TestBed.inject(CallSessionStore);
    store.init('acme');
    store.setDisplayName('Alice');
    await store.join('tab-1');
    expect(stopMock).toHaveBeenCalled();
    expect(publicApi.createSession).toHaveBeenCalledWith({ slug: 'acme', display_name: 'Alice', tab_key: 'tab-1' });
    expect(store.session()?.session_id).toBe('s1');
  });

  it('join primes only microphone permission when the camera toggle is off (the default)', async () => {
    setupMediaDevices('grant');
    const store = TestBed.inject(CallSessionStore);
    store.init('acme');
    await store.join('tab-1');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
  });

  it('join also primes camera permission when the caller opted in via the camera toggle', async () => {
    setupMediaDevices('grant');
    const store = TestBed.inject(CallSessionStore);
    store.init('acme');
    store.setCameraEnabled(true);
    await store.join('tab-1');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true, video: true });
  });

  it('join defaults display_name to Guest when blank', async () => {
    setupMediaDevices('grant');
    publicApi.createSession.mockReturnValue(
      of({ session_id: 's1', room_name: 'acme_s1', ws_url: 'ws://x', token: 'tok', expires_at: 'now' }),
    );
    const store = TestBed.inject(CallSessionStore);
    store.init('acme');
    await store.join('tab-1');
    expect(publicApi.createSession).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'Guest' }));
  });

  it('join records the mapped error when token issuance fails', async () => {
    setupMediaDevices('grant');
    publicApi.createSession.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 503, error: { error: { code: 'TRANSPORT_UNAVAILABLE', message: 'x', details: {} } } })),
    );
    const store = TestBed.inject(CallSessionStore);
    store.init('acme');
    await store.join('tab-1');
    expect(store.joinError()?.code).toBe('TRANSPORT_UNAVAILABLE');
    expect(store.joinPhase()).toBe('idle');
  });

  it('join is a no-op when there is no slug', async () => {
    const store = TestBed.inject(CallSessionStore);
    await store.join('tab-1');
    expect(publicApi.createSession).not.toHaveBeenCalled();
  });

  it('runPreflight is a no-op when there is no slug', async () => {
    const store = TestBed.inject(CallSessionStore);
    await store.runPreflight();
    expect(publicApi.preflight).not.toHaveBeenCalled();
  });
});
