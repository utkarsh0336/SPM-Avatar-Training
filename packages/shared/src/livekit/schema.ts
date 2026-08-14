import { z } from "zod";

/** 201 response body for POST /v1/conversations/:trainingSessionId/livekit-connect. */
export const liveKitConnectResponseSchema = z.object({
  livekitUrl: z.string().url(),
  roomToken: z.string().min(1),
  roomName: z.string().min(1),
});

export type LiveKitConnectResponse = z.infer<typeof liveKitConnectResponseSchema>;
