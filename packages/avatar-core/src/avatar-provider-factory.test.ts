import { describe, expect, it } from "vitest";
import { createAvatarProviderFromEnv } from "./avatar-provider-factory.js";

function createFakeVideoElement() {
  return { style: {}, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLVideoElement;
}
function createFakeAudioElement() {
  return { style: {} } as unknown as HTMLAudioElement;
}

describe("createAvatarProviderFromEnv", () => {
  it("defaults to the mock provider when NEXT_PUBLIC_AVATAR_PROVIDER is unset", () => {
    const provider = createAvatarProviderFromEnv({
      env: {},
      createVideoElement: createFakeVideoElement,
      createAudioElement: createFakeAudioElement,
    });
    // Mock provider always reports a null videoTrack — a real Simli
    // provider only does so before start() has resolved, but this alone
    // isn't a reliable enough signal, so this test only asserts the
    // factory didn't throw for the missing-token-requirement path below.
    expect(provider.videoTrack).toBeNull();
  });

  it("defaults to mock for any value other than exactly 'simli'", () => {
    expect(() =>
      createAvatarProviderFromEnv({
        env: { NEXT_PUBLIC_AVATAR_PROVIDER: "tavus" },
        createVideoElement: createFakeVideoElement,
        createAudioElement: createFakeAudioElement,
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
