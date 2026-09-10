"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

interface Coupon {
  id: string;
  code: string;
  discountAmount: number | null;
  discountPercent: number | null;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-8 text-neutral-600">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
      <span className="text-sm">Loading...</span>
    </div>
  );
}

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [maxUses, setMaxUses] = useState("");

  function load() {
    setLoading(true);
    apiFetch<Coupon[]>("/admin/coupons")
      .then(setCoupons)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await apiFetch("/admin/coupons", {
      method: "POST",
      body: JSON.stringify({
        code,
        discountAmount: discountAmount ? Number(discountAmount) : undefined,
        discountPercent: discountPercent ? Number(discountPercent) : undefined,
        maxUses: maxUses ? Number(maxUses) : undefined,
      }),
    });
    setCode("");
    setDiscountAmount("");
    setDiscountPercent("");
    setMaxUses("");
    load();
  }

  async function deactivate(id: string) {
    await apiFetch(`/admin/coupons/${id}/deactivate`, { method: "PATCH" });
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Coupons</h1>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>New coupon</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Code</Label>
                <Input required value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Discount amount (UGX)</Label>
                <Input
                  type="number"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Discount percent</Label>
                <Input
                  type="number"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max uses</Label>
                <Input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
              </div>
              <Button type="submit" className="w-full">
                Create coupon
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-2 lg:col-span-2">
          {loading ? (
            <Spinner />
          ) : coupons.length === 0 ? (
            <p className="py-8 text-neutral-600">No coupons yet.</p>
          ) : coupons.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-center justify-between pt-4">
                <div>
                  <p className="font-mono font-medium">{c.code}</p>
                  <p className="text-sm text-neutral-600">
                    {c.discountAmount ? `${c.discountAmount} UGX off` : `${c.discountPercent}% off`}{" "}
                    · used {c.usedCount}
                    {c.maxUses ? `/${c.maxUses}` : ""}
                  </p>
                </div>
                {c.isActive ? (
                  <Button size="sm" variant="destructive" onClick={() => deactivate(c.id)}>
                    Deactivate
                  </Button>
                ) : (
                  <span className="text-xs text-neutral-600">Inactive</span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
