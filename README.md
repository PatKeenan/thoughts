# Blog

A personal blog with a phone-first writing app you add to your Home Screen.

- **Site** — `/` and `/posts/<slug>`, RSS at `/feed.xml`.
- **Write** — `/write` (password). Type `/` in a post for tools:
  - `/code` — generate or paste a snippet, refine it by chat in a full-screen studio, then **Add inline**. Reopen any block later to edit or regenerate.
  - `/github` — search your repos, browse files, pick lines as a snippet, attach files as context for the AI, or insert a repo card.
- **Buddy** — line-edits (Polish) and structural notes (Structure) that follow your voice: it learns from your published posts and the voice notes in Settings. You accept or skip each change.
- **Publish** — now or scheduled. Scheduled posts go live on their own at the set time (within a minute).

## Deploy (Vercel)

1. Import this repo in Vercel.
2. Storage → add **Neon** Postgres (sets `DATABASE_URL`). Tables are created on first use.
3. Add env vars from `.env.example`: `ADMIN_PASSWORD`, `SESSION_SECRET`, `OPENROUTER_API_KEY`, optionally `GITHUB_TOKEN`.
4. Deploy. Open `https://<your-site>/write` on your phone → Share → **Add to Home Screen**.
5. In the app: Settings → site title, your name, voice notes.

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
| titles, excerpts, slugs | `deepseek/deepseek-v4.1-flash` |

Reserved for the next phase: fact-check (`:online` web search), image, motion.
