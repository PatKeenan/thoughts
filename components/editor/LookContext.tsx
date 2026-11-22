"use client";

// The post's look, shared with Tiptap node views (which can't take props) and the studio.

import { createContext, useContext } from "react";
import type { Look } from "@/lib/types";

/** Per-block async work started from the block footer or "Restyle all". */
export type BlockBusy =
  | { type: "capture" }
  | { type: "restyle"; label: string; progress: number }
  | { type: "error"; message: string };

export interface LookCtx {
  /** The effective look (post look, else the site default). */
  look: Look | null;
  /** The look is the site default; the post has none of its own. */
  inherited: boolean;
  setLook(look: Look | null): void;
  offLookIds: ReadonlySet<string>;
  /** Restyle one block (per-block button; clips included). */
  restyleBlock(id: string): void;
  cancelBlock(id: string): void;
  /** "Use as the look": read the look from this block and set it. */
  captureFrom(blockId: string): void;
  busy: Readonly<Record<string, BlockBusy>>;
  dismissBlockError(id: string): void;
}

const noop = () => {};

export const NO_LOOK: LookCtx = {
  look: null,
  inherited: false,
  setLook: noop,
  offLookIds: new Set(),
  restyleBlock: noop,
  cancelBlock: noop,
  captureFrom: noop,
  busy: {},
  dismissBlockError: noop,
};

export const LookContext = createContext<LookCtx>(NO_LOOK);

export function useLook(): LookCtx {
  return useContext(LookContext);
}
