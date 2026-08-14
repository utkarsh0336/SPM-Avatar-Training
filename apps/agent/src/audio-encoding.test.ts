import { describe, expect, it } from "vitest";
import { computeInt16PcmRms, encodeInt16PcmAsWav } from "./audio-encoding.js";

describe("encodeInt16PcmAsWav", () => {
  it("produces a valid RIFF/WAVE header for the given sample rate and sample count", () => {
    const samples = new Int16Array([0, 1000, -1000, 32767, -32768]);
    const wav = encodeInt16PcmAsWav(samples, 16000);
    const view = new DataView(wav.buffer);

    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(String.fromCharCode(...wav.slice(12, 16))).toBe("fmt ");
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(wav.length).toBe(44 + samples.length * 2);
  });

  it("round-trips sample values exactly through the data chunk", () => {
    const samples = new Int16Array([0, 12345, -12345, 32767, -32768]);
    const wav = encodeInt16PcmAsWav(samples, 8000);
    const view = new DataView(wav.buffer, 44);

    for (let i = 0; i < samples.length; i++) {
      expect(view.getInt16(i * 2, true)).toBe(samples[i]);
    }
  });

  it("handles an empty sample array without throwing", () => {
    expect(() => encodeInt16PcmAsWav(new Int16Array([]), 16000)).not.toThrow();
    expect(encodeInt16PcmAsWav(new Int16Array([]), 16000).length).toBe(44);
  });
});

describe("computeInt16PcmRms", () => {
  it("is 0 for silence", () => {
    expect(computeInt16PcmRms(new Int16Array([0, 0, 0, 0]))).toBe(0);
  });

  it("is 1 for full-scale square-wave-like samples", () => {
    expect(computeInt16PcmRms(new Int16Array([32768, 32768]))).toBeCloseTo(1, 2);
  });

  it("is 0 for an empty array (never divides by zero)", () => {
    expect(computeInt16PcmRms(new Int16Array([]))).toBe(0);
  });
});
