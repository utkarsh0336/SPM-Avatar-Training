/**
 * PII redaction applied at write time (before insert), never on read — see
 * .claude/rules/tenancy.md. Phase 0 stub; real patterns land with the
 * transcript pipeline in Phase 1.
 */
export function redact(text: string): string {
  return text;
}
