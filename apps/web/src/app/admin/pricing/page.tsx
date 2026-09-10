"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import type { RideType } from "@/lib/types";

interface PricingRule {
  rideType: RideType;
  baseFare: number;
  perKm: number;
  perMinute: number;
  currency: string;
}

const RIDE_TYPES: RideType[] = ["BODA"];

export default function AdminPricingPage() {
  const [rules, setRules] = useState<Record<string, PricingRule>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PricingRule[]>("/admin/pricing").then((data) => {
      const map: Record<string, PricingRule> = {};
      for (const r of data) map[r.rideType] = r;
      setRules(map);
    });
  }, []);

  function getRule(rideType: RideType): PricingRule {
    return rules[rideType] ?? { rideType, baseFare: 0, perKm: 0, perMinute: 0, currency: "UGX" };
  }

  function updateField(rideType: RideType, field: keyof PricingRule, value: string) {
    setRules((prev) => ({
      ...prev,
      [rideType]: {
        ...getRule(rideType),
        [field]: field === "currency" ? value : Number(value),
      },
    }));
  }

  async function save(rideType: RideType) {
    setSaving(rideType);
    const rule = getRule(rideType);
    await apiFetch(`/admin/pricing/${rideType}`, {
      method: "PATCH",
      body: JSON.stringify({
        baseFare: rule.baseFare,
        perKm: rule.perKm,
        perMinute: rule.perMinute,
        currency: rule.currency,
      }),
    });
    setSaving(null);
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Pricing rules</h1>
      <p className="mb-4 text-sm text-neutral-600">
        Shared fare used for both Passenger and Package Delivery requests.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {RIDE_TYPES.map((rt) => {
          const rule = getRule(rt);
          return (
            <Card key={rt}>
              <CardHeader>
                <CardTitle>Boda fare</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Base fare ({rule.currency})</Label>
                  <Input
                    type="number"
                    value={rule.baseFare}
                    onChange={(e) => updateField(rt, "baseFare", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Per km</Label>
                  <Input
                    type="number"
                    value={rule.perKm}
                    onChange={(e) => updateField(rt, "perKm", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Per minute</Label>
                  <Input
                    type="number"
                    value={rule.perMinute}
                    onChange={(e) => updateField(rt, "perMinute", e.target.value)}
                  />
                </div>
                <Button className="w-full" disabled={saving === rt} onClick={() => save(rt)}>
                  {saving === rt ? "Saving..." : "Save"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
