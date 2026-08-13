# Embed SDK Contract

This documents `packages/embed`'s public surface — the thing customer code
actually calls, and the wire shapes it depends on. Additive changes only;
a breaking change needs a new CDN major (`/v1/` → `/v2/`) and a migration
note here. See `.claude/rules/embed.md`.

(This file is the pragmatic substitute for that rule's reference to an
`apps/docs` app and a `contract-guard` script — neither exists in this
repo. Until they do, this file is the source of truth for the contract,
and there is no automated guard enforcing it beyond
`packages/embed/src/postmessage-parity.test.ts`, which keeps the loader's
hand-rolled validator and `@avatrain/shared/contracts`' zod schema from
silently drifting apart.)

## Installing the widget

```html
<script src="https://YOUR-EMBED-CDN-URL/v1/embed.js"></script>
<div id="avatrain-widget"></div>
<script>
  window.Avatrain.init({
    key: "pk_xxx", // your Application's publishable key — see the dashboard's Settings → Embed page
    target: "#avatrain-widget", // a CSS selector or an HTMLElement
    height: 480, // optional, pixels — the widget adjusts it after mounting
  });
</script>
```

Replace `YOUR-EMBED-CDN-URL` with wherever `packages/embed`'s built
`dist/index.js` and `apps/widget`'s built output are actually deployed —
that's a deployment decision, not something this loader can know, so it is
deliberately not hardcoded to a live domain anywhere in the source.

## `window.Avatrain.init(options)`

| Option      | Type                     | Required | Description                                                                          |
| ----------- | ------------------------ | -------- | -------------------------------------------------------------------------------------- |
| `key`       | `string`                 | yes      | The Application's publishable key.                                                     |
| `target`    | `string \| HTMLElement`  | yes      | CSS selector or element to mount the widget iframe into.                               |
| `height`    | `number`                 | no       | Initial iframe height in pixels (default 480) — the widget resizes it after mounting.  |
| `widgetUrl` | `string`                 | no       | Overrides the widget iframe's base URL. Defaults to a same-origin `/embed/widget/` path — override this for any real deployment. |

Returns an `AvatrainInstance` — currently just `{ destroy(): void }`, which
removes the iframe and stops listening for its messages.

Throws synchronously if `key` is missing or `target` doesn't resolve to an
element — this is a caller error, not a runtime condition to recover from.

## postMessage protocol

Both directions are exact-origin-checked and schema-validated — see
`.claude/rules/embed.md`. The zod-authoritative schemas live in
`@avatrain/shared/contracts` (`embed-config.ts`); `packages/embed`'s own
loader ships a hand-rolled parser instead (zero runtime dependencies, 10KB
gzip budget) that `postmessage-parity.test.ts` asserts stays in lockstep
with the zod version.

**Widget (iframe) → loader (parent):**

- `{ type: "avatrain:ready" }` — sent once the widget has mounted.
- `{ type: "avatrain:resize", height: number }` — sent whenever the
  widget's rendered content height changes (`ResizeObserver`-driven); the
  loader resizes the iframe to match.

**Loader (parent) → widget (iframe):**

- `{ type: "avatrain:destroy" }` — sent from `AvatrainInstance.destroy()`,
  best-effort, before the iframe is removed from the DOM. Lets the widget
  stop its microphone and close its WebSocket cleanly.

## Public API surface (`apps/api`)

Both routes are public and publishable-key-authenticated — no cookie, no
`Authorization` header. `key` travels as a query parameter on both (not a
JSON body) specifically so neither request needs a `Content-Type` header,
keeping both a "simple" CORS request per the Fetch spec — no `OPTIONS`
preflight handler exists or is needed.

- `GET /v1/embed/config?key=pk_xxx` — returns the pinned persona's fields
  (`EmbedConfigResponse`). 404 for an unknown key, 403 if the request's
  `Origin` isn't on the Application's `allowedOrigins`, 503 if the
  Application is disabled or has no complete, published (`ACTIVE`) avatar
  pinned yet.
- `POST /v1/embed/ticket?key=pk_xxx` — mints a short-lived, single-use WS
  ticket scoped to the pinned avatar (`orgId`, `userId: null`,
  `pinnedAvatarId`). Same origin/enablement/avatar checks as `config`,
  plus a per-key rate limit (20 requests / 5 minutes).

Every persona field returned by `config` is resolved server-side from the
Application's pinned `avatarId` — an embed page's own JavaScript never
supplies (or can override) `avatarName`/`expertise`/`voiceTone`/etc.
directly; see `conversation-service.ts`'s `claims.pinnedAvatarId` handling.

## What an anonymous embed session can't do

Per `.claude/rules/tenancy.md`, unsigned identity may never write to
`ObjectiveProgress`. An anonymous embed visitor's checkpoint/grading
feedback still streams back for UX (so a "check your understanding"
moment isn't silently dropped), it just never persists — so it won't
survive a page refresh, and `end_module` (which measures completion
against persisted progress) is refused outright rather than reporting a
result measured against nothing.

## Size budget

`packages/embed`'s built `dist/index.js` must stay under 10KB gzipped
(`pnpm --filter @avatrain/embed run size`, run as part of `pnpm verify`).
It ships zero runtime dependencies — everything it needs (including the
hand-rolled postMessage validator) lives in that one file, since the size
check measures `dist/index.js` directly with no bundling step.
