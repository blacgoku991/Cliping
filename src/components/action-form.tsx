"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, cx } from "./ui";

export interface FormState {
  error?: string;
  ok?: string;
}

const PendingContext = createContext(false);

/**
 * Formulaire relié à une action serveur qui renvoie { error } ou { ok }.
 *
 * Une fois la page chargée, l'envoi passe par onSubmit : les champs gardent ainsi leur contenu
 * quand le serveur renvoie une erreur de validation (React viderait le formulaire sinon).
 * L'attribut `action` reste renseigné pour le cas où le JavaScript n'est pas (encore) chargé :
 * le navigateur envoie alors le formulaire en POST à l'action serveur, au lieu d'un GET
 * qui mettrait la saisie — mot de passe compris — dans l'adresse de la page.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnOk = false,
  messageClassName,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  resetOnOk?: boolean;
  messageClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnOk) ref.current?.reset();
  }, [state, resetOnOk]);

  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        const data = new FormData(e.currentTarget, submitter instanceof HTMLElement ? submitter : undefined);
        startTransition(() => formAction(data));
      }}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {state.error && !pending ? (
        <p role="alert" className={cx("rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad", messageClassName)}>
          {state.error}
        </p>
      ) : null}
      {state.ok && !pending ? (
        <p role="status" className={cx("rounded-xl border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok", messageClassName)}>
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}

/** Bouton d'envoi : fonctionne dans un <ActionForm> comme dans un <form action={…}> classique. */
export function SubmitButton({ children, pendingLabel, ...props }: ComponentProps<typeof Button> & { pendingLabel?: ReactNode }) {
  const inContext = useContext(PendingContext);
  const status = useFormStatus();
  const pending = inContext || status.pending;
  return (
    <Button type="submit" {...props} disabled={pending || props.disabled} aria-busy={pending}>
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
