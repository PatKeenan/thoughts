"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { DocNode, Look, Post } from "@/lib/types";

export type SaveState = "saved" | "saving" | "offline" | "error";

export interface DraftSnapshot {
  title: string;
  content: DocNode;
  /** Present only when the look changed and hasn't been saved yet. */
  look?: Look | null;
}

interface LocalDraft extends DraftSnapshot {
  savedAt: string; // ISO, when written locally
  synced: boolean;
}

const DEBOUNCE = 1200;
const key = (id: string) => `draft:${id}`;

export function readLocalDraft(id: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as LocalDraft;
    if (!d || typeof d.title !== "string" || !d.content || typeof d.savedAt !== "string") return null;
    return d;
  } catch {
    return null;
  }
}

function writeLocal(id: string, snap: DraftSnapshot, synced: boolean) {
  try {
    const d: LocalDraft = { ...snap, savedAt: new Date().toISOString(), synced };
    localStorage.setItem(key(id), JSON.stringify(d));
  } catch {
    /* quota or private mode: the server copy still applies */
  }
}

function markSynced(id: string) {
  try {
    const d = readLocalDraft(id);
    if (d && !d.synced) localStorage.setItem(key(id), JSON.stringify({ ...d, synced: true }));
  } catch {
    /* ignore */
  }
}

/**
 * Debounced autosave with a localStorage mirror. Pending edits are never dropped:
 * a failed save keeps them and retries on the next change or when the device
 * comes back online.
 */
export function useAutosave(id: string, onSaved: (post: Post) => void) {
  const [state, setState] = useState<SaveState>("saved");
  const pending = useRef<DraftSnapshot | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const onSavedRef = useRef(onSaved);

  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // Serialise saves: wait for the running one, then send whatever is newest.
    while (inFlight.current) await inFlight.current;
    const snap = pending.current;
    if (!snap) return;
    setState("saving");
    const run = (async () => {
      try {
        const post = await api.patchPost(id, {
          title: snap.title,
          content: snap.content,
          ...("look" in snap ? { look: snap.look ?? null } : {}),
        });
        if (pending.current === snap) {
          pending.current = null;
          markSynced(id);
          setState("saved");
        }
        onSavedRef.current(post);
      } catch (e) {
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        setState(offline || e instanceof TypeError ? "offline" : "error");
        throw e;
      }
    })();
    inFlight.current = run.catch(() => {}).finally(() => {
      inFlight.current = null;
    });
    // Edits made during the save have their own timer pending.
    await run;
  }, [id]);

  const schedule = useCallback(
    (input: DraftSnapshot) => {
      // An unsaved look rides along with later snapshots until a save succeeds.
      const prev = pending.current;
      const snap = !("look" in input) && prev && "look" in prev ? { ...input, look: prev.look } : input;
      pending.current = snap;
      writeLocal(id, snap, false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        flush().catch(() => {});
      }, DEBOUNCE);
    },
    [id, flush],
  );

  useEffect(() => {
    const retry = () => {
      if (pending.current) flush().catch(() => {});
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") retry();
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", retry);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", retry);
      // Leaving the page (e.g. back to the list): send what's pending.
      retry();
    };
  }, [flush]);

  // flush() rejects when the save fails, so callers (Publish) can stop and say so.
  return { state, schedule, flush };
}
