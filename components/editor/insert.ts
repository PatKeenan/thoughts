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

export function scrollToBlock(editor: Editor, pos: number) {
  const dom = editor.view.nodeDOM(pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "center", behavior: "smooth" });
}
