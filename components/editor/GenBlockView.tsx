"use client";

import { useEffect, useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { isOffLook } from "@/lib/look";
import { captureSource, restyleKindOf, sameStamp } from "@/lib/client/studio";
import type { CodeData, GenBlockAttrs, ImageData, LookStamp, MotionData, RepoData } from "@/lib/types";
import type { GenBlockOptions } from "./GenBlock";
import CodeView from "./CodeView";
import RepoView from "./RepoView";
import { ImageView, JobRow, MotionView } from "./MediaView";
import { useLook } from "./LookContext";
import styles from "./GenBlockView.module.css";

/** A button that needs a second tap within 3 s. */
function useConfirm(): [boolean, (on: boolean) => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return [armed, setArmed];
}

export default function GenBlockView({ node, getPos, deleteNode, extension, selected, editor }: ReactNodeViewProps) {
  const attrs = node.attrs as GenBlockAttrs;
  const [confirmRemove, setConfirmRemove] = useConfirm();
  const [confirmClip, setConfirmClip] = useConfirm();
  const [more, setMore] = useState(false);
  const options = extension.options as GenBlockOptions;
  const lk = useLook();
  const busy = lk.busy[attrs.id];

  const open = (regenerate: boolean) => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    options.onOpen({ attrs, pos: pos ?? -1, regenerate });
  };

  const aiKind = attrs.kind === "code" || attrs.kind === "image" || attrs.kind === "motion";
  const canRegenerate = aiKind && (attrs.history ?? []).some((m) => m.role === "user");

  // ---- look ----
  const stamp = (attrs.data as { look?: LookStamp } | undefined)?.look;
  const rkind = restyleKindOf(attrs.kind, attrs.data);
  const off = !!rkind && isOffLook(stamp, lk.look);
  const matches = !!lk.look && !!stamp && sameStamp(stamp, { id: lk.look.id, version: lk.look.version });
  const canCapture = !!captureSource(attrs.kind, attrs.data) && !matches;
  const working = busy?.type === "restyle" || busy?.type === "capture";

  const media = (attrs.data ?? {}) as Record<string, unknown>;
  let body: React.ReactNode;
  if (attrs.kind === "code" && typeof (attrs.data as CodeData).code === "string") {
    body = <CodeView data={attrs.data as CodeData} />;
  } else if (attrs.kind === "repo" && typeof (attrs.data as RepoData).fullName === "string") {
    body = <RepoView data={attrs.data as RepoData} />;
  } else if (attrs.kind === "image" && typeof media.url === "string" && media.url) {
    body = <ImageView data={media as unknown as ImageData} />;
  } else if (attrs.kind === "motion" && typeof media.output === "string") {
    body = (
      <MotionView data={media as unknown as MotionData} id={attrs.id} editor={editor} hideJob={busy?.type === "restyle"} />
    );
  } else {
    body = <div className={styles.unknown}>Unsupported block</div>;
  }

  const restyle = () => {
    if (rkind === "clip" && !confirmClip) {
      setConfirmClip(true);
      return;
    }
    setConfirmClip(false);
    lk.restyleBlock(attrs.id);
  };

  // Primary actions stay in the row; secondary ones fold behind "More" when the row would crowd.
  const primary: React.ReactNode[] = [];
  const secondary: React.ReactNode[] = [];
  if (aiKind) {
    primary.push(
      <button key="edit" type="button" className={styles.action} onClick={() => open(false)}>
        Edit with AI
      </button>,
    );
  }
  if (attrs.kind === "repo") {
    primary.push(
      <button key="change" type="button" className={styles.action} onClick={() => open(false)}>
        Change
      </button>,
    );
  }
  if (off && !working) {
    primary.push(
      <button
        key="restyle"
        type="button"
        className={`${styles.action} ${confirmClip ? styles.danger : ""}`}
        onClick={restyle}
        title={rkind === "clip" ? "Costs more; the footage will change" : undefined}
      >
        {confirmClip ? "Regenerate clip?" : "Restyle"}
      </button>,
    );
  }
  if (canRegenerate) {
    secondary.push(
      <button key="regen" type="button" className={styles.action} onClick={() => open(true)}>
        Regenerate
      </button>,
    );
  }
  if (canCapture) {
    secondary.push(
      <button
        key="capture"
        type="button"
        className={styles.action}
        disabled={working}
        onClick={() => lk.captureFrom(attrs.id)}
      >
        {busy?.type === "capture" ? "Reading the look…" : "Use as the look"}
      </button>,
    );
  }
  const fold = secondary.length > 0 && primary.length + secondary.length > 2;
  // With Restyle in the row, Remove joins the folded actions so the row fits at 360px.
  const removeInMore = fold && primary.length > 1;
  const removeBtn = (
    <button
      key="remove"
      type="button"
      className={`${styles.action} ${confirmRemove ? styles.danger : ""}`}
      onClick={() => {
        if (confirmRemove) deleteNode();
        else setConfirmRemove(true);
      }}
    >
      {confirmRemove ? "Tap to remove" : "Remove"}
    </button>
  );

  return (
    <NodeViewWrapper
      className={`${styles.wrap} ${selected ? styles.selected : ""}`}
      data-gen-id={attrs.id}
      contentEditable={false}
    >
      <div className={styles.body}>
        {body}
        {off && <span className={styles.offTag}>Off-look</span>}
      </div>
      {busy?.type === "restyle" && (
        <JobRow progress={busy} onCancel={() => lk.cancelBlock(attrs.id)} />
      )}
      {busy?.type === "error" && (
        <JobRow
          error
          message={busy.message}
          actions={
            <button type="button" className={styles.action} onClick={() => lk.dismissBlockError(attrs.id)}>
              Dismiss
            </button>
          }
        />
      )}
      {confirmClip && <p className={styles.hint}>A new clip costs more and the footage will change.</p>}
      <div className={styles.actions}>
        {primary}
        {!fold && secondary}
        {/* The clip confirm is wide: it gets the row to itself while armed. */}
        {fold && !confirmClip && (
          <button
            type="button"
            className={`${styles.action} ${more ? styles.on : ""}`}
            aria-expanded={more}
            onClick={() => setMore((v) => !v)}
          >
            {busy?.type === "capture" ? "Reading…" : more ? "Less" : "More"}
          </button>
        )}
        <span className={styles.spacer} />
        {!removeInMore && !confirmClip && removeBtn}
      </div>
      {fold && more && (
        <div className={`${styles.actions} ${styles.moreRow}`}>
          {secondary}
          {removeInMore && (
            <>
              <span className={styles.spacer} />
              {removeBtn}
            </>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}
