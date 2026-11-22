"use client";

import { useSyncExternalStore } from "react";

export interface ViewportInfo {
  /** visible height (visualViewport.height) */
  height: number;
  /** visualViewport.offsetTop within the layout viewport */
  offsetTop: number;
  /** pixels at the bottom of the layout viewport hidden behind the on-screen keyboard */
  keyboard: number;
}

const SERVER: ViewportInfo = { height: 0, offsetTop: 0, keyboard: 0 };
let snapshot: ViewportInfo = SERVER;

function read(): ViewportInfo {
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  const offsetTop = vv ? vv.offsetTop : 0;
  const keyboard = Math.max(0, Math.round(window.innerHeight - height - offsetTop));
  if (snapshot.height === height && snapshot.offsetTop === offsetTop && snapshot.keyboard === keyboard) return snapshot;
  snapshot = { height, offsetTop, keyboard };
  return snapshot;
}

function subscribe(cb: () => void) {
  const vv = window.visualViewport;
  const on = () => cb();
  vv?.addEventListener("resize", on);
  vv?.addEventListener("scroll", on);
  window.addEventListener("resize", on);
  return () => {
    vv?.removeEventListener("resize", on);
    vv?.removeEventListener("scroll", on);
    window.removeEventListener("resize", on);
  };
}

/** Live visualViewport metrics, for pinning things above the on-screen keyboard. */
export function useViewport(): ViewportInfo {
  return useSyncExternalStore(subscribe, read, () => SERVER);
}

function subscribeCoarse(cb: () => void) {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True on touch-first devices (phones/tablets). */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}
