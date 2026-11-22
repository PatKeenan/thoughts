# Blog

A personal blog with a phone-first writing app you add to your Home Screen.

- **Site** — `/` and `/posts/<slug>`, RSS at `/feed.xml`.
- **Write** — `/write` (password). Type `/` in a post for tools:
  - `/code` — generate or paste a snippet, refine it by chat in a full-screen studio, then **Add inline**. Reopen any block later to edit or regenerate.
  - `/image` — describe an illustration, refine it by chat, pick an aspect ratio, add alt text.
  - `/motion` — **Animation**: the AI writes a Remotion composition, previewed live in a sandboxed frame, rendered on Add inline as a **Loop** (silent autoplaying MP4), **GIF** or **Video**. **Video clip**: a short clip from an AI video model.
  - `/github` — search your repos, browse files, pick lines as a snippet, attach files as context for the AI, or insert a repo card.
  - `/fact` or select text and tap **Check** — a verdict with sources; replace the claim with corrected wording or link a source.
- **Buddy** — line-edits (Polish) and structural notes (Structure) that follow your voice: it learns from your published posts and the voice notes in Settings. You accept or skip each change.
- **Publish** — now or scheduled. Scheduled posts go live on their own at the set time (within a minute).

## Deploy (Vercel)

1. Import this repo in Vercel.
2. Storage → add **Neon** Postgres (sets `DATABASE_URL`). Tables are created on first use.
3. Storage → add **Blob** (sets `BLOB_READ_WRITE_TOKEN`). Images, clips and rendered animations are stored there. Redeploy after adding it: the build then saves a render sandbox snapshot so animation renders start fast. Leave Vercel Sandbox / OIDC on (default).
4. Add env vars from `.env.example`: `ADMIN_PASSWORD`, `SESSION_SECRET`, `OPENROUTER_API_KEY`, optionally `GITHUB_TOKEN`.
5. Deploy. Open `https://<your-site>/write` on your phone → Share → **Add to Home Screen**.
6. In the app: Settings → site title, your name, voice notes.

## Local

```bash
cp .env.example .env.local   # set ADMIN_PASSWORD and SESSION_SECRET; AI_MOCK=1 works without keys
npm install && npm run dev
```

Without `DATABASE_URL`, posts are kept in `.data/db.json` (local only).

## Models

All AI goes through OpenRouter, one model per job, set in `lib/models.ts` and overridable with `MODEL_<JOB>` env vars.

| Job | Default |
|---|---|
| code snippets | `anthropic/claude-sonnet-5.5` |
| writing buddy | `anthropic/claude-opus-5.5` |
| titles, excerpts, slugs, image prompts | `deepseek/deepseek-v4.1-flash` |
| images | `google/gemini-3.1-flash-image` |
| animations (Remotion code) | `anthropic/claude-sonnet-5.5` |
| video clips | `google/veo-3.1-fast` |
| fact-check (web search) | `anthropic/claude-sonnet-5.5:online` |

## Animations

AI-written animation code only ever runs in a sandboxed iframe with no network access (preview) or in the render sandbox. Rendering uses Remotion: locally with your Chrome (`CHROME_PATH`, default `/usr/bin/google-chrome`), on Vercel in a Vercel Sandbox. Remotion is free for individuals; companies of more than three people need a licence (remotion.dev/license).
