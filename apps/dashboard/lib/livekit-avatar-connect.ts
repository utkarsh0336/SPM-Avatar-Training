"use client";

import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { mintLiveKitConnection } from "./api-client";

// How long to wait for a subscribed video track after the room connects
// before giving up and falling back — no existing precedent in this repo
// sizes this, same "documented assumption" status as
// apps/api/src/lib/livekit.ts's LIVEKIT_TOKEN_TTL_SECONDS default.
const VIDEO_TIMEOUT_MS = 5000;

export interface LiveKitAvatarConnection {
  room: Room;
  disconnect: () => void;
}

/**
 * Attempts the Mode B (LiveKit/photoreal avatar) path for a session —
 * mints credentials (only ever succeeds for an Enterprise-plan org with
 * FEATURE_LIVEKIT_ENABLED set), connects, and waits briefly for a
 * subscribed video track to actually arrive before counting it a success.
 * Any failure at any step (mint, room connect, or no video within
 * VIDEO_TIMEOUT_MS) resolves to `null` and leaves no leaked connection —
 * this is the DEFAULT path for every non-Enterprise org, not an error
 * condition, so nothing here logs at error level. Shared by
 * useConversationSession.ts and useVoiceConversationSession.ts.
 *
 * Scope flag: only attaches the video element into `container` — does not
 * wire transcript/checkpoint/latency data-channel events. A session running
 * on Mode B keeps working (voice + photoreal video), but its transcript
 * panel stays empty until that fast-follow lands — see
 * .claude/specs/real-time-video-avatar-interaction.md's B4 scope note.
 */
export async function tryConnectLiveKitAvatar(
  trainingSessionId: string,
  container: HTMLElement,
): Promise<LiveKitAvatarConnection | null> {
  let credentials: { livekitUrl: string; roomToken: string; roomName: string };
  try {
    credentials = await mintLiveKitConnection(trainingSessionId);
  } catch {
    return null; // expected for every non-Enterprise/flag-off org — not an error
  }

  const room = new Room();
  try {
    await room.connect(credentials.livekitUrl, credentials.roomToken);
    // Callers must publish the local mic themselves right after a
    // successful connect (room.localParticipant.setMicrophoneEnabled) —
    // deliberately not done here, so each hook applies its own current mute
    // preference in one call instead of this helper unconditionally
    // enabling it first. Without SOME call to this, apps/agent's cost gate
    // resolves (a human is present) but never receives audio to run a turn
    // on, since job-handler.ts's audio input is the room's subscribed human
    // mic track, not a WS upload like the default path.

    const gotVideo = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), VIDEO_TIMEOUT_MS);
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Video) return;
        clearTimeout(timer);
        const element = track.attach();
        element.style.width = "100%";
        element.style.height = "100%";
        element.style.objectFit = "cover";
        container.appendChild(element);
        resolve(true);
      });
    });

    if (!gotVideo) {
      await room.disconnect();
      return null;
    }

    return {
      room,
      disconnect: () => {
        void room.disconnect();
      },
    };
  } catch {
    await room.disconnect().catch(() => {});
    return null;
  }
}
