"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sheet from "@/components/ui/Sheet";
import { api } from "@/lib/client/api";
import { CODE_THEMES, cloneLook, codeThemeOf, editLook, safeRefUrl } from "@/lib/look";
import type { FontKind, Look, Settings } from "@/lib/types";
import ConfirmButton from "./ConfirmButton";
import Specimen, { Dots } from "./Specimen";
import styles from "./LookSheet.module.css";

const DEBOUNCE_MS = 500;
const MAX_EXTRA = 3;
const MAX_SAVED = 20;
const NEW_EXTRA = "#8a8a8a";
const LIGHT_THEMES = new Set(["vitesse-light", "github-light", "solarized-light"]);
const FONT_KINDS: FontKind[] = ["serif", "sans", "mono"];
const PACES = ["calm", "brisk", "snappy"] as const;

type Drafts = Record<string, string>;

/** Turns pending text/colour drafts into a patch; keys of drafts that can't be committed (empty name) stay out of `used`. */
function patchFromDrafts(d: Drafts, l: Look): { patch: Partial<Omit<Look, "id" | "version">>; used: string[] } {
  const patch: Partial<Omit<Look, "id" | "version">> = {};
  const used: string[] = [];
  if (d.name !== undefined) {
    const v = d.name.trim().slice(0, 60);
    if (v) {
      patch.name = v;
      used.push("name");
    }
  }
  if (d.illustration !== undefined) {
    const v = d.illustration.trim().slice(0, 400);
    if (v) {
      patch.illustration = v;
      used.push("illustration");
    }
  }
  const palKeys = ["bg", "ink", "accent", "muted"] as const;
  const extraKeys = l.palette.extra.map((_, i) => `extra${i}`);
  if ([...palKeys, ...extraKeys].some((k) => d[k] !== undefined)) {
    const p = { ...l.palette, extra: [...l.palette.extra] };
    for (const k of palKeys) {
      if (d[k] !== undefined) {
        p[k] = d[k];
        used.push(k);
      }
    }
    extraKeys.forEach((k, i) => {
      if (d[k] !== undefined) {
        p.extra[i] = d[k];
        used.push(k);
      }
    });
    patch.palette = p;
  }
  if (d.notes !== undefined) {
    patch.motion = { ...l.motion, notes: d.notes.trim().slice(0, 200) };
    used.push("notes");
  }
  if (d.mood !== undefined) {
    patch.mood = d.mood
      .split(",")
      .map((m) => m.trim().slice(0, 24))
      .filter(Boolean)
      .slice(0, 5);
    used.push("mood");
  }
  return { patch, used };
}

/** The look with any uncommitted drafts applied, so the specimen follows what is being typed or dragged. */
function withDrafts(l: Look, d: Drafts): Look {
  const { patch } = patchFromDrafts(d, l);
  return { ...l, ...patch };
}

type Saved =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; settings: Settings };

export default function LookSheet({
  open,
  onClose,
  look,
  inherited,
  onChange,
  offLook,
  restyle,
  onRestyleAll,
  onCancelRestyle,
  post,
}: {
  open: boolean;
  onClose(): void;
  look: Look | null;
  inherited: boolean;
  onChange(look: Look | null): void;
  offLook: number;
  restyle: { done: number; total: number; label: string } | null;
  onRestyleAll(): void;
  onCancelRestyle(): void;
  post: { title: string; text: string };
}) {
  const [drafts, setDrafts] = useState<Drafts>({});
  const draftsRef = useRef<Drafts>({});
  const lookRef = useRef<Look | null>(look);
  const onChangeRef = useRef(onChange);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitted = useRef<string>("");

  const [description, setDescription] = useState("");
  const [describing, setDescribing] = useState(false);
  const [describeErr, setDescribeErr] = useState("");

  const [saved, setSaved] = useState<Saved>({ status: "loading" });
  const [savedBusy, setSavedBusy] = useState(false);
  const [savedErr, setSavedErr] = useState("");

  useEffect(() => {
    lookRef.current = look;
    onChangeRef.current = onChange;
  });

  const setAllDrafts = useCallback((next: Drafts) => {
    draftsRef.current = next;
    setDrafts(next);
  }, []);

  const emit = useCallback((next: Look | null) => {
    emitted.current = next ? `${next.id}:${next.version}` : "";
    lookRef.current = next;
    onChangeRef.current(next);
  }, []);

  /** Commits pending drafts now (one onChange). Returns the look after them. */
  const flush = useCallback((): Look | null => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const l = lookRef.current;
    if (!l) return null;
    const { patch, used } = patchFromDrafts(draftsRef.current, l);
    if (used.length === 0) return l;
    const next = editLook(l, patch);
    const rest = { ...draftsRef.current };
    for (const k of used) delete rest[k];
    setAllDrafts(rest);
    emit(next);
    return next;
  }, [emit, setAllDrafts]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  /** Drops pending drafts without committing (the look is being replaced). */
  const discard = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setAllDrafts({});
  }, [setAllDrafts]);

  function setDraft(key: string, value: string) {
    setAllDrafts({ ...draftsRef.current, [key]: value });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), DEBOUNCE_MS);
  }

  /** An immediate edit: pending drafts and `fn`'s patch go out as a single change. */
  function edit(fn: (applied: Look) => Partial<Omit<Look, "id" | "version">>) {
    const l = lookRef.current;
    if (!l) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { patch: dp, used } = patchFromDrafts(draftsRef.current, l);
    const applied = { ...l, ...dp };
    const rest = { ...draftsRef.current };
    for (const k of used) delete rest[k];
    setAllDrafts(rest);
    emit(editLook(l, { ...dp, ...fn(applied) }));
  }

  // The look changed from outside (another look, a new version we did not send): drop stale drafts.
  const lookKey = look ? `${look.id}:${look.version}` : "";
  useEffect(() => {
    if (lookKey === emitted.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    draftsRef.current = {};
    setDrafts({});
  }, [lookKey]);

  // Closing the sheet commits what is pending; unmounting does too.
  useEffect(() => {
    if (!open) {
      flushRef.current();
      draftsRef.current = {};
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrafts({});
    }
  }, [open]);
  useEffect(() => {
    return () => {
      flushRef.current();
    };
  }, []);

  const loadSaved = useCallback(async () => {
    setSaved({ status: "loading" });
    try {
      setSaved({ status: "ok", settings: await api.getSettings() });
    } catch (e) {
      setSaved({ status: "error", message: e instanceof Error ? e.message : "Could not load saved looks" });
    }
  }, []);

  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setDescribeErr("");
      setSavedErr("");
      /* eslint-enable react-hooks/set-state-in-effect */
      void loadSaved();
    }
  }, [open, loadSaved]);

  async function describe() {
    const text = description.trim();
    if (!text || describing) return;
    setDescribing(true);
    setDescribeErr("");
    try {
      const next = await api.extractLook({ source: { kind: "text", description: text }, post });
      discard();
      emit(next);
      setDescription("");
    } catch (e) {
      setDescribeErr(e instanceof Error ? e.message : "Could not make a look");
    } finally {
      setDescribing(false);
    }
  }

  async function savedAction(patch: Partial<Settings>) {
    setSavedBusy(true);
    setSavedErr("");
    try {
      const settings = await api.patchSettings(patch);
      setSaved({ status: "ok", settings });
    } catch (e) {
      setSavedErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavedBusy(false);
    }
  }

  function saveThis() {
    if (saved.status !== "ok") return;
    const current = flush() ?? lookRef.current;
    if (!current) return;
    const list = saved.settings.savedLooks;
    const copy = cloneLook(current);
    if (list.some((s) => s.id === copy.id)) {
      void savedAction({ savedLooks: list.map((s) => (s.id === copy.id ? copy : s)) });
    } else if (list.length >= MAX_SAVED) {
      setSavedErr(`You can keep ${MAX_SAVED} saved looks. Delete one first.`);
    } else {
      void savedAction({ savedLooks: [...list, copy] });
    }
  }

  const shown = look ? withDrafts(look, drafts) : null;
  const val = (key: string, fallback: string) => drafts[key] ?? fallback;
  const settings = saved.status === "ok" ? saved.settings : null;
  const defaultId = settings?.defaultLook?.id ?? null;
  const defaultVersion = settings?.defaultLook?.version ?? null;
  const ref = look ? safeRefUrl(look.referenceUrl) : undefined;

  const describeBlock = (
    <section className={styles.section} aria-labelledby="look-describe">
      <h3 id="look-describe" className={styles.label}>
        Describe a look
      </h3>
      <textarea
        className={styles.input}
        rows={2}
        value={description}
        placeholder="Warm risograph, two inks, grainy paper, calm"
        onChange={(e) => setDescription(e.target.value)}
        aria-label="Describe a look"
      />
      <div className={styles.row}>
        {look ? (
          <ConfirmButton
            className={styles.secondary}
            armedClassName={styles.danger}
            label={describing ? "Working…" : "Replace with this"}
            armedLabel="Tap again to replace"
            disabled={!description.trim() || describing}
            onConfirm={() => void describe()}
          />
        ) : (
          <button
            type="button"
            className={styles.primary}
            disabled={!description.trim() || describing}
            onClick={() => void describe()}
          >
            {describing ? "Working…" : "Make a look"}
          </button>
        )}
      </div>
      {describeErr && (
        <p className={styles.error} role="alert">
          {describeErr}
        </p>
      )}
    </section>
  );

  return (
    <Sheet open={open} onClose={onClose} title="Look">
      {!look || !shown ? (
        <>
          <p className={styles.quiet}>
            No look yet. It will be set from the first image or animation you add — or describe one.
          </p>
          {describeBlock}
        </>
      ) : (
        <>
          <Specimen look={shown} />
          {inherited && (
            <p className={styles.quiet}>
              This post uses the site default look. Change anything to give the post its own copy.
            </p>
          )}

          <section className={styles.section}>
            <label className={styles.field}>
              <span className={styles.label}>Name</span>
              <input
                className={styles.input}
                value={val("name", look.name)}
                maxLength={60}
                onChange={(e) => setDraft("name", e.target.value)}
              />
            </label>
          </section>

          <section className={styles.section} aria-labelledby="look-colours">
            <h3 id="look-colours" className={styles.label}>
              Colours
            </h3>
            <div className={styles.swatches}>
              {(
                [
                  ["bg", "Background", look.palette.bg],
                  ["ink", "Text", look.palette.ink],
                  ["accent", "Accent", look.palette.accent],
                  ["muted", "Muted", look.palette.muted],
                ] as const
              ).map(([key, label, current]) => (
                <Swatch key={key} label={label} value={val(key, current)} onChange={(v) => setDraft(key, v)} />
              ))}
              {look.palette.extra.map((c, i) => (
                <Swatch
                  key={i}
                  label={`Extra ${i + 1}`}
                  value={val(`extra${i}`, c)}
                  onChange={(v) => setDraft(`extra${i}`, v)}
                  onRemove={() =>
                    edit((a) => ({ palette: { ...a.palette, extra: a.palette.extra.filter((_, j) => j !== i) } }))
                  }
                />
              ))}
            </div>
            {look.palette.extra.length < MAX_EXTRA && (
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.text}
                  onClick={() => edit((a) => ({ palette: { ...a.palette, extra: [...a.palette.extra, NEW_EXTRA] } }))}
                >
                  Add colour
                </button>
              </div>
            )}
          </section>

          <section className={styles.section}>
            <h3 className={styles.label} id="look-titles">
              Titles
            </h3>
            <Segmented
              labelledBy="look-titles"
              options={FONT_KINDS}
              value={look.typography.title}
              onPick={(k) => edit((a) => ({ typography: { ...a.typography, title: k } }))}
            />
            <h3 className={`${styles.label} ${styles.gap}`} id="look-body">
              Body
            </h3>
            <Segmented
              labelledBy="look-body"
              options={FONT_KINDS}
              value={look.typography.body}
              onPick={(k) => edit((a) => ({ typography: { ...a.typography, body: k } }))}
            />
          </section>

          <section className={styles.section}>
            <label className={styles.field}>
              <span className={styles.label}>Illustration style</span>
              <textarea
                className={styles.input}
                rows={3}
                maxLength={400}
                value={val("illustration", look.illustration)}
                onChange={(e) => setDraft("illustration", e.target.value)}
              />
            </label>
          </section>

          <section className={styles.section}>
            <h3 className={styles.label} id="look-pace">
              Motion pace
            </h3>
            <Segmented
              labelledBy="look-pace"
              options={PACES}
              value={look.motion.pace}
              onPick={(p) => edit((a) => ({ motion: { ...a.motion, pace: p } }))}
            />
            <label className={`${styles.field} ${styles.gap}`}>
              <span className={styles.label}>Motion notes</span>
              <textarea
                className={styles.input}
                rows={2}
                maxLength={200}
                value={val("notes", look.motion.notes)}
                onChange={(e) => setDraft("notes", e.target.value)}
              />
            </label>
          </section>

          <section className={styles.section}>
            <label className={styles.field}>
              <span className={styles.label}>Code theme</span>
              <select
                className={styles.input}
                value={codeThemeOf(look)}
                onChange={(e) => edit(() => ({ codeTheme: e.target.value }))}
              >
                {CODE_THEMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                    {LIGHT_THEMES.has(t) ? " (light)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className={styles.help}>Applies to every code snippet in this post. Nothing needs restyling.</p>
          </section>

          <section className={styles.section}>
            <label className={styles.field}>
              <span className={styles.label}>Mood words</span>
              <input
                className={styles.input}
                placeholder="warm, quiet, handmade"
                value={val("mood", look.mood.join(", "))}
                onChange={(e) => setDraft("mood", e.target.value)}
              />
            </label>
          </section>

          {ref && (
            <section className={styles.section}>
              <h3 className={styles.label}>Reference image</h3>
              <div className={styles.refRow}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.thumb} src={ref} alt="Style reference" />
                <button type="button" className={styles.text} onClick={() => edit(() => ({ referenceUrl: undefined }))}>
                  Remove reference
                </button>
              </div>
            </section>
          )}

          {offLook > 0 && (
            <section className={styles.section} aria-labelledby="look-off">
              <h3 id="look-off" className={styles.label}>
                Older blocks
              </h3>
              <p className={styles.plain}>
                {offLook} image{offLook === 1 ? "" : "s"} or animation{offLook === 1 ? " was" : "s were"} made before
                this look.
              </p>
              {restyle ? (
                <div role="status">
                  <p className={styles.plain}>
                    {restyle.label} · {restyle.done}/{restyle.total}
                  </p>
                  <div className={styles.bar} aria-hidden="true">
                    <div
                      className={styles.barFill}
                      style={{ width: `${restyle.total ? Math.min(100, (restyle.done / restyle.total) * 100) : 0}%` }}
                    />
                  </div>
                  <div className={styles.row}>
                    <button type="button" className={styles.secondary} onClick={onCancelRestyle}>
                      Stop
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.row}>
                    <button type="button" className={styles.secondary} onClick={onRestyleAll}>
                      Restyle all
                    </button>
                  </div>
                  <p className={styles.help}>Images are redrawn, so details will change. Video clips are not included.</p>
                </>
              )}
            </section>
          )}

          {describeBlock}
        </>
      )}

      <section className={styles.section} aria-labelledby="look-saved">
        <h3 id="look-saved" className={styles.label}>
          Saved looks
        </h3>
        {saved.status === "loading" && <p className={styles.quiet}>Loading…</p>}
        {saved.status === "error" && (
          <div className={styles.errorBox} role="alert">
            <p>{saved.message}</p>
            <button type="button" className={styles.text} onClick={() => void loadSaved()}>
              Retry
            </button>
          </div>
        )}
        {settings && settings.savedLooks.length === 0 && <p className={styles.quiet}>Nothing saved yet.</p>}
        {settings && settings.savedLooks.length > 0 && (
          <ul className={styles.list}>
            {settings.savedLooks.map((s) => (
              <li key={s.id} className={styles.item}>
                <div className={styles.itemMain}>
                  <span className={styles.itemName}>{s.name}</span>
                  <Dots look={s} />
                  <span className={styles.badges}>
                    {look?.id === s.id && <span className={styles.badge}>In use</span>}
                    {defaultId === s.id && <span className={styles.badge}>Site default</span>}
                  </span>
                </div>
                <div className={styles.itemActions}>
                  <button
                    type="button"
                    className={styles.text}
                    disabled={savedBusy}
                    onClick={() => {
                      discard();
                      emit(cloneLook(s));
                    }}
                  >
                    Use
                  </button>
                  <ConfirmButton
                    className={styles.text}
                    armedClassName={styles.dangerText}
                    label="Delete"
                    armedLabel="Tap again to delete"
                    disabled={savedBusy}
                    onConfirm={() => void savedAction({ savedLooks: settings.savedLooks.filter((x) => x.id !== s.id) })}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {savedErr && (
          <p className={styles.error} role="alert">
            {savedErr}
          </p>
        )}
        {look && settings && (
          <div className={styles.row}>
            <button type="button" className={styles.secondary} disabled={savedBusy} onClick={saveThis}>
              {settings.savedLooks.some((s) => s.id === look.id) ? "Update saved look" : "Save this look"}
            </button>
            {defaultId === look.id && defaultVersion === look.version ? (
              <button
                type="button"
                className={styles.secondary}
                disabled={savedBusy}
                onClick={() => void savedAction({ defaultLook: null })}
              >
                Remove as default
              </button>
            ) : (
              <button
                type="button"
                className={styles.secondary}
                disabled={savedBusy}
                onClick={() => {
                  const current = flush() ?? lookRef.current;
                  if (current) void savedAction({ defaultLook: cloneLook(current) });
                }}
              >
                {defaultId === look.id ? "Update site default" : "Make site default"}
              </button>
            )}
          </div>
        )}
        {look && defaultId === look.id && defaultVersion !== look.version && (
          <p className={styles.help}>The site default is an earlier version of this look.</p>
        )}
      </section>

      {look && !inherited && (
        <section className={styles.section}>
          <ConfirmButton
            className={styles.text}
            armedClassName={styles.dangerText}
            label="Clear look"
            armedLabel="Tap again to clear"
            onConfirm={() => {
              discard();
              emit(null);
            }}
          />
        </section>
      )}
    </Sheet>
  );
}

function Swatch({
  label,
  value,
  onChange,
  onRemove,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  onRemove?(): void;
}) {
  return (
    <div className={styles.swatch}>
      <label className={styles.swatchLabel}>
        <span className={styles.swatchName}>{label}</span>
        <input
          type="color"
          className={styles.color}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className={styles.hex}>{value}</span>
      </label>
      {onRemove && (
        <button type="button" className={styles.text} onClick={onRemove} aria-label={`Remove ${label}`}>
          Remove
        </button>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onPick,
  labelledBy,
}: {
  options: readonly T[];
  value: T;
  onPick(v: T): void;
  labelledBy: string;
}) {
  return (
    <div className={styles.seg} role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} className={styles.segBtn} onClick={() => onPick(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}
