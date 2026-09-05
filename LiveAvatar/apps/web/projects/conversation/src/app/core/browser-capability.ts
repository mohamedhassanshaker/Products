/**
 * Feature-detection browser-support check (NFR-6, UX_GUIDELINES §11.1/§11.2
 * step 2). Deliberately feature-detects (`getUserMedia`/`RTCPeerConnection`
 * presence) rather than user-agent sniffing, since a UA string is spoofable
 * and unreliable across browser forks — the spec's real requirement is "can
 * this browser actually run a WebRTC call," which feature detection answers
 * directly.
 * @returns true when the browser can plausibly run a live WebRTC call
 */
export function isBrowserSupported(): boolean {
  const hasGetUserMedia = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const hasRtcPeerConnection = typeof window !== 'undefined' && typeof window.RTCPeerConnection === 'function';
  return hasGetUserMedia && hasRtcPeerConnection;
}
