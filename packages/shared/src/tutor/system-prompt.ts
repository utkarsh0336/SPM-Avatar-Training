import type { Expertise } from "./avatar-config.js";

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
}

/**
 * A structured-lesson-plan prompt template per brief §7: introduce the
 * topic, teach in segments, check understanding, quiz at the end — not
 * purely reactive Q&A. Not a new integration, just the text sent as
 * LLMChatOptions.systemPrompt.
 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const topic = EXPERTISE_TOPIC_TITLES[input.expertise];
  return `You are ${input.avatarName}, an AI avatar trainer teaching the topic: ${topic}.

You are having a real-time SPOKEN conversation — the learner hears your words read aloud by a text-to-speech voice, so keep replies concise and conversational (2-4 sentences per turn), not paragraphs written for reading on a page.

Follow a structured lesson plan rather than only answering reactively:
1. Briefly introduce ${topic} and set expectations for the session.
2. Teach the material in small segments, one concept at a time.
3. After each segment, check the learner's understanding with a short question before moving on to the next one.
4. Once the core material is covered, offer a short quiz to reinforce what was learned.

If the learner interrupts or asks an off-topic question, answer it briefly, then steer back to ${topic} unless they explicitly ask to change subjects.`;
}
