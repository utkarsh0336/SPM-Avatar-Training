import { z } from "zod";
import {
  avatarStyleSchema,
  expertiseSchema,
  genderSchema,
  languageSchema,
  outfitSchema,
  voiceToneSchema,
} from "../tutor/avatar-config.js";
import { knowledgeSourceSchema } from "../knowledge/schema.js";
import { emotionSchema } from "../tutor/emotion.js";

/**
 * WebSocket protocol for GET /v1/conversations/:trainingSessionId/ws (see
 * apps/api/src/routes/conversations.ts). One JSON message format for both
 * control and audio (base64-embedded) rather than mixing binary and JSON WS
 * frames — revisit only if base64 overhead proves material at real audio
 * sizes. Client and server each validate only their own inbound schema, so
 * the two "audio.chunk"-shaped messages below never collide at runtime;
 * they are still named distinctly (client: audio.chunk, server: tts.chunk)
 * to avoid confusing the two in logs and code.
 */

export const trainingSessionIdParamSchema = z.object({
  trainingSessionId: z.string().min(1),
});
export type TrainingSessionIdParam = z.infer<typeof trainingSessionIdParamSchema>;

// ---------- Client -> Server ----------

export const sessionStartMessageSchema = z.object({
  type: z.literal("session.start"),
  avatarName: z.string().min(1),
  expertise: expertiseSchema,
  voiceTone: voiceToneSchema,
  style: avatarStyleSchema,
  gender: genderSchema,
  outfit: outfitSchema,
  /** Cosmetic only — header/caption text. The system prompt is driven by expertise, not this. */
  topic: z.string(),
  /** Drives the LLM's reply language, TTS voice, and STT language hint (see conversation-service.ts). Defaults to English so older clients that predate this field still validate. */
  language: languageSchema.default("English"),
  /**
   * Optional so older/curriculum-less clients still validate unchanged —
   * see .claude/specs/interactive-assessment.md. When present,
   * conversation-service.ts loads that Avatar's Curriculum (if one exists)
   * and enables the checkpoint/grading tool loop for the session; when
   * absent, behavior is identical to before this field existed. Not yet
   * sent by apps/dashboard's session screen — the onboarding handoff has
   * no persisted Avatar id to send today (a separate, larger prerequisite;
   * see conversation-service.ts's session.start handler comment).
   */
  avatarId: z.string().uuid().optional(),
});
export type SessionStartMessage = z.infer<typeof sessionStartMessageSchema>;

export const audioChunkMessageSchema = z.object({
  type: z.literal("audio.chunk"),
  utteranceId: z.string(),
  audioBase64: z.string(),
  mimeType: z.string(),
});
export type AudioChunkMessage = z.infer<typeof audioChunkMessageSchema>;

export const textFallbackMessageSchema = z.object({
  type: z.literal("text.fallback"),
  utteranceId: z.string(),
  text: z.string().min(1),
});
export type TextFallbackMessage = z.infer<typeof textFallbackMessageSchema>;

export const bargeInMessageSchema = z.object({
  type: z.literal("barge_in"),
  utteranceId: z.string(),
});
export type BargeInMessage = z.infer<typeof bargeInMessageSchema>;

export const sessionEndMessageSchema = z.object({
  type: z.literal("session.end"),
});
export type SessionEndMessage = z.infer<typeof sessionEndMessageSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  sessionStartMessageSchema,
  audioChunkMessageSchema,
  textFallbackMessageSchema,
  bargeInMessageSchema,
  sessionEndMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------- Server -> Client ----------

// No replicaId here — the client resolves its own replica locally (from the
// onboarding handoff, via avatar-core's resolveReplicaId) before it ever
// opens this connection, so there is nothing for the server to tell it.
export const sessionReadyMessageSchema = z.object({
  type: z.literal("session.ready"),
});
export type SessionReadyMessage = z.infer<typeof sessionReadyMessageSchema>;

export const transcriptMessageSchema = z.object({
  type: z.literal("transcript"),
  role: z.enum(["user", "avatar"]),
  text: z.string(),
  utteranceId: z.string(),
  final: z.boolean(),
  // Source attribution (SOW §3.3) — only ever set on role:"avatar" messages,
  // and only when the reply was actually grounded in retrieved
  // KnowledgeChunks. Omitted (not an empty array) for an ungrounded
  // Priority-3 reply, and omitted entirely for role:"user" — optional so
  // pre-knowledge-management clients still validate this message unchanged.
  // See .claude/specs/knowledge-management.md's Realtime Changes.
  sources: z.array(knowledgeSourceSchema).optional(),
  // Emotion-aware avatar expression (SOW §3.1) — computed once server-side
  // from the fully assembled reply text (tutor/emotion.ts's
  // classifyEmotion). Always set for role:"avatar" (including "neutral" —
  // the client needs an explicit neutral to fade a previous turn's
  // expression back out), never set for role:"user". Schema-optional only
  // so pre-emotion clients/fixtures still validate this message unchanged.
  emotion: emotionSchema.optional(),
});
export type TranscriptMessage = z.infer<typeof transcriptMessageSchema>;

// One sentence's synthesized audio. Carrying the sentence's own text
// alongside its audio in the same message is what gives the caption bar
// true sync for free — no separate caption-timing channel needed.
export const ttsChunkMessageSchema = z.object({
  type: z.literal("tts.chunk"),
  utteranceId: z.string(),
  sentenceIndex: z.number().int().nonnegative(),
  text: z.string(),
  audioBase64: z.string(),
  mimeType: z.string(),
  isLastForUtterance: z.boolean(),
});
export type TtsChunkMessage = z.infer<typeof ttsChunkMessageSchema>;

export const turnStartedMessageSchema = z.object({
  type: z.literal("turn.started"),
  utteranceId: z.string(),
});
export type TurnStartedMessage = z.infer<typeof turnStartedMessageSchema>;

export const turnEndedMessageSchema = z.object({
  type: z.literal("turn.ended"),
  utteranceId: z.string(),
});
export type TurnEndedMessage = z.infer<typeof turnEndedMessageSchema>;

export const turnCancelledMessageSchema = z.object({
  type: z.literal("turn.cancelled"),
  utteranceId: z.string(),
});
export type TurnCancelledMessage = z.infer<typeof turnCancelledMessageSchema>;

// Server-side STT is unavailable/exhausted — triggers the client's Web
// Speech API fallback (packages/realtime-core/src/web-speech-fallback.ts).
export const sttFailedMessageSchema = z.object({
  type: z.literal("stt.failed"),
  utteranceId: z.string(),
  retryable: z.boolean(),
});
export type SttFailedMessage = z.infer<typeof sttFailedMessageSchema>;

// Every provider in a hop's failover chain failed — the "clear spoken or
// on-screen message, not a hung spinner" surface from the DoD.
export const turnFailedMessageSchema = z.object({
  type: z.literal("turn.failed"),
  utteranceId: z.string(),
  kind: z.enum(["llm", "tts", "stt"]),
  message: z.string(),
});
export type TurnFailedMessage = z.infer<typeof turnFailedMessageSchema>;

export const latencyMessageSchema = z.object({
  type: z.literal("latency"),
  utteranceId: z.string(),
  sttMs: z.number().optional(),
  // Knowledge retrieval hop — docs/ARCHITECTURE.md §5's <100ms p95 budget.
  retrievalMs: z.number().optional(),
  llmFirstTokenMs: z.number().optional(),
  ttsFirstChunkMs: z.number().optional(),
  totalMs: z.number(),
  servedBy: z
    .object({
      llm: z.string().optional(),
      stt: z.string().optional(),
      tts: z.string().optional(),
    })
    .optional(),
});
export type LatencyMessage = z.infer<typeof latencyMessageSchema>;

export const errorMessageSchema = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string().optional(),
});
export type ErrorMessage = z.infer<typeof errorMessageSchema>;

// The checkpoint/grading tool loop's client-visible events — see
// .claude/specs/interactive-assessment.md's Realtime Changes. Sent only for
// sessions whose avatar has a Curriculum attached (session.start's optional
// avatarId); absent entirely otherwise.
export const checkpointStartedMessageSchema = z.object({
  type: z.literal("checkpoint.started"),
  objectiveId: z.string(),
  objectiveTitle: z.string(),
});
export type CheckpointStartedMessage = z.infer<typeof checkpointStartedMessageSchema>;

// See .claude/specs/branching-scenario-questions.md. Sent when advance_scenario continues to a
// non-terminal step; a terminal branch reuses checkpointResultMessageSchema below unchanged.
export const scenarioStepMessageSchema = z.object({
  type: z.literal("scenario.step"),
  objectiveId: z.string(),
  stepId: z.string(),
  prompt: z.string(),
});
export type ScenarioStepMessage = z.infer<typeof scenarioStepMessageSchema>;

export const checkpointResultMessageSchema = z.object({
  type: z.literal("checkpoint.result"),
  objectiveId: z.string(),
  verdict: z.enum(["PASS", "RETRY"]),
  feedback: z.string(),
  attempts: z.number().int().positive(),
});
export type CheckpointResultMessage = z.infer<typeof checkpointResultMessageSchema>;

export const moduleCompletedMessageSchema = z.object({
  type: z.literal("module.completed"),
  curriculumId: z.string(),
});
export type ModuleCompletedMessage = z.infer<typeof moduleCompletedMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  sessionReadyMessageSchema,
  transcriptMessageSchema,
  ttsChunkMessageSchema,
  turnStartedMessageSchema,
  turnEndedMessageSchema,
  turnCancelledMessageSchema,
  sttFailedMessageSchema,
  turnFailedMessageSchema,
  latencyMessageSchema,
  errorMessageSchema,
  checkpointStartedMessageSchema,
  scenarioStepMessageSchema,
  checkpointResultMessageSchema,
  moduleCompletedMessageSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
