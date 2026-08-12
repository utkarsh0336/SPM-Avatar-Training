import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Adapter boundary for where an uploaded document's raw bytes live —
 * addressed only by an opaque `key` (never a filesystem path directly, so
 * an S3-compatible implementation slots in later without touching
 * callers). See .claude/specs/knowledge-management.md.
 */
export interface DocumentStorage {
  /** Returns the key to persist on KnowledgeDocument.storageKey. */
  save(bytes: Buffer): Promise<string>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export interface LocalFilesystemStorageOptions {
  /** Defaults to KNOWLEDGE_STORAGE_DIR, or ./.data/knowledge-documents under cwd. */
  baseDir?: string;
}

/**
 * Resolves key -> absolute path and asserts the result is still inside
 * baseDir. Keys are always server-generated UUIDs (see save() below), never
 * taken from a client — this is defense in depth, not the primary guard.
 */
function resolveWithinBaseDir(baseDir: string, key: string): string {
  const resolvedBase = resolve(baseDir);
  const resolvedPath = resolve(resolvedBase, key);
  if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(resolvedBase + sep)) {
    throw new Error(`document storage key escapes its base directory: ${key}`);
  }
  return resolvedPath;
}

export function createLocalFilesystemStorage(options: LocalFilesystemStorageOptions = {}): DocumentStorage {
  const baseDir = options.baseDir ?? process.env.KNOWLEDGE_STORAGE_DIR ?? join(process.cwd(), ".data", "knowledge-documents");

  return {
    async save(bytes: Buffer): Promise<string> {
      const key = randomUUID();
      const filePath = resolveWithinBaseDir(baseDir, key);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, bytes);
      return key;
    },
    async read(key: string): Promise<Buffer> {
      return readFile(resolveWithinBaseDir(baseDir, key));
    },
    async delete(key: string): Promise<void> {
      await rm(resolveWithinBaseDir(baseDir, key), { force: true });
    },
  };
}

export function createDocumentStorageFromEnv(): DocumentStorage {
  return createLocalFilesystemStorage();
}
