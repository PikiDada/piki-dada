"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COMMON_REASONS = [
  "Luggage too big",
  "Waited too long",
  "Wrong pickup location",
  "Changed my mind",
  "Other",
];

interface CancelTripDialogProps {
  onConfirm: (reason: string) => void | Promise<void>;
  onDismiss: () => void;
}

export function CancelTripDialog({ onConfirm, onDismiss }: CancelTripDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (!reason.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
        <p className="font-semibold">Cancel trip</p>
        <p className="mt-1 text-sm text-neutral-500">
          Please tell us why you&apos;re cancelling — it helps us improve.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {COMMON_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r === "Other" ? "" : r)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                reason === r
                  ? "border-black bg-black text-white"
                  : "border-neutral-300 text-neutral-600 hover:border-neutral-400",
              )}
            >
              {r}
            </button>
          ))}
        </div>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Tell us more..."
          rows={3}
          className="mt-3 w-full rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-black"
        />

        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onDismiss} disabled={submitting}>
            Never mind
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={handleConfirm}
            disabled={submitting || !reason.trim()}
          >
            {submitting ? "Cancelling..." : "Confirm cancel"}
          </Button>
        </div>
      </div>
    </div>
  );
}
