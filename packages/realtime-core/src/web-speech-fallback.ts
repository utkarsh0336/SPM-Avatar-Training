// Minimal structural subset of the DOM SpeechRecognition interface — browsers
// disagree on the global name (SpeechRecognition vs webkitSpeechRecognition),
// and not every TS lib target ships the real type, so this is declared
// locally rather than relying on lib.dom.d.ts.
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export interface WebSpeechFallbackResult {
  text: string;
}

export interface RecognizeOnceOptions {
  /** Injectable for tests; defaults to the browser's SpeechRecognition/webkitSpeechRecognition. */
  createRecognition?: () => SpeechRecognitionLike | null;
}

function createDefaultRecognition(): SpeechRecognitionLike | null {
  const global = globalThis as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = global.SpeechRecognition ?? global.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/**
 * Client-side-only STT fallback (brief's approved stack table, §3) — used
 * for an utterance once the server reports STT unavailable (stt.failed).
 * Not a server-side STTProvider candidate: SpeechRecognition only exists in
 * the browser, so there is nothing for apps/api to run here. One-shot:
 * resolves with the first final result and stops; rejects (rather than
 * hanging forever) if recognition ends with no result.
 */
export function recognizeOnce(options: RecognizeOnceOptions = {}): Promise<WebSpeechFallbackResult> {
  return new Promise((resolve, reject) => {
    const recognition = options.createRecognition?.() ?? createDefaultRecognition();
    if (!recognition) {
      reject(new Error("web_speech_api_unavailable"));
      return;
    }

    let settled = false;
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      settled = true;
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      resolve({ text: transcript });
    };
    recognition.onerror = (event) => {
      settled = true;
      reject(new Error(`web_speech_error: ${event.error}`));
    };
    recognition.onend = () => {
      if (!settled) reject(new Error("web_speech_no_result"));
    };

    recognition.start();
  });
}
