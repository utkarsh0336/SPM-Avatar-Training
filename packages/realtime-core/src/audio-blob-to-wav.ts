export interface EncodedWav {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: "audio/wav";
  /**
   * RMS (0-1) of the whole decoded clip, not just a momentary sample — lets
   * the caller reject a "turn" whose overall energy never actually reached
   * speech level (a brief noise spike can satisfy voice-activity-detector.ts's
   * live per-frame threshold and still produce an all-but-silent clip
   * overall). Whisper-family STT models are documented to hallucinate
   * plausible-sounding text on near-silent audio rather than reporting "no
   * speech" — sending such a clip at all is the bug, not a transcription
   * accuracy issue. See conversation-session.ts's MIN_UTTERANCE_RMS.
   */
  rms: number;
}

export interface EncodeBlobAsWavOptions {
  blob: Blob;
  /** Injectable for tests; defaults to a real AudioContext. */
  createAudioContext?: () => AudioContext;
}

/**
 * Decodes a recorded audio Blob (whatever format MediaRecorder produced —
 * typically audio/webm;codecs=opus in Chrome) and re-encodes it as a mono
 * 16-bit PCM WAV file. Needed because Gemini's generateContent audio input
 * only documents wav/mp3/aiff/aac/ogg/flac support — not webm/opus — see
 * packages/shared/src/realtime/gemini.ts.
 */
export async function encodeBlobAsWav(options: EncodeBlobAsWavOptions): Promise<EncodedWav> {
  const audioContext = options.createAudioContext?.() ?? new AudioContext();
  const arrayBuffer = await options.blob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const mono = downmixToMono(audioBuffer);
  return { bytes: encodeMonoAsWav(mono, audioBuffer.sampleRate), mimeType: "audio/wav", rms: computeRms(mono) };
}

function downmixToMono(audioBuffer: AudioBuffer): Float32Array {
  const numFrames = audioBuffer.length;
  const channelCount = audioBuffer.numberOfChannels;

  // Downmix to mono — voice input has no meaningful stereo content, and
  // this halves the payload sent to Gemini and over the wire.
  const mono = new Float32Array(numFrames);
  for (let channel = 0; channel < channelCount; channel++) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < numFrames; i++) {
      mono[i]! += data[i]! / channelCount;
    }
  }
  return mono;
}

function computeRms(mono: Float32Array): number {
  if (mono.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < mono.length; i++) {
    sumSquares += mono[i]! * mono[i]!;
  }
  return Math.sqrt(sumSquares / mono.length);
}

function encodeMonoAsWav(mono: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const numFrames = mono.length;
  const bytesPerSample = 2; // 16-bit PCM
  const dataSize = numFrames * bytesPerSample;
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
  for (let i = 0; i < numFrames; i++) {
    const sample = Math.max(-1, Math.min(1, mono[i]!));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Uint8Array(buffer);
}

function writeAsciiString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
