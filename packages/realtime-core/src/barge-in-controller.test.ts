import { describe, expect, it, vi } from "vitest";
import { createBargeInController } from "./barge-in-controller.js";

describe("createBargeInController", () => {
  it("stops playback before notifying the server, in that order", () => {
    const callOrder: string[] = [];
    const controller = createBargeInController({
      stopPlayback: () => callOrder.push("stopPlayback"),
      notifyServer: () => callOrder.push("notifyServer"),
      getCurrentUtteranceId: () => "utterance-1",
    });

    controller.handleSpeechStart();

    expect(callOrder).toEqual(["stopPlayback", "notifyServer"]);
  });

  it("passes the current utteranceId to notifyServer", () => {
    const notifyServer = vi.fn();
    const controller = createBargeInController({
      stopPlayback: vi.fn(),
      notifyServer,
      getCurrentUtteranceId: () => "utterance-42",
    });

    controller.handleSpeechStart();

    expect(notifyServer).toHaveBeenCalledWith("utterance-42");
  });

  it("no-ops when nothing is currently playing", () => {
    const stopPlayback = vi.fn();
    const notifyServer = vi.fn();
    const controller = createBargeInController({
      stopPlayback,
      notifyServer,
      getCurrentUtteranceId: () => null,
    });

    controller.handleSpeechStart();

    expect(stopPlayback).not.toHaveBeenCalled();
    expect(notifyServer).not.toHaveBeenCalled();
  });
});
