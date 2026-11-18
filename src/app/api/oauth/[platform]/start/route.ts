import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { platformFromSlug } from "@/lib/platforms";
import { getUser } from "@/lib/session";

/** Démarre la connexion d'un compte social : redirige vers l'écran d'autorisation de la plateforme. */
export async function GET(_req: Request, ctx: { params: Promise<{ platform: string }> }): Promise<Response> {
  const { platform } = await ctx.params;
  const adapter = platformFromSlug(platform);
  if (!adapter) return new Response("Plateforme inconnue", { status: 404 });
  const user = await getUser();
  if (!user) return NextResponse.redirect(`${env.appUrl}/login`);
  if (!adapter.configured()) return NextResponse.redirect(`${env.appUrl}/app/accounts?error=${encodeURIComponent(`${adapter.label} n'est pas configuré sur ce serveur.`)}`);

  // « state » anti-CSRF : lié au navigateur par un cookie, vérifié au retour.
  const state = randomToken(24);
  (await cookies()).set(`oauth_state_${adapter.id.toLowerCase()}`, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appUrl.startsWith("https://"),
    path: "/api/oauth",
    maxAge: 600,
  });
  return NextResponse.redirect(adapter.authUrl(state));
}
