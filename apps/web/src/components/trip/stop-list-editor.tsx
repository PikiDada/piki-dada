"use client";

import type { Dispatch, SetStateAction } from "react";
import { Plus, X } from "lucide-react";
import { PlaceInput } from "@/components/maps/place-input";
import { Input } from "@/components/ui/input";
import { newStopDraft, type StopDraft } from "@/lib/stops";

interface StopListEditorProps {
  stops: StopDraft[];
  // A state setter, not a plain callback: place lookups resolve asynchronously, so updates must
  // apply to the latest list rather than the one captured when the user picked a suggestion.
  onChange: Dispatch<SetStateAction<StopDraft[]>>;
  max: number;
  // Delivery drop-offs each have their own recipient; ride stops don't.
  withContact?: boolean;
  noun?: string;
  // Numbering continues after stops already reached, which are not editable.
  startNumber?: number;
}

export function StopListEditor({
  stops,
  onChange,
  max,
  withContact = false,
  noun = "stop",
  startNumber = 1,
}: StopListEditorProps) {
  function update(index: number, patch: Partial<StopDraft>) {
    onChange((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  return (
    <div className="space-y-2">
      {stops.map((stop, i) => (
        <div key={stop.key} className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
              {noun} {startNumber + i}
            </p>
            <button
              type="button"
              aria-label={`Remove ${noun} ${startNumber + i}`}
              onClick={() => onChange((prev) => prev.filter((_, j) => j !== i))}
              className="rounded-full p-1 text-neutral-500 hover:bg-amber-100 hover:text-neutral-900"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <PlaceInput
            placeholder={`${noun[0].toUpperCase()}${noun.slice(1)} location`}
            value={stop.address}
            onChange={(address) => update(i, { address, location: undefined })}
            onSelect={(address, location) => update(i, { address, location })}
          />
          {withContact && (
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Recipient name"
                value={stop.contactName ?? ""}
                onChange={(e) => update(i, { contactName: e.target.value })}
              />
              <Input
                placeholder="Recipient phone"
                value={stop.contactPhone ?? ""}
                onChange={(e) => update(i, { contactPhone: e.target.value })}
              />
            </div>
          )}
        </div>
      ))}

      {stops.length < max && (
        <button
          type="button"
          onClick={() => onChange((prev) => [...prev, newStopDraft()])}
          className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add {noun}
        </button>
      )}
    </div>
  );
}
