"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BellRing, Bot, ScrollText, Smartphone } from "lucide-react";
import { savePushSubscription } from "@/app/actions/notify";
import { Button, cx, Notice } from "./ui";

const TABS = [
  { href: "/app/autopilot", label: "Pilote", icon: Bot },
  { href: "/app/autopilot/notifications", label: "Notifications", short: "Alertes", icon: BellRing },
  { href: "/app/autopilot/journal", label: "Journal", icon: ScrollText },
];

export function AutomationTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections de l'automatisation" className="mb-6 flex gap-1 rounded-2xl border border-line bg-surface p-1">
      {TABS.map((t) => {
        const active = pathname === t.href;
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold transition sm:px-3",
              active ? "bg-surface-2 text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <Icon className={cx("hidden size-4 shrink-0 sm:block", active && "text-brand")} />
            <span className="truncate sm:hidden">{t.short ?? t.label}</span>
            <span className="hidden truncate sm:inline">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Champ caché : fuseau horaire du navigateur (le serveur ne le connaît pas autrement). */
export function TimeZoneField() {
  const [tz, setTz] = useState("");
  useEffect(() => {
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  }, []);
  return <input type="hidden" name="tz" value={tz} />;
}

/** Compte à rebours jusqu'à l'envoi (délai de grâce). */
export function Countdown({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return <span>…</span>;
  const min = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (min <= 0) return <span>envoi imminent</span>;
  if (min < 60) return <span>part dans {min} min</span>;
  const h = Math.floor(min / 60);
  return <span>part dans {h} h {String(min % 60).padStart(2, "0")}</span>;
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "";
}

type PushState = "loading" | "unsupported" | "ios-install" | "denied" | "ready" | "subscribed";

/**
 * Active les notifications de l'app sur cet appareil. Sur iPhone, ça ne marche que depuis l'app
 * ajoutée à l'écran d'accueil (iOS 16.4 ou plus) : on l'explique au lieu d'afficher un bouton inutile.
 */
export function PushSubscribe({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<PushState>("loading");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState(ios && !standalone ? "ios-install" : "unsupported");
      return;
    }
    if (ios && !standalone) {
      setState("ios-install");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    // Enregistré dès l'ouverture de la page : au clic, l'abonnement peut partir immédiatement (exigence de Safari).
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "subscribed" : "ready"))
      .catch(() => setState("unsupported"));
  }, []);

  async function subscribe() {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      const res = await savePushSubscription(sub.toJSON() as Parameters<typeof savePushSubscription>[0], deviceName());
      if (res.error) {
        setMessage({ tone: "bad", text: res.error });
      } else {
        setState("subscribed");
        setMessage({ tone: "ok", text: "Notifications activées sur cet appareil. Envoie-toi un test ci-dessous." });
      }
    } catch {
      setState(Notification.permission === "denied" ? "denied" : "ready");
      setMessage({ tone: "bad", text: Notification.permission === "denied" ? "Tu as refusé les notifications." : "L'activation a échoué. Réessaie." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {state === "loading" ? <p className="text-sm text-muted">Vérification de cet appareil…</p> : null}
      {state === "ios-install" ? (
        <Notice tone="warn">
          <p className="font-semibold">Sur iPhone, installe d'abord l'app</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
            <li>Dans Safari, touche <span className="font-semibold">Partager</span> puis <span className="font-semibold">Sur l'écran d'accueil</span>.</li>
            <li>Ouvre Cliping depuis l'icône (pas depuis Safari).</li>
            <li>Reviens sur cette page et touche « Activer sur cet appareil ».</li>
          </ol>
          <p className="mt-1.5 text-xs">Il faut iOS 16.4 ou plus récent. En attendant, l'appli gratuite ntfy (plus bas) marche tout de suite.</p>
        </Notice>
      ) : null}
      {state === "unsupported" ? <Notice>Ce navigateur ne gère pas les notifications web. Utilise ntfy ou Discord ci-dessous.</Notice> : null}
      {state === "denied" ? (
        <Notice tone="bad">
          Les notifications sont bloquées pour Cliping sur cet appareil. Sur iPhone : Réglages → Notifications → Cliping. Sur ordinateur : l'icône à gauche de l'adresse.
        </Notice>
      ) : null}
      {state === "ready" || state === "subscribed" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant={state === "subscribed" ? "secondary" : "primary"} onClick={subscribe} disabled={busy} aria-busy={busy}>
            <Smartphone className="size-4" />
            {busy ? "Activation…" : state === "subscribed" ? "Réactiver sur cet appareil" : "Activer sur cet appareil"}
          </Button>
          {state === "subscribed" ? <span className="text-sm text-ok">Cet appareil reçoit les notifications.</span> : null}
        </div>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </div>
  );
}
