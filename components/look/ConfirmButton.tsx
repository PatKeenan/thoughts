"use client";

import { useEffect, useState } from "react";

/** Inline two-step confirm: first tap arms it, the second does it; reverts after 3 s. */
export default function ConfirmButton({
  label,
  armedLabel,
  onConfirm,
  className,
  armedClassName,
  disabled,
}: {
  label: string;
  armedLabel: string;
  onConfirm(): void;
  className?: string;
  armedClassName?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      disabled={disabled}
      className={`${className ?? ""} ${armed ? (armedClassName ?? "") : ""}`.trim()}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? armedLabel : label}
    </button>
  );
}
