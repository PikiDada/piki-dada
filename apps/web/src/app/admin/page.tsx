"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

interface Stats {
  totalTrips: number;
  completedTrips: number;
  activeDrivers: number;
  totalPassengers: number;
  totalRevenue: number;
}

interface MethodBreakdown {
  method: string;
  amount: number;
  count: number;
}

interface Finance {
  grossRevenue: number;
  platformCommission: number;
  riderPayouts: number;
  paidTripCount: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
  pendingAmount: number;
  pendingCount: number;
  walletBalanceHeld: number;
  byMethod: MethodBreakdown[];
  currency: string;
}

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  STRIPE: "Card (Stripe)",
  FLUTTERWAVE: "Mobile money (Flutterwave)",
  WALLET: "Wallet",
};

const METHOD_COLORS: Record<string, string> = {
  CASH: "bg-neutral-700",
  STRIPE: "bg-indigo-500",
  FLUTTERWAVE: "bg-orange-500",
  WALLET: "bg-emerald-500",
};

function money(n: number, currency: string) {
  return `${Math.round(n).toLocaleString()} ${currency}`;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);

  useEffect(() => {
    apiFetch<Stats>("/admin/stats").then(setStats);
    apiFetch<Finance>("/admin/finance").then(setFinance);
  }, []);

  if (!stats) return <p className="text-neutral-600">Loading...</p>;

  const cards: { label: string; value: string | number; href?: string }[] = [
    { label: "Total trips", value: stats.totalTrips, href: "/admin/trips" },
    { label: "Completed trips", value: stats.completedTrips, href: "/admin/trips" },
    { label: "Active riders", value: stats.activeDrivers, href: "/admin/drivers/active" },
    { label: "Total passengers", value: stats.totalPassengers, href: "/admin/users" },
  ];

  const maxMethodAmount = finance ? Math.max(1, ...finance.byMethod.map((m) => m.amount)) : 1;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => {
          const body = (
            <CardContent className="pt-6">
              <p className="text-sm text-neutral-600">{c.label}</p>
              <p className="text-2xl font-bold">{c.value}</p>
              {c.href && <p className="mt-1 text-xs text-neutral-600 underline">View details</p>}
            </CardContent>
          );

          return c.href ? (
            <Link key={c.label} href={c.href} className="block">
              <Card className="h-full transition-shadow duration-150 hover:shadow-md">{body}</Card>
            </Link>
          ) : (
            <Card key={c.label} className="h-full">
              {body}
            </Card>
          );
        })}
      </div>

      <h2 className="mb-4 mt-10 text-lg font-bold">Finance</h2>
      {!finance ? (
        <p className="text-neutral-600">Loading finance summary...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="border-2 border-[#F4C12C]">
              <CardContent className="pt-6">
                <p className="text-sm text-neutral-600">Platform commission (15%)</p>
                <p className="text-2xl font-bold tabular-nums">{money(finance.platformCommission, finance.currency)}</p>
                <p className="mt-1 text-xs text-neutral-600">what Piki Dada actually earned</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-neutral-600">Gross fares collected</p>
                <p className="text-2xl font-bold tabular-nums">{money(finance.grossRevenue, finance.currency)}</p>
                <p className="mt-1 text-xs text-neutral-600">{finance.paidTripCount} paid trips, all time</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-neutral-600">Rider payouts (85%)</p>
                <p className="text-2xl font-bold tabular-nums">{money(finance.riderPayouts, finance.currency)}</p>
                <p className="mt-1 text-xs text-neutral-600">
                  credited to wallets &mdash; cash trips excluded, riders keep that fare directly
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-neutral-600">Pending payment</p>
                <p className="text-2xl font-bold tabular-nums">{money(finance.pendingAmount, finance.currency)}</p>
                <p className="mt-1 text-xs text-neutral-600">{finance.pendingCount} trips awaiting settlement</p>
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-neutral-600">Today</p>
                <p className="text-xl font-bold tabular-nums">{money(finance.today, finance.currency)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-neutral-600">This week</p>
                <p className="text-xl font-bold tabular-nums">{money(finance.thisWeek, finance.currency)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-neutral-600">This month</p>
                <p className="text-xl font-bold tabular-nums">{money(finance.thisMonth, finance.currency)}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4">
            <CardContent className="pt-6">
              <p className="mb-4 text-sm font-medium text-neutral-600">Revenue by payment method</p>
              {finance.byMethod.length === 0 ? (
                <p className="text-sm text-neutral-600">No paid trips yet.</p>
              ) : (
                <div className="space-y-3">
                  {finance.byMethod
                    .slice()
                    .sort((a, b) => b.amount - a.amount)
                    .map((m) => (
                      <div key={m.method}>
                        <div className="mb-1 flex items-baseline justify-between text-sm">
                          <span className="font-medium">{METHOD_LABELS[m.method] ?? m.method}</span>
                          <span className="tabular-nums text-neutral-600">
                            {money(m.amount, finance.currency)} &middot; {m.count} trip{m.count === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                          <div
                            className={`h-full rounded-full ${METHOD_COLORS[m.method] ?? "bg-neutral-400"}`}
                            style={{ width: `${Math.max(3, (m.amount / maxMethodAmount) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          <p className="mt-3 text-xs text-neutral-600">
            {finance.walletBalanceHeld.toLocaleString()} {finance.currency} currently sitting in rider wallets, not yet withdrawn.
          </p>
        </>
      )}
    </div>
  );
}
