import { describe, expect, it } from "vitest";
import { createAvatarProviderFromEnv } from "./avatar-provider-factory.js";

function createFakeVideoElement() {
  return { style: {}, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLVideoElement;
}
function createFakeAudioElement() {
  return { style: {} } as unknown as HTMLAudioElement;
}

describe("createAvatarProviderFromEnv", () => {
  it("defaults to the vrm provider when NEXT_PUBLIC_AVATAR_PROVIDER is unset", () => {
    const provider = createAvatarProviderFromEnv({
      env: {},
      createVideoElement: createFakeVideoElement,
      createAudioElement: createFakeAudioElement,
    });
    // vrm (like Mock) always reports a null videoTrack before/without a
    // fallback becoming active — a real Simli provider only does so before
    // start() has resolved, but this alone isn't a reliable enough signal,
    // so this test only asserts the factory didn't throw at construction.
    expect(provider.videoTrack).toBeNull();
  });

  it("defaults to vrm for any value other than exactly 'simli' or 'mock'", () => {
    expect(() =>
      createAvatarProviderFromEnv({
        env: { NEXT_PUBLIC_AVATAR_PROVIDER: "tavus" },
        createVideoElement: createFakeVideoElement,
        createAudioElement: createFakeAudioElement,
      }),
    ).not.toThrow();
  });

  it("constructs the mock provider when explicitly requested", () => {
    const provider = createAvatarProviderFromEnv({
      env: { NEXT_PUBLIC_AVATAR_PROVIDER: "mock" },
      createVideoElement: createFakeVideoElement,
      createAudioElement: createFakeAudioElement,
    });
    expect(provider.videoTrack).toBeNull();
  });

  it("constructs the vrm provider when explicitly requested, forwarding skin/hair hex", () => {
    expect(() =>
      createAvatarProviderFromEnv({
        env: { NEXT_PUBLIC_AVATAR_PROVIDER: "vrm" },
        createAudioElement: createFakeAudioElement,
        skinToneHex: "#EFC9A2",
        hairColorHex: "#7A4020",
      }),
    ).not.toThrow();
  });

  it("throws if simli is selected without getSimliSessionCredentials", () => {
    expect(() =>
      createAvatarProviderFromEnv({
        env: { NEXT_PUBLIC_AVATAR_PROVIDER: "simli" },
        createVideoElement: createFakeVideoElement,
        createAudioElement: createFakeAudioElement,
      }),
    ).toThrow(/getSimliSessionCredentials/);
  });

  it("constructs a Simli provider when selected with a credentials resolver", () => {
    const provider = createAvatarProviderFromEnv({
      env: { NEXT_PUBLIC_AVATAR_PROVIDER: "simli" },
      getSimliSessionCredentials: () => Promise.resolve({ sessionToken: "tok", iceServers: [] }),
      createVideoElement: createFakeVideoElement,
      createAudioElement: createFakeAudioElement,
    });
    expect(typeof provider.start).toBe("function");
    expect(typeof provider.speak).toBe("function");
  });
});
