"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePwaInstall } from "@/hooks/use-pwa-install";

type ButtonState = "default" | "installing" | "installed" | "open" | "dismissed" | "unavailable";

export default function InstallPage() {
  const router = useRouter();
  const { installed, isIOS, promptInstall } = usePwaInstall();
  const [state, setState] = useState<ButtonState>("default");
  const [message, setMessage] = useState<string | null>(null);
  const waitingForInstallRef = useRef(false);

  useEffect(() => {
    if (installed) {
      if (waitingForInstallRef.current) {
        waitingForInstallRef.current = false;
        setState("installed");
        setMessage(null);
        const timer = setTimeout(() => setState("open"), 1500);
        return () => clearTimeout(timer);
      }
      setState("open");
    }
  }, [installed]);

  useEffect(() => {
    if (state !== "dismissed" && state !== "unavailable") return;
    const timer = setTimeout(() => {
      setState("default");
      setMessage(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [state]);

  async function handleClick() {
    if (state === "open") {
      router.push("/");
      return;
    }
    setState("installing");
    setMessage(null);
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      waitingForInstallRef.current = true;
      setMessage("Finishing installation…");
    } else if (outcome === "dismissed") {
      setState("dismissed");
      setMessage("Installation cancelled — you can try again anytime.");
    } else {
      setState("unavailable");
      setMessage("Installation isn't available in this browser right now.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Image
        src="/icons/icon-192.png"
        alt="Piki Dada"
        width={88}
        height={88}
        className="rounded-2xl shadow-md"
      />
      <h1 className="text-3xl font-bold">Install Piki Dada</h1>
      <p className="max-w-sm text-neutral-600">
        Add Piki Dada to your home screen for faster booking and offline-ready access.
      </p>

      {isIOS && !installed ? (
        <Card className="max-w-sm text-left">
          <CardContent className="space-y-2 pt-6 text-sm text-neutral-600">
            <p className="font-medium text-black">To install on iPhone/iPad:</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>
                Tap the <strong>Share</strong> icon in Safari's toolbar
              </li>
              <li>
                Scroll down and tap <strong>Add to Home Screen</strong>
              </li>
              <li>
                Tap <strong>Add</strong> in the top-right corner
              </li>
            </ol>
          </CardContent>
        </Card>
      ) : (
        <Button size="lg" disabled={state === "installing"} onClick={handleClick} className="w-56">
          {state === "installing" && (
            <>
              <Loader2 className="animate-spin" size={18} /> Installing
            </>
          )}
          {state === "installed" && (
            <>
              <CheckCircle2 size={18} /> Installed!
            </>
          )}
          {state === "open" && "Open Piki Dada"}
          {(state === "default" || state === "dismissed" || state === "unavailable") && "Install Now"}
        </Button>
      )}

      {message && <p className="text-sm text-neutral-600">{message}</p>}
    </div>
  );
}
