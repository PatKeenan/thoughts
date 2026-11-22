import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { GenBlockAttrs } from "@/lib/types";
import GenBlockView from "./GenBlockView";

export interface GenOpenRequest {
  attrs: GenBlockAttrs;
  /** Document position of the node when the request was made. */
  pos: number;
  /** Re-run the last user request straight away. */
  regenerate: boolean;
}

export interface GenBlockOptions {
  onOpen: (req: GenOpenRequest) => void;
}

function readGen(el: HTMLElement): Partial<GenBlockAttrs> {
  try {
    const raw = el.getAttribute("data-gen");
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as Partial<GenBlockAttrs>) : {};
  } catch {
    return {};
  }
}

export const GenBlock = Node.create<GenBlockOptions>({
  name: "genBlock",
  group: "block",
  atom: true,
  draggable: false,
  selectable: true,

  addOptions() {
    return { onOpen: () => {} };
  },

  addAttributes() {
    const attr = <K extends keyof GenBlockAttrs>(key: K, fallback: GenBlockAttrs[K]) => ({
      default: fallback,
      parseHTML: (el: HTMLElement) => readGen(el)[key] ?? fallback,
      renderHTML: () => ({}),
    });
    return {
      id: attr("id", ""),
      kind: attr("kind", "code"),
      data: attr("data", {}),
      history: attr("history", []),
    };
  },

  parseHTML() {
    return [{ tag: "div[data-gen]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-gen": JSON.stringify(node.attrs) })];
  },

  renderText({ node }) {
    const a = node.attrs as GenBlockAttrs;
    if (a.kind === "code") return String((a.data as { code?: string }).code ?? "");
    if (a.kind === "repo") return String((a.data as { fullName?: string }).fullName ?? "");
    return "";
  },

  addNodeView() {
    return ReactNodeViewRenderer(GenBlockView);
  },
});

/** Find a genBlock by id, preferring the node at `hint` when it matches. */
export function findGenBlock(doc: PMNode, id: string, hint?: number): { pos: number; node: PMNode } | null {
  if (hint != null && hint >= 0 && hint < doc.content.size) {
    const n = doc.nodeAt(hint);
    if (n && n.type.name === "genBlock" && n.attrs.id === id) return { pos: hint, node: n };
  }
  let found: { pos: number; node: PMNode } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "genBlock" && node.attrs.id === id) {
      found = { pos, node };
      return false;
    }
    return true;
  });
  return found;
}
