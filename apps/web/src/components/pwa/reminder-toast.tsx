"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { PWA_FIRST_DELAY, PWA_REPEAT_DELAY } from "@/lib/pwa";

export function ReminderToast() {
  const router = useRouter();
  const { installed, promptable, isIOS, promptInstall } = usePwaInstall();
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (installed || !promptable) {
      setVisible(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    const show = () => setVisible((current) => current || true);
    timeoutRef.current = setTimeout(() => {
      show();
      intervalRef.current = setInterval(show, PWA_REPEAT_DELAY);
    }, PWA_FIRST_DELAY);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [installed, promptable]);

  if (!visible || installed) return null;

  async function handleInstall() {
    if (isIOS) {
      setVisible(false);
      router.push("/install");
      return;
    }
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      setMessage("Finishing installation…");
    } else {
      setVisible(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-2xl border border-neutral-200 bg-white p-4 shadow-xl">
      <p className="text-sm font-semibold">Install Piki Dada</p>
      <p className="mt-1 text-xs text-neutral-600">
        {message ?? "Add Piki Dada to your home screen for faster access."}
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1" onClick={handleInstall}>
          Install Now
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={() => setVisible(false)}>
          Maybe Later
        </Button>
      </div>
    </div>
  );
}
