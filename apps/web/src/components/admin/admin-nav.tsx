"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Users, Motorbike, MapPin, Tag, DollarSign, Megaphone, Wallet, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

const ITEMS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/drivers", label: "Riders", icon: Motorbike },
  { href: "/admin/drivers/wallets", label: "Payouts", icon: Wallet },
  { href: "/admin/trips", label: "Trips", icon: MapPin },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/pricing", label: "Pricing", icon: DollarSign },
  { href: "/admin/coupons", label: "Coupons", icon: Tag },
  { href: "/admin/push", label: "Push", icon: Megaphone },
];

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const clearSession = useAuthStore((s) => s.clearSession);

  return (
    <aside className="fixed inset-y-0 left-0 w-56 border-r border-neutral-200 bg-white p-4">
      <div className="mb-6 flex items-center gap-2 px-2">
        <Image src="/brand/pikidada_logo4.png" alt="Piki Dada" width={120} height={39} />
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
          Admin
        </span>
      </div>
      <nav className="space-y-0.5">
        {ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            className={cn(
              // The active item is a filled pill with a brand marker instead of a hard
              // black slab -- it sits on the surface rather than punching a hole in it.
              "relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
              pathname === href
                ? "bg-neutral-900 text-white shadow-card"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
            )}
          >
            {pathname === href && (
              <span
                className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand"
                aria-hidden
              />
            )}
            <Icon size={16} strokeWidth={pathname === href ? 2.3 : 1.9} />
            {label}
          </Link>
        ))}
        <button
          onClick={async () => {
            await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
            clearSession();
            router.push("/login");
          }}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
        >
          <LogOut size={16} strokeWidth={1.9} />
          Logout
        </button>
      </nav>
    </aside>
  );
}
