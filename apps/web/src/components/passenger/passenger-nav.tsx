"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Motorbike, Clock, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

const ITEMS = [
  { href: "/passenger", label: "Ride", icon: Motorbike },
  { href: "/passenger/history", label: "History", icon: Clock },
  { href: "/passenger/profile", label: "Profile", icon: User },
];

export function PassengerNav() {
  const pathname = usePathname();
  const router = useRouter();
  const clearSession = useAuthStore((s) => s.clearSession);

  return (
    <nav className="fixed bottom-0 left-0 right-0 flex justify-around border-t border-neutral-200 bg-white py-2">
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "relative flex flex-col items-center gap-1 px-4 py-1 text-xs",
            pathname === href ? "text-black" : "text-neutral-600",
          )}
        >
          {pathname === href && <span className="absolute -top-2 h-1 w-6 rounded-full bg-[#F4C12C]" />}
          <Icon size={20} />
          {label}
        </Link>
      ))}
      <button
        onClick={async () => {
          await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
          clearSession();
          router.push("/login");
        }}
        className="flex flex-col items-center gap-1 px-4 py-1 text-xs text-neutral-600 transition-all duration-150 hover:scale-[1.08] active:scale-[0.92] hover:text-neutral-700"
      >
        Logout
      </button>
    </nav>
  );
}
