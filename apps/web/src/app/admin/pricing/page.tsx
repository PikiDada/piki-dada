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
  waitingPerMinute: number;
  freeWaitMinutes: number;
  currency: string;
}

type UnvisitedStopsPolicy = "REMOVE_FROM_FARE" | "CHARGE_QUOTED";

interface PricingSettings {
  fareRoundingUnit: number;
  platformCommissionRate: number;
  unvisitedStopsPolicy: UnvisitedStopsPolicy;
  roadDistanceFallbackFactor: number;
  averageSpeedKmh: number;
}

const RIDE_TYPES: { type: RideType; label: string }[] = [{ type: "BODA", label: "Boda" }];

// Used for the worked examples next to the inputs.
const EXAMPLE_WAIT_MINUTES = 15;

function emptyRule(rideType: RideType): PricingRule {
  return {
    rideType,
    baseFare: 0,
    perKm: 0,
    perMinute: 0,
    waitingPerMinute: 0,
    freeWaitMinutes: 3,
    currency: "UGX",
  };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  // The input sits inside the label, so the two are linked for screen readers and clicks.
  return (
    <div className="space-y-1.5">
      <Label className="flex flex-col gap-1.5">
        <span>{label}</span>
        {children}
      </Label>
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

function SaveStatus({ status }: { status: string | null }) {
  if (!status) return null;
  const failed = status.startsWith("Could not");
  return <p className={failed ? "text-sm text-red-600" : "text-sm text-green-700"}>{status}</p>;
}

export default function AdminPricingPage() {
  const [rules, setRules] = useState<Record<string, PricingRule>>({});
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string | null>>({});

  useEffect(() => {
    apiFetch<PricingRule[]>("/admin/pricing").then((data) => {
      const map: Record<string, PricingRule> = {};
      for (const r of data) map[r.rideType] = r;
      setRules(map);
    });
    apiFetch<PricingSettings>("/admin/pricing-settings").then(setSettings);
  }, []);

  function getRule(rideType: RideType): PricingRule {
    return rules[rideType] ?? emptyRule(rideType);
  }

  function updateRule(rideType: RideType, field: keyof PricingRule, value: string) {
    setRules((prev) => ({
      ...prev,
      [rideType]: { ...getRule(rideType), [field]: field === "currency" ? value : Number(value) },
    }));
  }

  function updateSettings<K extends keyof PricingSettings>(field: K, value: PricingSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  async function save(key: string, run: () => Promise<unknown>) {
    setSaving(key);
    setStatus((s) => ({ ...s, [key]: null }));
    try {
      await run();
      setStatus((s) => ({ ...s, [key]: "Saved. New bookings use these from now on." }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      setStatus((s) => ({ ...s, [key]: `Could not save: ${message}` }));
    } finally {
      setSaving(null);
    }
  }

  function saveRule(rideType: RideType) {
    const r = getRule(rideType);
    return save(rideType, () =>
      apiFetch(`/admin/pricing/${rideType}`, {
        method: "PATCH",
        body: JSON.stringify({
          baseFare: r.baseFare,
          perKm: r.perKm,
          perMinute: r.perMinute,
          waitingPerMinute: r.waitingPerMinute,
          freeWaitMinutes: r.freeWaitMinutes,
          currency: r.currency,
        }),
      }),
    );
  }

  function saveSettings() {
    if (!settings) return;
    return save("settings", async () => {
      const saved = await apiFetch<PricingSettings>("/admin/pricing-settings", {
        method: "PATCH",
        body: JSON.stringify({
          fareRoundingUnit: settings.fareRoundingUnit,
          platformCommissionRate: settings.platformCommissionRate,
          unvisitedStopsPolicy: settings.unvisitedStopsPolicy,
          roadDistanceFallbackFactor: settings.roadDistanceFallbackFactor,
          averageSpeedKmh: settings.averageSpeedKmh,
        }),
      });
      setSettings(saved);
    });
  }

  return (
    <div className="max-w-5xl">
      <h1 className="mb-2 text-2xl font-bold">Pricing</h1>
      <p className="mb-6 text-sm text-neutral-600">
        Every number the app uses to price a ride or delivery is set here. Changes apply to new
        bookings; trips already booked keep the rates they were quoted. Delivery rates per item
        size are under{" "}
        <a href="/admin/delivery-size-tiers" className="underline hover:text-black">
          Delivery pricing
        </a>
        .
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {RIDE_TYPES.map(({ type, label }) => {
          const r = getRule(type);
          const exampleWait =
            Math.max(0, EXAMPLE_WAIT_MINUTES - r.freeWaitMinutes) * r.waitingPerMinute;
          return (
            <Card key={type}>
              <CardHeader>
                <CardTitle>{label} fare</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Field label={`Base fare (${r.currency})`} hint="Charged on every ride.">
                  <Input
                    type="number"
                    min={0}
                    value={r.baseFare}
                    onChange={(e) => updateRule(type, "baseFare", e.target.value)}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Per km">
                    <Input
                      type="number"
                      min={0}
                      value={r.perKm}
                      onChange={(e) => updateRule(type, "perKm", e.target.value)}
                    />
                  </Field>
                  <Field label="Per minute driving">
                    <Input
                      type="number"
                      min={0}
                      value={r.perMinute}
                      onChange={(e) => updateRule(type, "perMinute", e.target.value)}
                    />
                  </Field>
                </div>

                <div className="space-y-3 rounded-xl bg-neutral-50 p-3">
                  <p className="text-sm font-semibold">Waiting at stops</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Free minutes per stop">
                      <Input
                        type="number"
                        min={0}
                        max={120}
                        value={r.freeWaitMinutes}
                        onChange={(e) => updateRule(type, "freeWaitMinutes", e.target.value)}
                      />
                    </Field>
                    <Field label={`Then per minute (${r.currency})`}>
                      <Input
                        type="number"
                        min={0}
                        value={r.waitingPerMinute}
                        onChange={(e) => updateRule(type, "waitingPerMinute", e.target.value)}
                      />
                    </Field>
                  </div>
                  <p className="text-xs text-neutral-500">
                    Example: a {EXAMPLE_WAIT_MINUTES}-minute wait costs the passenger{" "}
                    {exampleWait.toLocaleString()} {r.currency} (before rounding), all of it
                    earnings for the rider less commission.
                  </p>
                </div>

                <SaveStatus status={status[type] ?? null} />
                <Button className="w-full" disabled={saving === type} onClick={() => saveRule(type)}>
                  {saving === type ? "Saving..." : `Save ${label.toLowerCase()} fare`}
                </Button>
              </CardContent>
            </Card>
          );
        })}

        <Card>
          <CardHeader>
            <CardTitle>Rules for every fare</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!settings ? (
              <p className="text-sm text-neutral-500">Loading...</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Round fares to (UGX)"
                    hint="So cash fares can be paid in notes."
                  >
                    <Input
                      type="number"
                      min={1}
                      value={settings.fareRoundingUnit}
                      onChange={(e) => updateSettings("fareRoundingUnit", Number(e.target.value))}
                    />
                  </Field>
                  <Field
                    label="Platform commission (%)"
                    hint="Kept from each paid fare; the rider earns the rest."
                  >
                    <Input
                      type="number"
                      min={0}
                      max={90}
                      step={0.5}
                      value={Math.round(settings.platformCommissionRate * 1000) / 10}
                      onChange={(e) =>
                        updateSettings("platformCommissionRate", Number(e.target.value) / 100)
                      }
                    />
                  </Field>
                </div>

                <Field
                  label="Stops a ride never reached"
                  hint="When a rider ends a ride before visiting every stop."
                >
                  <select
                    value={settings.unvisitedStopsPolicy}
                    onChange={(e) =>
                      updateSettings("unvisitedStopsPolicy", e.target.value as UnvisitedStopsPolicy)
                    }
                    className="h-10 w-full rounded-xl border border-neutral-300 bg-white px-3 text-sm"
                  >
                    <option value="REMOVE_FROM_FARE">
                      Don&apos;t charge for them (never more than the quote)
                    </option>
                    <option value="CHARGE_QUOTED">Charge the full quoted fare</option>
                  </select>
                </Field>

                <div className="space-y-3 rounded-xl bg-neutral-50 p-3">
                  <p className="text-sm font-semibold">When routing is unavailable</p>
                  <p className="text-xs text-neutral-500">
                    Used only if no routing service answers, to estimate the trip from a straight
                    line. The speed also sets the rider-to-pickup time shown to riders.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Road distance = straight line ×">
                      <Input
                        type="number"
                        min={1}
                        max={3}
                        step={0.05}
                        value={settings.roadDistanceFallbackFactor}
                        onChange={(e) =>
                          updateSettings("roadDistanceFallbackFactor", Number(e.target.value))
                        }
                      />
                    </Field>
                    <Field label="Average speed (km/h)">
                      <Input
                        type="number"
                        min={5}
                        max={120}
                        value={settings.averageSpeedKmh}
                        onChange={(e) => updateSettings("averageSpeedKmh", Number(e.target.value))}
                      />
                    </Field>
                  </div>
                </div>

                <SaveStatus status={status.settings ?? null} />
                <Button className="w-full" disabled={saving === "settings"} onClick={saveSettings}>
                  {saving === "settings" ? "Saving..." : "Save rules"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
