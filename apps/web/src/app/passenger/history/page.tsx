"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import type { Trip } from "@/lib/types";
import { PassengerNav } from "@/components/passenger/passenger-nav";

export default function PassengerHistoryPage() {
  const [trips, setTrips] = useState<Trip[]>([]);

  useEffect(() => {
    apiFetch<Trip[]>("/trips/me").then(setTrips);
  }, []);

  return (
    <div className="min-h-screen p-4 pb-20">
      <h1 className="mb-4 text-xl font-bold">Your rides</h1>
      <div className="space-y-3">
        {trips.length === 0 && <p className="text-sm text-neutral-600">No rides yet.</p>}
        {trips.map((trip) => (
          <Link key={trip.id} href={`/passenger/trip/${trip.id}`}>
            <Card>
              <CardContent className="flex items-center justify-between pt-4">
                <div>
                  <p className="text-sm font-medium">{trip.pickupAddress}</p>
                  <p className="text-xs text-neutral-600">→ {trip.destinationAddress}</p>
                  <p className="mt-1 text-xs text-neutral-600">
                    {new Date(trip.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">
                    {trip.fare?.toLocaleString()} {trip.currency}
                  </p>
                  <p className="text-xs text-neutral-600">{trip.status}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <PassengerNav />
    </div>
  );
}
