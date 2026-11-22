# Phase 2 contracts: /image, /motion, fact-check

Read `AGENTS.md` and `CONTRACTS.md` first — every rule at the top of CONTRACTS.md still applies (house style, CSS modules + tokens, only touch your own files, `npx tsc --noEmit` + `npx eslint <your files>`, **no `next dev`/`next build`**, no commits, no installs). Shared and frozen: `lib/types.ts` (phase-2 types are at the bottom), `lib/models.ts`, `package.json`. Phase 1 is finished and working; read the files you integrate with before changing anything.

Installed for this phase: `remotion`, `@remotion/player`, `@remotion/vercel`, `@remotion/bundler` (dev), `@remotion/renderer` (dev) — all exactly 4.0.545; `@vercel/blob`, `@vercel/functions`, `@vercel/sandbox`, `sucrase`, `esbuild` (dev), `tsx` (dev). Remotion's official Next+Vercel template is cloned at `/tmp/template-vercel` for reference. `ffmpeg` and `/usr/bin/google-chrome` exist on this machine.

New env: `BLOB_READ_WRITE_TOKEN` (Vercel Blob; absent → local files under `$DATA_DIR/media`, dev only).

## Media storage — `lib/media.ts` (Stream S1)
```ts
export async function putMedia(bytes: Uint8Array | ArrayBuffer | Buffer, contentType: string): Promise<{ url: string }>
```
Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set (`put("media/<uuid>.<ext>", …, { access: "public" })`); otherwise writes `$DATA_DIR/media/<uuid>.<ext>` and returns `/media/<uuid>.<ext>`, served by `app/media/[name]/route.ts` (GET, public, immutable cache headers, strict filename validation, correct content type incl. `video/mp4` with Range support so iOS Safari will play it). On Vercel without the token: throw an Error with a clear message naming the env var.

## AI backends (Stream S1)
All start with `requireAuth()`. All honour `AI_MOCK=1` with no network.
- `POST /api/ai/studio` — extend the existing route: `kind: "motion"` uses job `motion` and the motion system prompt; `current` is then `{ code: string }`. Same streamed-text + single-fenced-block protocol (fence language `tsx`), so the client reuses the code pipeline. Mock mode must return a small VALID composition per the motion code contract below.
- `POST /api/ai/image` body `{ messages: ChatMessage[], current?: ImageData, aspect: Aspect, post?: {title, text} }` → `{ image: ImageData, note: string }`. Two steps: (1) job `fast`/`writing` turns the conversation (+ current prompt, + article context) into ONE complete image prompt plus alt text and a one-sentence note about what changed — editorial blog illustration defaults, no text in the image unless asked; (2) OpenRouter image generation, job `image`, then `putMedia`. Verify the current OpenRouter image API from its docs (WebFetch `https://openrouter.ai/docs/llms.txt` and follow to the image generation pages): endpoint, aspect-ratio parameter, response shape, and whether a reference image can be passed for edits — if it can, pass `current.url` when refining.
- `POST /api/ai/video` body `{ prompt: string, aspect: Aspect, seconds: number }` → streamed NDJSON of `JobEvent` (`application/x-ndjson`): submit to OpenRouter's async video API (job `video`; verify endpoint/params/polling from the docs — `POST /api/v1/videos`, poll, download), emit progress while polling, download the result, `putMedia`, emit `done`. Keep the connection alive with progress events; `maxDuration = 300`.
- `POST /api/ai/factcheck` body `{ claim: string, context: string, title: string }` → `FactCheckResult`. Job `factcheck` (web search via the `:online` suffix / `plugins:[{id:"web"}]`). Sources come from `message.annotations[]` (`type:"url_citation"`, `url_citation:{url,title}`) — dedupe, max 6, http(s) only; never invent sources: if there are no citations, verdict must be "unclear" and the summary says no sources were found. Prompt: check only the claim as written, prefer primary sources, say what is wrong precisely, `correction` keeps the author's wording and changes only what is needed. JSON out, parsed defensively.

## Motion code contract (the AI writes this; S1's prompt enforces it, S2 executes it)
One TSX module. Imports ONLY from `"react"` and `"remotion"`. Inline styles only; no external assets, fonts, network, `window`, timers or randomness (`random()` from remotion is fine). System font stacks.
```tsx
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
export const config = { durationInFrames: 150, fps: 30, width: 1280, height: 720 };
export default function Motion() { /* … */ }
```
Limits enforced by S2: fps 15–60, duration ≤ 20 s, width/height 240–1920 and even numbers.

## Remotion pipeline (Stream S2)
- `remotion/evaluate.ts`: `evaluateMotion(code: string): { Component: React.ComponentType; config: MotionConfig }` — sucrase (`typescript`, `jsx`, `imports`) → CommonJS, run with a `require` shim exposing only `react` and `remotion`; validates/clamps config; throws Errors with readable messages. Shared by preview and render.
- Preview: a standalone page built with esbuild by `scripts/build-motion-frame.mjs` → `public/motion-frame.html` + `public/motion-frame.js` (generated; git-ignored; wired into `predev`/`prebuild` npm scripts). It mounts `@remotion/player` (loop, autoplay, controls) and talks to the parent by `postMessage`: parent → `{type:"code", code}`; frame → `{type:"ready"}`, `{type:"ok", config}`, `{type:"error", message}` (compile and runtime errors, via an error boundary). 
- `components/motion/MotionPreview.tsx` (client): `export default function MotionPreview({ code, onStatus }: { code: string; onStatus?(s: { ok: true; config: MotionConfig } | { ok: false; message: string }): void })` — renders the frame in `<iframe sandbox="allow-scripts">` (opaque origin: generated code can never touch the session), aspect-ratio box from the config, debounces code updates while streaming.
- Render: `POST /api/render` body `{ code: string, output: MotionOutput }` → NDJSON `JobEvent` stream. `output: "gif"` → GIF (≤ 720px wide, 15 fps via `everyNthFrame`, `numberOfGifLoops` infinite); `"loop"`/`"video"` → H.264 MP4 (yuv420p, muted). Result stored through `putMedia` locally or straight to Blob on Vercel. Two backends in `lib/render.ts`: local (`@remotion/bundler` + `@remotion/renderer`, `browserExecutable` from `CHROME_PATH` or `/usr/bin/google-chrome`, dynamically imported and kept out of the Vercel bundle) and Vercel (`@remotion/vercel` sandbox, following `/tmp/template-vercel`; build-time snapshot step that SKIPS gracefully when `BLOB_READ_WRITE_TOKEN` is missing so a first deploy never fails, falling back to creating the sandbox on demand).
- Remotion entry: `remotion/index.ts` + `remotion/Root.tsx` with one composition `Dynamic` whose `calculateMetadata` evaluates `inputProps.code`.

## Public renderers + fact-check UI (Stream S3)
- `components/render/ImageFigure.tsx` (`{ data: ImageData }`) and `MotionFigure.tsx` (`{ data: MotionData }`), wired into `Doc.tsx` for `genBlock` kinds `image` and `motion`. Motion: `output` "gif" → `<img>`; "loop" → `<video autoplay muted loop playsinline>` (no controls; respects prefers-reduced-motion by showing controls and not autoplaying — needs a tiny client component); "video" → `<video controls playsinline preload="metadata">`. Width/height attributes to avoid layout shift. Renders nothing when `url` is empty. Only http(s) or root-relative URLs.
- `components/factcheck/FactCheckSheet.tsx`: `export default function FactCheckSheet({ open, onClose, editor, title }: { open: boolean; onClose(): void; editor: Editor; title: string })`. On open it reads the editor's current selection (claim = selected text; context = text of the enclosing textblock), remembers the range, and calls `api.factcheck`. Shows: the claim quoted, a verdict label, the summary, sources as links (title + domain), and when `correction` exists a small diff with "Replace in post" (one transaction at the remembered range, re-validated against the current doc text; if it changed → "Text changed"). Each source has "Link it" which applies a link mark with that URL to the claim range. "Check again" re-runs. Empty selection → "Select a sentence in your post, then tap Check."
- `lib/client/api.ts`: add `factcheck(body: {claim: string; context: string; title: string}): Promise<FactCheckResult>`.

## Studio + editor integration (Stream S4)
Owns every existing file under `components/editor/**`, `components/studio/**`, `lib/client/studio.ts` plus new files there. See the stream brief.
