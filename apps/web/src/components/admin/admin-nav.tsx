"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Users, Motorbike, MapPin, Tag, DollarSign, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

const ITEMS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/drivers", label: "Riders", icon: Motorbike },
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
        <span className="text-xs font-semibold text-neutral-600">Admin</span>
      </div>
      <nav className="space-y-1">
        {ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-lg border-l-4 px-3 py-2 text-sm font-medium",
              pathname === href
                ? "border-[#F4C12C] bg-black text-white"
                : "border-transparent text-neutral-600 hover:bg-neutral-100",
            )}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
        <button
          onClick={async () => {
            await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
            clearSession();
            router.push("/login");
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-neutral-600 hover:bg-neutral-100"
        >
          Logout
        </button>
      </nav>
    </aside>
  );
}
