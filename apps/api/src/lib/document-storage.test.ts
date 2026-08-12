import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalFilesystemStorage, type DocumentStorage } from "./document-storage.js";

describe("createLocalFilesystemStorage", () => {
  let baseDir: string;
  let storage: DocumentStorage;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "avatrain-knowledge-test-"));
    storage = createLocalFilesystemStorage({ baseDir });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("saves bytes and returns a key that reads back the same content", async () => {
    const bytes = Buffer.from("hello world");
    const key = await storage.save(bytes);

    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
    const readBack = await storage.read(key);
    expect(readBack.equals(bytes)).toBe(true);
  });

  it("generates a distinct key for each save, even for identical bytes", async () => {
    const bytes = Buffer.from("same content");
    const keyA = await storage.save(bytes);
    const keyB = await storage.save(bytes);
    expect(keyA).not.toBe(keyB);
  });

  it("deletes a stored file so it can no longer be read", async () => {
    const key = await storage.save(Buffer.from("to be deleted"));
    await storage.delete(key);
    await expect(storage.read(key)).rejects.toThrow();
  });

  it("delete is a no-op (does not throw) for a key that was never saved", async () => {
    await expect(storage.delete("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
  });

  it("rejects a key that attempts to escape the base directory", async () => {
    await expect(storage.read("../../etc/passwd")).rejects.toThrow(/escapes its base directory/);
  });
});
