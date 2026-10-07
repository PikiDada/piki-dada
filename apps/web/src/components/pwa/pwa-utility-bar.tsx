"use client";

import { usePwaInstall } from "@/hooks/use-pwa-install";
import { useCanOfferPush } from "@/hooks/use-can-offer-push";
import { InstallLink } from "./install-link";
import { PushBell } from "./push-bell";

export function PwaUtilityBar() {
  const { installed } = usePwaInstall();
  const showBell = useCanOfferPush();

  if (installed && !showBell) return null;

  return (
    <div className="fixed top-3 right-3 z-40 flex items-center gap-1 rounded-full bg-white/90 px-1 shadow-sm backdrop-blur">
      <PushBell />
      <InstallLink />
    </div>
  );
}
