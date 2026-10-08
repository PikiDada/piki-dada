"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

type Kind = "BODA" | "ECONOMY" | "COMFORT" | "DELIVERY";

interface Row {
  kind: Kind;
  band: 1 | 2 | 3 | 4;
  trips: number;
  durationRatio: number | null;
  distanceRatio: number | null;
  mapsTrips: number;
  mapsDurationRatio: number | null;
  mapsDistanceRatio: number | null;
  factor: number;
}

interface CorrectionSettings {
  durationCorrectionEnabled: boolean;
  durationCorrectionMinTrips: number;
  durationCorrectionMax: number;
}

interface Report {
  windowDays: number;
  bands: Record<string, string>;
  settings: CorrectionSettings;
  rows: Row[];
}

const KIND_LABELS: Record<Kind, string> = {
  BODA: "Boda",
  ECONOMY: "Economy",
  COMFORT: "Comfort",
  DELIVERY: "Deliveries",
};

// actual / estimate as "+30% longer" / "12% shorter" / "spot on".
function describeRatio(ratio: number | null) {
  if (ratio === null) return "—";
  const pct = Math.round((ratio - 1) * 100);
  if (Math.abs(pct) < 3) return "spot on";
  return pct > 0 ? `${pct}% longer` : `${-pct}% shorter`;
}

function ratioClass(ratio: number | null) {
  if (ratio === null) return "text-neutral-400";
  const off = Math.abs(ratio - 1);
  if (off < 0.1) return "text-green-700";
  if (off < 0.25) return "text-amber-700";
  return "text-red-700";
}

export default function EstimateAccuracyPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [settings, setSettings] = useState<CorrectionSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(
    () =>
      apiFetch<Report>("/admin/estimate-accuracy").then(
        (data) => {
          setReport(data);
          setSettings(data.settings);
        },
        (err: unknown) =>
          setError(err instanceof Error ? err.message : "Couldn't load the report"),
      ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaved(null);
    try {
      await apiFetch("/admin/pricing-settings", {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      setSaved("Saved. New bookings use it within a minute.");
      await load();
    } catch (err) {
      setSaved(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  const bands = report ? Object.entries(report.bands) : [];
  const kinds: Kind[] = ["BODA", "ECONOMY", "COMFORT", "DELIVERY"];
  const rowFor = (kind: Kind, band: number) =>
    report?.rows.find((r) => r.kind === kind && r.band === band);

  return (
    <div className="max-w-6xl">
      <h1 className="mb-2 text-2xl font-bold">Estimate accuracy</h1>
      <p className="mb-6 text-sm text-neutral-600">
        How long trips really took compared with the estimate they were priced on, from completed
        trips in the last {report?.windowDays ?? 60} days that Google priced. &quot;30% longer&quot;
        means trips took 30% longer than Google said, so the per-minute part of those fares was
        too low. The maps platform column is our own map&apos;s answer for the same trips, the
        evidence for deciding whether it can replace Google.
      </p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {report && report.rows.length === 0 && (
        <p className="mb-6 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">
          No measured trips yet. Each completed trip with GPS from the rider&apos;s phone adds to
          this report.
        </p>
      )}

      {report && report.rows.length > 0 && (
        <div className="mb-8 overflow-x-auto rounded-xl border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-600">
              <tr>
                <th className="px-3 py-2">Ride type</th>
                <th className="px-3 py-2">Time of day</th>
                <th className="px-3 py-2 text-right">Trips</th>
                <th className="px-3 py-2">Time vs Google</th>
                <th className="px-3 py-2">Distance vs Google</th>
                <th className="px-3 py-2">Time vs our map</th>
                <th className="px-3 py-2">Distance vs our map</th>
                <th className="px-3 py-2 text-right">Correction</th>
              </tr>
            </thead>
            <tbody>
              {kinds.flatMap((kind) =>
                bands.map(([band, label]) => {
                  const row = rowFor(kind, Number(band));
                  if (!row) return null;
                  return (
                    <tr key={`${kind}-${band}`} className="border-t border-neutral-100">
                      <td className="px-3 py-2 font-medium">{KIND_LABELS[kind]}</td>
                      <td className="px-3 py-2 text-neutral-600">{label}</td>
                      <td className="px-3 py-2 text-right">{row.trips}</td>
                      <td className={`px-3 py-2 ${ratioClass(row.durationRatio)}`}>
                        {describeRatio(row.durationRatio)}
                      </td>
                      <td className={`px-3 py-2 ${ratioClass(row.distanceRatio)}`}>
                        {describeRatio(row.distanceRatio)}
                      </td>
                      <td className={`px-3 py-2 ${ratioClass(row.mapsDurationRatio)}`}>
                        {row.mapsTrips > 0 ? describeRatio(row.mapsDurationRatio) : "—"}
                      </td>
                      <td className={`px-3 py-2 ${ratioClass(row.mapsDistanceRatio)}`}>
                        {row.mapsTrips > 0 ? describeRatio(row.mapsDistanceRatio) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.factor === 1 ? "—" : `× ${row.factor}`}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}

      {settings && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Correct Google&apos;s trip times</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-neutral-600">
              Google is asked for trip times without live traffic, the cheaper request. When this
              is on, each new quote&apos;s time is multiplied by the correction shown above for its
              ride type and time of day. A ride type and time with too few trips stays
              uncorrected.
            </p>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={settings.durationCorrectionEnabled}
                onChange={(e) =>
                  setSettings({ ...settings, durationCorrectionEnabled: e.target.checked })
                }
              />
              Use the correction for new bookings
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Trips needed before correcting</span>
                <Input
                  type="number"
                  min={10}
                  max={1000}
                  value={settings.durationCorrectionMinTrips}
                  onChange={(e) =>
                    setSettings({ ...settings, durationCorrectionMinTrips: Number(e.target.value) })
                  }
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Largest correction (×)</span>
                <Input
                  type="number"
                  min={1}
                  max={3}
                  step={0.1}
                  value={settings.durationCorrectionMax}
                  onChange={(e) =>
                    setSettings({ ...settings, durationCorrectionMax: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            {saved && <p className="text-sm text-neutral-600">{saved}</p>}
            <Button className="w-full" disabled={saving} onClick={save}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
