"use client";

import { useEffect, useState } from "react";
import type { CodeData, FileResult, RepoData, RepoInfo, TreeEntry } from "@/lib/types";
import {
  contextFromFile,
  getFile,
  getTree,
  inRange,
  nextRange,
  rangeBounds,
  repoDataFrom,
  searchRepos,
  snippetFromFile,
  splitLines,
  type ContextFile,
  type LineRange,
} from "@/lib/client/studio";
import { formatStars } from "@/components/editor/RepoView";
import styles from "./GithubPicker.module.css";

type Step =
  | { step: "search" }
  | { step: "repo"; repo: RepoInfo; path: string; ref: string }
  | { step: "file"; repo: RepoInfo; path: string; ref: string };

type Loadable<T> = { key: string; data?: T; error?: string } | null;

export interface GithubPickerProps {
  /** Offer "Insert repo card" (the /github command, not "Attach from GitHub"). */
  allowRepoCard: boolean;
  onRepoCard(data: RepoData): void;
  onUseSnippet(data: CodeData): void;
  onAttach(file: ContextFile): void;
  /** Return to the chat; omitted when there is nothing to return to. */
  onBack?: () => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export default function GithubPicker(props: GithubPickerProps) {
  const [nav, setNav] = useState<Step>({ step: "search" });
  const [query, setQuery] = useState("");

  return (
    <div className={styles.picker}>
      {nav.step === "search" && (
        <RepoSearch
          query={query}
          onQuery={setQuery}
          onPick={(repo) => setNav({ step: "repo", repo, path: "", ref: repo.defaultBranch })}
          onBack={props.onBack}
        />
      )}
      {nav.step === "repo" && (
        <RepoBrowser
          repo={nav.repo}
          path={nav.path}
          refName={nav.ref}
          allowRepoCard={props.allowRepoCard}
          onRepoCard={() => props.onRepoCard(repoDataFrom(nav.repo))}
          onNavigate={(path, ref) => setNav({ step: "repo", repo: nav.repo, path, ref })}
          onOpenFile={(path, ref) => setNav({ step: "file", repo: nav.repo, path, ref })}
          onBack={() => setNav({ step: "search" })}
        />
      )}
      {nav.step === "file" && (
        <FileView
          repo={nav.repo}
          path={nav.path}
          refName={nav.ref}
          onNavigate={(path) => setNav({ step: "repo", repo: nav.repo, path, ref: nav.ref })}
          onBackToRepos={() => setNav({ step: "search" })}
          onUseSnippet={props.onUseSnippet}
          onAttach={props.onAttach}
        />
      )}
    </div>
  );
}

// ---- 1. repo search -----------------------------------------------------------

function RepoSearch({
  query,
  onQuery,
  onPick,
  onBack,
}: {
  query: string;
  onQuery(q: string): void;
  onPick(r: RepoInfo): void;
  onBack?: () => void;
}) {
  const [result, setResult] = useState<Loadable<{ repos: RepoInfo[]; authed: boolean }>>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${query.trim()}#${attempt}`;

  useEffect(() => {
    const ctrl = new AbortController();
    const q = query.trim();
    const k = `${q}#${attempt}`;
    const t = setTimeout(
      () => {
        searchRepos(q, ctrl.signal)
          .then((data) => setResult({ key: k, data }))
          .catch((e) => {
            if (!ctrl.signal.aborted) setResult({ key: k, error: message(e) });
          });
      },
      q ? 300 : 0,
    );
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, attempt]);

  const loading = !result || result.key !== key;
  const shown = result?.data;

  return (
    <>
      <div className={styles.head}>
        {onBack && (
          <button type="button" className={styles.link} onClick={onBack}>
            Back
          </button>
        )}
        <span className={styles.crumbs}>Repositories</span>
      </div>
      <div className={styles.searchRow}>
        <input
          className={styles.search}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Search GitHub, or owner/repo"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          aria-label="Search repositories"
        />
      </div>
      <div className={styles.scroll}>
        {shown && !shown.authed && (
          <p className={styles.hint}>Add GITHUB_TOKEN to list your private repos and raise rate limits.</p>
        )}
        {result?.error && result.key === key && (
          <div className={styles.error}>
            <span>{result.error}</span>
            <button type="button" className={styles.link} onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        )}
        {loading && <p className={styles.muted}>{query.trim() ? "Searching…" : "Loading…"}</p>}
        {!loading && shown && shown.repos.length === 0 && (
          <p className={styles.muted}>{query.trim() ? "No repositories found." : "Search for a repository."}</p>
        )}
        <ul className={`${styles.list} ${loading ? styles.stale : ""}`}>
          {shown?.repos.map((r) => (
            <li key={r.fullName}>
              <button type="button" className={styles.repo} onClick={() => onPick(r)}>
                <span className={styles.repoName}>
                  {r.fullName}
                  {r.private && <span className={styles.tag}>private</span>}
                </span>
                {r.description && <span className={styles.repoDesc}>{r.description}</span>}
                <span className={styles.repoMeta}>
                  {[r.language, `${formatStars(r.stars)} stars`].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ---- 2. repo browser ---------------------------------------------------------------

function Crumbs({
  repo,
  path,
  onRepos,
  onPath,
  linkLast = false,
}: {
  repo: RepoInfo;
  path: string;
  onRepos(): void;
  onPath(p: string): void;
  linkLast?: boolean;
}) {
  const parts = path ? path.split("/") : [];
  return (
    <nav className={styles.crumbs} aria-label="Path">
      <button type="button" className={styles.crumb} onClick={onRepos}>
        Repos
      </button>
      <span className={styles.sep}>/</span>
      <button type="button" className={styles.crumb} onClick={() => onPath("")}>
        {repo.fullName.split("/")[1]}
      </button>
      {parts.map((seg, i) => {
        const p = parts.slice(0, i + 1).join("/");
        const last = i === parts.length - 1;
        return (
          <span key={p} className={styles.crumbSeg}>
            <span className={styles.sep}>/</span>
            {last && !linkLast ? (
              <span className={styles.crumbHere}>{seg}</span>
            ) : (
              <button type="button" className={styles.crumb} onClick={() => onPath(p)}>
                {seg}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function RepoBrowser({
  repo,
  path,
  refName,
  allowRepoCard,
  onRepoCard,
  onNavigate,
  onOpenFile,
  onBack,
}: {
  repo: RepoInfo;
  path: string;
  refName: string;
  allowRepoCard: boolean;
  onRepoCard(): void;
  onNavigate(path: string, ref: string): void;
  onOpenFile(path: string, ref: string): void;
  onBack(): void;
}) {
  const [result, setResult] = useState<Loadable<{ entries: TreeEntry[]; ref: string }>>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${repo.fullName}:${refName}:${path}#${attempt}`;

  useEffect(() => {
    const ctrl = new AbortController();
    const k = `${repo.fullName}:${refName}:${path}#${attempt}`;
    getTree(repo.fullName, refName, path, ctrl.signal)
      .then((data) => setResult({ key: k, data }))
      .catch((e) => {
        if (!ctrl.signal.aborted) setResult({ key: k, error: message(e) });
      });
    return () => ctrl.abort();
  }, [repo.fullName, refName, path, attempt]);

  const current = result && result.key === key ? result : null;
  const ref = current?.data?.ref || refName;

  return (
    <>
      <div className={styles.head}>
        <Crumbs repo={repo} path={path} onRepos={onBack} onPath={(p) => onNavigate(p, ref)} />
      </div>
      <div className={styles.scroll}>
        {path === "" && (
          <div className={styles.repoHead}>
            <div className={styles.repoTitle}>{repo.fullName}</div>
            {repo.description && <p className={styles.repoDesc}>{repo.description}</p>}
            {allowRepoCard && (
              <button type="button" className={styles.primary} onClick={onRepoCard}>
                Insert repo card
              </button>
            )}
            <div className={styles.label}>Or pick a file</div>
          </div>
        )}
        {current?.error && (
          <div className={styles.error}>
            <span>{current.error}</span>
            <button type="button" className={styles.link} onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        )}
        {!current && <p className={styles.muted}>Loading&hellip;</p>}
        {current?.data && current.data.entries.length === 0 && <p className={styles.muted}>Empty folder.</p>}
        <ul className={styles.list}>
          {current?.data?.entries.map((e) => (
            <li key={e.path}>
              <button
                type="button"
                className={styles.entry}
                onClick={() => (e.type === "dir" ? onNavigate(e.path, ref) : onOpenFile(e.path, ref))}
              >
                <span className={e.type === "dir" ? styles.dir : styles.file}>
                  {e.name}
                  {e.type === "dir" ? "/" : ""}
                </span>
                {e.type === "file" && <span className={styles.size}>{formatSize(e.size)}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---- 3. file view ------------------------------------------------------------------

const PAGE = 400;

function FileView({
  repo,
  path,
  refName,
  onNavigate,
  onBackToRepos,
  onUseSnippet,
  onAttach,
}: {
  repo: RepoInfo;
  path: string;
  refName: string;
  onNavigate(path: string): void;
  onBackToRepos(): void;
  onUseSnippet(data: CodeData): void;
  onAttach(file: ContextFile): void;
}) {
  const [result, setResult] = useState<Loadable<FileResult>>(null);
  const [attempt, setAttempt] = useState(0);
  const [range, setRange] = useState<LineRange>(null);
  const [limit, setLimit] = useState(PAGE);
  const key = `${repo.fullName}:${refName}:${path}#${attempt}`;

  useEffect(() => {
    const ctrl = new AbortController();
    const k = `${repo.fullName}:${refName}:${path}#${attempt}`;
    getFile(repo.fullName, path, refName, ctrl.signal)
      .then((data) => setResult({ key: k, data }))
      .catch((e) => {
        if (!ctrl.signal.aborted) setResult({ key: k, error: message(e) });
      });
    return () => ctrl.abort();
  }, [repo.fullName, refName, path, attempt]);

  const current = result && result.key === key ? result : null;
  const file = current?.data;
  const lines = file ? splitLines(file.content) : [];
  const b = rangeBounds(range);
  const rangeLabel = b ? (b.start === b.end ? `line ${b.start}` : `lines ${b.start}–${b.end}`) : "whole file";

  return (
    <>
      <div className={styles.head}>
        <Crumbs repo={repo} path={path} onRepos={onBackToRepos} onPath={onNavigate} />
      </div>
      {file && (
        <div className={styles.fileActions}>
          <div className={styles.rangeNote}>
            {range ? (
              <>
                <span>Selected {rangeLabel}</span>
                <button type="button" className={styles.link} onClick={() => setRange(null)}>
                  Clear
                </button>
              </>
            ) : (
              <span>Tap a line to start a range, tap another to end it</span>
            )}
          </div>
          <div className={styles.actionRow}>
            <button type="button" className={styles.primary} onClick={() => onUseSnippet(snippetFromFile(file, range))}>
              Use as snippet
            </button>
            <button type="button" className={styles.secondary} onClick={() => onAttach(contextFromFile(file, range))}>
              Attach as context
            </button>
          </div>
        </div>
      )}
      <div className={styles.scroll}>
        {current?.error && (
          <div className={styles.error}>
            <span>{current.error}</span>
            <button type="button" className={styles.link} onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        )}
        {!current && <p className={styles.muted}>Loading&hellip;</p>}
        {file && (
          <div className={styles.lines} role="list">
            {lines.slice(0, limit).map((text, i) => {
              const n = i + 1;
              const on = inRange(range, n);
              return (
                <div
                  key={n}
                  role="listitem"
                  className={`${styles.line} ${on ? styles.lineOn : ""}`}
                  onClick={() => setRange((r) => nextRange(r, n))}
                >
                  <span className={styles.num}>{n}</span>
                  <span className={styles.text}>{text || " "}</span>
                </div>
              );
            })}
          </div>
        )}
        {file && lines.length > limit && (
          <button type="button" className={styles.more} onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, lines.length - limit)} more lines ({lines.length - limit} left)
          </button>
        )}
      </div>
    </>
  );
}
