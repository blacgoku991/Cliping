"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createSession, destroySession } from "@/lib/session";

export interface FormState {
  error?: string;
  ok?: string;
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide")),
  password: z.string().min(10, "Le mot de passe doit faire au moins 10 caractères").max(200),
});

// Frein simple contre le bourrinage de mots de passe (par adresse e-mail, en mémoire du processus).
const attempts = new Map<string, { count: number; resetAt: number }>();
function tooManyAttempts(email: string): boolean {
  const now = Date.now();
  const entry = attempts.get(email);
  if (!entry || entry.resetAt < now) {
    attempts.set(email, { count: 1, resetAt: now + 15 * 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 10;
}

export async function register(_prev: FormState, form: FormData): Promise<FormState> {
  if (!env.allowSignup) return { error: "Les inscriptions sont fermées sur ce serveur." };
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  const { email, password } = parsed.data;
  if (await db.user.findUnique({ where: { email } })) return { error: "Un compte existe déjà avec cette adresse." };
  const name = String(form.get("name") ?? "").trim().slice(0, 60) || null;
  const user = await db.user.create({ data: { email, name, passwordHash: await hashPassword(password) } });
  await createSession(user.id);
  redirect("/app");
}

export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Renseigne ton e-mail et ton mot de passe." };
  if (tooManyAttempts(email)) return { error: "Trop de tentatives. Réessaie dans un quart d'heure." };
  const user = await db.user.findUnique({ where: { email } });
  // Même message dans les deux cas : on ne révèle pas si l'adresse existe.
  if (!user || !(await verifyPassword(password, user.passwordHash))) return { error: "E-mail ou mot de passe incorrect." };
  attempts.delete(email);
  await createSession(user.id);
  redirect("/app");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/");
}
