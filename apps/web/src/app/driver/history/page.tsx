"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import type { Trip } from "@/lib/types";
import { DriverNav } from "@/components/driver/driver-nav";

interface Wallet {
  balance: number;
  currency: string;
  ledgerEntries: { id: string; amount: number; reason: string; createdAt: string }[];
}

function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

export default function DriverHistoryPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadWallet() {
    apiFetch<Wallet>("/wallet/me").then(setWallet);
  }

  useEffect(() => {
    apiFetch<Trip[]>("/trips/me").then(setTrips);
    loadWallet();
  }, []);

  const completed = useMemo(() => trips.filter((t) => t.status === "COMPLETED"), [trips]);

  const earnings = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    let today = 0,
      week = 0,
      month = 0;
    for (const t of completed) {
      const created = new Date(t.createdAt);
      if (isSameDay(created, now)) today += t.fare;
      if (created >= weekAgo) week += t.fare;
      if (created >= monthAgo) month += t.fare;
    }
    return { today, week, month };
  }, [completed]);

  async function handleWithdraw() {
    if (!wallet) return;
    setError(null);
    setWithdrawing(true);
    try {
      await apiFetch("/wallet/withdraw", {
        method: "POST",
        body: JSON.stringify({ amount: wallet.balance }),
      });
      loadWallet();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <div className="min-h-screen p-4 pb-20">
      <h1 className="mb-4 text-xl font-bold">Earnings</h1>

      {wallet && (
        <Card className="mb-4">
          <CardContent className="flex items-center justify-between pt-4">
            <div>
              <p className="text-xs text-neutral-600">Wallet balance</p>
              <p className="text-2xl font-bold">
                {wallet.balance.toLocaleString()} {wallet.currency}
              </p>
            </div>
            <Button disabled={wallet.balance <= 0 || withdrawing} onClick={handleWithdraw}>
              {withdrawing ? "Processing..." : "Withdraw"}
            </Button>
          </CardContent>
        </Card>
      )}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mb-4 grid grid-cols-3 gap-2">
        {[
          { label: "Today", value: earnings.today },
          { label: "This week", value: earnings.week },
          { label: "This month", value: earnings.month },
        ].map((e) => (
          <Card key={e.label}>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-neutral-600">{e.label}</p>
              <p className="font-bold">{e.value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="mb-2 text-sm font-medium text-neutral-600">Trip history</h2>
      <div className="space-y-3">
        {trips.length === 0 && <p className="text-sm text-neutral-600">No trips yet.</p>}
        {trips.map((trip) => (
          <Card key={trip.id}>
            <CardContent className="flex items-center justify-between pt-4">
              <div>
                <p className="text-sm font-medium">{trip.pickupAddress}</p>
                <p className="text-xs text-neutral-600">→ {trip.destinationAddress}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold">
                  {trip.fare?.toLocaleString()} {trip.currency}
                </p>
                <p className="text-xs text-neutral-600">{trip.status}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <DriverNav />
    </div>
  );
}
