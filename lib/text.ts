import type { DocNode } from "@/lib/types";

const TEXT_BLOCKS = new Set(["paragraph", "heading"]);

function inlineText(node: DocNode): string {
  if (node.type === "hardBreak") return "\n";
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(inlineText).join("");
}

/**
 * Plain text of every text block (paragraph, heading, code block) in document
 * order, descending into lists and blockquotes. Generated blocks (genBlock) are
 * skipped. Empty blocks are dropped.
 */
function collect(node: DocNode, out: string[], includeCode: boolean): void {
  if (TEXT_BLOCKS.has(node.type) || (includeCode && node.type === "codeBlock")) {
    const t = inlineText(node).trim();
    if (t) out.push(t);
    return;
  }
  if (node.type === "genBlock" || node.type === "codeBlock") return;
  for (const child of node.content ?? []) collect(child, out, includeCode);
}

/**
 * One string per text block (paragraph or heading), descending into list items
 * and blockquotes. Code blocks and genBlocks are excluded. Empty blocks dropped.
 * The index into this array is the `i` used by the writing buddy.
 */
export function docToParagraphs(doc: DocNode): string[] {
  const out: string[] = [];
  collect(doc, out, false);
  return out;
}

/** Plain text of the whole document, blocks separated by a blank line; includes code blocks. */
export function docToText(doc: DocNode): string {
  const out: string[] = [];
  collect(doc, out, true);
  return out.join("\n\n");
}

/** Estimated reading time in whole minutes (>= 1), ~220 words per minute. */
export function readingMinutes(doc: DocNode): number {
  const words = docToText(doc).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}
