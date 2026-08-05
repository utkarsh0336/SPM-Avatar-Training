# Roadmap

Phases are sequential and each has a hard exit criterion. **Do not start phase N+1 while phase N's
exit criterion is unmet.** The most common way this project fails is building the avatar before the
voice loop is fast, then never being able to tell which layer is slow.

Effort estimates assume one engineer working with Claude Code.

---

## Phase 0 — Scaffold (2–3 days)

pnpm + Turborepo workspace, all apps/packages created empty but building. Docker compose for
Postgres + Redis. GitHub Actions running `pnpm verify`. Prisma initialised with `Organization`,
`Application`, and RLS helpers. `.claude/` rules and agents committed.

**Exit:** `pnpm verify` green on CI, every app builds, `pnpm dev` brings up the full local stack.

---

## Phase 1 — Walking skeleton (1 week) ⚑ the phase that matters

Voice-only, no avatar, no UI polish. `POST /v1/sessions` mints an ephemeral secret. The widget
establishes a direct WebRTC connection, streams mic audio, plays model audio, and renders live
captions. Barge-in works. Telemetry captures TTFA. The record/replay harness exists and has at
least one captured session fixture.

**Exit:**
- Two-way spoken conversation, sustained 5 minutes, no drops
- **TTFA p50 < 700ms** measured, not estimated
- Barge-in cuts audio within 100ms
- Reconnect after a forced network drop resumes the conversation
- CI runs realtime tests off recorded fixtures with no live API calls

If TTFA is above budget here, stop and fix it. It will only get worse.

---

## Phase 2 — Avatar (1.5 weeks)

`avatar-core` interface, `mesh3d` implementation, GLB loading, spectral viseme pipeline, idle
behaviours (blink, saccade, breathe, sway, gaze), expression channel, LOD degradation, `voiceOnly`
fallback.

**Exit:**
- Lip-sync judged convincing by three people who did not build it
- 30fps sustained on a 2019 integrated-graphics laptop
- Mouth freezes to neutral within one frame of barge-in
- WebGL failure degrades to `voiceOnly` with no console errors
- Latency budget unchanged from Phase 1 — the avatar adds nothing measurable

---

## Phase 3 — It actually teaches (2 weeks)

Ingestion pipeline (PDF/DOCX/PPTX/MP4 → chunks → embeddings). Curriculum model. Tool registry with
`search_knowledge`, `show_asset`, `start_checkpoint`, `grade_answer`, `record_progress`,
`end_module`. Grounded system-instruction template. Progress persistence.

**Exit:**
- A real 5-objective module taught end to end
- Every product claim traceable to a retrieved chunk (spot-check 20 utterances, zero ungrounded)
- Wrong answers trigger remediation, not just "incorrect"
- `ObjectiveProgress` reflects the session accurately
- Tool p95 < 400ms, or a filler utterance fires

This is where the product becomes a product. Everything before it is a demo.

---

## Phase 4 — Embeddable (1.5 weeks)

`packages/embed` loader, Shadow DOM host, sandboxed iframe, origin allowlist, identity JWT
verification, `postMessage` bridge with schema validation, `highlight_element` pointing at the host
page, public JS API and events, quotas and rate limits.

**Exit:**
- Loader **≤ 10KB gzipped**, zero dependencies
- Runs on three unrelated third-party sites with zero console errors and zero CSS bleed
- Requests from a non-allowlisted origin are rejected
- Forged identity cannot write progress
- Lighthouse impact on the host page is negligible

---

## Phase 5 — Trainer surface (2 weeks)

Next.js dashboard from the Figma design system: onboarding, content upload with ingestion status,
curriculum builder, persona configuration with live preview, analytics (completion, mastery,
drop-off points, transcript search), webhook management, key rotation.

**Exit:** a trainer who has never seen the product completes upload → configure → publish → read
results without help. Watch someone do it; do not assume.

---

## Phase 6 — Photoreal (1.5 weeks)

`apps/agent` LiveKit worker, Mode B transport, avatar provider adapter, human-participant cost gate,
server-side tool execution, mode resolution by plan, graceful degradation from `stream` to `mesh3d`.

**Exit:**
- Identical widget UX across both modes
- p95 TTFA < 1400ms
- Worker provably does not start a paid session before a human joins (test it)
- Provider outage degrades to `mesh3d` mid-session without dropping the learner

---

## Phase 7 — Money (1 week)

Stripe usage-based billing, `billableMs` metering from heartbeats, plan enforcement, soft and hard
caps, per-org cost dashboards, anomaly alerts, invoice reconciliation job.

**Exit:** metered minutes reconcile with Stripe to the cent across a 7-day synthetic run; exceeding
a hard cap blocks new sessions with a clean in-widget message.

---

## Phase 8 — Hardening (2 weeks)

Load testing to 500 concurrent sessions, accessibility pass, security review and pen test, SOC 2
evidence collection, runbooks, on-call alerting, multi-region pinning, DSAR tooling.

**Exit:**
- 500 concurrent sessions with SLOs held
- axe-core clean; full keyboard path; captions default-on; `prefers-reduced-motion` respected
- Pen-test findings closed or accepted with written rationale
- Runbook exists for every alert that can page someone

---

## Deliberately deferred

Phonemic lip-sync, vision input (learner screen share), native mobile SDKs, SCORM/xAPI export,
avatar replica training, on-prem, marketplace of prebuilt programs. Each is a real request you will
receive; none of them is why the first customer buys.