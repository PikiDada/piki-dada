"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

interface AdminTrip {
  id: string;
  status: string;
  rideType: string;
  fare: number | null;
  currency: string;
  pickupAddress: string;
  destinationAddress: string;
  createdAt: string;
  passenger: { name: string };
  driver: { user: { name: string } } | null;
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-8 text-neutral-600">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
      <span className="text-sm">Loading...</span>
    </div>
  );
}

export default function AdminTripsPage() {
  const [trips, setTrips] = useState<AdminTrip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<AdminTrip[]>("/admin/trips")
      .then(setTrips)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Ride monitor</h1>
      <div className="space-y-2">
        {loading ? (
          <Spinner />
        ) : trips.length === 0 ? (
          <p className="text-neutral-600">No rides yet.</p>
        ) : trips.map((t) => (
          <Card key={t.id}>
            <CardContent className="flex items-center justify-between pt-4 text-sm">
              <div>
                <p className="font-medium">
                  {t.passenger.name} → {t.driver?.user.name ?? "unassigned"}
                </p>
                <p className="text-neutral-600">
                  {t.pickupAddress} → {t.destinationAddress}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold">
                  {t.fare?.toLocaleString() ?? "-"} {t.currency}
                </p>
                <p className="text-neutral-600">{t.status}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
