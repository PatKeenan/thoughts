"use client";

// Everything the editor does with the post's look: the effective look, persistence,
// off-look tracking, per-block restyle / "Use as the look", auto-capture and "Restyle all".

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { api } from "@/lib/client/api";
import { effectiveLook, stampOf } from "@/lib/look";
import {
  captureSource,
  createAutoCapture,
  errorMessage,
  isAbort,
  offLookBlocks,
  restyleData,
  runRestyleQueue,
  sourceStillMatches,
  type ExtractSource,
  type OffLookItem,
} from "@/lib/client/studio";
import type { GenBlockAttrs, Look } from "@/lib/types";
import { findGenBlock } from "./GenBlock";
import { patchGenBlockData, replaceGenBlock } from "./insert";
import type { BlockBusy, LookCtx } from "./LookContext";

export interface LookNotice {
  key: number;
  text: string;
  /** show a "Change" link that opens the Look sheet */
  change?: boolean;
}

const EMPTY: OffLookItem[] = [];

/** Off-look blocks of a doc, memoised on (doc, look); returns the same array while the result is unchanged. */
function createOffLookMemo() {
  let last: { doc: PMNode; look: Look | null; key: string; items: OffLookItem[] } | null = null;
  return (doc: PMNode | undefined, look: Look | null): OffLookItem[] => {
    if (!doc) return EMPTY;
    if (last && last.doc === doc && last.look === look) return last.items;
    const items = offLookBlocks(doc, look);
    const key = items.map((i) => `${i.id}:${i.kind}`).join(",");
    if (last && last.key === key) {
      last = { ...last, doc, look };
      return last.items;
    }
    last = { doc, look, key, items: items.length ? items : EMPTY };
    return last.items;
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const SOURCE_NOUN: Record<ExtractSource["kind"], string> = { image: "image", motion: "animation" };

export function useLookState({
  editor,
  initialLook,
  persist,
  getPostContext,
}: {
  editor: Editor | null;
  initialLook: Look | null;
  /** save the post's own look (null clears it) */
  persist(look: Look | null): void;
  getPostContext(): { title: string; text: string };
}) {
  const [postLook, setPostLook] = useState<Look | null>(initialLook);
  const [defaultLook, setDefaultLook] = useState<Look | null>(null);
  const [settings] = useState(() => deferred<void>());
  const look = effectiveLook(postLook, defaultLook);
  const inherited = !postLook && !!defaultLook;

  // Refs read by async work (always the newest values, even before a re-render).
  const postLookRef = useRef(postLook);
  const defaultLookRef = useRef<Look | null>(null);
  const lookRef = useRef<Look | null>(look);
  const persistRef = useRef(persist);
  const ctxRef = useRef(getPostContext);
  const editorRef = useRef(editor);
  const alive = useRef(true);
  useEffect(() => {
    persistRef.current = persist;
    ctxRef.current = getPostContext;
    editorRef.current = editor;
  });

  useEffect(() => {
    alive.current = true;
    let live = true;
    api
      .getSettings()
      .then((st) => {
        if (!live) return;
        const d = st.defaultLook ?? null;
        defaultLookRef.current = d;
        lookRef.current = effectiveLook(postLookRef.current, d);
        setDefaultLook(d);
      })
      .catch(() => {
        /* no default look */
      })
      .finally(() => settings.resolve());
    return () => {
      live = false;
      alive.current = false;
    };
  }, [settings]);

  const setLook = useCallback((next: Look | null) => {
    postLookRef.current = next;
    lookRef.current = effectiveLook(next, defaultLookRef.current);
    setPostLook(next);
    persistRef.current(next);
  }, []);

  // ---- notice line under the chip ----
  const [notice, setNotice] = useState<LookNotice | null>(null);
  const say = useCallback((text: string, change = false) => setNotice({ key: Date.now(), text, change }), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.change ? 6000 : 8000);
    return () => clearTimeout(t);
  }, [notice]);
  const dismissNotice = useCallback(() => setNotice(null), []);

  // ---- off-look blocks (recomputed on every doc change; cheap walk, memoised on doc) ----
  const [memo] = useState(createOffLookMemo);
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!editor) return () => {};
      editor.on("update", cb);
      return () => {
        editor.off("update", cb);
      };
    },
    [editor],
  );
  const offItems = useSyncExternalStore(
    subscribe,
    () => memo(editor ? editor.state.doc : undefined, look),
    () => EMPTY,
  );
  const offLookIds = useMemo(() => new Set(offItems.map((i) => i.id)), [offItems]);

  // ---- per-block work ----
  const [busy, setBusy] = useState<Record<string, BlockBusy>>({});
  const [controllers] = useState(() => new Map<string, AbortController>());
  const mark = useCallback((id: string, b: BlockBusy | null) => {
    if (!alive.current) return;
    setBusy((cur) => {
      if (!b) {
        if (!(id in cur)) return cur;
        const next = { ...cur };
        delete next[id];
        return next;
      }
      return { ...cur, [id]: b };
    });
  }, []);

  useEffect(
    () => () => {
      controllers.forEach((c) => c.abort());
      controllers.clear();
    },
    [controllers],
  );

  const stampBlock = useCallback((id: string, src: ExtractSource, l: Look) => {
    const ed = editorRef.current;
    if (ed) patchGenBlockData(ed, id, { look: stampOf(l) }, (d) => sourceStillMatches(src, d));
  }, []);

  /** Restyle one block to the current look. Throws on failure (AbortError when cancelled). */
  const restyleOne = useCallback(
    async (id: string, signal: AbortSignal): Promise<void> => {
      const ed = editorRef.current;
      const l = lookRef.current;
      if (!ed || ed.isDestroyed || !l) return;
      const found = findGenBlock(ed.state.doc, id);
      if (!found) return;
      const attrs = found.node.attrs as GenBlockAttrs;
      const data = (attrs.data ?? {}) as Record<string, unknown>;
      const before = JSON.stringify(data);
      mark(id, { type: "restyle", label: "Starting", progress: 0 });
      try {
        const r = await restyleData({
          kind: attrs.kind,
          data,
          history: attrs.history ?? [],
          look: l,
          signal,
          onProgress: (p) => mark(id, { type: "restyle", ...p }),
          post: ctxRef.current(),
        });
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        // By id, and only if nobody changed the block meanwhile.
        replaceGenBlock(ed, id, r, (cur) => JSON.stringify(cur) === before);
        mark(id, null);
      } catch (e) {
        if (signal.aborted || isAbort(e)) mark(id, null);
        else mark(id, { type: "error", message: `Couldn’t restyle: ${errorMessage(e)}` });
        throw e;
      }
    },
    [mark],
  );

  const restyleBlock = useCallback(
    (id: string) => {
      if (controllers.has(id)) return;
      const ctrl = new AbortController();
      controllers.set(id, ctrl);
      restyleOne(id, ctrl.signal)
        .catch(() => {})
        .finally(() => {
          if (controllers.get(id) === ctrl) controllers.delete(id);
        });
    },
    [controllers, restyleOne],
  );

  const cancelBlock = useCallback(
    (id: string) => {
      controllers.get(id)?.abort();
      controllers.delete(id);
      mark(id, null);
    },
    [controllers, mark],
  );

  const dismissBlockError = useCallback((id: string) => mark(id, null), [mark]);

  const captureFrom = useCallback(
    (id: string) => {
      const ed = editorRef.current;
      if (!ed || controllers.has(id)) return;
      const found = findGenBlock(ed.state.doc, id);
      if (!found) return;
      const src = captureSource(found.node.attrs.kind, found.node.attrs.data);
      if (!src) return;
      // Reading can't be aborted mid-request; the marker keeps it from running twice.
      const ctrl = new AbortController();
      controllers.set(id, ctrl);
      mark(id, { type: "capture" });
      api
        .extractLook({ source: src, post: ctxRef.current() })
        .then((l) => {
          if (!alive.current || ctrl.signal.aborted) return;
          setLook(l);
          stampBlock(id, src, l);
          mark(id, null);
        })
        .catch((e: unknown) => {
          if (!ctrl.signal.aborted) mark(id, { type: "error", message: `Couldn’t read the look: ${errorMessage(e)}` });
        })
        .finally(() => {
          if (controllers.get(id) === ctrl) controllers.delete(id);
        });
    },
    [controllers, mark, setLook, stampBlock],
  );

  // ---- auto-capture: first image/animation in a post without a look ----
  // One capturer for the editor's lifetime (it holds the "already running" flag).
  const captureRef = useRef<ReturnType<typeof createAutoCapture> | null>(null);
  const autoCapture = useCallback(
    (attrs: Pick<GenBlockAttrs, "id" | "kind" | "data">) => {
      captureRef.current ??= createAutoCapture({
        getLook: () => lookRef.current,
        extract: async (source) => {
          await settings.promise; // a site default may still be loading
          if (lookRef.current) throw new Error("look exists");
          return api.extractLook({ source, post: ctxRef.current() });
        },
        apply: (l, block, src) => {
          if (!alive.current) return;
          setLook(l);
          stampBlock(block.id, src, l);
          say(`Look set from this ${SOURCE_NOUN[src.kind]}.`, true);
        },
      });
      return captureRef.current(attrs);
    },
    [settings, setLook, stampBlock, say],
  );

  // ---- restyle all ----
  const [restyle, setRestyle] = useState<{ done: number; total: number; label: string } | null>(null);
  const queueRef = useRef<AbortController | null>(null);
  useEffect(() => () => queueRef.current?.abort(), []);

  const restyleAll = useCallback(() => {
    const ed = editorRef.current;
    if (queueRef.current || !ed || ed.isDestroyed) return;
    const items = offLookBlocks(ed.state.doc, lookRef.current).filter((i) => i.kind !== "clip" && !controllers.has(i.id));
    if (!items.length) return;
    const queue = new AbortController();
    queueRef.current = queue;
    runRestyleQueue({
      items,
      signal: queue.signal,
      onUpdate: (st) => {
        if (alive.current) setRestyle(st.current ? { done: st.done, total: st.total, label: st.label } : null);
      },
      run: (item, signal) => {
        const ctrl = new AbortController();
        const onAbort = () => ctrl.abort();
        signal.addEventListener("abort", onAbort, { once: true });
        controllers.set(item.id, ctrl);
        return restyleOne(item.id, ctrl.signal).finally(() => {
          signal.removeEventListener("abort", onAbort);
          if (controllers.get(item.id) === ctrl) controllers.delete(item.id);
        });
      },
    }).then(({ failed }) => {
      if (queueRef.current === queue) queueRef.current = null;
      if (!alive.current) return;
      setRestyle(null);
      if (failed) say(`${failed} couldn’t be restyled`);
    });
  }, [controllers, restyleOne, say]);

  const cancelRestyleAll = useCallback(() => {
    queueRef.current?.abort();
  }, []);

  const ctx: LookCtx = useMemo(
    () => ({
      look,
      inherited,
      setLook,
      offLookIds,
      restyleBlock,
      cancelBlock,
      captureFrom,
      busy,
      dismissBlockError,
    }),
    [look, inherited, setLook, offLookIds, restyleBlock, cancelBlock, captureFrom, busy, dismissBlockError],
  );

  return {
    ctx,
    look,
    inherited,
    setLook,
    offLook: offItems.length,
    restyle,
    restyleAll,
    cancelRestyleAll,
    notice,
    dismissNotice,
    autoCapture,
  };
}
