import type { LLMToolDefinition } from "../providers/types.js";

/**
 * Four tools implementing the checkpoint/grading loop from
 * .claude/specs/interactive-assessment.md (SOW §3.4/§3.5). Each takes only
 * objectiveId (or nothing) from the model — the server derives everything
 * else (which answer to grade, the verdict, what gets persisted) rather
 * than trusting model arguments. record_progress/grade_answer are
 * serverOnly per .claude/rules/tenancy.md; that rule is enforced by
 * conversation-service.ts's handlers, not by these definitions, but the
 * narrow objectiveId-only argument shape here is what makes it possible —
 * there is no verdict/feedback/answer field the model COULD pass even if
 * it tried.
 */

export const START_CHECKPOINT_TOOL: LLMToolDefinition = {
  name: "start_checkpoint",
  description:
    "Call this right before you check the learner's understanding of a specific curriculum objective, just before asking its check question.",
  parameters: {
    type: "object",
    properties: {
      objectiveId: { type: "string", description: "The id of the objective you are about to check." },
    },
    required: ["objectiveId"],
  },
};

export const GRADE_ANSWER_TOOL: LLMToolDefinition = {
  name: "grade_answer",
  description:
    "Call this immediately after the learner answers the objective's check question, so their answer can be graded.",
  parameters: {
    type: "object",
    properties: {
      objectiveId: { type: "string", description: "The id of the objective the learner just answered." },
    },
    required: ["objectiveId"],
  },
};

export const ADVANCE_SCENARIO_TOOL: LLMToolDefinition = {
  name: "advance_scenario",
  description:
    "Call this instead of grade_answer, immediately after the learner answers a scenario step's prompt for an objective whose curriculum context shows a scenario opening line instead of a check question.",
  parameters: {
    type: "object",
    properties: {
      objectiveId: {
        type: "string",
        description: "The id of the objective whose scenario step the learner just answered.",
      },
    },
    required: ["objectiveId"],
  },
};

export const RECORD_PROGRESS_TOOL: LLMToolDefinition = {
  name: "record_progress",
  description:
    "Call this to record the learner's graded result for an objective, only after grade_answer has already returned a verdict for that same objective in this turn.",
  parameters: {
    type: "object",
    properties: {
      objectiveId: { type: "string", description: "The id of the objective whose graded result should be recorded." },
    },
    required: ["objectiveId"],
  },
};

export const END_MODULE_TOOL: LLMToolDefinition = {
  name: "end_module",
  description:
    "Call this once you believe the learner has passed every objective in the curriculum, to confirm the module is complete.",
  parameters: { type: "object", properties: {} },
};

export const CURRICULUM_TOOLS: LLMToolDefinition[] = [
  START_CHECKPOINT_TOOL,
  GRADE_ANSWER_TOOL,
  ADVANCE_SCENARIO_TOOL,
  RECORD_PROGRESS_TOOL,
  END_MODULE_TOOL,
];
