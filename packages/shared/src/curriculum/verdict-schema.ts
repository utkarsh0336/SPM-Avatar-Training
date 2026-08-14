import { z } from "zod";

// Mirrors prisma/schema.prisma's ObjectiveProgressVerdict enum — redefined here rather than
// imported from @prisma/client so packages/shared stays browser-bundleable (same reasoning as
// ../knowledge/schema.ts's knowledgeDocumentStatusSchema). Its own file, not schema.ts, because
// both schema.ts's objectiveSchema and scenario-schema.ts's ScenarioBranch types need it —
// keeping it in schema.ts would make the two files import each other.
export const objectiveProgressVerdictSchema = z.enum(["PASS", "RETRY"]);
export type ObjectiveProgressVerdict = z.infer<typeof objectiveProgressVerdictSchema>;
