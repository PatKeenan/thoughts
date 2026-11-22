// Slash menu: a tiny external store driven by @tiptap/suggestion, rendered by SlashMenu.tsx.
import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { exitSuggestion, type SuggestionProps, type SuggestionKeyDownProps } from "@tiptap/suggestion";

export type ToolKind = "code" | "github" | "image" | "motion";

export interface SlashItem {
  id: string;
  label: string;
  hint: string;
  keywords: string[];
  disabled?: boolean;
  tool?: ToolKind;
  /** Non-studio actions handled by the editor screen. */
  action?: "fact";
  run?: (editor: Editor, range: Range) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: "code",
    label: "Code snippet",
    hint: "Generate or paste code, refine by chat",
    keywords: ["code", "snippet", "ai", "generate"],
    tool: "code",
  },
  {
    id: "image",
    label: "Image",
    hint: "Generate an illustration, refine by chat",
    keywords: ["image", "picture", "illustration", "drawing"],
    tool: "image",
  },
  {
    id: "motion",
    label: "Motion graphic",
    hint: "Animate an idea; loop, GIF or video",
    keywords: ["motion", "animation", "animate", "video", "gif"],
    tool: "motion",
  },
  {
    id: "github",
    label: "GitHub",
    hint: "Pull code or a repo from GitHub",
    keywords: ["github", "repo", "gh", "git"],
    tool: "github",
  },
  {
    id: "fact",
    label: "Fact-check",
    hint: "Check the sentence you're in",
    keywords: ["fact", "check", "verify", "claim"],
    action: "fact",
  },
  {
    id: "h2",
    label: "Heading",
    hint: "Section title",
    keywords: ["heading", "h2", "title"],
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run(),
  },
  {
    id: "h3",
    label: "Subheading",
    hint: "Smaller section title",
    keywords: ["subheading", "h3"],
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 3 }).run(),
  },
  {
    id: "quote",
    label: "Quote",
    hint: "Block quotation",
    keywords: ["quote", "blockquote"],
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("paragraph").toggleBlockquote().run(),
  },
  {
    id: "ul",
    label: "Bullet list",
    hint: "Unordered list",
    keywords: ["bullet", "list", "ul"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    id: "ol",
    label: "Numbered list",
    hint: "Ordered list",
    keywords: ["numbered", "ordered", "list", "ol"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    id: "hr",
    label: "Divider",
    hint: "Horizontal rule",
    keywords: ["divider", "rule", "hr", "line"],
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
];

export function filterItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (it) =>
      it.label.toLowerCase().startsWith(q) ||
      it.label.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) ||
      it.keywords.some((k) => k.startsWith(q)),
  );
}

export interface SlashState {
  open: boolean;
  items: SlashItem[];
  selected: number;
  rect: { top: number; bottom: number; left: number } | null;
}

const CLOSED: SlashState = { open: false, items: [], selected: 0, rect: null };

function firstEnabled(items: SlashItem[], from = 0, dir = 1): number {
  const n = items.length;
  for (let k = 0; k < n; k++) {
    const i = (((from + k * dir) % n) + n) % n;
    if (!items[i].disabled) return i;
  }
  return -1;
}

/** A late-bound callback: extensions are created once, React handlers are set in effects. */
export class Handler<T> {
  private fn: (arg: T) => void = () => {};
  set(fn: (arg: T) => void) {
    this.fn = fn;
  }
  call(arg: T) {
    this.fn(arg);
  }
}

/** External store bridging the suggestion plugin and React. */
export class SlashController {
  state: SlashState = CLOSED;
  /** Set by the editor screen: open the Studio for a tool at a doc position. */
  readonly tool = new Handler<{ tool: ToolKind; pos: number }>();
  /** Set by the editor screen: open the fact-check sheet for the current selection. */
  readonly fact = new Handler<void>();
  private listeners = new Set<() => void>();
  private props: SuggestionProps<SlashItem, SlashItem> | null = null;
  private editor: Editor | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.state;

  private set(next: SlashState) {
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  private rectOf(props: SuggestionProps<SlashItem, SlashItem>) {
    const r = props.clientRect?.();
    return r ? { top: r.top, bottom: r.bottom, left: r.left } : null;
  }

  update(props: SuggestionProps<SlashItem, SlashItem>) {
    this.props = props;
    this.editor = props.editor;
    const items = props.items;
    const same = this.state.open && this.state.items.length === items.length && this.state.items.every((it, i) => it === items[i]);
    const selected = same ? this.state.selected : Math.max(0, firstEnabled(items));
    this.set({ open: true, items, selected, rect: this.rectOf(props) });
  }

  /** Re-read the caret rect (on viewport scroll/resize). */
  reposition() {
    if (!this.props || !this.state.open) return;
    this.set({ ...this.state, rect: this.rectOf(this.props) });
  }

  exit() {
    this.props = null;
    this.set(CLOSED);
  }

  close() {
    if (this.editor && this.state.open) exitSuggestion(this.editor.view, slashKey);
    this.exit();
  }

  hover(i: number) {
    if (this.state.items[i] && !this.state.items[i].disabled) this.set({ ...this.state, selected: i });
  }

  choose(i: number) {
    const item = this.state.items[i];
    if (!item || item.disabled || !this.props) return;
    this.props.command(item);
  }

  keyDown({ event }: SuggestionKeyDownProps): boolean {
    const { items, selected, open } = this.state;
    if (!open) return false;
    if (event.key === "Escape") {
      this.exit();
      return true;
    }
    if (!items.length || firstEnabled(items) === -1) return false;
    if (event.key === "ArrowDown") {
      this.set({ ...this.state, selected: firstEnabled(items, selected + 1, 1) });
      return true;
    }
    if (event.key === "ArrowUp") {
      this.set({ ...this.state, selected: firstEnabled(items, selected - 1, -1) });
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      this.choose(selected);
      return true;
    }
    return false;
  }
}

export const slashKey = new PluginKey("slash");

export const SlashCommand = Extension.create<{ controller: SlashController | null }>({
  name: "slashCommand",

  addOptions() {
    return { controller: null };
  },

  addProseMirrorPlugins() {
    const controller = this.options.controller;
    if (!controller) return [];
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashKey,
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        allowedPrefixes: [" ", " "],
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          // Not inside code blocks.
          return $from.parent.type.name !== "codeBlock";
        },
        items: ({ query }) => filterItems(query),
        command: ({ editor, range, props: item }) => {
          if (item.disabled) return;
          if (item.run) {
            item.run(editor, range);
            return;
          }
          if (item.action === "fact") {
            // Drop the typed "/query"; the sheet falls back to the sentence around the caret.
            editor.chain().focus().deleteRange(range).run();
            editor.commands.blur();
            controller.fact.call();
            return;
          }
          if (item.tool) {
            editor.chain().focus().deleteRange(range).run();
            const pos = editor.state.selection.from;
            editor.commands.blur();
            controller.tool.call({ tool: item.tool, pos });
          }
        },
        render: () => ({
          onStart: (props) => controller.update(props),
          onUpdate: (props) => controller.update(props),
          onExit: () => controller.exit(),
          onKeyDown: (props) => controller.keyDown(props),
        }),
      }),
    ];
  },
});

/** Insert a "/" at the caret (with a leading space when needed) to open the menu. */
export function triggerSlash(editor: Editor) {
  const { state } = editor;
  const { $from, empty } = state.selection;
  const before = empty ? $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, "\n", "\n") : "";
  const needsSpace = before !== "" && !/\s/.test(before);
  editor
    .chain()
    .focus()
    .insertContent(needsSpace ? " /" : "/")
    .run();
}
