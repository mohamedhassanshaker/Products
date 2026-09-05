import { isBrowserSupported } from './browser-capability';

describe('isBrowserSupported (NFR-6)', () => {
  const originalMediaDevices = navigator.mediaDevices;
  const originalRtc = window.RTCPeerConnection;

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true });
    (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = originalRtc;
  });

  it('returns true when both getUserMedia and RTCPeerConnection exist', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.resolve() },
      configurable: true,
    });
    (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = function RTCPeerConnection() {};
    expect(isBrowserSupported()).toBe(true);
  });

  it('returns false when getUserMedia is missing', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = function RTCPeerConnection() {};
    expect(isBrowserSupported()).toBe(false);
  });

  it('returns false when RTCPeerConnection is missing', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.resolve() },
      configurable: true,
    });
    (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = undefined;
    expect(isBrowserSupported()).toBe(false);
  });
});
