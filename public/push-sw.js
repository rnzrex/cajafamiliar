self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = {};
  }

  const title = typeof data.title === "string" ? data.title : "Caja Familiar";
  const body = typeof data.body === "string" ? data.body : "Tienes pagos que requieren atención.";
  const tag = typeof data.tag === "string" ? data.tag : undefined;
  const url = normalizeNotificationUrl(data.url);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: "/caja-familiar.svg",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = normalizeNotificationUrl(event.notification.data?.url);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if ("focus" in client) return client.navigate(targetUrl).catch(() => null).then(() => client.focus());
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

function normalizeNotificationUrl(value) {
  try {
    const target = new URL(typeof value === "string" ? value : "/?view=pagos", self.location.origin);
    if (target.origin !== self.location.origin || target.pathname !== "/" || target.searchParams.get("view") !== "pagos") return "/?view=pagos";

    const paymentId = target.searchParams.get("payment");
    if (paymentId && !/^[A-Za-z0-9_-]+$/.test(paymentId)) target.searchParams.delete("payment");
    return `${target.pathname}${target.search}`;
  } catch {
    return "/?view=pagos";
  }
}
