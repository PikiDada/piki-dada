"use client";

import { useCallback, useSyncExternalStore } from "react";
import { canPrompt, isIOS, isInstalled, markInstalled, promptInstall } from "@/lib/pwa";

// Install state lives outside React (localStorage, display mode, the browser's deferred
// install prompt), so it's read with useSyncExternalStore and re-read whenever one of these
// events says it may have changed.
function subscribe(onChange: () => void) {
  const handleInstalled = () => {
    markInstalled();
    onChange();
  };
  window.addEventListener("pwa:prompt-available", onChange);
  window.addEventListener("app:pwa-installed", handleInstalled);
  window.addEventListener("appinstalled", handleInstalled);
  return () => {
    window.removeEventListener("pwa:prompt-available", onChange);
    window.removeEventListener("app:pwa-installed", handleInstalled);
    window.removeEventListener("appinstalled", handleInstalled);
  };
}

function isPromptable() {
  return !isInstalled() && canPrompt();
}

const onServer = () => false;

export function usePwaInstall() {
  const installed = useSyncExternalStore(subscribe, isInstalled, onServer);
  const promptable = useSyncExternalStore(subscribe, isPromptable, onServer);

  const prompt = useCallback(async () => {
    const outcome = await promptInstall();
    return outcome;
  }, []);

  return { installed, promptable, isIOS: isIOS(), promptInstall: prompt };
}
