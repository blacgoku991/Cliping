"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { rememberTimeZone } from "@/app/app/stats/actions";

/** Transmet au serveur le fuseau horaire du navigateur s'il diffère de celui qu'il connaît, puis recharge les chiffres. */
export function TimeZoneSync({ known }: { known: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz || tz === known) return;
    void rememberTimeZone(tz).then((r) => {
      if (r.ok) router.refresh();
    });
  }, [known, router]);
  return null;
}
