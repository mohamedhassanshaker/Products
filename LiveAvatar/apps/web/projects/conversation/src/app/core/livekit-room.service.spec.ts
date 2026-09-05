const connect = jest.fn().mockResolvedValue(undefined);
const disconnect = jest.fn().mockResolvedValue(undefined);
const setMicrophoneEnabled = jest.fn().mockResolvedValue(undefined);
const setCameraEnabled = jest.fn().mockResolvedValue(undefined);
const on = jest.fn();
let capturedHandlers: Record<string, (...args: unknown[]) => void> = {};

jest.mock('livekit-client', () => ({
  Room: jest.fn().mockImplementation(() => ({
    connect,
    disconnect,
    localParticipant: { setMicrophoneEnabled, setCameraEnabled, audioLevel: 0.5 },
    on: (event: string, handler: (...args: unknown[]) => void) => {
      capturedHandlers[event] = handler;
      return on(event, handler);
    },
  })),
  RoomEvent: {
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
    Disconnected: 'disconnected',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    TranscriptionReceived: 'transcriptionReceived',
    DataReceived: 'dataReceived',
  },
  Track: { Kind: { Video: 'video', Audio: 'audio' } },
}));

import { LiveKitRoomService } from './livekit-room.service';

describe('LiveKitRoomService (FR-CALL-2, the only file allowed to import livekit-client)', () => {
  let videoEl: HTMLVideoElement;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    capturedHandlers = {};
    videoEl = document.createElement('video');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('connects, publishes the mic, and moves to connected', async () => {
    const service = new LiveKitRoomService();
    await service.connect('ws://x', 'tok', false, videoEl);
    expect(connect).toHaveBeenCalledWith('ws://x', 'tok');
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(setCameraEnabled).not.toHaveBeenCalled();
    expect(service.connectionState()).toBe('connected');
  });

  it('publishes the camera too when cameraEnabled is true', async () => {
    const service = new LiveKitRoomService();
    await service.connect('ws://x', 'tok', true, videoEl);
    expect(setCameraEnabled).toHaveBeenCalledWith(true);
  });

  it('attaches a subscribed video track and marks hasAvatarVideo true', async () => {
    const service = new LiveKitRoomService();
    await service.connect('ws://x', 'tok', false, videoEl);
    const attach = jest.fn();
    capturedHandlers['trackSubscribed']({ kind: 'video', attach }, {}, {});
    expect(attach).toHaveBeenCalledWith(videoEl);
    expect(service.hasAvatarVideo()).toBe(true);
  });

  it('ignores a subscribed audio track for hasAvatarVideo', async () => {
    const service = new LiveKitRoomService();
    await service.connect('ws://x', 'tok', false, videoEl);
    capturedHandlers['trackSubscribed']({ kind: 'audio', attach: jest.fn() }, {}, {});
    expect(service.hasAvatarVideo()).toBe(false);
  });

  it('marks hasAvatarVideo false when the video track is unsubscribed', async () => {
    const service = new LiveKitRoomService();
    await service.connect('ws://x', 'tok', false, videoEl);
    capturedHandlers['trackSubscribed']({ kind: 'video', attach: jest.fn() }, {}, {});
    capturedHandlers['trackUnsubscribed']({ kind: 'video' });
    expect(service.hasAvatarVideo()).toBe(false);
  });

  it('reflects reconnecting/reconnected/disconnected connection state events', async () => {
    const service = new LiveKitRoomService();
    await service.connect('ws://x', 'tok', false, videoEl);
    capturedHandlers['reconnecting']();
    expect(service.connectionState()).toBe('reconnecting');
    capturedHandlers['reconnected']();
    expect(service.connectionState()).toBe('connected');
    capturedHandlers['disconnected']();
    expect(service.connectionState()).toBe('disconnected');
  });

  it('setMuted stops publishing audio and updates the muted signal', async () => {
    const service = new LiveKitRoomService();
    await service.connect('ws://x', 'tok', false, videoEl);
    await service.setMuted(true);
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(service.muted()).toBe(true);
  });

  it('polls a real mic level while unmuted', async () => {
    const service = new LiveKitRoomService();
    await service.connect('ws://x', 'tok', false, videoEl);
    jest.advanceTimersByTime(100);
    expect(service.micLevel()).toBe(0.5);
  });

  it('reports a flat mic level while muted', async () => {
    const service = new LiveKitRoomService();
    await service.connect('ws://x', 'tok', false, videoEl);
    await service.setMuted(true);
    jest.advanceTimersByTime(100);
    expect(service.micLevel()).toBe(0);
  });

  it('setCameraEnabled toggles the local camera track', async () => {
    const service = new LiveKitRoomService();
    await service.connect('ws://x', 'tok', false, videoEl);
    await service.setCameraEnabled(true);
    expect(setCameraEnabled).toHaveBeenCalledWith(true);
  });

  it('disconnect tears down the room and resets state', async () => {
    const service = new LiveKitRoomService();
    await service.connect('ws://x', 'tok', false, videoEl);
    await service.disconnect();
    expect(disconnect).toHaveBeenCalled();
    expect(service.connectionState()).toBe('disconnected');
    expect(service.hasAvatarVideo()).toBe(false);
    expect(service.micLevel()).toBe(0);
  });

  it('setMuted/setCameraEnabled/disconnect are safe no-ops before any connect', async () => {
    const service = new LiveKitRoomService();
    await service.setMuted(true);
    await service.setCameraEnabled(true);
    await expect(service.disconnect()).resolves.toBeUndefined();
  });

  describe('live captions (FR-CALL-3, BL-017)', () => {
    it('sets captionText to the latest segment and marks captions available', async () => {
      const service = new LiveKitRoomService();
      await service.connect('ws://x', 'tok', false, videoEl);
      capturedHandlers['transcriptionReceived']([
        { id: 'seg-1', text: 'Hello', final: false },
        { id: 'seg-1', text: 'Hello there', final: true },
      ]);
      expect(service.captionText()).toBe('Hello there');
      expect(service.captionsAvailable()).toBe(true);
    });

    it('ignores an empty segments array without clearing the previous caption', async () => {
      const service = new LiveKitRoomService();
      await service.connect('ws://x', 'tok', false, videoEl);
      capturedHandlers['transcriptionReceived']([{ id: 'seg-1', text: 'Hello', final: true }]);
      capturedHandlers['transcriptionReceived']([]);
      expect(service.captionText()).toBe('Hello');
    });

    it('clears captionText on disconnect', async () => {
      const service = new LiveKitRoomService();
      await service.connect('ws://x', 'tok', false, videoEl);
      capturedHandlers['transcriptionReceived']([{ id: 'seg-1', text: 'Hello', final: true }]);
      await service.disconnect();
      expect(service.captionText()).toBe('');
    });

    it('captionsAvailable defaults to false until a transcription is actually received (QA D-2 fix)', async () => {
      const service = new LiveKitRoomService();
      await service.connect('ws://x', 'tok', false, videoEl);
      expect(service.captionsAvailable()).toBe(false);
    });

    it('captionsAvailable flips false again on Reconnecting', async () => {
      const service = new LiveKitRoomService();
      await service.connect('ws://x', 'tok', false, videoEl);
      capturedHandlers['transcriptionReceived']([{ id: 'seg-1', text: 'Hello', final: true }]);
      expect(service.captionsAvailable()).toBe(true);

      capturedHandlers['reconnecting']();
      expect(service.captionsAvailable()).toBe(false);
    });

    it('captionsAvailable resets to false on disconnect', async () => {
      const service = new LiveKitRoomService();
      await service.connect('ws://x', 'tok', false, videoEl);
      capturedHandlers['transcriptionReceived']([{ id: 'seg-1', text: 'Hello', final: true }]);
      await service.disconnect();
      expect(service.captionsAvailable()).toBe(false);
    });
  });

  describe('HITL hold state (A8.7, forward-compatible scaffold — ARCHITECTURE_NOTES.md §6.2)', () => {
    function send(service: LiveKitRoomService, message: Record<string, unknown>): void {
      const payload = new TextEncoder().encode(JSON.stringify(message));
      capturedHandlers['dataReceived'](payload, {}, {}, 'hitl');
    }

    it('sets hitlHold on a hold_start message on the "hitl" topic', async () => {
      const service = new LiveKitRoomService();
      await service.connect('ws://x', 'tok', false, videoEl);
      send(service, { type: 'hold_start', message: 'Let me get that approved.', sla_seconds: 45 });
      expect(service.hitlHold()).toEqual(expect.objectContaining({ message: 'Let me get that approved.', slaSeconds: 45 }));
    });

    it('falls back to generic copy when hold_start carries no message', async () => {
      const service = new LiveKitRoomService();
      await service.connect('ws://x', 'tok', false, videoEl);
      send(service, { type: 'hold_start' });
      expect(service.hitlHold()?.message).toBe('Still waiting on approval — thanks for bearing with me.');
      expect(service.hitlHold()?.slaSeconds).toBeNull();
    });

    it('clears hitlHold on hold_end', async () => {
      const service = new LiveKitRoomService();
      await service.connect('ws://x', 'tok', false, videoEl);
      send(service, { type: 'hold_start' });
      send(service, { type: 'hold_end' });
      expect(service.hitlHold()).toBeNull();
    });

    it('sets hitlDeferredOutcome and clears hitlHold on a deferred_outcome message', async () => {
      const service = new LiveKitRoomService();
      await service.connect('ws://x', 'tok', false, videoEl);
      send(service, { type: 'hold_start' });
      send(service, { type: 'deferred_outcome', message: "You'll get a text within the hour." });
      expect(service.hitlHold()).toBeNull();
      expect(service.hitlDeferredOutcome()).toBe("You'll get a text within the hour.");
    });

    it('ignores messages on other topics', async () => {
      const service = new LiveKitRoomService();
      await service.connect('ws://x', 'tok', false, videoEl);
      const payload = new TextEncoder().encode(JSON.stringify({ type: 'hold_start' }));
      capturedHandlers['dataReceived'](payload, {}, {}, 'some-other-topic');
      expect(service.hitlHold()).toBeNull();
    });

    it('ignores malformed payloads without throwing', async () => {
      const service = new LiveKitRoomService();
      await service.connect('ws://x', 'tok', false, videoEl);
      const payload = new TextEncoder().encode('not json');
      expect(() => capturedHandlers['dataReceived'](payload, {}, {}, 'hitl')).not.toThrow();
      expect(service.hitlHold()).toBeNull();
    });

    it('clears hitlHold on disconnect', async () => {
      const service = new LiveKitRoomService();
      await service.connect('ws://x', 'tok', false, videoEl);
      send(service, { type: 'hold_start' });
      await service.disconnect();
      expect(service.hitlHold()).toBeNull();
    });
  });
});
