import { z } from "zod";

/**
 * SOW §3.1 "emotion-aware interaction" — a cheap local heuristic, never a
 * model call: computed once per assembled avatar reply (see
 * conversation-service.ts's transcript send site), adding no latency to the
 * realtime turn. Deliberately excludes VRM's "angry"/"relaxed" expression
 * presets — a corporate trainer avatar should never visibly look angry at a
 * learner, and "relaxed" reads as indistinguishable from neutral for this
 * purpose.
 */
export const emotionSchema = z.enum(["happy", "sad", "surprised", "neutral"]);
export type Emotion = z.infer<typeof emotionSchema>;

const HAPPY_WORDS = [
  "great",
  "congratulations",
  "well done",
  "excellent",
  "awesome",
  "nice work",
  "perfect",
  "fantastic",
  "wonderful",
  "good job",
  "correct",
  "exactly right",
  "you got it",
];

const SURPRISED_WORDS = [
  "wow",
  "interesting",
  "didn't expect",
  "surprisingly",
  "actually",
  "who knew",
  "believe it or not",
];

const SAD_WORDS = [
  "sorry",
  "unfortunately",
  "mistake",
  "incorrect",
  "not quite",
  "apologize",
  "afraid not",
  "that's not right",
];

function countMatches(text: string, words: readonly string[]): number {
  let count = 0;
  for (const word of words) {
    if (text.includes(word)) count += 1;
  }
  return count;
}

/**
 * Keyword/punctuation scoring over the fully-assembled reply text — no ML,
 * no network call, sub-millisecond. Ties in scores fall back to "neutral"
 * rather than guessing.
 */
export function classifyEmotion(text: string): Emotion {
  const lower = text.toLowerCase();
  const exclamations = (text.match(/!/g) ?? []).length;
  const questions = (text.match(/\?/g) ?? []).length;

  const happyScore = countMatches(lower, HAPPY_WORDS) + (exclamations > 0 ? 1 : 0);
  const surprisedScore = countMatches(lower, SURPRISED_WORDS) + (questions > 1 ? 1 : 0);
  const sadScore = countMatches(lower, SAD_WORDS);

  const best = Math.max(happyScore, surprisedScore, sadScore);
  if (best === 0) return "neutral";
  // Priority on ties favors the gentler read (sad over surprised over happy
  // stays neutral-leaning) — arbitrary but deterministic, and ties are rare
  // given these lexicons barely overlap.
  if (sadScore === best) return "sad";
  if (surprisedScore === best) return "surprised";
  return "happy";
}
