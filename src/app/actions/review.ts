"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export type ReviewDecision = "APPROVED" | "REJECTED" | "READY";

/**
 * Tri rapide d'un clip (mode validation, cartes de la liste, tableau de bord).
 * READY sert à annuler une décision.
 */
export async function reviewClip(id: string, status: ReviewDecision): Promise<{ ok?: true; error?: string }> {
  const user = await requireUser();
  if (status !== "APPROVED" && status !== "REJECTED" && status !== "READY") return { error: "Décision inconnue." };
  const res = await db.clip.updateMany({
    where: { id: String(id), userId: user.id, status: { in: ["READY", "APPROVED", "REJECTED"] } },
    data: { status },
  });
  if (!res.count) return { error: "Ce clip n'existe plus ou est en cours de montage." };
  revalidatePath("/app");
  revalidatePath("/app/clips");
  revalidatePath(`/app/clips/${id}`);
  return { ok: true };
}
