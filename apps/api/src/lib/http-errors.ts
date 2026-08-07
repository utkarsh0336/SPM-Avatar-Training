import { ZodError } from "zod";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

/** Error envelope shape per .claude/specs/authentication.md: { error, message? } */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "HttpError";
  }
}

export const unauthorized = (code = "unauthorized", message?: string) =>
  new HttpError(401, code, message);
export const forbidden = (code = "forbidden", message?: string) =>
  new HttpError(403, code, message);
export const conflict = (code: string, message?: string) => new HttpError(409, code, message);
export const badRequest = (code = "bad_request", message?: string) =>
  new HttpError(400, code, message);
export const gone = (code: string, message?: string) => new HttpError(410, code, message);
export const serviceUnavailable = (code = "service_unavailable", message?: string) =>
  new HttpError(503, code, message);

export function handleError(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof HttpError) {
    reply.status(error.statusCode).send({ error: error.code, message: error.message });
    return;
  }
  if (error instanceof ZodError) {
    reply.status(400).send({ error: "invalid_request", message: error.message });
    return;
  }
  // Never forward an unexpected error's message to the client (Fastify's
  // default Error serialization would include it) — log it server-side
  // instead, since `Fastify({ logger: false })` means nothing else will.
  console.error(error);
  reply.status(500).send({ error: "internal_error" });
}
