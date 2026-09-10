"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { redirectForRole } from "@/lib/auth-helpers";

export default function CompleteProfilePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      router.push("/login");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/users/me", { method: "PATCH", body: JSON.stringify({ phone }) });
      redirectForRole(user.role, router);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save phone number");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Add your phone number</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-neutral-600">
            A phone number is required so drivers and passengers can reach each other during a
            trip.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                required
                pattern="^\+?[0-9\s\(\)\-]{7,20}$"
                title="Enter a valid phone number"
                placeholder="07XXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Saving..." : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
