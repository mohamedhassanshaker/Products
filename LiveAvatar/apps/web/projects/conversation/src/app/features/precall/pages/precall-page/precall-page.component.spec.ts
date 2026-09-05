import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { PublicApiService } from '@liveavatar/web-shared';
import { PrecallPageComponent } from './precall-page.component';
import * as browserCapability from '../../../../core/browser-capability';

describe('PrecallPageComponent (Screen 9, FR-CALL-1)', () => {
  let fixture: ComponentFixture<PrecallPageComponent>;
  let publicApi: { preflight: jest.Mock; createSession: jest.Mock };
  let router: { navigate: jest.Mock };

  function setup(slug = 'acme') {
    publicApi = { preflight: jest.fn().mockReturnValue(of(makePreflightOk())), createSession: jest.fn() };
    router = { navigate: jest.fn().mockResolvedValue(true) };
    jest.spyOn(browserCapability, 'isBrowserSupported').mockReturnValue(true);

    TestBed.configureTestingModule({
      imports: [PrecallPageComponent],
      providers: [
        { provide: PublicApiService, useValue: publicApi },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ slug }) } },
        },
      ],
    });
    fixture = TestBed.createComponent(PrecallPageComponent);
    fixture.detectChanges();
  }

  /** Flushes a chain of `await`-linked microtasks without depending on NgZone stability. */
  async function flushMicrotasks(times = 6): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      await Promise.resolve();
    }
  }

  function makePreflightOk() {
    return {
      deployment: { slug: 'acme', name: 'Acme' },
      transport: { reachable: true, ws_url: 'ws://x' },
      config: { complete: true },
      avatar: {},
    };
  }

  it('renders the browser-unsupported dead end when the feature-detect fails', () => {
    publicApi = { preflight: jest.fn(), createSession: jest.fn() };
    jest.spyOn(browserCapability, 'isBrowserSupported').mockReturnValue(false);
    TestBed.configureTestingModule({
      imports: [PrecallPageComponent],
      providers: [
        { provide: PublicApiService, useValue: publicApi },
        { provide: Router, useValue: { navigate: jest.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ slug: 'acme' }) } } },
      ],
    });
    fixture = TestBed.createComponent(PrecallPageComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain("This browser cannot run a live video call");
    expect(publicApi.preflight).not.toHaveBeenCalled();
  });

  it('runs preflight on init and shows a ready Join button on success', () => {
    setup();
    expect(publicApi.preflight).toHaveBeenCalledWith('acme');
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.la-precall__join');
    expect(button.disabled).toBe(false);
  });

  it('shows the config-incomplete sentence with no retry on that failure', async () => {
    setup();
    publicApi.preflight.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 422, error: { error: { code: 'CONFIG_INCOMPLETE', message: 'x', details: {} } } })),
    );
    const component = fixture.componentInstance;
    await (component as unknown as { store: { runPreflight: () => Promise<void> } }).store.runPreflight();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('This assistant is not available right now.');
    const button: HTMLButtonElement = el.querySelector('.la-precall__join')!;
    expect(button.textContent?.trim()).not.toBe('Retry');
    expect(button.disabled).toBe(true);
  });

  it('joins successfully and navigates to the call screen with router state', async () => {
    setup();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [{ stop: jest.fn() }] }) },
    });
    publicApi.createSession.mockReturnValue(
      of({ session_id: 's1', room_name: 'acme_s1', ws_url: 'ws://x', token: 'tok', expires_at: 'now' }),
    );
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    await flushMicrotasks();
    // `<base href="/c/">` already supplies `/c` — the commands array must NOT
    // repeat it (QA Phase 3 D-1).
    expect(router.navigate).toHaveBeenCalledWith(
      ['acme', 'call'],
      expect.objectContaining({ state: expect.objectContaining({ session: expect.objectContaining({ session_id: 's1' }) }) }),
    );
  });

  it('retries preflight in place on a retryable TRANSPORT_UNAVAILABLE failure', async () => {
    setup();
    publicApi.preflight.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 503, error: { error: { code: 'TRANSPORT_UNAVAILABLE', message: 'x', details: {} } } })),
    );
    await (fixture.componentInstance as unknown as { store: { runPreflight: () => Promise<void> } }).store.runPreflight();
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.la-precall__join');
    expect(button.textContent?.trim()).toBe('Retry');
    expect(button.disabled).toBe(false);

    publicApi.preflight.mockReturnValue(of(makePreflightOk()));
    button.click();
    await flushMicrotasks();
    fixture.detectChanges();
    expect(publicApi.preflight).toHaveBeenCalledTimes(3);
  });

  it('updates the display name and camera toggle on the store', () => {
    setup();
    const component = fixture.componentInstance as unknown as {
      onDisplayNameChange(v: string): void;
      onCameraToggle(v: boolean): void;
      store: { displayName: () => string; cameraEnabled: () => boolean };
    };
    component.onDisplayNameChange('Bob');
    expect(component.store.displayName()).toBe('Bob');
    component.onCameraToggle(true);
    expect(component.store.cameraEnabled()).toBe(true);
  });

  it('shows the mic-denied sentence and does not navigate when mic permission is denied', async () => {
    setup();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: jest.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError')) },
    });
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    await flushMicrotasks();
    fixture.detectChanges();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Microphone access is required to start.');
  });

  it('requests both camera and microphone, and shows the camera-aware denied sentence, once the camera toggle is on', async () => {
    setup();
    const getUserMedia = jest.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    (fixture.componentInstance as unknown as { onCameraToggle(v: boolean): void }).onCameraToggle(true);
    fixture.detectChanges();

    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    await flushMicrotasks();
    fixture.detectChanges();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: true });
    expect(fixture.nativeElement.textContent).toContain('Microphone and camera access are required to start.');
  });

  it('shows a "no microphone found" sentence, not a misleading "allow permission" one, when there is no microphone hardware', async () => {
    setup();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: jest.fn().mockRejectedValue(new DOMException('Requested device not found', 'NotFoundError')) },
    });
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    await flushMicrotasks();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No microphone was found on this device.');
    expect(fixture.nativeElement.textContent).not.toContain('Allow the microphone');
  });
});
