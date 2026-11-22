import type { Editor } from "@tiptap/core";
import type { GenBlockAttrs } from "@/lib/types";
import { findGenBlock } from "./GenBlock";

/**
 * Insert a genBlock at `pos` (where the slash command was typed).
 * - empty top-level paragraph: replaced by [block, empty paragraph]
 * - end of a paragraph: [block, empty paragraph] after it
 * - start of a paragraph: block before it
 * - middle of a paragraph: the paragraph is split around the block
 * - inside lists/quotes: after the top-level ancestor
 * Leaves the caret in the paragraph after the block. Returns the block's position.
 */
export function insertGenBlock(editor: Editor, pos: number, attrs: GenBlockAttrs): number {
  const doc = editor.state.doc;
  const p = Math.max(0, Math.min(pos, doc.content.size));
  const $p = doc.resolve(p);
  const block = { type: "genBlock", attrs };
  const para = { type: "paragraph" };

  if ($p.depth === 1 && $p.parent.isTextblock) {
    const parent = $p.parent;
    if (parent.content.size === 0) {
      const from = $p.before();
      editor
        .chain()
        .insertContentAt({ from, to: $p.after() }, [block, para], { updateSelection: false })
        .setTextSelection(from + 2)
        .run();
      return from;
    }
    if ($p.parentOffset === parent.content.size) {
      const at = $p.after();
      editor.chain().insertContentAt(at, [block, para], { updateSelection: false }).setTextSelection(at + 2).run();
      return at;
    }
    if ($p.parentOffset === 0) {
      const at = $p.before();
      editor.chain().insertContentAt(at, block, { updateSelection: false }).setTextSelection(at + 2).run();
      return at;
    }
    // Split the paragraph, then drop the block between the halves.
    const at = p + 1;
    editor
      .chain()
      .setTextSelection(p)
      .splitBlock({ keepMarks: false })
      .insertContentAt(at, block, { updateSelection: false })
      .setTextSelection(at + 2)
      .run();
    return at;
  }

  // Nested (list item, blockquote) or between blocks: after the top-level ancestor.
  const at = $p.depth >= 1 ? $p.after(1) : p;
  editor.chain().insertContentAt(at, [block, para], { updateSelection: false }).setTextSelection(at + 2).run();
  return at;
}

/** Update an existing block's attrs (found by id). Returns its position, or null if it's gone. */
export function updateGenBlock(
  editor: Editor,
  id: string,
  hint: number,
  patch: Pick<GenBlockAttrs, "kind" | "data" | "history">,
): number | null {
  const found = findGenBlock(editor.state.doc, id, hint);
  if (!found) return null;
  const { pos, node } = found;
  editor
    .chain()
    .command(({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
      return true;
    })
    .run();
  return pos;
}

/**
 * Merge `patch` into the `data` of the genBlock with this id, wherever it is now
 * (for async results such as renders; the position may have moved meanwhile).
 * No-op (returns false) if the block is gone, the editor is destroyed, or
 * `guard` rejects the block's current data (e.g. its code changed since).
 * Kept out of undo history so undo never strips a finished render.
 */
export function patchGenBlockData(
  editor: Editor,
  id: string,
  patch: Record<string, unknown>,
  guard?: (data: Record<string, unknown>) => boolean,
): boolean {
  if (editor.isDestroyed || !id) return false;
  const found = findGenBlock(editor.state.doc, id);
  if (!found) return false;
  const data = (found.node.attrs.data ?? {}) as Record<string, unknown>;
  if (guard && !guard(data)) return false;
  const tr = editor.state.tr
    .setNodeMarkup(found.pos, undefined, { ...found.node.attrs, data: { ...data, ...patch } })
    .setMeta("addToHistory", false);
  editor.view.dispatch(tr);
  return true;
}

/**
 * Replace the data (and optionally history) of the genBlock with this id, wherever it is now.
 * Unlike patchGenBlockData this is undoable (restyles are edits the author asked for).
 * No-op (false) if the block is gone, the editor is destroyed, or `guard` rejects its current data.
 */
export function replaceGenBlock(
  editor: Editor,
  id: string,
  next: { data: Record<string, unknown>; history?: GenBlockAttrs["history"] },
  guard?: (data: Record<string, unknown>) => boolean,
): boolean {
  if (editor.isDestroyed || !id) return false;
  const found = findGenBlock(editor.state.doc, id);
  if (!found) return false;
  const data = (found.node.attrs.data ?? {}) as Record<string, unknown>;
  if (guard && !guard(data)) return false;
  const attrs = { ...found.node.attrs, data: next.data, ...(next.history ? { history: next.history } : {}) };
  editor.view.dispatch(editor.state.tr.setNodeMarkup(found.pos, undefined, attrs));
  return true;
}

export function scrollToBlock(editor: Editor, pos: number) {
  const dom = editor.view.nodeDOM(pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "center", behavior: "smooth" });
}
