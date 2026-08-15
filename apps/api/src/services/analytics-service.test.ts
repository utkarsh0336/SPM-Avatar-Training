import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, setAuthContext, withAuthContext } from "@avatrain/shared";
import {
  getPerformanceAnalytics,
  getSatisfactionAnalytics,
  getTrainingAnalytics,
  getUsageAnalytics,
  recordKnowledgeAccess,
  recordSatisfactionRating,
  recordTurnMetric,
} from "./analytics-service.js";
import { createCurriculum, replaceObjectives } from "./curriculum-service.js";

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const orgId of createdOrgIds) {
    await withAuthContext({ orgId }, async (tx) => {
      await tx.satisfactionRating.deleteMany({ where: { orgId } });
      await tx.turnMetric.deleteMany({ where: { orgId } });
      await tx.knowledgeAccessEvent.deleteMany({ where: { orgId } });
      await tx.knowledgeDocument.deleteMany({ where: { orgId } });
      await tx.message.deleteMany({ where: { orgId } });
      await tx.trainingSession.deleteMany({ where: { orgId } });
      // Objective/ObjectiveProgress cascade via curricula's FK ON DELETE CASCADE.
      await tx.curriculum.deleteMany({ where: { orgId } });
      await tx.avatar.deleteMany({ where: { orgId } });
      await tx.membership.deleteMany({ where: { orgId } });
    });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  for (const orgId of createdOrgIds) {
    await prisma.organization.deleteMany({ where: { id: orgId } });
  }
}

afterAll(cleanup);

async function seedOrgAndUser(label: string): Promise<{ orgId: string; userId: string }> {
  const orgId = randomUUID();
  const userId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: orgId, name: label } });
    await tx.user.create({ data: { id: userId, email: `${label}-${randomUUID()}@example.com`, passwordHash: "seeded" } });
    await setAuthContext(tx, { userId, orgId });
    await tx.membership.create({ data: { orgId, userId, role: "OWNER" } });
  });
  createdOrgIds.push(orgId);
  createdUserIds.push(userId);
  return { orgId, userId };
}

async function seedTrainingSession(
  orgId: string,
  userId: string,
  overrides: { status?: "ACTIVE" | "ENDED"; endedAt?: Date | null; createdAt?: Date } = {},
) {
  return withAuthContext({ orgId, userId }, (tx) =>
    tx.trainingSession.create({
      data: {
        orgId,
        createdByUserId: userId,
        clientRequestId: randomUUID(),
        kind: "VOICE_ONLY",
        title: "Test Session",
        voiceExpertId: "priya",
        personaName: "Priya",
        personaRole: "HR Expert",
        status: overrides.status ?? "ACTIVE",
        endedAt: overrides.endedAt ?? null,
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      },
    }),
  );
}

async function seedAvatar(orgId: string, userId: string): Promise<string> {
  const avatar = await withAuthContext({ orgId, userId }, (tx) =>
    tx.avatar.create({ data: { orgId, createdById: userId, name: "Test Avatar" } }),
  );
  return avatar.id;
}

async function seedKnowledgeDocument(orgId: string, userId: string, title: string, category: string | null = null) {
  return withAuthContext({ orgId, userId }, (tx) =>
    tx.knowledgeDocument.create({
      data: {
        orgId,
        uploadedById: userId,
        title,
        originalFilename: `${title}.pdf`,
        mimeType: "application/pdf",
        fileSizeBytes: 1024,
        storageKey: `docs/${randomUUID()}`,
        category,
      },
    }),
  );
}

describe("analytics-service", () => {
  describe("recordKnowledgeAccess", () => {
    it("writes an event for a rehearsal session (trainingSessionId set)", async () => {
      const { orgId, userId } = await seedOrgAndUser("Record Access Rehearsal Org");
      const session = await seedTrainingSession(orgId, userId);
      const document = await seedKnowledgeDocument(orgId, userId, "Handbook");

      await recordKnowledgeAccess(orgId, document.id, session.id);

      const events = await withAuthContext({ orgId }, (tx) => tx.knowledgeAccessEvent.findMany({ where: { orgId } }));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ documentId: document.id, trainingSessionId: session.id });
    });

    it("writes an event when trainingSessionId is null (anonymous embed session) — does not no-op", async () => {
      const { orgId, userId } = await seedOrgAndUser("Record Access Embed Org");
      const document = await seedKnowledgeDocument(orgId, userId, "Handbook");

      await recordKnowledgeAccess(orgId, document.id, null);

      const events = await withAuthContext({ orgId }, (tx) => tx.knowledgeAccessEvent.findMany({ where: { orgId } }));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ documentId: document.id, trainingSessionId: null });
    });

    it("swallows a write failure rather than throwing (never fails the realtime turn)", async () => {
      const { orgId } = await seedOrgAndUser("Record Access Failure Org");

      await expect(recordKnowledgeAccess(orgId, randomUUID(), null)).resolves.toBeUndefined();
    });
  });

  describe("getUsageAnalytics", () => {
    it("returns zeros and nulls, never NaN, for an org with no sessions or knowledge access", async () => {
      const { orgId } = await seedOrgAndUser("Usage Analytics Empty Org");

      const result = await getUsageAnalytics(orgId, 30);
      expect(result).toMatchObject({
        windowDays: 30,
        activeUserCount: 0,
        totalConversationCount: 0,
        avgSessionDurationSeconds: null,
        topKnowledgeAreas: [],
      });
    });

    it("counts a user with multiple sessions once in activeUserCount", async () => {
      const { orgId, userId } = await seedOrgAndUser("Usage Analytics Repeat User Org");
      await seedTrainingSession(orgId, userId);
      await seedTrainingSession(orgId, userId);

      const result = await getUsageAnalytics(orgId, 30);
      expect(result.activeUserCount).toBe(1);
      expect(result.totalConversationCount).toBe(2);
    });

    it("averages session duration only over ENDED sessions, ignoring ACTIVE ones", async () => {
      const { orgId, userId } = await seedOrgAndUser("Usage Analytics Duration Org");
      const start = new Date(Date.now() - 60_000);
      await seedTrainingSession(orgId, userId, { status: "ENDED", createdAt: start, endedAt: new Date(start.getTime() + 60_000) });
      await seedTrainingSession(orgId, userId, { status: "ACTIVE" });

      const result = await getUsageAnalytics(orgId, 30);
      expect(result.totalConversationCount).toBe(2);
      expect(result.avgSessionDurationSeconds).toBeCloseTo(60, 0);
    });

    it("excludes a session created outside the window", async () => {
      const { orgId, userId } = await seedOrgAndUser("Usage Analytics Window Org");
      const outsideWindow = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await seedTrainingSession(orgId, userId, { createdAt: outsideWindow });
      await seedTrainingSession(orgId, userId);

      const result = await getUsageAnalytics(orgId, 7);
      expect(result.totalConversationCount).toBe(1);
    });

    it("ranks knowledge areas by access count, descending", async () => {
      const { orgId, userId } = await seedOrgAndUser("Usage Analytics Ranking Org");
      const popular = await seedKnowledgeDocument(orgId, userId, "Popular Doc", "onboarding");
      const rare = await seedKnowledgeDocument(orgId, userId, "Rare Doc", "compliance");
      await recordKnowledgeAccess(orgId, popular.id, null);
      await recordKnowledgeAccess(orgId, popular.id, null);
      await recordKnowledgeAccess(orgId, rare.id, null);

      const result = await getUsageAnalytics(orgId, 30);
      expect(result.topKnowledgeAreas).toEqual([
        { documentId: popular.id, documentTitle: "Popular Doc", category: "onboarding", accessCount: 2 },
        { documentId: rare.id, documentTitle: "Rare Doc", category: "compliance", accessCount: 1 },
      ]);
    });

    it("caps topKnowledgeAreas at 10", async () => {
      const { orgId, userId } = await seedOrgAndUser("Usage Analytics Cap Org");
      for (let i = 0; i < 11; i++) {
        const document = await seedKnowledgeDocument(orgId, userId, `Doc ${i}`);
        await recordKnowledgeAccess(orgId, document.id, null);
      }

      const result = await getUsageAnalytics(orgId, 30);
      expect(result.topKnowledgeAreas).toHaveLength(10);
    });

    it("counts a real-usage embed-session access alongside rehearsal-only session metrics without mixing the two", async () => {
      const { orgId, userId } = await seedOrgAndUser("Usage Analytics Mixed Org");
      const document = await seedKnowledgeDocument(orgId, userId, "Embed Doc");
      // No TrainingSession created — this org's only activity is an anonymous embed retrieval.
      await recordKnowledgeAccess(orgId, document.id, null);

      const result = await getUsageAnalytics(orgId, 30);
      expect(result.activeUserCount).toBe(0);
      expect(result.totalConversationCount).toBe(0);
      expect(result.topKnowledgeAreas).toEqual([
        { documentId: document.id, documentTitle: "Embed Doc", category: null, accessCount: 1 },
      ]);
    });
  });

  describe("getTrainingAnalytics", () => {
    it("returns zeros and nulls, never NaN, for an org with no activity", async () => {
      const { orgId } = await seedOrgAndUser("Training Analytics Empty Org");

      const result = await getTrainingAnalytics(orgId);
      expect(result).toMatchObject({
        participantCount: 0,
        curriculumsWithActivityCount: 0,
        avgCompletionRate: null,
        avgTimeToCompetencySeconds: null,
        knowledgeGaps: [],
      });
    });

    it("averages completion rate only across curricula with activity, not diluted by an untouched curriculum", async () => {
      const { orgId, userId } = await seedOrgAndUser("Training Analytics Avg Org");
      const learnerA = await seedOrgAndUser("Training Analytics Avg Learner A Org");
      const learnerB = await seedOrgAndUser("Training Analytics Avg Learner B Org");
      const avatarId1 = await seedAvatar(orgId, userId);
      const avatarId2 = await seedAvatar(orgId, userId);
      const avatarId3 = await seedAvatar(orgId, userId);

      const curriculum1 = await createCurriculum(orgId, userId, { avatarId: avatarId1, title: "Complete" });
      const [obj1] = await replaceObjectives(orgId, curriculum1.id, [
        { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      await withAuthContext({ orgId }, (tx) =>
        tx.objectiveProgress.create({
          data: { orgId, objectiveId: obj1!.id, learnerId: learnerA.userId, verdict: "PASS", attempts: 1, feedback: "Good" },
        }),
      );

      const curriculum2 = await createCurriculum(orgId, userId, { avatarId: avatarId2, title: "Incomplete" });
      const [obj2] = await replaceObjectives(orgId, curriculum2.id, [
        { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      await withAuthContext({ orgId }, (tx) =>
        tx.objectiveProgress.create({
          data: { orgId, objectiveId: obj2!.id, learnerId: learnerB.userId, verdict: "RETRY", attempts: 1, feedback: "Try again" },
        }),
      );

      // Untouched curriculum: has an objective, but zero ObjectiveProgress rows.
      await createCurriculum(orgId, userId, { avatarId: avatarId3, title: "Untouched" });

      const result = await getTrainingAnalytics(orgId);
      expect(result.curriculumsWithActivityCount).toBe(2);
      expect(result.avgCompletionRate).toBeCloseTo(0.5, 5);
    });

    it("does not count a learner as completed when an untouched objective exists in the same curriculum", async () => {
      const { orgId, userId } = await seedOrgAndUser("Training Analytics Untouched Objective Org");
      const learner = await seedOrgAndUser("Training Analytics Untouched Objective Learner Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });
      const [objectiveA] = await replaceObjectives(orgId, curriculum.id, [
        { title: "Obj A", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
        { title: "Obj B", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      // Only objective A ever gets a progress row — objective B has zero attempts from anyone.
      await withAuthContext({ orgId }, (tx) =>
        tx.objectiveProgress.create({
          data: { orgId, objectiveId: objectiveA!.id, learnerId: learner.userId, verdict: "PASS", attempts: 1, feedback: "Good" },
        }),
      );

      const result = await getTrainingAnalytics(orgId);
      expect(result.avgCompletionRate).toBe(0);
    });

    it("excludes an objective from knowledgeGaps when fewer than MIN_ATTEMPTS learners have attempted it", async () => {
      const { orgId, userId } = await seedOrgAndUser("Training Analytics Min Attempts Org");
      const learner = await seedOrgAndUser("Training Analytics Min Attempts Learner Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });
      const [objective] = await replaceObjectives(orgId, curriculum.id, [
        { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      await withAuthContext({ orgId }, (tx) =>
        tx.objectiveProgress.create({
          data: { orgId, objectiveId: objective!.id, learnerId: learner.userId, verdict: "RETRY", attempts: 1, feedback: "Try again" },
        }),
      );

      const result = await getTrainingAnalytics(orgId);
      expect(result.knowledgeGaps).toEqual([]);
    });

    it("ranks knowledgeGaps by passRate ascending and caps at 10", async () => {
      const { orgId, userId } = await seedOrgAndUser("Training Analytics Gaps Org");
      const learnerA = await seedOrgAndUser("Training Analytics Gaps Learner A Org");
      const learnerB = await seedOrgAndUser("Training Analytics Gaps Learner B Org");
      const avatarId = await seedAvatar(orgId, userId);
      const curriculum = await createCurriculum(orgId, userId, { avatarId, title: "X" });
      const objectiveInputs = Array.from({ length: 11 }, (_, i) => ({
        title: i === 10 ? "Perfect" : `Weak ${i}`,
        teachingContent: "T",
        checkQuestion: "Q",
        gradingCriteria: "G",
      }));
      const objectives = await replaceObjectives(orgId, curriculum.id, objectiveInputs);

      await withAuthContext({ orgId }, (tx) =>
        tx.objectiveProgress.createMany({
          data: objectives.flatMap((objective) => {
            const verdict = objective.title === "Perfect" ? "PASS" : "RETRY";
            return [
              { orgId, objectiveId: objective.id, learnerId: learnerA.userId, verdict, attempts: 1, feedback: "F" },
              { orgId, objectiveId: objective.id, learnerId: learnerB.userId, verdict, attempts: 1, feedback: "F" },
            ];
          }),
        }),
      );

      const result = await getTrainingAnalytics(orgId);
      expect(result.knowledgeGaps).toHaveLength(10);
      expect(result.knowledgeGaps.every((gap) => gap.passRate === 0)).toBe(true);
      expect(result.knowledgeGaps.some((gap) => gap.objectiveTitle === "Perfect")).toBe(false);
    });

    it("dedupes participantCount for a learner active across two curricula", async () => {
      const { orgId, userId } = await seedOrgAndUser("Training Analytics Participant Org");
      const learner = await seedOrgAndUser("Training Analytics Participant Learner Org");
      const avatarId1 = await seedAvatar(orgId, userId);
      const avatarId2 = await seedAvatar(orgId, userId);
      const curriculum1 = await createCurriculum(orgId, userId, { avatarId: avatarId1, title: "A" });
      const curriculum2 = await createCurriculum(orgId, userId, { avatarId: avatarId2, title: "B" });
      const [obj1] = await replaceObjectives(orgId, curriculum1.id, [
        { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      const [obj2] = await replaceObjectives(orgId, curriculum2.id, [
        { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      await withAuthContext({ orgId }, (tx) =>
        tx.objectiveProgress.createMany({
          data: [
            { orgId, objectiveId: obj1!.id, learnerId: learner.userId, verdict: "PASS", attempts: 1, feedback: "Good" },
            { orgId, objectiveId: obj2!.id, learnerId: learner.userId, verdict: "PASS", attempts: 1, feedback: "Good" },
          ],
        }),
      );

      const result = await getTrainingAnalytics(orgId);
      expect(result.participantCount).toBe(1);
    });

    it("keeps another org's ObjectiveProgress rows out of participantCount, curriculumsWithActivityCount, and knowledgeGaps", async () => {
      const orgA = await seedOrgAndUser("Training Analytics Isolation Org A");
      const orgB = await seedOrgAndUser("Training Analytics Isolation Org B");
      const learnerB = await seedOrgAndUser("Training Analytics Isolation Learner B Org");
      const avatarB = await seedAvatar(orgB.orgId, orgB.userId);
      const curriculumB = await createCurriculum(orgB.orgId, orgB.userId, { avatarId: avatarB, title: "X" });
      const [objectiveB] = await replaceObjectives(orgB.orgId, curriculumB.id, [
        { title: "Obj 1", teachingContent: "T", checkQuestion: "Q", gradingCriteria: "G" },
      ]);
      await withAuthContext({ orgId: orgB.orgId }, (tx) =>
        tx.objectiveProgress.createMany({
          data: [
            { orgId: orgB.orgId, objectiveId: objectiveB!.id, learnerId: learnerB.userId, verdict: "PASS", attempts: 1, feedback: "Good" },
            { orgId: orgB.orgId, objectiveId: objectiveB!.id, learnerId: orgB.userId, verdict: "RETRY", attempts: 1, feedback: "Try again" },
          ],
        }),
      );

      const result = await getTrainingAnalytics(orgA.orgId);
      expect(result).toMatchObject({ participantCount: 0, curriculumsWithActivityCount: 0, knowledgeGaps: [] });
    });
  });

  describe("recordTurnMetric", () => {
    it("writes a metric row for a rehearsal session (trainingSessionId set)", async () => {
      const { orgId, userId } = await seedOrgAndUser("Record Turn Metric Rehearsal Org");
      const session = await seedTrainingSession(orgId, userId);

      await recordTurnMetric(orgId, session.id, {
        turnId: "turn-1",
        sttMs: 100,
        retrievalMs: 50,
        llmFirstTokenMs: 300,
        ttsFirstChunkMs: 400,
        totalMs: 900,
        grounded: true,
      });

      const rows = await withAuthContext({ orgId }, (tx) => tx.turnMetric.findMany({ where: { orgId } }));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ trainingSessionId: session.id, totalMs: 900, grounded: true });
    });

    it("writes a metric row when trainingSessionId is null (anonymous embed session) — does not no-op", async () => {
      const { orgId } = await seedOrgAndUser("Record Turn Metric Embed Org");

      await recordTurnMetric(orgId, null, { turnId: "turn-2", totalMs: 500, grounded: false });

      const rows = await withAuthContext({ orgId }, (tx) => tx.turnMetric.findMany({ where: { orgId } }));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ trainingSessionId: null, grounded: false });
    });

    it("stores a skipped hop as null rather than 0", async () => {
      const { orgId } = await seedOrgAndUser("Record Turn Metric Skipped Hop Org");

      await recordTurnMetric(orgId, null, { turnId: "turn-3", totalMs: 200, grounded: false });

      const rows = await withAuthContext({ orgId }, (tx) => tx.turnMetric.findMany({ where: { orgId } }));
      expect(rows[0]).toMatchObject({ sttMs: null, retrievalMs: null, llmFirstTokenMs: null, ttsFirstChunkMs: null });
    });

    it("swallows a write failure rather than throwing (never fails the realtime turn)", async () => {
      const { orgId } = await seedOrgAndUser("Record Turn Metric Failure Org");

      await expect(
        recordTurnMetric(orgId, randomUUID(), { turnId: "turn-4", totalMs: 100, grounded: false }),
      ).resolves.toBeUndefined();
    });
  });

  describe("getPerformanceAnalytics", () => {
    it("returns zeros and nulls, never NaN, for an org with no turns", async () => {
      const { orgId } = await seedOrgAndUser("Performance Analytics Empty Org");

      const result = await getPerformanceAnalytics(orgId, 30);
      expect(result.turnCount).toBe(0);
      expect(result.groundedReplyRate).toBeNull();
      expect(result.avgLatencyMs).toEqual({
        stt: null,
        retrieval: null,
        llmFirstToken: null,
        ttsFirstChunk: null,
        total: null,
      });
      expect(result.knowledgeUtilizationTrend).toHaveLength(14);
      expect(result.knowledgeUtilizationTrend.every((point) => point.accessCount === 0)).toBe(true);
    });

    it("averages latency across turns and ignores hops a turn skipped, without excluding that turn from turnCount", async () => {
      const { orgId } = await seedOrgAndUser("Performance Analytics Avg Org");
      await recordTurnMetric(orgId, null, { turnId: "t1", sttMs: 100, totalMs: 500, grounded: true });
      await recordTurnMetric(orgId, null, { turnId: "t2", sttMs: 200, totalMs: 700, grounded: false });
      // t3 has no sttMs at all — must not drag the stt average toward 0 or be excluded from turnCount.
      await recordTurnMetric(orgId, null, { turnId: "t3", totalMs: 300, grounded: false });

      const result = await getPerformanceAnalytics(orgId, 30);
      expect(result.turnCount).toBe(3);
      expect(result.avgLatencyMs.stt).toBeCloseTo(150, 5);
      expect(result.avgLatencyMs.total).toBeCloseTo(500, 5);
      expect(result.groundedReplyRate).toBeCloseTo(1 / 3, 5);
    });

    it("excludes a turn recorded outside the window", async () => {
      const { orgId } = await seedOrgAndUser("Performance Analytics Window Org");
      const outsideWindow = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await withAuthContext({ orgId }, (tx) =>
        tx.turnMetric.create({
          data: { orgId, turnId: "old", totalMs: 100, grounded: false, createdAt: outsideWindow },
        }),
      );
      await recordTurnMetric(orgId, null, { turnId: "recent", totalMs: 200, grounded: false });

      const result = await getPerformanceAnalytics(orgId, 7);
      expect(result.turnCount).toBe(1);
    });

    it("buckets knowledgeUtilizationTrend by day, oldest first, over a fixed 14-day window independent of the days selector", async () => {
      const { orgId, userId } = await seedOrgAndUser("Performance Analytics Trend Org");
      const document = await seedKnowledgeDocument(orgId, userId, "Trend Doc");
      await recordKnowledgeAccess(orgId, document.id, null);

      const result = await getPerformanceAnalytics(orgId, 7);
      expect(result.knowledgeUtilizationTrend).toHaveLength(14);
      const today = new Date().toISOString().slice(0, 10);
      expect(result.knowledgeUtilizationTrend[13]).toEqual({ date: today, accessCount: 1 });
    });

    it("never includes another org's TurnMetric rows in the aggregate (two-org isolation)", async () => {
      const orgA = await seedOrgAndUser("Performance Analytics Isolation Org A");
      const orgB = await seedOrgAndUser("Performance Analytics Isolation Org B");
      await recordTurnMetric(orgB.orgId, null, { turnId: "b1", totalMs: 999, grounded: true });

      const result = await getPerformanceAnalytics(orgA.orgId, 30);
      expect(result.turnCount).toBe(0);
      expect(result.groundedReplyRate).toBeNull();
    });
  });

  describe("recordSatisfactionRating", () => {
    it("writes a rating row when trainingSessionId is null (anonymous embed session) — does not no-op", async () => {
      const { orgId } = await seedOrgAndUser("Record Satisfaction Rating Embed Org");

      await recordSatisfactionRating(orgId, null, 5, "Loved it!");

      const rows = await withAuthContext({ orgId }, (tx) => tx.satisfactionRating.findMany({ where: { orgId } }));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ trainingSessionId: null, rating: 5, comment: "Loved it!" });
    });

    it("writes a rating row for a rehearsal session (trainingSessionId set)", async () => {
      const { orgId, userId } = await seedOrgAndUser("Record Satisfaction Rating Rehearsal Org");
      const session = await seedTrainingSession(orgId, userId);

      await recordSatisfactionRating(orgId, session.id, 4, null);

      const rows = await withAuthContext({ orgId }, (tx) => tx.satisfactionRating.findMany({ where: { orgId } }));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ trainingSessionId: session.id, rating: 4, comment: null });
    });

    it("redacts PII in comment before persisting", async () => {
      const { orgId } = await seedOrgAndUser("Redact Satisfaction Comment Org");

      await recordSatisfactionRating(orgId, null, 3, "call me at (415) 555-2671");

      const rows = await withAuthContext({ orgId }, (tx) => tx.satisfactionRating.findMany({ where: { orgId } }));
      expect(rows[0]).toMatchObject({ comment: "call me at [REDACTED_PHONE]" });
    });

    it("stores a null comment as null, not an empty string", async () => {
      const { orgId } = await seedOrgAndUser("Record Satisfaction Rating No Comment Org");

      await recordSatisfactionRating(orgId, null, 2, null);

      const rows = await withAuthContext({ orgId }, (tx) => tx.satisfactionRating.findMany({ where: { orgId } }));
      expect(rows[0]).toMatchObject({ comment: null });
    });

    it("swallows a write failure rather than throwing (never fails the realtime turn)", async () => {
      const { orgId } = await seedOrgAndUser("Record Satisfaction Rating Failure Org");

      await expect(recordSatisfactionRating(orgId, randomUUID(), 3, null)).resolves.toBeUndefined();
    });
  });

  describe("getSatisfactionAnalytics", () => {
    it("returns zeros, null avgRating, and a zero-filled 1-5 distribution for an org with no ratings", async () => {
      const { orgId } = await seedOrgAndUser("Satisfaction Analytics Empty Org");

      const result = await getSatisfactionAnalytics(orgId, 30);
      expect(result.ratingCount).toBe(0);
      expect(result.avgRating).toBeNull();
      expect(result.ratingDistribution).toEqual([
        { rating: 1, count: 0 },
        { rating: 2, count: 0 },
        { rating: 3, count: 0 },
        { rating: 4, count: 0 },
        { rating: 5, count: 0 },
      ]);
    });

    it("averages ratings and buckets the distribution correctly", async () => {
      const { orgId } = await seedOrgAndUser("Satisfaction Analytics Avg Org");
      await recordSatisfactionRating(orgId, null, 5, null);
      await recordSatisfactionRating(orgId, null, 5, null);
      await recordSatisfactionRating(orgId, null, 1, null);

      const result = await getSatisfactionAnalytics(orgId, 30);
      expect(result.ratingCount).toBe(3);
      expect(result.avgRating).toBeCloseTo(11 / 3, 5);
      expect(result.ratingDistribution).toEqual([
        { rating: 1, count: 1 },
        { rating: 2, count: 0 },
        { rating: 3, count: 0 },
        { rating: 4, count: 0 },
        { rating: 5, count: 2 },
      ]);
    });

    it("excludes a rating recorded outside the window", async () => {
      const { orgId } = await seedOrgAndUser("Satisfaction Analytics Window Org");
      const outsideWindow = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await withAuthContext({ orgId }, (tx) =>
        tx.satisfactionRating.create({ data: { orgId, rating: 5, createdAt: outsideWindow } }),
      );
      await recordSatisfactionRating(orgId, null, 2, null);

      const result = await getSatisfactionAnalytics(orgId, 7);
      expect(result.ratingCount).toBe(1);
      expect(result.avgRating).toBe(2);
    });

    it("never includes another org's SatisfactionRating rows in the aggregate (two-org isolation)", async () => {
      const orgA = await seedOrgAndUser("Satisfaction Analytics Isolation Org A");
      const orgB = await seedOrgAndUser("Satisfaction Analytics Isolation Org B");
      await recordSatisfactionRating(orgB.orgId, null, 5, null);

      const result = await getSatisfactionAnalytics(orgA.orgId, 30);
      expect(result.ratingCount).toBe(0);
      expect(result.avgRating).toBeNull();
    });
  });
});
