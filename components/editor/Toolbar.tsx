"use client";

import { useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import Sheet from "@/components/ui/Sheet";
import { triggerSlash } from "./slash";
import { useCoarsePointer, useViewport } from "./useViewport";
import styles from "./Toolbar.module.css";

type Btn = {
  id: string;
  label: React.ReactNode;
  title: string;
  active?: boolean;
  disabled?: boolean;
  run: () => void;
};

const icon = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function renderBtn(b: Btn, hidden: boolean) {
  return (
    <button
      key={b.id}
      type="button"
      title={b.title}
      aria-label={b.title}
      aria-pressed={b.active ?? undefined}
      disabled={b.disabled}
      tabIndex={hidden ? -1 : 0}
      className={`${styles.btn} ${b.active ? styles.active : ""}`}
      // Keep the editor's selection: the tap must not move focus.
      onPointerDown={(e) => e.preventDefault()}
      onClick={b.run}
    >
      {b.label}
    </button>
  );
}

export default function Toolbar({ editor, onCheck }: { editor: Editor; onCheck(): void }) {
  const coarse = useCoarsePointer();
  const vp = useViewport();
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");

  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      focused: e.isFocused,
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      link: e.isActive("link"),
      h2: e.isActive("heading", { level: 2 }),
      ul: e.isActive("bulletList"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const openLink = () => {
    const current = (editor.getAttributes("link").href as string | undefined) ?? "";
    setHref(current);
    setLinkOpen(true);
  };

  const applyLink = () => {
    let url = href.trim();
    setLinkOpen(false);
    const chain = editor.chain().focus();
    if (!url) {
      chain.extendMarkRange("link").unsetLink().run();
      return;
    }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("/") && !url.startsWith("#")) url = "https://" + url;
    if (editor.state.selection.empty && !editor.isActive("link")) {
      chain
        .insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] })
        .unsetMark("link")
        .run();
    } else {
      chain.extendMarkRange("link").setLink({ href: url }).run();
    }
  };

  // Pinned first: the only controls reachable while text is selected on a phone.
  const pinned: Btn[] = [
    { id: "slash", label: <span className={styles.slash}>/</span>, title: "Insert", run: () => triggerSlash(editor) },
    { id: "check", label: <span className={styles.check}>Check</span>, title: "Fact-check the selection", run: onCheck },
  ];
  const buttons: Btn[] = [
    { id: "bold", label: <b>B</b>, title: "Bold", active: st.bold, run: () => editor.chain().focus().toggleBold().run() },
    { id: "italic", label: <i>I</i>, title: "Italic", active: st.italic, run: () => editor.chain().focus().toggleItalic().run() },
    {
      id: "link",
      label: icon("M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"),
      title: "Link",
      active: st.link,
      run: openLink,
    },
    { id: "h2", label: <span className={styles.text}>H2</span>, title: "Heading", active: st.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    {
      id: "ul",
      label: icon("M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"),
      title: "Bullet list",
      active: st.ul,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    { id: "undo", label: icon("M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"), title: "Undo", disabled: !st.canUndo, run: () => editor.chain().focus().undo().run() },
    { id: "redo", label: icon("m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13"), title: "Redo", disabled: !st.canRedo, run: () => editor.chain().focus().redo().run() },
  ];

  const hidden = coarse && !st.focused;
  const style: React.CSSProperties | undefined = coarse ? { bottom: vp.keyboard } : undefined;

  return (
    <>
      <div
        className={`${styles.bar} ${coarse ? styles.floating : styles.static} ${hidden ? styles.hidden : ""}`}
        style={style}
        role="toolbar"
        aria-label="Formatting"
        aria-hidden={hidden || undefined}
      >
        <div className={styles.inner}>
          <div className={styles.pinned}>{pinned.map((b) => renderBtn(b, hidden))}</div>
          <div className={styles.scroller}>{buttons.map((b) => renderBtn(b, hidden))}</div>
        </div>
      </div>
      <Sheet open={linkOpen} onClose={() => setLinkOpen(false)} title="Link">
        <form
          className={styles.linkForm}
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input
            className={styles.linkInput}
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            autoFocus
          />
          <div className={styles.linkActions}>
            {st.link && (
              <button
                type="button"
                className={styles.linkGhost}
                onClick={() => {
                  setLinkOpen(false);
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                }}
              >
                Remove link
              </button>
            )}
            <button type="submit" className={styles.linkPrimary}>
              Apply
            </button>
          </div>
        </form>
      </Sheet>
    </>
  );
}
