import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  generateOpaqueToken,
  prisma,
  setAuthContext,
  sha256Hex,
  withAuthContext,
  type EmbeddingProvider,
  type Role,
} from "@avatrain/shared";
import { buildApp } from "../app.js";
import { ingestDocument } from "../services/knowledge-service.js";
import { txtParser } from "../lib/document-parsers/txt.js";

// Same fake-provider pattern as knowledge-service.test.ts: real ingestion
// via the local @xenova/transformers model is unnecessary and slow for
// routing/HTTP-shape tests, so tests that need an INDEXED row call
// ingestDocument() directly with this instead of waiting on the fire-and-
// forget real provider the HTTP route kicks off.
function fakeEmbeddingProvider(): EmbeddingProvider {
  return {
    name: "fake",
    dimensions: 384,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(() => Array(384).fill(0.01));
    },
  };
}

function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@example.com`;
}

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const orgId of createdOrgIds) {
    await withAuthContext({ orgId }, async (tx) => {
      await tx.knowledgeDocument.deleteMany({ where: { orgId } });
      await tx.session.deleteMany({ where: { orgId } });
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

const app = buildApp();

// Same rate-limit workaround onboarding.test.ts/auth.test.ts already
// document: every app.inject() call reports the same synthetic IP, so real
// signups would share one rate-limit bucket across this file's many tests.
interface SeededOrg {
  token: string;
  userId: string;
  orgId: string;
}

async function seedOrgWithSessionToken(orgName: string, role: Role = "OWNER"): Promise<SeededOrg> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const token = generateOpaqueToken();
  const tokenHash = sha256Hex(token);

  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: orgId, name: orgName } });
    await tx.user.create({ data: { id: userId, email: uniqueEmail(orgName), passwordHash: "seeded" } });
    await setAuthContext(tx, { userId, orgId });
    await tx.membership.create({ data: { orgId, userId, role } });
    await tx.session.create({
      data: { orgId, userId, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
  });

  createdOrgIds.push(orgId);
  createdUserIds.push(userId);
  return { token, userId, orgId };
}

function buildMultipartBody(
  filename: string,
  contentType: string,
  content: Buffer,
  extraFields: Record<string, string> = {},
): { body: Buffer; contentTypeHeader: string } {
  const boundary = `----AvatrainTestBoundary${randomUUID()}`;
  const fieldParts = Object.entries(extraFields).map(
    ([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
  const preamble = Buffer.from(
    `${fieldParts.join("")}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([preamble, content, epilogue]),
    contentTypeHeader: `multipart/form-data; boundary=${boundary}`,
  };
}

async function uploadFile(
  token: string,
  filename: string,
  contentType: string,
  content: Buffer,
  extraFields: Record<string, string> = {},
) {
  const { body, contentTypeHeader } = buildMultipartBody(filename, contentType, content, extraFields);
  return app.inject({
    method: "POST",
    url: "/v1/knowledge/documents",
    cookies: { avatrain_session: token },
    headers: { "content-type": contentTypeHeader },
    payload: body,
  });
}

async function uploadVersion(
  token: string,
  documentId: string,
  filename: string,
  contentType: string,
  content: Buffer,
  extraFields: Record<string, string> = {},
) {
  const { body, contentTypeHeader } = buildMultipartBody(filename, contentType, content, extraFields);
  return app.inject({
    method: "POST",
    url: `/v1/knowledge/documents/${documentId}/versions`,
    cookies: { avatrain_session: token },
    headers: { "content-type": contentTypeHeader },
    payload: body,
  });
}

describe("knowledge routes", () => {
  describe("POST /v1/knowledge/documents", () => {
    it("requires authentication", async () => {
      const { body, contentTypeHeader } = buildMultipartBody("a.txt", "text/plain", Buffer.from("hi"));
      const response = await app.inject({
        method: "POST",
        url: "/v1/knowledge/documents",
        headers: { "content-type": contentTypeHeader },
        payload: body,
      });
      expect(response.statusCode).toBe(401);
    });

    it("403s for a MEMBER caller", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Member Org", "MEMBER");
      const response = await uploadFile(token, "a.txt", "text/plain", Buffer.from("hi"));
      expect(response.statusCode).toBe(403);
    });

    it("201s for an OWNER, returning a PENDING document", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Upload Org");
      const response = await uploadFile(token, "leave-policy.txt", "text/plain", Buffer.from("Employees get 20 days of leave."));
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ status: "PENDING" });
      expect(typeof response.json().id).toBe("string");
    });

    it("400s for an unsupported mime type", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Bad Mime Org");
      const response = await uploadFile(token, "deck.pptx", "application/vnd.ms-powerpoint", Buffer.from("x"));
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("unsupported_mime_type");
    });
  });

  describe("GET /v1/knowledge/documents", () => {
    it("requires authentication", async () => {
      const response = await app.inject({ method: "GET", url: "/v1/knowledge/documents" });
      expect(response.statusCode).toBe(401);
    });

    it("lists documents uploaded by the caller's org", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge List Org");
      await uploadFile(token, "a.txt", "text/plain", Buffer.from("a"));
      await uploadFile(token, "b.txt", "text/plain", Buffer.from("b"));

      const response = await app.inject({
        method: "GET",
        url: "/v1/knowledge/documents",
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().documents).toHaveLength(2);
    });
  });

  describe("GET/DELETE /v1/knowledge/documents/:documentId", () => {
    it("GET 404s for a document that does not exist", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Get Missing Org");
      const response = await app.inject({
        method: "GET",
        url: `/v1/knowledge/documents/${randomUUID()}`,
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(404);
    });

    it("DELETE removes the document, and a later GET 404s", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Delete Org");
      const upload = await uploadFile(token, "to-delete.txt", "text/plain", Buffer.from("bye"));
      const { id } = upload.json();

      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/v1/knowledge/documents/${id}`,
        cookies: { avatrain_session: token },
      });
      expect(deleteResponse.statusCode).toBe(204);

      const getResponse = await app.inject({
        method: "GET",
        url: `/v1/knowledge/documents/${id}`,
        cookies: { avatrain_session: token },
      });
      expect(getResponse.statusCode).toBe(404);
    });

    describe("two-org isolation", () => {
      it("org B gets 404 (not org A's document) for GET and DELETE", async () => {
        const orgA = await seedOrgWithSessionToken("Knowledge Isolation Org A");
        const orgB = await seedOrgWithSessionToken("Knowledge Isolation Org B");

        const upload = await uploadFile(orgA.token, "secret.txt", "text/plain", Buffer.from("secret"));
        const { id } = upload.json();

        const getResponse = await app.inject({
          method: "GET",
          url: `/v1/knowledge/documents/${id}`,
          cookies: { avatrain_session: orgB.token },
        });
        expect(getResponse.statusCode).toBe(404);

        const deleteResponse = await app.inject({
          method: "DELETE",
          url: `/v1/knowledge/documents/${id}`,
          cookies: { avatrain_session: orgB.token },
        });
        expect(deleteResponse.statusCode).toBe(404);

        // Confirm org A's document really does still exist — org B's
        // DELETE attempt must not have silently succeeded against it.
        const stillThere = await app.inject({
          method: "GET",
          url: `/v1/knowledge/documents/${id}`,
          cookies: { avatrain_session: orgA.token },
        });
        expect(stillThere.statusCode).toBe(200);
      });
    });
  });

  describe("POST /v1/knowledge/documents: category/tags", () => {
    it("persists category and JSON-encoded tags", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Category Org");
      const response = await uploadFile(token, "handbook.txt", "text/plain", Buffer.from("hello"), {
        category: "HR",
        tags: JSON.stringify(["policy", "onboarding"]),
      });
      expect(response.statusCode).toBe(201);
      const { id } = response.json();

      const getResponse = await app.inject({
        method: "GET",
        url: `/v1/knowledge/documents/${id}`,
        cookies: { avatrain_session: token },
      });
      expect(getResponse.json()).toMatchObject({ category: "HR", tags: ["policy", "onboarding"] });
    });

    it("400s for malformed tags JSON", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Bad Tags Org");
      const response = await uploadFile(token, "a.txt", "text/plain", Buffer.from("a"), {
        tags: "not json",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("invalid_tags");
    });

    it("400s for a tags array that fails schema validation", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Too Many Tags Org");
      const response = await uploadFile(token, "a.txt", "text/plain", Buffer.from("a"), {
        tags: JSON.stringify(Array.from({ length: 21 }, (_, i) => `tag-${i}`)),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("invalid_tags");
    });
  });

  describe("GET /v1/knowledge/documents: filtering", () => {
    it("filters by category and by tag", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Filter Org");
      await uploadFile(token, "a.txt", "text/plain", Buffer.from("a"), { category: "HR", tags: '["policy"]' });
      await uploadFile(token, "b.txt", "text/plain", Buffer.from("b"), { category: "Legal", tags: '["sales"]' });

      const byCategory = await app.inject({
        method: "GET",
        url: "/v1/knowledge/documents?category=HR",
        cookies: { avatrain_session: token },
      });
      expect(byCategory.json().documents).toHaveLength(1);
      expect(byCategory.json().documents[0].category).toBe("HR");

      const byTag = await app.inject({
        method: "GET",
        url: "/v1/knowledge/documents?tag=sales",
        cookies: { avatrain_session: token },
      });
      expect(byTag.json().documents).toHaveLength(1);
      expect(byTag.json().documents[0].tags).toContain("sales");
    });
  });

  describe("PATCH /v1/knowledge/documents/:documentId", () => {
    it("requires authentication", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/v1/knowledge/documents/${randomUUID()}`,
        payload: { category: "HR" },
      });
      expect(response.statusCode).toBe(401);
    });

    it("updates category and tags", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Patch Org");
      const upload = await uploadFile(token, "a.txt", "text/plain", Buffer.from("a"));
      const { id } = upload.json();

      const response = await app.inject({
        method: "PATCH",
        url: `/v1/knowledge/documents/${id}`,
        cookies: { avatrain_session: token },
        payload: { category: "Compliance", tags: ["urgent"] },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ category: "Compliance", tags: ["urgent"] });
    });

    it("404s for another org's document", async () => {
      const orgA = await seedOrgWithSessionToken("Knowledge Patch Isolation Org A");
      const orgB = await seedOrgWithSessionToken("Knowledge Patch Isolation Org B");
      const upload = await uploadFile(orgA.token, "secret.txt", "text/plain", Buffer.from("secret"));
      const { id } = upload.json();

      const response = await app.inject({
        method: "PATCH",
        url: `/v1/knowledge/documents/${id}`,
        cookies: { avatrain_session: orgB.token },
        payload: { category: "x" },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /v1/knowledge/documents/:documentId/versions", () => {
    it("requires authentication", async () => {
      const { body, contentTypeHeader } = buildMultipartBody("a.txt", "text/plain", Buffer.from("a"));
      const response = await app.inject({
        method: "POST",
        url: `/v1/knowledge/documents/${randomUUID()}/versions`,
        headers: { "content-type": contentTypeHeader },
        payload: body,
      });
      expect(response.statusCode).toBe(401);
    });

    it("403s for a MEMBER caller", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Versions Member Org", "MEMBER");
      const response = await uploadVersion(token, randomUUID(), "a.txt", "text/plain", Buffer.from("a"));
      expect(response.statusCode).toBe(403);
    });

    it("creates the next version, inheriting title/category/tags from v1", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Versions Org");
      const v1 = await uploadFile(token, "handbook.txt", "text/plain", Buffer.from("hello"), {
        category: "HR",
        tags: '["policy"]',
      });
      const { id: v1Id } = v1.json();

      const v2 = await uploadVersion(token, v1Id, "handbook-v2.txt", "text/plain", Buffer.from("hello v2"));
      expect(v2.statusCode).toBe(201);
      expect(v2.json()).toMatchObject({ version: 2, status: "PENDING" });

      const getV2 = await app.inject({
        method: "GET",
        url: `/v1/knowledge/documents/${v2.json().id}`,
        cookies: { avatrain_session: token },
      });
      expect(getV2.json()).toMatchObject({ title: "handbook", category: "HR", tags: ["policy"], isLatest: false });
    });

    it("accepts an explicit title override", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Versions Title Org");
      const v1 = await uploadFile(token, "handbook.txt", "text/plain", Buffer.from("hello"));
      const { id: v1Id } = v1.json();

      const v2 = await uploadVersion(token, v1Id, "handbook-v2.txt", "text/plain", Buffer.from("hello v2"), {
        title: "Employee Handbook 2026",
      });
      const getV2 = await app.inject({
        method: "GET",
        url: `/v1/knowledge/documents/${v2.json().id}`,
        cookies: { avatrain_session: token },
      });
      expect(getV2.json().title).toBe("Employee Handbook 2026");
    });

    it("404s for another org's document", async () => {
      const orgA = await seedOrgWithSessionToken("Knowledge Versions Isolation Org A");
      const orgB = await seedOrgWithSessionToken("Knowledge Versions Isolation Org B");
      const upload = await uploadFile(orgA.token, "secret.txt", "text/plain", Buffer.from("secret"));
      const { id } = upload.json();

      const response = await uploadVersion(orgB.token, id, "x.txt", "text/plain", Buffer.from("x"));
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /v1/knowledge/documents/:documentId/versions", () => {
    it("requires authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/knowledge/documents/${randomUUID()}/versions`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("lists versions newest first", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge List Versions Org");
      const v1 = await uploadFile(token, "a.txt", "text/plain", Buffer.from("a"));
      const { id: v1Id } = v1.json();
      const v2 = await uploadVersion(token, v1Id, "a2.txt", "text/plain", Buffer.from("a2"));

      const response = await app.inject({
        method: "GET",
        url: `/v1/knowledge/documents/${v1Id}/versions`,
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(200);
      const { versions } = response.json();
      expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
      expect(versions[0].id).toBe(v2.json().id);
    });

    it("404s for another org's document", async () => {
      const orgA = await seedOrgWithSessionToken("Knowledge Versions List Isolation Org A");
      const orgB = await seedOrgWithSessionToken("Knowledge Versions List Isolation Org B");
      const upload = await uploadFile(orgA.token, "secret.txt", "text/plain", Buffer.from("secret"));
      const { id } = upload.json();

      const response = await app.inject({
        method: "GET",
        url: `/v1/knowledge/documents/${id}/versions`,
        cookies: { avatrain_session: orgB.token },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /v1/knowledge/documents/:documentId/versions/:versionId/restore", () => {
    it("requires authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/knowledge/documents/${randomUUID()}/versions/${randomUUID()}/restore`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("403s for a MEMBER caller", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Restore Member Org", "MEMBER");
      const response = await app.inject({
        method: "POST",
        url: `/v1/knowledge/documents/${randomUUID()}/versions/${randomUUID()}/restore`,
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(403);
    });

    it("restores an older INDEXED version as the lineage's active version", async () => {
      const { token, orgId } = await seedOrgWithSessionToken("Knowledge Restore Org");
      const bytes = Buffer.from("word ".repeat(500).trim());
      const v1 = await uploadFile(token, "a.txt", "text/plain", bytes);
      const { id: v1Id } = v1.json();
      await ingestDocument(orgId, v1Id, bytes, txtParser, { createEmbeddingProvider: fakeEmbeddingProvider });

      const v2bytes = Buffer.from("word ".repeat(500).trim());
      const v2 = await uploadVersion(token, v1Id, "a2.txt", "text/plain", v2bytes);
      const { id: v2Id } = v2.json();
      await ingestDocument(orgId, v2Id, v2bytes, txtParser, { createEmbeddingProvider: fakeEmbeddingProvider });

      const getV2Before = await app.inject({
        method: "GET",
        url: `/v1/knowledge/documents/${v2Id}`,
        cookies: { avatrain_session: token },
      });
      expect(getV2Before.json().isLatest).toBe(true);

      const restoreResponse = await app.inject({
        method: "POST",
        url: `/v1/knowledge/documents/${v1Id}/versions/${v1Id}/restore`,
        cookies: { avatrain_session: token },
      });
      expect(restoreResponse.statusCode).toBe(200);
      expect(restoreResponse.json().isLatest).toBe(true);

      const getV2After = await app.inject({
        method: "GET",
        url: `/v1/knowledge/documents/${v2Id}`,
        cookies: { avatrain_session: token },
      });
      expect(getV2After.json().isLatest).toBe(false);
    });

    it("409s when restoring a FAILED version", async () => {
      const { token, orgId } = await seedOrgWithSessionToken("Knowledge Restore Conflict Org");
      const v1 = await uploadFile(token, "a.txt", "text/plain", Buffer.from("word ".repeat(500).trim()));
      const { id: v1Id } = v1.json();

      // Uploading only enqueues now — nothing consumes that queue during
      // this test file's own run, so simulate what the worker would do:
      // call ingestDocument() directly. "No extractable text" is a
      // synchronous, deterministic failure path (fails before any
      // embedding-provider call), so this is fully deterministic, no
      // polling needed.
      const blankBytes = Buffer.from("   \n\t  ");
      const v2 = await uploadVersion(token, v1Id, "a2.txt", "text/plain", blankBytes);
      const { id: v2Id } = v2.json();
      await ingestDocument(orgId, v2Id, blankBytes, txtParser, { createEmbeddingProvider: fakeEmbeddingProvider });

      const v2Status = await app.inject({
        method: "GET",
        url: `/v1/knowledge/documents/${v2Id}`,
        cookies: { avatrain_session: token },
      });
      expect(v2Status.json().status).toBe("FAILED");

      const response = await app.inject({
        method: "POST",
        url: `/v1/knowledge/documents/${v1Id}/versions/${v2Id}/restore`,
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe("version_not_restorable");
    });

    it("404s for another org's document/version", async () => {
      const orgA = await seedOrgWithSessionToken("Knowledge Restore Isolation Org A");
      const orgB = await seedOrgWithSessionToken("Knowledge Restore Isolation Org B");
      const upload = await uploadFile(orgA.token, "secret.txt", "text/plain", Buffer.from("secret"));
      const { id } = upload.json();

      const response = await app.inject({
        method: "POST",
        url: `/v1/knowledge/documents/${id}/versions/${id}/restore`,
        cookies: { avatrain_session: orgB.token },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /v1/knowledge/search", () => {
    it("requires authentication", async () => {
      const response = await app.inject({ method: "GET", url: "/v1/knowledge/search?q=leave" });
      expect(response.statusCode).toBe(401);
    });

    it("403s for a MEMBER caller", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Search Member Org", "MEMBER");
      const response = await app.inject({
        method: "GET",
        url: "/v1/knowledge/search?q=leave",
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(403);
    });

    it("400s for a missing q", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Search Missing Q Org");
      const response = await app.inject({
        method: "GET",
        url: "/v1/knowledge/search",
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(400);
    });

    it("400s for a blank q", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Search Blank Q Org");
      const response = await app.inject({
        method: "GET",
        url: "/v1/knowledge/search?q=%20%20%20",
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(400);
    });

    it("returns [] when nothing is indexed yet", async () => {
      const { token } = await seedOrgWithSessionToken("Knowledge Search Empty Org");
      const response = await app.inject({
        method: "GET",
        url: "/v1/knowledge/search?q=leave%20policy",
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ results: [] });
    });

    it("returns matching, correctly-shaped results after indexing", async () => {
      const { token, orgId } = await seedOrgWithSessionToken("Knowledge Search Org");
      // No createEmbeddingProvider override here: the search route always
      // embeds the query with the real env-configured provider (routes
      // never accept deps injection), so this document must be indexed
      // with that same real provider too — otherwise the fake constant
      // vector used elsewhere in this file lives in a different embedding
      // space than the query and never scores above the similarity floor.
      const bytes = Buffer.from("Employees get twenty days of paid leave per year.");
      const upload = await uploadFile(token, "leave-policy.txt", "text/plain", bytes);
      const { id: documentId } = upload.json();
      await ingestDocument(orgId, documentId, bytes, txtParser, {});

      const response = await app.inject({
        method: "GET",
        url: "/v1/knowledge/search?q=leave%20policy&topK=3",
        cookies: { avatrain_session: token },
      });
      expect(response.statusCode).toBe(200);
      const { results } = response.json();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toMatchObject({ documentId, title: "leave-policy" });
      expect(typeof results[0].content).toBe("string");
      expect(typeof results[0].similarity).toBe("number");
    });

    it("never returns another org's indexed content", async () => {
      const orgA = await seedOrgWithSessionToken("Knowledge Search Isolation Org A");
      const orgB = await seedOrgWithSessionToken("Knowledge Search Isolation Org B");
      const bytes = Buffer.from("word ".repeat(500).trim());
      const upload = await uploadFile(orgA.token, "secret.txt", "text/plain", bytes);
      const { id: documentId } = upload.json();
      await ingestDocument(orgA.orgId, documentId, bytes, txtParser, {
        createEmbeddingProvider: fakeEmbeddingProvider,
      });

      const response = await app.inject({
        method: "GET",
        url: "/v1/knowledge/search?q=word",
        cookies: { avatrain_session: orgB.token },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ results: [] });
    });
  });
});
