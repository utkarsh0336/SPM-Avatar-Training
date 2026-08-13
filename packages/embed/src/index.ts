/**
 * Avatrain embed loader — the actual "put an AI avatar trainer on any
 * website" entry point. Deliberately a single self-contained file: this
 * package ships zero runtime dependencies and must stay under a 10KB
 * gzipped budget (see .claude/rules/embed.md and scripts/check-embed-size.mjs,
 * which measures dist/index.js directly — a plain `tsc` compile, no
 * bundler, so splitting logic across files would silently under-count the
 * real delivered size of a <script src> embed).
 *
 * init() mounts a sandboxed <iframe> pointed at the widget (apps/widget)
 * and wires a postMessage bridge to it — exact-origin-checked in both
 * directions, schema-validated by the hand-rolled parseInboundMessage
 * below (not zod: would blow the size budget alone). The zod-authoritative
 * version of this exact wire shape lives in
 * @avatrain/shared/contracts/embed-config.ts; embed's own test suite
 * asserts both accept/reject the same inputs.
 */

export type AvatrainTarget = string | HTMLElement;

export interface AvatrainInitOptions {
  /** The Application's publishableKey — apps/dashboard's embed settings page (Settings → Embed) generates one per Application row. */
  key: string;
  /** CSS selector or element to mount the widget iframe into. */
  target: AvatrainTarget;
  /** Initial iframe height in pixels, before the widget's own avatrain:resize message (if any) adjusts it. */
  height?: number;
  /**
   * Base URL the widget iframe is served from. Defaults to a same-origin
   * relative path, which only resolves correctly if apps/widget's build
   * output is deployed alongside whatever page calls init() — true for
   * local/dev testing against this monorepo's own server. A real
   * production deployment must pass its actual widget CDN URL here; where
   * that build is hosted is a deployment decision this loader can't know,
   * so it is deliberately not hardcoded to a live domain. See docs/embed-contract.md.
   */
  widgetUrl?: string;
}

export interface AvatrainInstance {
  /** Removes the iframe and stops listening for its messages. */
  destroy(): void;
}

const DEFAULT_HEIGHT = 480;
const DEFAULT_WIDGET_URL = "/embed/widget/";

function resolveTarget(target: AvatrainTarget): HTMLElement | null {
  if (typeof target !== "string") return target;
  return document.querySelector(target);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface AvatrainReadyMessage {
  type: "avatrain:ready";
}
export interface AvatrainResizeMessage {
  type: "avatrain:resize";
  height: number;
}
export type AvatrainInboundMessage = AvatrainReadyMessage | AvatrainResizeMessage;

/**
 * Parses a postMessage payload from the widget iframe — the only two
 * inbound message types this loader understands. Returns null (never
 * throws) for anything else, including a malformed/spoofed payload from a
 * page that isn't actually running the widget.
 */
export function parseInboundMessage(data: unknown): AvatrainInboundMessage | null {
  if (!isPlainObject(data)) return null;
  if (data.type === "avatrain:ready") return { type: "avatrain:ready" };
  if (data.type === "avatrain:resize" && typeof data.height === "number" && Number.isFinite(data.height) && data.height > 0) {
    return { type: "avatrain:resize", height: data.height };
  }
  return null;
}

/**
 * Mounts the widget. Throws synchronously on a bad call (missing key, no
 * matching target) rather than failing silently — a caller integrating
 * this for the first time should see the mistake immediately, not a blank
 * div. Everything DOM-related that follows is fire-and-forget: the widget
 * itself is what actually renders the avatar and runs the voice session.
 */
export function init(options: AvatrainInitOptions): AvatrainInstance {
  if (!options.key) {
    throw new Error("[Avatrain] init(): `key` is required (your Application's publishable key)");
  }
  const container = resolveTarget(options.target);
  if (!container) {
    throw new Error("[Avatrain] init(): target not found");
  }

  const url = new URL(options.widgetUrl ?? DEFAULT_WIDGET_URL, window.location.href);
  url.searchParams.set("key", options.key);
  const widgetOrigin = url.origin;

  const iframe = document.createElement("iframe");
  iframe.src = url.toString();
  iframe.title = "Avatrain AI Avatar";
  iframe.allow = "microphone";
  iframe.style.border = "none";
  iframe.style.width = "100%";
  iframe.style.height = `${options.height ?? DEFAULT_HEIGHT}px`;
  iframe.style.display = "block";

  function onMessage(event: MessageEvent): void {
    // Exact-string origin check, never '*' — .claude/rules/embed.md. Also
    // requires the message to actually originate from THIS iframe, not
    // merely from something sharing its origin (e.g. a second embed on the
    // same page).
    if (event.origin !== widgetOrigin) return;
    if (event.source !== iframe.contentWindow) return;
    const message = parseInboundMessage(event.data);
    if (!message) return;
    if (message.type === "avatrain:resize") {
      iframe.style.height = `${message.height}px`;
    }
  }

  window.addEventListener("message", onMessage);
  container.appendChild(iframe);

  return {
    destroy(): void {
      window.removeEventListener("message", onMessage);
      // Best-effort: let the widget stop its mic/WS cleanly before the
      // iframe is torn down. Origin-scoped, not '*'.
      iframe.contentWindow?.postMessage({ type: "avatrain:destroy" }, widgetOrigin);
      iframe.remove();
    },
  };
}

declare global {
  interface Window {
    Avatrain?: { init: typeof init };
  }
}

// No global CSS, no window pollution beyond window.Avatrain —
// .claude/rules/embed.md.
if (typeof window !== "undefined") {
  window.Avatrain = { init };
}
