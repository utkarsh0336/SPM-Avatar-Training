import type { Expertise, Language, ReadingLevel } from "./avatar-config.js";
import type { ScenarioStepResult } from "../curriculum/scenario-schema.js";

// Display copy only (used to phrase the prompt text) — not type-critical if
// this drifts slightly from apps/dashboard's EXPERTISE_LABELS, unlike
// avatar-config.ts's enums.
const EXPERTISE_TOPIC_TITLES: Record<Expertise, string> = {
  HR_LEAVE_POLICY: "HR & Leave Policy",
  SALES_NEGOTIATION: "Sales & Negotiation",
  COMPLIANCE_LEGAL: "Compliance & Legal",
  PRODUCT_TRAINING: "Product Training",
  CUSTOMER_SUPPORT: "Customer Support",
  LEADERSHIP_MANAGEMENT: "Leadership & Management",
  FINANCE_ACCOUNTING: "Finance & Accounting",
  IT_TECHNOLOGY: "IT & Technology",
  MARKETING_BRANDING: "Marketing & Branding",
};

export interface BuildSystemPromptInput {
  avatarName: string;
  expertise: Expertise;
  /** Defaults to English — optional so existing callers that predate this field keep working. */
  language?: Language;
  /**
   * Trainer-set on the Avatar record, resolved server-side — see conversation-service.ts's
   * session.start handler. Defaults to STANDARD so an avatar with no readingLevel set keeps
   * materially the same behavior it had before this field existed.
   */
  readingLevel?: ReadingLevel;
}

/**
 * Audience vocabulary/complexity — distinct from the spoken-brevity instruction below (that one is
 * about turn length for TTS; this one is about word choice and sentence complexity for the target
 * audience). See .claude/specs/adaptive-learning-personalization.md.
 */
const READING_LEVEL_INSTRUCTION: Record<ReadingLevel, string> = {
  SIMPLE:
    "Use plain language: short sentences and common everyday words. Avoid jargon and acronyms; when a technical term is unavoidable, briefly explain it in the same breath.",
  STANDARD: "Use clear, professional language appropriate for a general working-adult audience.",
  ADVANCED:
    "You may use precise domain terminology and assume familiarity with standard concepts in this field — prioritize accuracy and depth over simplification.",
};

// Instructs the LLM directly rather than switching a template file per
// language — Gemini/Groq's models are natively multilingual, so this is the
// whole mechanism. The corresponding audio side (TTS voice, STT hint) is
// wired in conversation-service.ts, driven by the same session.start
// `language` field this value ultimately comes from.
const LANGUAGE_INSTRUCTION: Record<Language, string> = {
  English: "Respond in English.",
  Hindi: "Respond in Hindi (Devanagari script), regardless of what language the learner uses.",
};

/**
 * A structured-lesson-plan prompt template per brief §7: introduce the
 * topic, teach in segments, check understanding, quiz at the end — not
 * purely reactive Q&A. Not a new integration, just the text sent as
 * LLMChatOptions.systemPrompt.
 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const topic = EXPERTISE_TOPIC_TITLES[input.expertise];
  const language = input.language ?? "English";
  const readingLevel = input.readingLevel ?? "STANDARD";
  return `You are ${input.avatarName}, an AI avatar trainer teaching the topic: ${topic}.

${LANGUAGE_INSTRUCTION[language]}

${READING_LEVEL_INSTRUCTION[readingLevel]}

You are having a real-time SPOKEN conversation — the learner hears your words read aloud by a text-to-speech voice, so keep replies concise and conversational (2-4 sentences per turn), not paragraphs written for reading on a page.

Follow a structured lesson plan rather than only answering reactively:
1. Briefly introduce ${topic} and set expectations for the session.
2. Teach the material in small segments, one concept at a time.
3. After each segment, check the learner's understanding with a short question before moving on to the next one.
4. Once the core material is covered, offer a short quiz to reinforce what was learned.

If the learner interrupts or asks an off-topic question, answer it briefly, then steer back to ${topic} unless they explicitly ask to change subjects.`;
}

export interface KnowledgeContextChunk {
  documentTitle: string;
  content: string;
}

/**
 * Implements SOW §3.3's Response Priority Hierarchy and its "clearly
 * distinguish organization-specific knowledge from externally generated
 * content" requirement: grounds the reply in retrieved org knowledge when
 * relevant (Priority 1/2), instructing the model to fall back to its own
 * general knowledge — explicitly flagged as such — when the context doesn't
 * cover the question (Priority 3). Built fresh per turn (retrieval is
 * query-dependent) by conversation-service.ts — never mutates the base
 * systemPrompt that persists across a session's turns. A no-op (returns
 * systemPrompt unchanged) when nothing relevant was retrieved.
 */
export function appendKnowledgeContext(systemPrompt: string, chunks: KnowledgeContextChunk[]): string {
  if (chunks.length === 0) return systemPrompt;

  const contextBlock = chunks.map((chunk) => `[Source: ${chunk.documentTitle}]\n${chunk.content}`).join("\n\n");

  return `${systemPrompt}

Use the following organization knowledge to answer the learner's question when it's relevant:

${contextBlock}

If the answer isn't contained in the context above, say so plainly and answer from your own general knowledge instead — never imply organization-specific content when you are actually relying on general knowledge.`;
}

/**
 * NOT_STARTED: no ObjectiveProgress row for this learner. NEEDS_REVIEW: their most recent
 * grade_answer verdict was RETRY. MASTERED: their most recent verdict was PASS. Computed
 * server-side from ObjectiveProgress, never from a model argument — see
 * .claude/specs/adaptive-learning-personalization.md.
 */
export type ObjectiveMasteryStatus = "NOT_STARTED" | "NEEDS_REVIEW" | "MASTERED";

export interface CurriculumContextObjective {
  id: string;
  title: string;
  teachingContent: string;
  checkQuestion: string;
  /** Defaults to NOT_STARTED for callers that predate learner-aware curriculum loading. */
  status?: ObjectiveMasteryStatus;
  /** The learner's own last grade_answer feedback — only meaningful when status is NEEDS_REVIEW. */
  lastFeedback?: string;
  /**
   * Non-empty when this objective uses a branching scenario instead of a flat checkQuestion —
   * see .claude/specs/branching-scenario-questions.md. Only the FIRST step is shown here (it's
   * the only one knowable upfront); later steps are branch-dependent and surface only via
   * advance_scenario's tool result at runtime.
   */
  scenarioSteps?: ScenarioStepResult[];
}

const STATUS_ANNOTATION: Record<ObjectiveMasteryStatus, (lastFeedback?: string) => string> = {
  NOT_STARTED: () => "not yet attempted",
  NEEDS_REVIEW: (lastFeedback) =>
    `NEEDS_REVIEW — the learner struggled here before${lastFeedback ? `: "${lastFeedback}"` : ""}. Explain it a different way before re-asking the check question.`,
  MASTERED: () => "already MASTERED — do not re-teach; only revisit if the learner explicitly brings it up",
};

/**
 * Replaces the generic "offer a short quiz" instruction in
 * buildSystemPrompt's step 4 with a real, checkable curriculum — see
 * .claude/specs/interactive-assessment.md. Built once per session (unlike
 * appendKnowledgeContext, which is query-dependent and rebuilt per turn)
 * since the objective list doesn't change mid-session. A no-op (returns
 * systemPrompt unchanged) when the avatar has no attached curriculum, so
 * every existing avatar's behavior is unaffected.
 *
 * Objective order is caller-determined, not decided here — this function only numbers and
 * annotates whatever sequence it's handed. By default that sequence is the trainer's authored
 * order, since a trainer's authored order may encode real teaching dependencies between
 * objectives (.claude/specs/adaptive-learning-personalization.md's Scope decisions). A curriculum
 * with adaptiveOrderingEnabled set is the one exception: getCurriculumForAvatar reweights the
 * array by mastery tier before it ever reaches this function — see
 * .claude/specs/adaptive-learning-paths.md.
 */
export function appendCurriculumContext(systemPrompt: string, objectives: CurriculumContextObjective[]): string {
  if (objectives.length === 0) return systemPrompt;

  const objectiveList = objectives
    .map((objective, index) => {
      const status = objective.status ?? "NOT_STARTED";
      const annotation = STATUS_ANNOTATION[status](objective.lastFeedback);
      const firstScenarioStep = objective.scenarioSteps?.[0];
      const questionLine = firstScenarioStep
        ? `   Scenario opening line: ${firstScenarioStep.prompt}`
        : `   Check question: ${objective.checkQuestion}`;
      return `${index + 1}. [id: ${objective.id}] ${objective.title} (${annotation})\n   Teach: ${objective.teachingContent}\n${questionLine}`;
    })
    .join("\n");

  return `${systemPrompt}

This session has a structured curriculum with the following objectives, in order, each annotated
with this learner's own progress:

${objectiveList}

Teach each objective's material, then check understanding, using these tools as you go:
- Skip objectives already MASTERED — do not re-teach them from scratch, and do not call start_checkpoint/grade_answer/advance_scenario/record_progress for them again.
- Call start_checkpoint with the objective's id right before checking it.
- For an objective with a "Check question" line: ask that question, then call grade_answer with the objective's id immediately after the learner answers.
- For an objective with a "Scenario opening line" instead: present that line, then after each answer call advance_scenario (not grade_answer) with the objective's id — its result is either the next line to present (call advance_scenario again after the learner's next answer) or a final verdict, handled exactly like grade_answer's below.
- If grade_answer or advance_scenario returns PASS, call record_progress with the objective's id, then move on to the next objective. If it returns RETRY, briefly explain what was missing and let the learner try again — do not call record_progress until they pass.
- Once every objective has been recorded as passed, call end_module to confirm the session is complete.`;
}
