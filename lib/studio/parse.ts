// Studio replies are plain text: a short note plus exactly one fenced code block
// holding the full, current artifact. This parser is shared by client and server.

export interface Artifact {
  note: string; // text outside the fence, trimmed
  language: string;
  filename?: string;
  code: string;
  /** false while the closing fence hasn't streamed in yet */
  complete: boolean;
}

/** Extracts the last fenced block from (possibly still streaming) assistant text. */
export function extractArtifact(text: string): Artifact | null {
  const open = /```([\w+#.-]*)[ \t]*(?:title="([^"\n]*)")?[^\n]*\n/g;
  let m: RegExpExecArray | null;
  let last: { start: number; bodyStart: number; lang: string; file?: string } | null = null;
  let pos = 0;
  // Walk fences in order so a closing ``` is never mistaken for an opener.
  while ((m = open.exec(text)) && m.index >= pos) {
    const bodyStart = m.index + m[0].length;
    last = { start: m.index, bodyStart, lang: m[1] || "text", file: m[2] || undefined };
    const close = text.indexOf("\n```", bodyStart - 1);
    if (close === -1) break;
    pos = close + 4;
    open.lastIndex = pos;
  }
  if (!last) return null;
  const close = text.indexOf("\n```", last.bodyStart - 1);
  const complete = close !== -1;
  const code = complete ? text.slice(last.bodyStart, close) : text.slice(last.bodyStart);
  const after = complete ? text.slice(close + 4) : "";
  const note = (text.slice(0, last.start) + "\n" + after).trim();
  return { note, language: last.lang, filename: last.file, code, complete };
}
