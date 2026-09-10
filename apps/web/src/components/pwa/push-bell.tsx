"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { isPushSubscribed, isPushSupported, subscribeToPush } from "@/lib/pwa";

export function PushBell() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setVisible(
      isPushSupported() &&
        Notification.permission !== "denied" &&
        !isPushSubscribed(),
    );
  }, []);

  async function handleSubscribe() {
    setLoading(true);
    try {
      const result = await subscribeToPush(
        () => apiFetch<{ publicKey: string }>("/push/public-key"),
        (subscription) =>
          apiFetch("/push/subscribe", { method: "POST", body: JSON.stringify(subscription) }),
      );
      if (result === "granted") setVisible(false);
    } finally {
      setLoading(false);
    }
  }

  if (!visible) return null;

  return (
    <button
      onClick={handleSubscribe}
      disabled={loading}
      aria-label="Enable notifications"
      className="rounded-full p-2 text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
    >
      <Bell size={18} />
    </button>
  );
}
