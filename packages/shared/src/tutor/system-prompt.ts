import type { Expertise, Language } from "./avatar-config.js";

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
}

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
  return `You are ${input.avatarName}, an AI avatar trainer teaching the topic: ${topic}.

${LANGUAGE_INSTRUCTION[language]}

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
