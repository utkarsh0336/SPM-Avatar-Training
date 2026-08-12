import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@avatrain/shared";
import { updateBranding } from "./org-service.js";

const createdOrgIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const orgId of createdOrgIds) {
    await prisma.organization.deleteMany({ where: { id: orgId } });
  }
}

afterAll(cleanup);

async function seedOrg(name: string): Promise<string> {
  const orgId = randomUUID();
  await prisma.organization.create({ data: { id: orgId, name } });
  createdOrgIds.push(orgId);
  return orgId;
}

describe("updateBranding", () => {
  it("persists a full branding update", async () => {
    const orgId = await seedOrg("Full Update Org");

    const result = await updateBranding(orgId, {
      name: "Acme Corp",
      logoUrl: "https://cdn.example.com/logo.png",
      primaryColorHex: "#8B5CF6",
      secondaryColorHex: "#3B82F6",
    });

    expect(result).toEqual({
      id: orgId,
      name: "Acme Corp",
      logoUrl: "https://cdn.example.com/logo.png",
      primaryColorHex: "#8B5CF6",
      secondaryColorHex: "#3B82F6",
    });
  });

  it("a partial update leaves previously-set fields untouched", async () => {
    const orgId = await seedOrg("Partial Update Org");
    await updateBranding(orgId, {
      name: "Original Name",
      logoUrl: "https://cdn.example.com/original.png",
      primaryColorHex: "#111111",
      secondaryColorHex: "#222222",
    });

    const result = await updateBranding(orgId, { primaryColorHex: "#8B5CF6" });

    expect(result).toEqual({
      id: orgId,
      name: "Original Name",
      logoUrl: "https://cdn.example.com/original.png",
      primaryColorHex: "#8B5CF6",
      secondaryColorHex: "#222222",
    });
  });

  it("an org that never sets branding keeps null defaults", async () => {
    const orgId = await seedOrg("Default Org");
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

    expect(org.logoUrl).toBeNull();
    expect(org.primaryColorHex).toBeNull();
    expect(org.secondaryColorHex).toBeNull();
  });
});
