"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { subscribeToPush } from "@/lib/pwa";
import { useCanOfferPush } from "@/hooks/use-can-offer-push";

export function PushBell() {
  const canOffer = useCanOfferPush();
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const visible = canOffer && !subscribed;

  async function handleSubscribe() {
    setLoading(true);
    try {
      const result = await subscribeToPush(
        () => apiFetch<{ publicKey: string }>("/push/public-key"),
        (subscription) =>
          apiFetch("/push/subscribe", { method: "POST", body: JSON.stringify(subscription) }),
      );
      if (result === "granted") setSubscribed(true);
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
