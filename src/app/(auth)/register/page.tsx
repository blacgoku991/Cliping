import type { Metadata } from "next";
import Link from "next/link";
import { register } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Field, Input, Notice } from "@/components/ui";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Créer un compte" };
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <Card className="p-6">
      <h1 className="text-xl font-bold">Crée ton compte</h1>
      <p className="mt-1 text-sm text-muted">Deux minutes, puis le bot commence à surveiller tes streamers.</p>
      {env.allowSignup ? (
        <ActionForm action={register} className="mt-6 space-y-4">
          <Field label="Pseudo"><Input name="name" autoComplete="nickname" maxLength={60} placeholder="Facultatif" /></Field>
          <Field label="E-mail"><Input name="email" type="email" autoComplete="email" required /></Field>
          <Field label="Mot de passe" hint="10 caractères minimum.">
            <Input name="password" type="password" autoComplete="new-password" minLength={10} required />
          </Field>
          <SubmitButton variant="primary" className="w-full" pendingLabel="Création…">Créer mon compte</SubmitButton>
        </ActionForm>
      ) : (
        <Notice tone="warn" className="mt-6">Les inscriptions sont fermées sur ce serveur.</Notice>
      )}
      <p className="mt-5 text-center text-sm text-muted">
        Déjà inscrit ? <Link href="/login" className="font-semibold text-brand hover:underline">Se connecter</Link>
      </p>
    </Card>
  );
}
