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
  currency: string;
}

interface DeliveryCategory {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  pricingRule: PricingRule | null;
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-8 text-neutral-600">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
      <span className="text-sm">Loading...</span>
    </div>
  );
}

export default function AdminDeliveryCategoriesPage() {
  const [categories, setCategories] = useState<DeliveryCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    apiFetch<DeliveryCategory[]>("/admin/delivery-categories")
      .then(setCategories)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function updateCategory(id: string, patch: Partial<DeliveryCategory>) {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function updatePricing(id: string, patch: Partial<PricingRule>) {
    setCategories((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              pricingRule: {
                baseFare: 0,
                perKm: 0,
                perMinute: 0,
                currency: "UGX",
                ...c.pricingRule,
                ...patch,
              },
            }
          : c,
      ),
    );
  }

  async function createCategory() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await apiFetch("/admin/delivery-categories", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName("");
      load();
    } finally {
      setCreating(false);
    }
  }

  async function saveDetails(category: DeliveryCategory) {
    setSavingId(category.id);
    try {
      await apiFetch(`/admin/delivery-categories/${category.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: category.name,
          icon: category.icon,
          description: category.description,
          isActive: category.isActive,
          sortOrder: category.sortOrder,
        }),
      });
    } finally {
      setSavingId(null);
    }
  }

  async function savePricing(category: DeliveryCategory) {
    const rule = category.pricingRule ?? { baseFare: 0, perKm: 0, perMinute: 0, currency: "UGX" };
    setSavingId(category.id);
    try {
      await apiFetch(`/admin/delivery-categories/${category.id}/pricing`, {
        method: "PATCH",
        body: JSON.stringify(rule),
      });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Delivery categories</h1>
      <p className="mb-4 text-sm text-neutral-600">
        Every category matches a motorcycle rider (Boda vehicle) — there&apos;s no separate vehicle
        type to pick. Add as many categories as you need; disable one to hide it from the
        booking form without losing its history.
      </p>

      <Card className="mb-6">
        <CardContent className="flex items-end gap-2 pt-6">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="newCategory">New category name</Label>
            <Input
              id="newCategory"
              placeholder="e.g. Medicine"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <Button disabled={!newName.trim() || creating} onClick={createCategory}>
            {creating ? "Adding..." : "Add category"}
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {categories.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">{c.name}</CardTitle>
                <Button
                  size="sm"
                  variant={c.isActive ? "outline" : "default"}
                  onClick={() => {
                    updateCategory(c.id, { isActive: !c.isActive });
                    saveDetails({ ...c, isActive: !c.isActive });
                  }}
                >
                  {c.isActive ? "Active" : "Disabled"}
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={c.name} onChange={(e) => updateCategory(c.id, { name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Input
                    value={c.description ?? ""}
                    onChange={(e) => updateCategory(c.id, { description: e.target.value })}
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={savingId === c.id}
                  onClick={() => saveDetails(c)}
                >
                  {savingId === c.id ? "Saving..." : "Save details"}
                </Button>

                <div className="grid grid-cols-3 gap-2 pt-2">
                  <div className="space-y-1.5">
                    <Label>Base fare</Label>
                    <Input
                      type="number"
                      value={c.pricingRule?.baseFare ?? 0}
                      onChange={(e) => updatePricing(c.id, { baseFare: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Per km</Label>
                    <Input
                      type="number"
                      value={c.pricingRule?.perKm ?? 0}
                      onChange={(e) => updatePricing(c.id, { perKm: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Per minute</Label>
                    <Input
                      type="number"
                      value={c.pricingRule?.perMinute ?? 0}
                      onChange={(e) => updatePricing(c.id, { perMinute: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={savingId === c.id}
                  onClick={() => savePricing(c)}
                >
                  {savingId === c.id ? "Saving..." : "Save pricing"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
