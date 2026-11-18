import type { Metadata } from "next";
import Link from "next/link";
import { login } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  return (
    <Card className="p-6">
      <h1 className="text-xl font-bold">Content de te revoir</h1>
      <p className="mt-1 text-sm text-muted">Connecte-toi pour retrouver tes clips.</p>
      <ActionForm action={login} className="mt-6 space-y-4">
        <Field label="E-mail"><Input name="email" type="email" autoComplete="email" required autoFocus /></Field>
        <Field label="Mot de passe"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <SubmitButton variant="primary" className="w-full" pendingLabel="Connexion…">Se connecter</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm text-muted">
        Pas encore de compte ? <Link href="/register" className="font-semibold text-brand hover:underline">Créer un compte</Link>
      </p>
    </Card>
  );
}
