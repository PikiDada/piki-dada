"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Clock, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

const ITEMS = [
  { href: "/driver", label: "Dashboard", icon: LayoutDashboard },
  { href: "/driver/history", label: "History", icon: Clock },
];

export function DriverNav() {
  const pathname = usePathname();
  const router = useRouter();
  const clearSession = useAuthStore((s) => s.clearSession);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 flex justify-around border-t border-neutral-200/80 bg-white/85 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-lg">
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className={cn(
            "relative flex w-20 flex-col items-center gap-1 py-1 text-[11px] font-medium transition-colors",
            pathname === href ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-800",
          )}
        >
          {pathname === href && (
            <span className="absolute -top-2 h-1 w-8 rounded-full bg-brand" aria-hidden />
          )}
          <Icon size={20} strokeWidth={pathname === href ? 2.4 : 1.9} />
          {label}
        </Link>
      ))}
      <button
        onClick={async () => {
          await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
          clearSession();
          router.push("/login");
        }}
        className="flex w-20 flex-col items-center gap-1 py-1 text-[11px] font-medium text-neutral-500 transition-colors hover:text-neutral-800"
      >
        <LogOut size={20} strokeWidth={1.9} />
        Logout
      </button>
    </nav>
  );
}
