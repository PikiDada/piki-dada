"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";

interface CouponCheck {
  code: string;
  discountAmount: number | null;
  discountPercent: number | null;
}

function describe(c: CouponCheck) {
  return c.discountPercent
    ? `${c.discountPercent}% off`
    : `${(c.discountAmount ?? 0).toLocaleString()} UGX off`;
}

// Checks a code before booking so the passenger sees what it's worth. The booking request
// re-checks it, since the coupon could run out in between.
export function CouponInput({ onChange }: { onChange: (code: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<CouponCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setChecking(true);
    setError(null);
    try {
      const result = await apiFetch<CouponCheck>(
        `/coupons/check?code=${encodeURIComponent(code.trim())}`,
      );
      setApplied(result);
      onChange(result.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That coupon couldn't be applied");
    } finally {
      setChecking(false);
    }
  }

  function remove() {
    setApplied(null);
    setCode("");
    onChange(null);
  }

  if (applied) {
    return (
      <div className="flex items-center justify-between rounded-2xl bg-green-50 px-4 py-3 text-sm">
        <span>
          <span className="font-mono font-semibold">{applied.code}</span>{" "}
          <span className="text-green-800">applied: {describe(applied)}</span>
        </span>
        <button type="button" onClick={remove} className="text-xs font-medium underline">
          Remove
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-neutral-700 underline"
      >
        Have a coupon?
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          placeholder="Coupon code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="uppercase"
          aria-label="Coupon code"
        />
        <Button
          type="button"
          variant="outline"
          disabled={checking || code.trim().length < 3}
          onClick={apply}
        >
          {checking ? "Checking..." : "Apply"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
