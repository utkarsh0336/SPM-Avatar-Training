# AI Avatar Tutor — Implementation Brief

You are helping me build the conversational AI layer for an enterprise training platform called **AI Nancy**. The frontend UI is already designed and partially built. Your job is the AI pipeline behind it.

Read this whole brief before writing any code. Ask me the questions in the final section first.

---

## 1. What already exists

- A login screen.
- A 6-step **Avatar Builder** wizard: style (Realistic / Animated / 3D Stylized) → gender → skin tone + hair style + hair color → outfit → name + area of expertise → voice tone (Deep / Neutral / Warm) + summary.
- A **live session screen**: avatar video centre, user's webcam top-right, live transcript panel right, session controls at the bottom (mute, camera, language, hide panel, fullscreen, end session), and a subtitle bar over the video.
- A left nav with New Chat, Voice AI, Saved Conversations, Dashboard.

I will attach screenshots. Match the existing components and styling — do not redesign the UI.

## 2. The hard constraint

**This must run at $0/month during development and demo.** Not "cheap." Zero.

Treat any code path that spends money as opt-in behind an explicit environment flag that defaults to off. If you are ever unsure whether something costs money, stop and ask me rather than writing the integration.

## 3. Approved stack

Use these. Do not substitute without asking.

| Layer | Choice | Free limit to respect |
|---|---|---|
| LLM (primary) | Google Gemini Flash via AI Studio | ~1,500 req/day, ~10–15 req/min |
| LLM (fallback) | Groq | 30 req/min, no credit card |
| Speech-to-text | Groq Whisper | 2,000 audio requests/day |
| STT (fallback) | Browser Web Speech API | Free, no quota, quality varies |
| Text-to-speech | Piper, self-hosted | Free, CPU-only, no quota |
| TTS (fallback) | edge-tts | Free, no key |
| Avatar video | **Mock provider** (see §5) | Free |
| Transport | Plain WebSocket for now | Free |

**Forbidden without my explicit approval:** OpenAI, Anthropic, ElevenLabs, D-ID, Akool, Anam, or any paid API. Tavus and HeyGen are allowed *only* as a disabled provider implementation — write the adapter, never call it by default.

## 4. Architecture requirement: everything is a swappable provider

This is the most important instruction in this brief.

Free tiers get rate-limited, deprecate models, and change terms monthly. And the avatar renderer will eventually change from mock → hosted → self-hosted. So:

Define four interfaces and code the app against **only** the interfaces:

```
LLMProvider     → chat(messages, opts) → AsyncIterator<token>
STTProvider     → transcribe(audioStream) → AsyncIterator<partial|final>
TTSProvider     → synthesize(textStream) → AsyncIterator<audioChunk>
AvatarProvider  → start(config) / speak(audioStream) / interrupt() / stop() / videoTrack
```

Requirements:
- Providers are selected by env var, e.g. `LLM_PROVIDER=gemini`, `AVATAR_PROVIDER=mock`.
- The LLM and STT layers need **automatic failover**: on HTTP 429 or 5xx, fall through to the next configured provider and log which one served the request. This is not optional — free tiers will 429 during a live demo otherwise.
- No provider SDK types may leak above the interface boundary.

## 5. The avatar renderer — build it in this order

**Phase 1 (now): `MockAvatarProvider`.** A looping idle video clip of a person, plus a subtitle bar driven by the TTS text, plus a simple audio-amplitude indicator. No lip-sync. This is deliberate — it lets me test the entire conversation loop for free, and 80% of the product experience is the conversation, not the mouth.

Idle clips live at `public/avatars/idle/{replicaId}.mp4` and are referenced from `replicas.json`. I am still sourcing the footage — stub against those paths and use a placeholder clip if a file is missing, rather than blocking on the assets.

**Phase 2 (later, behind a flag): `TavusAvatarProvider`.** Write the adapter, wire it to `AVATAR_PROVIDER=tavus`, but leave it off. I have 25 free conversational minutes total and I don't want them burned by a test run.

**Phase 3 (later): `SelfHostedAvatarProvider`.** Targets a local MuseTalk or Wav2Lip service over HTTP. Just stub the adapter for now.

Do not implement Phase 2 or 3 until I say so. Phase 1 first, working end to end.

## 6. Avatar Builder → renderer mapping

Important constraint you need to design around: the builder produces thousands of combinations, but real avatar renderers work from a small set of **pre-trained faces**, not from parameters. You cannot generate an arbitrary face at conversation latency.

So:
- Maintain a `replicas.json` registry of a handful of faces, each tagged with `{style, gender, outfit}`.
- The builder's style/gender/outfit picks resolve to the **nearest** registry entry.
- Skin tone, hair style, and hair color are **presentation state only** — they drive the preview card and the summary screen, not the renderer.
- Expertise and voice tone feed the **system prompt** and the TTS voice selection respectively.

Make the resolver a pure, unit-tested function. If no entry matches, fall back to a default and log it — never crash the wizard.

## 7. Conversation behaviour

- **Streaming throughout.** Start TTS on the first sentence boundary from the LLM, not after the full response. Target under 1.2 seconds from end-of-user-speech to first avatar audio.
- **Barge-in.** If the user starts speaking while the avatar is talking, cancel the in-flight TTS and LLM stream immediately and start listening. This is what makes it feel real; treat it as a core feature, not polish.
- **Voice activity detection** so the mic isn't push-to-talk.
- **The tutor has a lesson plan.** The system prompt should make the avatar teach the selected expertise area in structured segments, check understanding, and be able to quiz at the end — not just answer questions reactively.
- Transcript entries stream into the right-hand panel as they finalise.

## 8. Secrets and config

- All keys in `.env`, never committed. Ship a `.env.example`.
- **No API key may ever reach the browser.** All provider calls go through my backend; the frontend talks only to my own endpoints.
- Log every provider call with latency and which provider served it, so I can see where the time goes.

## 9. Deliverables for this first pass

1. `.env.example` with every variable documented.
2. The four provider interfaces plus one working implementation each (Gemini, Groq Whisper, Piper, Mock avatar) and the failover wrapper.
3. The replica resolver with tests.
4. A single working vertical slice: press a button, speak, the mock avatar responds with streamed audio, subtitles, and a transcript entry — with barge-in working.
5. A short `README` section on how to run it locally.

Do not build the dashboard, saved conversations, notifications, or settings yet.

## 10. Definition of done

This pass is not finished until every box below can be demonstrated on my machine from a fresh clone. Do not tell me it's complete before you have actually run these — if something can't be verified, say so explicitly rather than assuming it passes.

### Conversation loop

- [ ] I click start, speak, stop speaking, and the avatar replies — without pressing any other button. VAD ends the turn on its own.
- [ ] My words appear in the transcript panel, and the avatar's reply streams in as a separate entry.
- [ ] Subtitles appear over the video in sync with the audio, not before or after it.
- [ ] I can interrupt the avatar mid-sentence. Audio stops within ~300ms, the in-flight LLM request is cancelled, and my new utterance is picked up.
- [ ] A 10-minute continuous session runs without the audio desyncing, the socket dropping, or memory climbing steadily.

### Latency

- [ ] Every hop — STT, LLM first token, TTS first chunk — is logged with its own timing.
- [ ] Median time from end-of-speech to first avatar audio is under 1.2 seconds, measured over at least 20 turns.
- [ ] 95th percentile is under 2 seconds. If it isn't, tell me which hop is responsible rather than optimising blind.

### Avatar builder

- [ ] All 6 steps complete and the summary screen reflects every choice I made.
- [ ] The resolver maps style/gender/outfit to a real entry in `replicas.json`, and the session opens with that face.
- [ ] Voice tone changes the actual TTS voice. Expertise changes the system prompt. I can hear and see the difference between two different builds.
- [ ] Passing a combination with no matching replica falls back to the default and logs a warning — it does not throw.
- [ ] Resolver unit tests cover exact match, nearest match, and no match.

### Failover — test this by forcing it, not by hoping

- [ ] With a deliberately invalid Gemini key, the request is served by Groq and the conversation continues. I should not be able to tell from the UI.
- [ ] A simulated 429 produces the same result.
- [ ] With every provider failing, the user sees a clear spoken or on-screen message — not a spinner that hangs or a stack trace.
- [ ] The log line for each turn names which provider actually served it.

### The $0 constraint

- [ ] With default env settings, a full session makes zero calls to any paid endpoint. Verify from the request log, not from reading the code.
- [ ] The Tavus adapter compiles and is wired up, but sends no traffic unless `AVATAR_PROVIDER=tavus` is set by hand.
- [ ] A 5-minute test session consumes no more than ~40 Whisper requests — one per utterance, not one per audio chunk. Report the actual count.

### Code structure

- [ ] Switching `LLM_PROVIDER` from `gemini` to `groq` works with an env change and a restart. No code edits.
- [ ] No provider SDK is imported anywhere outside its own adapter file. Add a lint rule or test that fails if this is violated.
- [ ] Grep the production frontend bundle for each API key value — zero hits.

### Handover

- [ ] `.env.example` lists every variable with a comment on where to get it and what the free limit is.
- [ ] I can clone, follow the README, and reach a working conversation without asking you anything.
- [ ] Anything you stubbed, faked, or skipped is listed explicitly at the end of your final message.

## 11. Ask me these before you start

1. What's the existing stack — framework, language, backend, and is there a repo structure you should follow?
2. Should the backend be a new service or extend something that exists?
3. Do I have a GPU available, or is everything CPU-only for now?
4. Roughly how many concurrent sessions should the design assume?

Answer nothing about cost or vendor choice on your own. If a requirement here conflicts with something you find in the codebase, raise it rather than silently picking.