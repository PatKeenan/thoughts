@AGENTS.md

# Thoughts — personal blog + phone-first writing app

A public blog and a private, installable (PWA) editor in one Next.js app, deployed on Vercel. The author writes on a phone; AI tools live inside the editor behind slash commands. `README.md` has the feature list and deploy steps.

## Commands

```bash
npm run dev      # builds the motion preview frame first (predev), then next dev
npm run build    # same prebuild, then next build
npm run lint     # eslint
npx tsc --noEmit # type-check
python3 scripts/make-icons.py   # regenerate app icons (needs Pillow)
```

Local run: `neon deploy` writes `DATABASE_URL`/`NEON_AUTH_BASE_URL` to `.env`; add `NEON_AUTH_COOKIE_SECRET`, `ADMIN_EMAIL`, `LOGIN_SLUG` and `AI_MOCK=1`. Sign-in needs Neon Auth even locally. With no `DATABASE_URL`, data lives in `.data/db.json`; with no `BLOB_READ_WRITE_TOKEN`, media lives in `.data/media` and is served from `/media/<file>`.

There is no test suite in the repo. The app was verified with throwaway Playwright runs at a phone viewport against `next start` with `AI_MOCK=1`. Verify UI changes the same way (iPhone-sized viewport first) rather than by reading code.

## Layout

- `app/(site)/**` — public blog: `/`, `/posts/[slug]`; `app/feed.xml` — RSS. Both pages are `force-dynamic` so scheduled posts go live on time and builds need no database.
- `app/write/**` — the editor app (auth-guarded in `app/write/layout.tsx`): drafts list, `/write/[id]` editor, settings; `/write/resume` sends a 401'd editor back to sign-in.
- `app/[gate]` — the sign-in page, served only at `/<LOGIN_SLUG>`; any other unclaimed single-segment path 404s through it.
- `app/api/**` — every handler except `auth/[...path]` starts with `requireAuth()` from `lib/auth.ts`.
  - `posts`, `settings`, `auth/[...path]` (proxy to Neon Auth: GETs, sign-out, and sign-in only from the sign-in page; everything else 404s)
  - `ai/studio` (streamed text; code and motion), `ai/image`, `ai/video` (NDJSON job stream), `ai/buddy`, `ai/meta`, `ai/factcheck`, `ai/look`, `ai/restyle`
  - `github/{repos,tree,file}`, `render` (Remotion → MP4/GIF, NDJSON job stream)
- `components/editor/**` — Tiptap v3 editor, slash menu, keyboard toolbar, the `genBlock` node and its views, look state (`useLookState.ts`, `LookContext.tsx`).
- `components/studio/**` — the full-screen "studio" where a generated block is refined by chat; `lib/client/studio.ts` holds its reducer, stream readers and the restyle logic.
- `components/render/**` — server components that turn stored Tiptap JSON into the public post (`Doc.tsx`, no Tiptap dependency).
- `components/{buddy,factcheck,publish,look,ui}` — sheets opened from the editor.
- `remotion/**`, `motion-frame/**`, `components/motion/**`, `lib/render.ts` — animation pipeline (below).
- `lib/` — `types.ts` (all shared shapes), `look.ts` (look helpers), `models.ts` (model per job), `prompts.ts` (every system prompt), `openrouter.ts`, `store/` (Postgres + file implementations of one `Store` interface), `media.ts`, `github.ts`, `highlight.ts`.

## Core concepts

**Auth** is Neon Auth (Managed Better Auth, `@neon/auth`): `lib/auth.ts` server side, `lib/client/auth.ts` in the browser. A session is not enough: the email must be in `ADMIN_EMAIL` (comma-separated); unset means nobody gets in. No `proxy.ts`: `/write` is guarded in its layout, API routes by `requireAuth()`. The sign-in path is a secret (`LOGIN_SLUG`) and must never reach client code or redirects for strangers: signed-out `/write` 404s unless the browser carries the signed `author_device` cookie set on a successful sign-in. Sign-up is disabled on the Neon branch and blocked in the proxy; there is one account.

**Database** is Neon Postgres via `pg` + `attachDatabasePool` (`lib/store/postgres.ts`, pooled `DATABASE_URL`). `neon.ts` declares the Neon services; `neon deploy` applies it.

**Posts** are Tiptap JSON (`Post.content`). Public visibility: `status` is `published` or `scheduled` AND `publishAt <= now` — no cron.

**Generated blocks** are one Tiptap node, `genBlock` (block atom), with attrs `{ id, kind, data, history }`. `kind` is `code | repo | image | motion`; `data` is `CodeData | RepoData | ImageData | MotionData`; `history` is the studio chat that made it (user turns verbatim, assistant turns are the short note only — never the code), kept so a block can be reopened, edited and regenerated. `history` and image prompts must never reach public markup.

**Studio protocol.** `/api/ai/studio` streams plain text: a sentence or two plus exactly one fenced block holding the complete current artifact. `lib/studio/parse.ts#extractArtifact` parses it on both sides. The live artifact is always sent separately as `current`.

**The look.** Each post has an optional `Look` (palette, type feel, illustration style, motion pace, code theme, optional reference image). Effective look = `post.look ?? settings.defaultLook`; a built-in house look is the default for new installs. Image/animation/clip generation receives the look; blocks carry a `LookStamp` (`data.look`) and are "off-look" when it no longer matches (`isOffLook`). Restyling is always user-initiated. Code blocks follow `look.codeTheme` at render time and are never off-look. Use the helpers in `lib/look.ts`; do not re-implement them.

**Animations.** The AI writes one TSX module (imports only `react` and `remotion`, `export const config`, default export taking `{ theme }`; all colours and fonts come from `theme`, no hex literals). `remotion/check.ts` validates it statically; `remotion/evaluate.ts` runs it. Preview happens in `public/motion-frame.{html,js}` (generated by `scripts/build-motion-frame.mjs`, git-ignored) inside `<iframe sandbox="allow-scripts">` with a no-network CSP — generated code must never run in the app's own origin. Rendering: locally via `@remotion/renderer` and system Chrome (`CHROME_PATH`); on Vercel via `@remotion/vercel` in a Vercel Sandbox, uploading to Blob (`vercel.json` build command bundles Remotion and saves a sandbox snapshot).

**Models.** Everything goes through OpenRouter; `lib/models.ts` maps a job to a model, overridable with `MODEL_<JOB>` env vars. Model slugs and OpenRouter endpoints change often: check the current docs before editing them, do not rely on memory.

## Conventions

- Styling is CSS Modules beside each component, driven by tokens in `app/globals.css`. Never hard-code colours or fonts; the only exceptions are places that deliberately draw a look's own colours (look specimen, swatches).
- Design: light only (no dark mode, by the author's choice). Cool off-white page, teal-950 text, teal for links and primary actions (`--accent`), pink for marks, selection and pull rules (`--accent-2`). Hairline rules; no shadows, cards, gradients or emoji. Type is Schibsted Grotesk (headings, controls) and Figtree (reading); heading weight/tracking/scale are the `--display-*` tokens. Code blocks default to the Dracula theme.
- Phone first: design at 390×844, must work at 360 wide. Inputs ≥ 16px font-size (iOS zoom), touch targets ≥ `var(--tap)`, use `100dvh` and `visualViewport`, respect safe areas.
- Toolbar and other controls that must not blur the editor use `onPointerDown` + `preventDefault`.
- `AI_MOCK=1` must keep every AI route fully offline and deterministic; add a mock path to any new AI route.
- Route handlers validate bodies by hand (no schema library); errors are `{ error: string }` with a real status.
- No new dependencies without a reason; Remotion packages must all stay on the exact same version, and `@vercel/sandbox` is pinned to 1.6.0 for `@remotion/vercel`.

## Not yet verified against live services

Built and browser-tested with mocks and real local Remotion renders only. Untested as of the last commit: live OpenRouter calls (chat, images, video, web-search fact-check, look extraction), Vercel Blob, Vercel Sandbox rendering, and behaviour on a real iPhone keyboard. Expect to debug these on first deploy.

## History

`docs/build-notes/` holds the briefs used while building (contracts between parallel work streams). They describe intent and API shapes well, but their process rules (for example "do not run next dev") and their early palette no longer apply.
