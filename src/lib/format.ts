export function duration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")}` : m ? `${m} min ${String(r).padStart(2, "0")}` : `${r} s`;
}

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** « il y a 5 min » — indépendant du fuseau horaire, donc sûr à calculer côté serveur. */
export function ago(date: Date | null | undefined, now = Date.now()): string {
  if (!date) return "jamais";
  const diff = Math.round((now - date.getTime()) / 1000);
  if (diff < 0) return inFuture(-diff);
  if (diff < 45) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.round(diff / 3600)} h`;
  return `il y a ${Math.round(diff / 86400)} j`;
}

function inFuture(diff: number): string {
  if (diff < 60) return "dans un instant";
  if (diff < 3600) return `dans ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `dans ${Math.round(diff / 3600)} h`;
  return `dans ${Math.round(diff / 86400)} j`;
}

export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}
