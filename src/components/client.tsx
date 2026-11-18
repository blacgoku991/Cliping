"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button, cx } from "./ui";

/** Rafraîchit les données serveur de la page à intervalle régulier (tant que l'onglet est visible). */
export function AutoRefresh({ seconds = 8 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

/** Demande confirmation avant d'envoyer le formulaire parent (suppression, etc.). */
export function ConfirmButton({ message, children, ...props }: ComponentProps<typeof Button> & { message: string }) {
  const status = useFormStatus();
  return (
    <Button
      type="submit"
      {...props}
      disabled={status.pending || props.disabled}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}

/** Date/heure affichée dans le fuseau du navigateur (le serveur ne connaît pas celui de l'utilisateur). */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));
  }, [iso]);
  return (
    <time dateTime={iso} className={cx(className)} suppressHydrationWarning>
      {text || "…"}
    </time>
  );
}
