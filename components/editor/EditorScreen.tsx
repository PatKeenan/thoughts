"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { api } from "@/lib/client/api";
import { newBlockId } from "@/lib/client/studio";
import type { DocNode, GenBlockAttrs, Look, Post } from "@/lib/types";
import BuddyPanel from "@/components/buddy/BuddyPanel";
import PublishSheet from "@/components/publish/PublishSheet";
import Studio, { type StudioOpen, type StudioCommit } from "@/components/studio/Studio";
import FactCheckSheet from "@/components/factcheck/FactCheckSheet";
import LookSheet from "@/components/look/LookSheet";
import { GenBlock, type GenOpenRequest } from "./GenBlock";
import { Handler, SlashCommand, SlashController } from "./slash";
import SlashMenu from "./SlashMenu";
import Toolbar from "./Toolbar";
import { insertGenBlock, scrollToBlock, updateGenBlock } from "./insert";
import { readLocalDraft, useAutosave, type SaveState } from "./useAutosave";
import { LookContext } from "./LookContext";
import LookChip from "./LookChip";
import { useLookState } from "./useLookState";
import styles from "./EditorScreen.module.css";

const EMPTY_DOC: DocNode = { type: "doc", content: [{ type: "paragraph" }] };
const NO_POST = { title: "", text: "" };

interface Loaded {
  post: Post;
  title: string;
  content: DocNode;
  /** the post's own look (the local copy's, when it held an unsaved one) */
  look: Look | null;
  /** local copy was newer than the server's: save it */
  restored: boolean;
  /** the restored local copy carried an unsaved look */
  lookRestored: boolean;
}

export default function EditorScreen({ id }: { id: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .getPost(id)
      .then((post) => {
        if (!live) return;
        const local = readLocalDraft(id);
        const newer =
          !!local && !local.synced && Date.parse(local.savedAt) > Date.parse(post.updatedAt || "0");
        const lookRestored = newer && !!local && "look" in local;
        setLoaded({
          post,
          title: newer ? local!.title : post.title,
          content: newer ? local!.content : post.content?.type === "doc" ? post.content : EMPTY_DOC,
          look: lookRestored ? (local!.look ?? null) : (post.look ?? null),
          restored: newer,
          lookRestored,
        });
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "Could not load this draft.");
      });
    return () => {
      live = false;
    };
  }, [id, attempt]);

  if (error && !loaded) {
    return (
      <div className={styles.status}>
        <p>{error}</p>
        <div className={styles.statusActions}>
          <Link href="/write" className={styles.ghost}>
            Drafts
          </Link>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!loaded) return <div className={styles.status} aria-busy="true" />;
  return <EditorBody key={loaded.post.id} id={id} initial={loaded} />;
}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  saving: "Saving…",
  offline: "Offline — kept on this device",
  error: "Not saved — will retry",
};

function EditorBody({ id, initial }: { id: string; initial: Loaded }) {
  const [post, setPost] = useState<Post>(initial.post);
  const [title, setTitle] = useState(initial.title);
  const titleRef = useRef(initial.title);
  const titleEl = useRef<HTMLTextAreaElement>(null);
  const [controller] = useState(() => new SlashController());
  const [openBlock] = useState(() => new Handler<GenOpenRequest>());
  const [studio, setStudio] = useState<StudioOpen | null>(null);
  const [buddyOpen, setBuddyOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [factOpen, setFactOpen] = useState(false);
  const [lookOpen, setLookOpen] = useState(false);
  const [lookPost, setLookPost] = useState(NO_POST);

  const { state: saveState, schedule, flush } = useAutosave(id, setPost);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
        codeBlock: false,
      }),
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === "paragraph" ? "Write, or type / for tools" : ""),
      }),
      GenBlock.configure({ onOpen: (req) => openBlock.call(req) }),
      SlashCommand.configure({ controller }),
    ],
    content: initial.content,
    editorProps: {
      attributes: {
        class: styles.prose,
        autocapitalize: "sentences",
        spellcheck: "true",
        "aria-label": "Post body",
      },
    },
    onUpdate: ({ editor: e }) => {
      schedule({ title: titleRef.current, content: e.getJSON() as DocNode });
    },
  });

  // Local copy was newer than the server: push it.
  useEffect(() => {
    if (initial.restored && editor) {
      schedule({
        title: initial.title,
        content: editor.getJSON() as DocNode,
        ...(initial.lookRestored ? { look: initial.look } : {}),
      });
    }
  }, [initial, editor, schedule]);

  // Bridges from editor extensions to React state.
  useEffect(() => {
    controller.tool.set(({ tool, pos }) => {
      setStudio({ key: Date.now(), mode: tool, target: { type: "new", pos }, regenerate: false });
    });
    openBlock.set((req) => {
      setStudio({
        key: Date.now(),
        mode: req.attrs.kind === "repo" ? "github" : req.attrs.kind,
        target: { type: "existing", id: req.attrs.id, pos: req.pos },
        existing: req.attrs,
        regenerate: req.regenerate,
      });
    });
    controller.fact.set(() => setFactOpen(true));
  }, [controller, openBlock]);

  // Auto-grow the title.
  useLayoutEffect(() => {
    const el = titleEl.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [title]);

  const onTitle = (v: string) => {
    const clean = v.replace(/\n/g, " ");
    setTitle(clean);
    titleRef.current = clean;
    if (editor) schedule({ title: clean, content: editor.getJSON() as DocNode });
  };

  const getPostContext = useCallback(
    () => ({ title: titleRef.current, text: editor ? editor.getText().slice(0, 2000) : "" }),
    [editor],
  );

  // The look is saved with the next autosave (and retried with later ones until it sticks).
  const persistLook = useCallback(
    (look: Look | null) => {
      if (editor) schedule({ title: titleRef.current, content: editor.getJSON() as DocNode, look });
    },
    [editor, schedule],
  );
  const lk = useLookState({ editor, initialLook: initial.look, persist: persistLook, getPostContext });
  const { look, autoCapture } = lk;
  const openLook = useCallback(() => {
    setLookPost(getPostContext());
    setLookOpen(true);
  }, [getPostContext]);
  useEffect(() => {
    controller.look.set(openLook);
  }, [controller, openLook]);

  const commit = (open: StudioOpen, result: StudioCommit) => {
      if (!editor) return;
      let pos: number | null = null;
      if (open.target.type === "existing") {
        pos = updateGenBlock(editor, open.target.id, open.target.pos, result);
      }
      if (pos === null) {
        const attrs: GenBlockAttrs = {
          id: open.target.type === "existing" ? open.target.id : newBlockId(),
          ...result,
        };
        pos = insertGenBlock(editor, open.target.pos, attrs);
        // The first image/animation in a post without a look sets it (in the background).
        if (open.target.type === "new") autoCapture(attrs).catch(() => {});
      }
      setStudio(null);
      const at = pos;
      requestAnimationFrame(() => {
        if (open.target.type === "new") editor.commands.focus(undefined, { scrollIntoView: false });
        scrollToBlock(editor, at);
      });
  };

  const publishLabel =
    post.status === "published" ? "Published" : post.status === "scheduled" ? "Scheduled" : "Publish";

  return (
    <LookContext.Provider value={lk.ctx}>
      <div className={styles.screen}>
        <header className={styles.top}>
          <div className={styles.topInner}>
            <Link href="/write" className={styles.back} aria-label="Back to drafts">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M15 5l-7 7 7 7" />
              </svg>
              Drafts
            </Link>
            <span className={`${styles.save} ${saveState === "offline" || saveState === "error" ? styles.saveWarn : ""}`} aria-live="polite">
              {SAVE_LABEL[saveState]}
            </span>
            <button type="button" className={styles.ghost} onClick={() => setBuddyOpen(true)} disabled={!editor}>
              Buddy
            </button>
            <button
              type="button"
              className={post.status === "draft" ? styles.primary : styles.ghost}
              onClick={() => setPublishOpen(true)}
              disabled={!editor}
            >
              {publishLabel}
            </button>
          </div>
        </header>

        <main className={styles.column}>
          <textarea
            ref={titleEl}
            className={styles.title}
            value={title}
            rows={1}
            placeholder="Title"
            aria-label="Title"
            enterKeyHint="next"
            onChange={(e) => onTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                editor?.commands.focus("start");
              }
            }}
          />
          <LookChip
            look={look}
            inherited={lk.inherited}
            offLook={lk.offLook}
            restyling={!!lk.restyle}
            notice={lk.notice}
            onOpen={openLook}
            onDismissNotice={lk.dismissNotice}
          />
          <EditorContent editor={editor} className={styles.body} />
        </main>

        {editor && <Toolbar editor={editor} onCheck={() => setFactOpen(true)} />}
        <SlashMenu controller={controller} />

        {editor && studio && (
          <Studio
            key={studio.key}
            open={studio}
            onClose={() => {
              setStudio(null);
              if (studio.target.type === "new") {
                requestAnimationFrame(() => editor.commands.focus(studio.target.pos, { scrollIntoView: true }));
              }
            }}
            onCommit={(r) => commit(studio, r)}
            getPostContext={getPostContext}
            look={look}
          />
        )}

        {editor && (
          <>
            <FactCheckSheet open={factOpen} onClose={() => setFactOpen(false)} editor={editor} title={title} />
            <BuddyPanel open={buddyOpen} onClose={() => setBuddyOpen(false)} editor={editor} title={title} />
            <PublishSheet
              open={publishOpen}
              onClose={() => setPublishOpen(false)}
              post={{ ...post, title, look: lk.inherited ? null : look }}
              onChange={setPost}
              getText={() => editor.getText()}
              flush={flush}
            />
            <LookSheet
              open={lookOpen}
              onClose={() => setLookOpen(false)}
              look={look}
              inherited={lk.inherited}
              onChange={lk.setLook}
              offLook={lk.offLook}
              restyle={lk.restyle}
              onRestyleAll={lk.restyleAll}
              onCancelRestyle={lk.cancelRestyleAll}
              post={lookPost}
            />
          </>
        )}
      </div>
    </LookContext.Provider>
  );
}

