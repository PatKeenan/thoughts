"use client";

import { useEffect, useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type { CodeData, GenBlockAttrs, ImageData, MotionData, RepoData } from "@/lib/types";
import type { GenBlockOptions } from "./GenBlock";
import CodeView from "./CodeView";
import RepoView from "./RepoView";
import { ImageView, MotionView } from "./MediaView";
import styles from "./GenBlockView.module.css";

export default function GenBlockView({ node, getPos, deleteNode, extension, selected, editor }: ReactNodeViewProps) {
  const attrs = node.attrs as GenBlockAttrs;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const options = extension.options as GenBlockOptions;

  useEffect(() => {
    if (!confirmRemove) return;
    const t = setTimeout(() => setConfirmRemove(false), 3000);
    return () => clearTimeout(t);
  }, [confirmRemove]);

  const open = (regenerate: boolean) => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    options.onOpen({ attrs, pos: pos ?? -1, regenerate });
  };

  const aiKind = attrs.kind === "code" || attrs.kind === "image" || attrs.kind === "motion";
  const canRegenerate = aiKind && (attrs.history ?? []).some((m) => m.role === "user");

  const media = (attrs.data ?? {}) as Record<string, unknown>;
  let body: React.ReactNode;
  if (attrs.kind === "code" && typeof (attrs.data as CodeData).code === "string") {
    body = <CodeView data={attrs.data as CodeData} />;
  } else if (attrs.kind === "repo" && typeof (attrs.data as RepoData).fullName === "string") {
    body = <RepoView data={attrs.data as RepoData} />;
  } else if (attrs.kind === "image" && typeof media.url === "string" && media.url) {
    body = <ImageView data={media as unknown as ImageData} />;
  } else if (attrs.kind === "motion" && typeof media.output === "string") {
    body = <MotionView data={media as unknown as MotionData} id={attrs.id} editor={editor} />;
  } else {
    body = <div className={styles.unknown}>Unsupported block</div>;
  }

  return (
    <NodeViewWrapper
      className={`${styles.wrap} ${selected ? styles.selected : ""}`}
      data-gen-id={attrs.id}
      contentEditable={false}
    >
      {body}
      <div className={styles.actions}>
        {aiKind && (
          <button type="button" className={styles.action} onClick={() => open(false)}>
            Edit with AI
          </button>
        )}
        {attrs.kind === "repo" && (
          <button type="button" className={styles.action} onClick={() => open(false)}>
            Change
          </button>
        )}
        {canRegenerate && (
          <button type="button" className={styles.action} onClick={() => open(true)}>
            Regenerate
          </button>
        )}
        <span className={styles.spacer} />
        <button
          type="button"
          className={`${styles.action} ${confirmRemove ? styles.danger : ""}`}
          onClick={() => {
            if (confirmRemove) deleteNode();
            else setConfirmRemove(true);
          }}
        >
          {confirmRemove ? "Tap to remove" : "Remove"}
        </button>
      </div>
    </NodeViewWrapper>
  );
}
