"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";

export function InstallLink() {
  const { installed } = usePwaInstall();

  if (installed) return null;

  return (
    <Link
      href="/install"
      className="js-hide-if-pwa-installed flex items-center gap-1 rounded-full p-2 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
    >
      <Download size={16} />
      <span className="hidden sm:inline">Install App</span>
    </Link>
  );
}
