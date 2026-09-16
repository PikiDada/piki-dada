"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";

interface RiderWallet {
  driverId: string;
  balance: number;
  currency: string;
  user: { id: string; name: string; email: string; phone?: string | null };
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-8 text-neutral-600">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
      <span className="text-sm">Loading...</span>
    </div>
  );
}

function SettleForm({ driverId, onSettled }: { driverId: string; onSettled: () => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function submit() {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a positive amount");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/admin/drivers/${driverId}/wallet/settle`, {
        method: "PATCH",
        body: JSON.stringify({ amount: parsed, note: note || undefined }),
      });
      setAmount("");
      setNote("");
      setOpen(false);
      onSettled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record settlement");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Record settlement
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Input
          type="number"
          step="any"
          placeholder="Amount received"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-9 w-36 text-sm"
        />
        <Input
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="h-9 w-40 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={submitting}>
          {submitting ? "Recording..." : "Confirm received"}
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function AdminRiderWalletsPage() {
  const [wallets, setWallets] = useState<RiderWallet[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    apiFetch<RiderWallet[]>("/admin/drivers/wallets")
      .then(setWallets)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const owing = wallets.filter((w) => w.balance < 0);
  const totalOwed = owing.reduce((sum, w) => sum + w.balance, 0);

  return (
    <div>
      <Link href="/admin" className="text-sm text-neutral-600 underline hover:text-black">
        &larr; Back to dashboard
      </Link>
      <h1 className="mt-3 mb-2 text-2xl font-bold">Rider payouts &amp; settlements</h1>
      <p className="mb-6 text-sm text-neutral-600">
        Cash trips owe Piki Dada 15% commission instead of paying the rider out -- see the finance
        board for why. Record it here when a rider actually brings you that money in person.
      </p>

      {!loading && owing.length > 0 && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <CardContent className="pt-4">
            <p className="text-sm text-red-700">
              {owing.length} rider{owing.length === 1 ? "" : "s"} currently owe a total of{" "}
              <span className="font-bold tabular-nums">
                {Math.abs(totalOwed).toLocaleString()} {wallets[0]?.currency ?? "UGX"}
              </span>
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {loading ? (
          <Spinner />
        ) : wallets.length === 0 ? (
          <p className="text-neutral-600">No riders yet.</p>
        ) : (
          wallets.map((w) => (
            <Card key={w.driverId}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
                <div>
                  <p className="font-medium">{w.user.name}</p>
                  <p className="text-sm text-neutral-600">{w.user.email}</p>
                  {w.user.phone && <p className="text-sm text-neutral-600">{w.user.phone}</p>}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-neutral-600">{w.balance < 0 ? "Owes" : "Balance"}</p>
                    <p className={`font-bold tabular-nums ${w.balance < 0 ? "text-red-600" : ""}`}>
                      {Math.abs(w.balance).toLocaleString()} {w.currency}
                    </p>
                  </div>
                  {w.balance < 0 && <SettleForm driverId={w.driverId} onSettled={load} />}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
