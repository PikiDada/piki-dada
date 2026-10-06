"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

interface PricingRule {
  baseFare: number;
  perKm: number;
  perMinute: number;
  waitingPerMinute: number;
  freeWaitMinutes: number;
  currency: string;
}

const EMPTY_RULE: PricingRule = {
  baseFare: 0,
  perKm: 0,
  perMinute: 0,
  waitingPerMinute: 0,
  freeWaitMinutes: 3,
  currency: "UGX",
};

interface DeliverySizeTier {
  id: string;
  name: string;
  maxWeightKg: number | null;
  isActive: boolean;
  sortOrder: number;
  pricingRule: PricingRule | null;
}

interface SurchargeRule {
  id: string;
  key: string;
  label: string;
  amount: number;
  currency: string;
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

export default function AdminDeliverySizeTiersPage() {
  const [tiers, setTiers] = useState<DeliverySizeTier[]>([]);
  const [surcharges, setSurcharges] = useState<SurchargeRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newMaxWeight, setNewMaxWeight] = useState("");
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      apiFetch<DeliverySizeTier[]>("/admin/delivery-size-tiers"),
      apiFetch<SurchargeRule[]>("/admin/delivery-surcharges"),
    ])
      .then(([t, s]) => {
        setTiers(t);
        setSurcharges(s);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function updateTier(id: string, patch: Partial<DeliverySizeTier>) {
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function updatePricing(id: string, patch: Partial<PricingRule>) {
    setTiers((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              pricingRule: {
                ...EMPTY_RULE,
                ...t.pricingRule,
                ...patch,
              },
            }
          : t,
      ),
    );
  }

  async function createTier() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await apiFetch("/admin/delivery-size-tiers", {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          maxWeightKg: newMaxWeight ? Number(newMaxWeight) : undefined,
        }),
      });
      setNewName("");
      setNewMaxWeight("");
      load();
    } finally {
      setCreating(false);
    }
  }

  async function saveDetails(tier: DeliverySizeTier) {
    setSavingId(tier.id);
    try {
      await apiFetch(`/admin/delivery-size-tiers/${tier.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: tier.name,
          maxWeightKg: tier.maxWeightKg,
          isActive: tier.isActive,
          sortOrder: tier.sortOrder,
        }),
      });
    } finally {
      setSavingId(null);
    }
  }

  async function savePricing(tier: DeliverySizeTier) {
    const rule = { ...EMPTY_RULE, ...tier.pricingRule };
    setSavingId(tier.id);
    try {
      await apiFetch(`/admin/delivery-size-tiers/${tier.id}/pricing`, {
        method: "PATCH",
        body: JSON.stringify(rule),
      });
    } finally {
      setSavingId(null);
    }
  }

  function updateSurcharge(id: string, amount: number) {
    setSurcharges((prev) => prev.map((s) => (s.id === id ? { ...s, amount } : s)));
  }

  async function saveSurcharge(surcharge: SurchargeRule) {
    setSavingId(surcharge.id);
    try {
      await apiFetch(`/admin/delivery-surcharges/${surcharge.key}`, {
        method: "PATCH",
        body: JSON.stringify({ amount: surcharge.amount }),
      });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Delivery size tiers</h1>
      <p className="mb-4 text-sm text-neutral-600">
        How hard an item is to carry — this is what actually sets delivery price, independent of
        category. A parcel and a 50kg cargo item are priced differently because of the tier
        they&apos;re in, not what they&apos;re called.
      </p>

      <Card className="mb-6">
        <CardContent className="flex items-end gap-2 pt-6">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="newTierName">New tier name</Label>
            <Input
              id="newTierName"
              placeholder="e.g. Extra heavy (100kg+)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="w-32 space-y-1.5">
            <Label htmlFor="newTierWeight">Max kg</Label>
            <Input
              id="newTierWeight"
              type="number"
              placeholder="optional"
              value={newMaxWeight}
              onChange={(e) => setNewMaxWeight(e.target.value)}
            />
          </div>
          <Button disabled={!newName.trim() || creating} onClick={createTier}>
            {creating ? "Adding..." : "Add tier"}
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {tiers.map((t) => (
              <Card key={t.id}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">{t.name}</CardTitle>
                  <Button
                    size="sm"
                    variant={t.isActive ? "outline" : "default"}
                    onClick={() => {
                      updateTier(t.id, { isActive: !t.isActive });
                      saveDetails({ ...t, isActive: !t.isActive });
                    }}
                  >
                    {t.isActive ? "Active" : "Disabled"}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2 space-y-1.5">
                      <Label>Name</Label>
                      <Input value={t.name} onChange={(e) => updateTier(t.id, { name: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Max kg</Label>
                      <Input
                        type="number"
                        value={t.maxWeightKg ?? ""}
                        placeholder="none"
                        onChange={(e) =>
                          updateTier(t.id, {
                            maxWeightKg: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={savingId === t.id}
                    onClick={() => saveDetails(t)}
                  >
                    {savingId === t.id ? "Saving..." : "Save details"}
                  </Button>

                  <div className="grid grid-cols-3 gap-2 pt-2">
                    <div className="space-y-1.5">
                      <Label>Base fare</Label>
                      <Input
                        type="number"
                        value={t.pricingRule?.baseFare ?? 0}
                        onChange={(e) => updatePricing(t.id, { baseFare: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Per km</Label>
                      <Input
                        type="number"
                        value={t.pricingRule?.perKm ?? 0}
                        onChange={(e) => updatePricing(t.id, { perKm: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Per minute</Label>
                      <Input
                        type="number"
                        value={t.pricingRule?.perMinute ?? 0}
                        onChange={(e) => updatePricing(t.id, { perMinute: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label>Free waiting min / drop-off</Label>
                      <Input
                        type="number"
                        min={0}
                        max={120}
                        value={t.pricingRule?.freeWaitMinutes ?? EMPTY_RULE.freeWaitMinutes}
                        onChange={(e) =>
                          updatePricing(t.id, { freeWaitMinutes: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Then per minute</Label>
                      <Input
                        type="number"
                        min={0}
                        value={t.pricingRule?.waitingPerMinute ?? 0}
                        onChange={(e) =>
                          updatePricing(t.id, { waitingPerMinute: Number(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={savingId === t.id}
                    onClick={() => savePricing(t)}
                  >
                    {savingId === t.id ? "Saving..." : "Save pricing"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Handling surcharges</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-neutral-600">
                Flat fees added on top of the tier fare for items that need extra care.
              </p>
              {surcharges.map((s) => (
                <div key={s.id} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Label>{s.label}</Label>
                    <Input
                      type="number"
                      value={s.amount}
                      onChange={(e) => updateSurcharge(s.id, Number(e.target.value))}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={savingId === s.id}
                    onClick={() => saveSurcharge(s)}
                  >
                    {savingId === s.id ? "Saving..." : "Save"}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
