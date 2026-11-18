import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { platformFromSlug, saveAccount } from "@/lib/platforms";
import { getUser } from "@/lib/session";

function back(params: Record<string, string>): Response {
  return NextResponse.redirect(`${env.appUrl}/app/accounts?${new URLSearchParams(params)}`);
}

/** Retour de la plateforme après autorisation : on échange le code contre des jetons et on enregistre le compte. */
export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }): Promise<Response> {
  const { platform } = await ctx.params;
  const adapter = platformFromSlug(platform);
  if (!adapter) return new Response("Plateforme inconnue", { status: 404 });
  const user = await getUser();
  if (!user) return NextResponse.redirect(`${env.appUrl}/login`);

  const url = new URL(req.url);
  const jar = await cookies();
  const cookieName = `oauth_state_${adapter.id.toLowerCase()}`;
  const expected = jar.get(cookieName)?.value ?? "";
  jar.delete({ name: cookieName, path: "/api/oauth" });

  const denied = url.searchParams.get("error");
  if (denied) return back({ error: `Connexion ${adapter.label} annulée (${url.searchParams.get("error_description") ?? denied}).` });

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const sameState = expected.length > 0 && state.length === expected.length && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  if (!sameState || !code) return back({ error: "Session de connexion expirée ou invalide. Réessaie." });

  try {
    const tokens = await adapter.exchangeCode(code);
    const account = await saveAccount(user.id, adapter, tokens);
    return back({ connected: `${adapter.label} · ${account.displayName}` });
  } catch (err) {
    return back({ error: err instanceof Error ? err.message : "Connexion impossible." });
  }
}
