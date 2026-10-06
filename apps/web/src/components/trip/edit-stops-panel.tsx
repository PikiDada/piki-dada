"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { draftsFromStops, stopProgress, stopsPayload, stopsReady } from "@/lib/stops";
import { MAX_STOPS, type DeliveryStop, type TripStop } from "@/lib/types";
import { StopListEditor } from "./stop-list-editor";

interface EditStopsPanelProps<T> {
  // "/trips/<id>" or "/deliveries/<id>"
  basePath: string;
  stops: (TripStop | DeliveryStop)[];
  currency: string;
  withContact?: boolean;
  noun?: string;
  onSaved: (updated: T) => void;
  onClose: () => void;
}

interface Preview {
  fare: number;
  previousFare: number | null;
}

// Two steps on purpose: the passenger sees the new fare before the change takes effect, since
// adding a stop mid-trip can raise it.
export function EditStopsPanel<T>({
  basePath,
  stops,
  currency,
  withContact = false,
  noun = "stop",
  onSaved,
  onClose,
}: EditStopsPanelProps<T>) {
  const { locked, pending } = stopProgress(stops);
  const [drafts, setDrafts] = useState(() => draftsFromStops(pending));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = stopsReady(drafts, withContact);

  async function run<R>(fn: () => Promise<R>) {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function checkFare() {
    run(async () => {
      const result = await apiFetch<Preview>(`${basePath}/stops/preview`, {
        method: "POST",
        body: JSON.stringify({ stops: stopsPayload(drafts, withContact) }),
      });
      setPreview(result);
    });
  }

  function confirm() {
    run(async () => {
      const updated = await apiFetch<T>(`${basePath}/stops`, {
        method: "PUT",
        body: JSON.stringify({ stops: stopsPayload(drafts, withContact) }),
      });
      onSaved(updated);
    });
  }

  return (
    <div className="space-y-3 rounded-2xl border border-neutral-200 p-3">
      <p className="text-sm font-semibold">Change {noun}s</p>
      {locked.length > 0 && (
        <p className="text-xs text-neutral-500">
          {locked.length} {noun}
          {locked.length > 1 ? "s" : ""} already reached can&apos;t be changed.
        </p>
      )}
      <StopListEditor
        stops={drafts}
        onChange={(next) => {
          setDrafts(next);
          setPreview(null);
        }}
        max={MAX_STOPS - locked.length}
        withContact={withContact}
        noun={noun}
        startNumber={locked.length + 1}
      />

      {preview && (
        <p className="rounded-xl bg-neutral-100 px-3 py-2 text-sm">
          New fare: <span className="font-semibold">{preview.fare.toLocaleString()} {currency}</span>
          {preview.previousFare != null && (
            <span className="text-neutral-500">
              {" "}
              (was {preview.previousFare.toLocaleString()})
            </span>
          )}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {preview ? (
          <Button className="flex-1" disabled={busy || !ready} onClick={confirm}>
            {busy ? "Saving..." : "Confirm change"}
          </Button>
        ) : (
          <Button className="flex-1" disabled={busy || !ready} onClick={checkFare}>
            {busy ? "Checking..." : "Check new fare"}
          </Button>
        )}
      </div>
    </div>
  );
}
