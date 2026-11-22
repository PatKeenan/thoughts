import type { Node as PMNode } from "@tiptap/pm/model";
import { textOffsetToRange } from "@/components/buddy/positions";

export const MAX_CLAIM = 600;
const MAX_CONTEXT = 1500;

export interface Capture {
  from: number;
  to: number;
  /** Exact doc text of [from,to) as read with textBetween(…, " "); used to re-validate. */
  raw: string;
  claim: string;
  context: string;
  tooLong: boolean;
  /** True when the range came from the sentence-around-caret fallback (caller may select it). */
  fromCaret: boolean;
}

/** Text of the range with the same convention used everywhere here. */
export function rangeText(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(from, to, " ");
}

/** Split text into sentences: [start,end) offsets, end excluding trailing whitespace. */
export function sentenceSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const re = /[.!?]+["'’”)\]]*(?=\s)/g;
  let start = 0;
  let m: RegExpExecArray | null;
  const push = (s: number, e: number) => {
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) spans.push({ start: s, end: e });
  };
  while ((m = re.exec(text))) {
    push(start, m.index + m[0].length);
    start = m.index + m[0].length;
  }
  push(start, text.length);
  return spans;
}

function trimRange(doc: PMNode, from: number, to: number): { from: number; to: number; text: string } {
  const raw = rangeText(doc, from, to);
  const lead = raw.length - raw.trimStart().length;
  const trail = raw.length - raw.trimEnd().length;
  const text = raw.trim();
  if (!text) return { from, to, text };
  // Positions map 1:1 to characters only within a single textblock of plain text.
  if (doc.resolve(from).sameParent(doc.resolve(to))) {
    return { from: from + lead, to: to - trail, text };
  }
  return { from, to, text };
}

/** The sentence containing `pos` within its textblock, as a document range. */
export function sentenceAround(doc: PMNode, pos: number): { from: number; to: number } | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  const block = $pos.parent;
  if (!block.isTextblock || block.type.spec.code) return null;
  const blockPos = $pos.before();
  const text = block.textBetween(0, block.content.size, "");
  if (!text.trim()) return null;
  const caret = block.textBetween(0, $pos.parentOffset, "").length;
  const spans = sentenceSpans(text);
  if (spans.length === 0) return null;
  let chosen = spans[0];
  for (const s of spans) {
    if (s.start <= caret) chosen = s;
    else break;
  }
  return textOffsetToRange(block, blockPos, chosen.start, chosen.end);
}

function contextFor(doc: PMNode, pos: number): string {
  const $pos = doc.resolve(pos);
  const block = $pos.parent;
  const text = block.isTextblock ? block.textBetween(0, block.content.size, "") : "";
  return text.length > MAX_CONTEXT ? text.slice(0, MAX_CONTEXT) : text;
}

/**
 * Work out what to fact-check from a selection. Empty selection: the sentence around the caret.
 * Returns null when there is nothing to check.
 */
export function captureClaim(doc: PMNode, selFrom: number, selTo: number): Capture | null {
  let from = Math.min(selFrom, selTo);
  let to = Math.max(selFrom, selTo);
  let fromCaret = false;
  if (from === to) {
    const r = sentenceAround(doc, from);
    if (!r) return null;
    from = r.from;
    to = r.to;
    fromCaret = true;
  }
  const t = trimRange(doc, from, to);
  if (!t.text) return null;
  const raw = rangeText(doc, t.from, t.to);
  return {
    from: t.from,
    to: t.to,
    raw,
    claim: t.text,
    context: contextFor(doc, t.from),
    tooLong: t.text.length > MAX_CLAIM,
    fromCaret,
  };
}

/** True if the document still holds exactly `expected` at [from,to). */
export function rangeStillMatches(doc: PMNode, from: number, to: number, expected: string): boolean {
  if (from < 0 || to > doc.content.size || from >= to) return false;
  return rangeText(doc, from, to) === expected;
}
