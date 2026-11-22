import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS, type DocNode, type Look, type Post, type PostStatus, type PostSummary, type Settings } from "@/lib/types";
import type { Store } from "./index";

type Row = Record<string, unknown>;

const iso = (v: unknown): string => (v instanceof Date ? v : new Date(v as string)).toISOString();
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));

function parseLook(v: unknown): Look | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return (JSON.parse(v) as Look | null) ?? null;
    } catch {
      return null;
    }
  }
  return v as Look;
}

function toSummary(r: Row): PostSummary {
  return {
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    excerpt: r.excerpt as string,
    status: r.status as PostStatus,
    publishAt: isoOrNull(r.publish_at),
    look: parseLook(r.look),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toPost(r: Row): Post {
  const content = typeof r.content === "string" ? (JSON.parse(r.content) as DocNode) : (r.content as DocNode);
  return { ...toSummary(r), content };
}

const SUMMARY_COLS = "id, slug, title, excerpt, status, publish_at, look, created_at, updated_at";

export function createPostgresStore(url: string): Store {
  const sql = neon(url);
  let ready: Promise<void> | null = null;

  function init(): Promise<void> {
    if (!ready) {
      ready = (async () => {
        await sql.query(`create table if not exists posts (
          id text primary key,
          slug text not null default '',
          title text not null default '',
          excerpt text not null default '',
          content jsonb not null,
          status text not null default 'draft',
          publish_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )`);
        await sql.query(`alter table posts add column if not exists look jsonb`);
        await sql.query(`create unique index if not exists posts_slug_key on posts (slug) where slug <> ''`);
        await sql.query(`create table if not exists settings (
          key text primary key,
          value jsonb not null
        )`);
      })().catch((e) => {
        ready = null; // retry on next call
        throw e;
      });
    }
    return ready;
  }

  async function q(text: string, params: unknown[] = []): Promise<Row[]> {
    await init();
    return (await sql.query(text, params)) as Row[];
  }

  return {
    async listPosts() {
      const rows = await q(`select ${SUMMARY_COLS} from posts order by updated_at desc`);
      return rows.map(toSummary);
    },

    async getPost(id) {
      const rows = await q(`select * from posts where id = $1`, [id]);
      return rows[0] ? toPost(rows[0]) : null;
    },

    async createPost() {
      const rows = await q(
        `insert into posts (id, content) values ($1, $2::jsonb) returning *`,
        [randomUUID(), JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] })],
      );
      return toPost(rows[0]);
    },

    async updatePost(id, patch) {
      const cols: Record<string, string> = {
        title: "title",
        slug: "slug",
        excerpt: "excerpt",
        content: "content",
        status: "status",
        publishAt: "publish_at",
        look: "look",
      };
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [key, col] of Object.entries(cols)) {
        const v = (patch as Record<string, unknown>)[key];
        if (v === undefined) continue;
        params.push(key === "content" || key === "look" ? (v === null ? null : JSON.stringify(v)) : v);
        sets.push(`${col} = $${params.length}${key === "content" || key === "look" ? "::jsonb" : key === "publishAt" ? "::timestamptz" : ""}`);
      }
      sets.push("updated_at = now()");
      params.push(id);
      const rows = await q(`update posts set ${sets.join(", ")} where id = $${params.length} returning *`, params);
      return rows[0] ? toPost(rows[0]) : null;
    },

    async deletePost(id) {
      await q(`delete from posts where id = $1`, [id]);
    },

    async slugTaken(slug, exceptId) {
      if (!slug) return false;
      const rows = await q(`select 1 from posts where slug = $1 and id <> $2 limit 1`, [slug, exceptId]);
      return rows.length > 0;
    },

    async listPublic(now = new Date()) {
      const rows = await q(
        `select ${SUMMARY_COLS} from posts
         where status in ('published','scheduled') and publish_at <= $1::timestamptz
         order by publish_at desc`,
        [now.toISOString()],
      );
      return rows.map(toSummary);
    },

    async getPublicBySlug(slug, now = new Date()) {
      if (!slug) return null;
      const rows = await q(
        `select * from posts
         where slug = $1 and status in ('published','scheduled') and publish_at <= $2::timestamptz
         limit 1`,
        [slug, now.toISOString()],
      );
      return rows[0] ? toPost(rows[0]) : null;
    },

    async getSettings() {
      const rows = await q(`select value from settings where key = 'site'`);
      const stored = (rows[0]?.value ?? {}) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...stored, defaultLook: stored.defaultLook === undefined ? DEFAULT_SETTINGS.defaultLook : stored.defaultLook, savedLooks: Array.isArray(stored.savedLooks) ? stored.savedLooks : [] };
    },

    async updateSettings(patch) {
      const current = await this.getSettings();
      const next = { ...current, ...patch };
      await q(
        `insert into settings (key, value) values ('site', $1::jsonb)
         on conflict (key) do update set value = excluded.value`,
        [JSON.stringify(next)],
      );
      return next;
    },
  };
}
