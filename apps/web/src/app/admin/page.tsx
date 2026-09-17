"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

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

interface RangeFinance {
  grossRevenue: number;
  platformCommission: number;
  riderPayouts: number;
  paidTripCount: number;
  byMethod: MethodBreakdown[];
  currency: string;
}

function money(n: number, currency: string) {
  return `${Math.round(n).toLocaleString()} ${currency}`;
}

function toDateInput(d: Date) {
  // Local calendar date, not toISOString() -- that converts to UTC first, which
  // silently shifts the date backward a day for any timezone ahead of UTC
  // (including Kampala, UTC+3), showing e.g. Aug 31 instead of Sep 1 for "this month."
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function preset(kind: "thisYear" | "lastYear" | "thisMonth" | "lastMonth") {
  const now = new Date();
  switch (kind) {
    case "thisYear":
      return { from: new Date(now.getFullYear(), 0, 1), to: now };
    case "lastYear":
      return { from: new Date(now.getFullYear() - 1, 0, 1), to: new Date(now.getFullYear() - 1, 11, 31) };
    case "thisMonth":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    case "lastMonth":
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: new Date(now.getFullYear(), now.getMonth(), 0),
      };
  }
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);

  const [rangeFrom, setRangeFrom] = useState(() => toDateInput(preset("thisMonth").from));
  const [rangeTo, setRangeTo] = useState(() => toDateInput(preset("thisMonth").to));
  const [activePreset, setActivePreset] = useState<string>("thisMonth");
  const [rangeData, setRangeData] = useState<RangeFinance | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Stats>("/admin/stats").then(setStats);
    apiFetch<Finance>("/admin/finance").then(setFinance);
  }, []);

  function loadRange(from: string, to: string) {
    if (!from || !to) return;
    setRangeLoading(true);
    setRangeError(null);
    apiFetch<RangeFinance>(`/admin/finance/range?from=${from}&to=${to}`)
      .then(setRangeData)
      .catch((err) => setRangeError(err instanceof Error ? err.message : "Could not load that range"))
      .finally(() => setRangeLoading(false));
  }

  useEffect(() => {
    loadRange(rangeFrom, rangeTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(kind: "thisYear" | "lastYear" | "thisMonth" | "lastMonth") {
    const { from, to } = preset(kind);
    const f = toDateInput(from);
    const t = toDateInput(to);
    setRangeFrom(f);
    setRangeTo(t);
    setActivePreset(kind);
    loadRange(f, t);
  }

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
            {/* The headline number: a brand top rule and tinted ground mark it out
                without the heavy 2px cage that surrounded it before. */}
            <Card className="overflow-hidden border-brand/40 bg-brand-soft/40">
              <div className="h-1 w-full bg-brand" aria-hidden />
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
              <p className="mb-3 text-sm font-medium text-neutral-600">Choose a period</p>
              <div className="mb-4 flex flex-wrap gap-2">
                {(["thisMonth", "lastMonth", "thisYear", "lastYear"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => applyPreset(k)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-150",
                      activePreset === k
                        ? "border-black bg-black text-white"
                        : "border-neutral-300 text-neutral-600 hover:border-neutral-400 hover:text-black",
                    )}
                  >
                    {{ thisMonth: "This month", lastMonth: "Last month", thisYear: "This year", lastYear: "Last year" }[k]}
                  </button>
                ))}
              </div>

              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div>
                  <Label htmlFor="range-from" className="mb-1 block text-xs text-neutral-600">
                    From
                  </Label>
                  <Input
                    id="range-from"
                    type="date"
                    value={rangeFrom}
                    onChange={(e) => {
                      setRangeFrom(e.target.value);
                      setActivePreset("");
                    }}
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="range-to" className="mb-1 block text-xs text-neutral-600">
                    To
                  </Label>
                  <Input
                    id="range-to"
                    type="date"
                    value={rangeTo}
                    onChange={(e) => {
                      setRangeTo(e.target.value);
                      setActivePreset("");
                    }}
                    className="h-9 text-sm"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => loadRange(rangeFrom, rangeTo)}
                  disabled={rangeLoading || !rangeFrom || !rangeTo}
                >
                  {rangeLoading ? "Loading..." : "Apply"}
                </Button>
              </div>

              {rangeError && <p className="mb-3 text-sm text-red-600">{rangeError}</p>}

              {rangeData && (
                <div className="grid grid-cols-2 gap-3 border-t border-neutral-200 pt-4 lg:grid-cols-4">
                  <div>
                    <p className="text-xs text-neutral-600">Commission earned</p>
                    <p className="font-bold tabular-nums">{money(rangeData.platformCommission, rangeData.currency)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-600">Gross fares</p>
                    <p className="font-bold tabular-nums">{money(rangeData.grossRevenue, rangeData.currency)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-600">Rider payouts</p>
                    <p className="font-bold tabular-nums">{money(rangeData.riderPayouts, rangeData.currency)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-600">Paid trips</p>
                    <p className="font-bold tabular-nums">{rangeData.paidTripCount}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardContent className="pt-6">
              <p className="mb-4 text-sm font-medium text-neutral-600">Revenue by payment method (all time)</p>
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
