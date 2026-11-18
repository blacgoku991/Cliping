"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { buttonClass, cx } from "../ui";

/** Copie un texte dans le presse-papiers (avec repli pour les navigateurs sans API Clipboard). */
export function CopyButton({ text, label = "Copier", className, compact = false }: { text: string; label?: string; className?: string; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (!ok) throw new Error("copie refusée");
      }
      setState("done");
    } catch {
      setState("fail");
    }
  }

  const text_ = state === "done" ? "Copié" : state === "fail" ? "Sélectionne et copie" : label;
  return (
    <button
      type="button"
      onClick={copy}
      className={cx(buttonClass({ variant: "secondary", size: "sm" }), compact && "px-2", className)}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
    >
      {state === "done" ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      {compact && state === "idle" ? null : <span aria-live="polite">{text_}</span>}
    </button>
  );
}
