/**
 * Standalone WAV encoder for 16-bit PCM samples, working directly from an
 * Int16Array — the sample format @livekit/rtc-node's AudioFrame already
 * hands back, so no Float32 round-trip is needed here. Deliberately NOT
 * shared with packages/realtime-core/src/audio-blob-to-wav.ts's
 * Float32-based encodeMonoAsWav (unexported, browser-Blob/AudioContext
 * oriented) — that package's other exports assume browser globals
 * (MediaStreamTrack, MediaRecorder, WebSocket-as-global), which apps/agent
 * (a Node process) shouldn't take on as a dependency just to reuse one
 * function. Same duplication-over-cross-boundary-dependency precedent this
 * codebase already establishes elsewhere (AvatarEmotion,
 * AvatarProviderStartConfig).
 */
export function encodeInt16PcmAsWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAsciiString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAsciiString(view, 8, "WAVE");
  writeAsciiString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAsciiString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(offset, samples[i]!, true);
    offset += bytesPerSample;
  }

  return new Uint8Array(buffer);
}

/** RMS (0-1) of a whole PCM clip — same "reject a turn whose overall energy never reached
 * speech level" guard packages/realtime-core/src/conversation-session.ts's MIN_UTTERANCE_RMS
 * already applies client-side, ported here for the server-side turn loop. */
export function computeInt16PcmRms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i]! / 32768;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / samples.length);
}

function writeAsciiString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
