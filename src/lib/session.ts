import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomToken, sha256 } from "./crypto";
import { db } from "./db";
import { env } from "./env";

const COOKIE = "cliping_session";
const MAX_AGE_SEC = 30 * 24 * 3600;

export async function createSession(userId: string): Promise<void> {
  const token = randomToken();
  await db.session.create({
    data: { tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + MAX_AGE_SEC * 1000) },
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appUrl.startsWith("https://"),
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(COOKIE);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  settings: unknown;
}

/** Utilisateur connecté (ou null). Mis en cache pour la durée de la requête. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, email: true, name: true, settings: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
