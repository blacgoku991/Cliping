/*
 * Service worker de Cliping : notifications Web Push uniquement (aucun cache, l'app reste toujours à jour).
 * Safari n'accepte pas les notifications invisibles : chaque message reçu est affiché tout de suite,
 * sinon iOS retire l'autorisation.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Cliping", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Cliping";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/app" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || "/app";
  const target = new URL(path, self.location.origin);
  // Uniquement des liens internes à l'app.
  const url = target.origin === self.location.origin ? target.href : self.location.origin + "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin) && "focus" in w) {
          return w.focus().then((c) => (c && "navigate" in c ? c.navigate(url) : c));
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
