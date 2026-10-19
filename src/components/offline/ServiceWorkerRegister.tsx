"use client";

import { useEffect } from "react";
import { Workbox } from "workbox-window";
import { flushTravelOrderPendingQueue } from "@/lib/offline/travel-order-sync";

const SHELL_WARM_URLS = ["/offline-travel-orders.html", "/work/tasks"];

function warmTravelOrderShell(registration?: ServiceWorkerRegistration | null) {
  const worker = registration?.active || navigator.serviceWorker.controller;
  if (worker) {
    worker.postMessage({ type: "WARM_TRAVEL_ORDER_SHELL", urls: SHELL_WARM_URLS });
  }
  // Also warm from the page so cookies/session apply the same as normal navigations.
  if (typeof navigator !== "undefined" && navigator.onLine) {
    void Promise.all(
      SHELL_WARM_URLS.map((url) =>
        fetch(url, { credentials: "same-origin", cache: "no-cache" }).catch(() => null),
      ),
    );
  }
}

/**
 * Registers the Workbox service worker and listens for Background Sync wakeups.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    // Dev compiles often exceed NetworkFirst timeouts; a cached shell + new chunks
    // produces ChunkLoadError / half-mounted React trees. Keep SW for production only.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.unregister();
      });
      if ("caches" in window) {
        void caches.keys().then((keys) => {
          for (const key of keys) void caches.delete(key);
        });
      }
      return;
    }

    const wb = new Workbox("/sw.js", { scope: "/" });

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === "TRAVEL_ORDER_SYNC") {
        void flushTravelOrderPendingQueue();
      }
    };

    wb.addEventListener("waiting", () => {
      wb.messageSkipWaiting();
    });

    wb.addEventListener("controlling", () => {
      warmTravelOrderShell();
    });

    navigator.serviceWorker.addEventListener("message", onMessage);

    void wb
      .register()
      .then((registration) => {
        warmTravelOrderShell(registration);
      })
      .catch((err) => {
        console.warn("[sw] registration failed", err);
      });

    const onOnline = () => {
      void flushTravelOrderPendingQueue();
      warmTravelOrderShell();
    };
    window.addEventListener("online", onOnline);

    // Warm when user lands on agent tasks (best chance to cache the real HTML shell).
    if (window.location.pathname.startsWith("/agent")) {
      warmTravelOrderShell();
    }

    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return null;
}
