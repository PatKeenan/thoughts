import type { Node as PMNode } from "@tiptap/pm/model";

export interface CollectedBlock {
  /** Sequential index among the collected (non-empty, non-code, non-genBlock) textblocks. */
  i: number;
  /** Document position of the start of the textblock node (before its opening token). */
  pos: number;
  text: string;
}

/**
 * Every non-empty textblock that is not a code block and not inside a genBlock,
 * numbered 0,1,2... in document order.
 */
export function collectBlocks(doc: PMNode): CollectedBlock[] {
  const out: CollectedBlock[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "genBlock") return false;
    if (node.isTextblock) {
      if (node.type.spec.code) return false;
      const text = node.textContent;
      if (text.trim().length > 0) out.push({ i: out.length, pos, text });
      return false;
    }
    return true;
  });
  return out;
}

export function collectParagraphs(doc: PMNode): {
  paragraphs: { i: number; text: string }[];
  positions: Map<number, number>;
} {
  const blocks = collectBlocks(doc);
  return {
    paragraphs: blocks.map((b) => ({ i: b.i, text: b.text })),
    positions: new Map(blocks.map((b) => [b.i, b.pos])),
  };
}

/**
 * Map a [start,end) range of a textblock's textContent to absolute document positions.
 * Walks the inline children so marks (which split text nodes) and inline leaf nodes
 * (hard breaks) are accounted for: a child contributes however many characters it
 * adds to `textContent` (a leaf without leafText adds 0 but still occupies 1 position).
 */
export function textOffsetToRange(
  block: PMNode,
  blockPos: number,
  start: number,
  end: number,
): { from: number; to: number } | null {
  if (start < 0 || end < start) return null;
  const base = blockPos + 1; // inside the block
  let textOffset = 0;
  let from = -1;
  let to = -1;
  let childPos = 0;
  for (let k = 0; k < block.childCount; k++) {
    const child = block.child(k);
    const chunk = block.textBetween(childPos, childPos + child.nodeSize, "");
    const len = chunk.length;
    const chunkStart = textOffset;
    const chunkEnd = textOffset + len;
    if (len > 0) {
      const atomic = !child.isText;
      if (from < 0 && start >= chunkStart && start < chunkEnd) {
        from = base + childPos + (atomic ? 0 : start - chunkStart);
      }
      if (to < 0 && end > chunkStart && end <= chunkEnd) {
        to = base + childPos + (atomic ? child.nodeSize : end - chunkStart);
      }
    }
    textOffset = chunkEnd;
    childPos += child.nodeSize;
  }
  // start == end == total length (insertion at very end) is not a valid quote; ignore.
  if (from < 0 || to < 0 || to < from) return null;
  return { from, to };
}

/**
 * Find `quote` in the current document. Prefers the block with index `preferredIndex`;
 * otherwise the containing block nearest to `hintPos` (or the first one).
 */
export function locateQuote(
  doc: PMNode,
  quote: string,
  preferredIndex: number,
  hintPos?: number,
): { from: number; to: number; index: number } | null {
  if (!quote) return null;
  const blocks = collectBlocks(doc).filter((b) => b.text.includes(quote));
  if (blocks.length === 0) return null;
  let chosen = blocks.find((b) => b.i === preferredIndex);
  if (!chosen) {
    chosen = blocks[0];
    if (hintPos !== undefined) {
      for (const b of blocks) {
        if (Math.abs(b.pos - hintPos) < Math.abs(chosen.pos - hintPos)) chosen = b;
      }
    }
  }
  const node = doc.nodeAt(chosen.pos);
  if (!node) return null;
  const idx = chosen.text.indexOf(quote);
  const range = textOffsetToRange(node, chosen.pos, idx, idx + quote.length);
  return range ? { ...range, index: chosen.i } : null;
}
