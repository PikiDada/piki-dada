"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

interface AdminDelivery {
  id: string;
  status: string;
  fare: number | null;
  currency: string;
  pickupAddress: string;
  destinationAddress: string;
  itemDescription: string;
  createdAt: string;
  sender: { name: string };
  category: { name: string };
  rider: { user: { name: string } } | null;
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-8 text-neutral-600">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
      <span className="text-sm">Loading...</span>
    </div>
  );
}

export default function AdminDeliveriesPage() {
  const [deliveries, setDeliveries] = useState<AdminDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<AdminDelivery[]>("/admin/deliveries")
      .then(setDeliveries)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Deliveries</h1>
      <div className="space-y-2">
        {loading ? (
          <Spinner />
        ) : deliveries.length === 0 ? (
          <p className="text-neutral-600">No deliveries yet.</p>
        ) : (
          deliveries.map((d) => (
            <Card key={d.id}>
              <CardContent className="flex items-center justify-between pt-4 text-sm">
                <div>
                  <p className="font-medium">
                    {d.sender.name} → {d.rider?.user.name ?? "unassigned"}{" "}
                    <span className="font-normal text-neutral-600">({d.category.name})</span>
                  </p>
                  <p className="text-neutral-600">
                    {d.pickupAddress} → {d.destinationAddress}
                  </p>
                  <p className="text-neutral-600">{d.itemDescription}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">
                    {d.fare?.toLocaleString() ?? "-"} {d.currency}
                  </p>
                  <p className="text-neutral-600">{d.status}</p>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
