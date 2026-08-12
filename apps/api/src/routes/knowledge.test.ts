import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { generateOpaqueToken, prisma, setAuthContext, sha256Hex, withAuthContext, type Role } from "@avatrain/shared";
import { buildApp } from "../app.js";

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
): { body: Buffer; contentTypeHeader: string } {
  const boundary = `----AvatrainTestBoundary${randomUUID()}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
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
) {
  const { body, contentTypeHeader } = buildMultipartBody(filename, contentType, content);
  return app.inject({
    method: "POST",
    url: "/v1/knowledge/documents",
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
});
