import { describe, expect, it, vi } from "vitest";
import { encodeBlobAsWav } from "./audio-blob-to-wav.js";

function createFakeAudioBuffer(channels: number[][], sampleRate = 16000) {
  const length = channels[0]?.length ?? 0;
  return {
    sampleRate,
    length,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => new Float32Array(channels[channel]!),
  };
}

function createFakeAudioContext(audioBuffer: unknown) {
  return { decodeAudioData: vi.fn().mockResolvedValue(audioBuffer) };
}

function readAsciiString(view: DataView, offset: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint8(offset + i));
  return text;
}

describe("encodeBlobAsWav", () => {
  it("writes a valid 44-byte RIFF/WAVE header matching the source sample rate and mono output", async () => {
    const audioBuffer = createFakeAudioBuffer([[0, 0.5, -0.5, 1, -1]], 22050);
    const context = createFakeAudioContext(audioBuffer);

    const result = await encodeBlobAsWav({
      blob: new Blob([new Uint8Array([1, 2, 3])]),
      createAudioContext: () => context as unknown as AudioContext,
    });

    expect(result.mimeType).toBe("audio/wav");
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    expect(readAsciiString(view, 0, 4)).toBe("RIFF");
    expect(readAsciiString(view, 8, 4)).toBe("WAVE");
    expect(readAsciiString(view, 12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(22050); // sample rate preserved
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(readAsciiString(view, 36, 4)).toBe("data");
    const dataSize = view.getUint32(40, true);
    expect(dataSize).toBe(5 * 2); // 5 frames * 16-bit
    expect(result.bytes.byteLength).toBe(44 + dataSize);
  });

  it("quantizes float samples to 16-bit PCM correctly", async () => {
    const audioBuffer = createFakeAudioBuffer([[0, 0.5, -0.5, 1, -1]]);
    const context = createFakeAudioContext(audioBuffer);

    const result = await encodeBlobAsWav({
      blob: new Blob([]),
      createAudioContext: () => context as unknown as AudioContext,
    });

    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBeCloseTo(0.5 * 0x7fff, -1);
    expect(view.getInt16(48, true)).toBeCloseTo(-0.5 * 0x8000, -1);
    expect(view.getInt16(50, true)).toBe(0x7fff);
    expect(view.getInt16(52, true)).toBe(-0x8000);
  });

  it("downmixes multi-channel audio to mono by averaging channels", async () => {
    // Left channel silent, right channel full scale — mono average should be 0.5.
    const audioBuffer = createFakeAudioBuffer([
      [0, 0],
      [1, 1],
    ]);
    const context = createFakeAudioContext(audioBuffer);

    const result = await encodeBlobAsWav({
      blob: new Blob([]),
      createAudioContext: () => context as unknown as AudioContext,
    });

    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    expect(view.getUint16(22, true)).toBe(1); // still declares mono output
    expect(view.getInt16(44, true)).toBeCloseTo(0.5 * 0x7fff, -1);
  });

  it("clamps out-of-range samples instead of overflowing", async () => {
    const audioBuffer = createFakeAudioBuffer([[1.5, -1.5]]);
    const context = createFakeAudioContext(audioBuffer);

    const result = await encodeBlobAsWav({
      blob: new Blob([]),
      createAudioContext: () => context as unknown as AudioContext,
    });

    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});
