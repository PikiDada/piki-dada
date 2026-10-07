"use client";

import { useSyncExternalStore } from "react";
import { isPushSubscribed, isPushSupported } from "@/lib/pwa";

function canOfferPush() {
  return isPushSupported() && Notification.permission !== "denied" && !isPushSubscribed();
}

// Nothing announces a change here; the bell hides itself once the user subscribes.
const noChanges = () => () => {};

// Whether to show the "enable notifications" bell: read from the browser, never on the server.
export function useCanOfferPush() {
  return useSyncExternalStore(noChanges, canOfferPush, () => false);
}
