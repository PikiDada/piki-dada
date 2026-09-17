"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useAuthStore } from "@/lib/auth-store";
import { redirectForRole } from "@/lib/auth-helpers";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { Banknote, Receipt, ShieldCheck } from "lucide-react";

const FEATURES = [
  { label: "Upfront fares", icon: Receipt },
  { label: "Cash accepted", icon: Banknote },
  { label: "Verified riders", icon: ShieldCheck },
];

export default function Home() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { installed } = usePwaInstall();

  useEffect(() => {
    if (user) redirectForRole(user.role, router);
  }, [user, router]);

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 py-10 text-center">
      <div className="relative flex flex-col items-center gap-6">
        {/* A soft halo anchored to the logo itself, so it reads as the mark glowing
            rather than a yellow band painted across the top of the screen. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-60 w-72 -translate-x-1/2 rounded-full bg-brand/20 blur-3xl"
        />
        <Image
          src="/brand/pikidada_logo4.png"
          alt="Piki Dada"
          width={280}
          height={90}
          priority
          className="relative"
        />
        <h1 className="sr-only">Piki Dada</h1>

        <p className="max-w-sm text-balance leading-relaxed text-neutral-600">
          Your trusted partner for safe, reliable boda rides and fast deliveries across the city and
          beyond.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-medium text-neutral-600">
          {FEATURES.map(({ label, icon: Icon }) => (
            <span key={label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Icon className="h-3.5 w-3.5 text-neutral-500" aria-hidden />
              {label}
            </span>
          ))}
        </div>

        <div className="flex w-full max-w-xs flex-col gap-3 pt-1 sm:w-auto sm:flex-row">
          <Link href="/register" className="sm:w-auto">
            <Button size="lg" variant="brand" className="w-full sm:w-auto">
              Get started
            </Button>
          </Link>
          <Link href="/login" className="sm:w-auto">
            <Button size="lg" variant="outline" className="w-full sm:w-auto">
              Sign in
            </Button>
          </Link>
        </div>

        {!installed && (
          <Link
            href="/install"
            className="js-hide-if-pwa-installed text-sm font-medium text-neutral-600 underline underline-offset-4 hover:text-neutral-900"
          >
            Install the app
          </Link>
        )}
      </div>
    </div>
  );
}
