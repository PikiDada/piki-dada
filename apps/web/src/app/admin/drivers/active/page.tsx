"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import type { Vehicle } from "@/lib/types";

interface ActiveDriver {
  id: string;
  rating: number;
  totalTrips: number;
  currentLat: number | null;
  currentLng: number | null;
  vehicle: Vehicle | null;
  user: { id: string; name: string; email: string; phone?: string | null };
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-8 text-neutral-600">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
      <span className="text-sm">Loading...</span>
    </div>
  );
}

export default function AdminActiveDriversPage() {
  const [drivers, setDrivers] = useState<ActiveDriver[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<ActiveDriver[]>("/admin/drivers/active")
      .then(setDrivers)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Link href="/admin" className="text-sm text-neutral-600 underline hover:text-black">
        &larr; Back to dashboard
      </Link>
      <h1 className="mt-3 mb-6 text-2xl font-bold">
        Active drivers{!loading && ` (${drivers.length})`}
      </h1>

      <div className="space-y-3">
        {loading ? (
          <Spinner />
        ) : drivers.length === 0 ? (
          <p className="text-neutral-600">No drivers are online right now.</p>
        ) : (
          drivers.map((d) => (
            <Card key={d.id}>
              <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-4">
                <div>
                  <p className="font-medium">{d.user.name}</p>
                  <p className="text-sm text-neutral-600">{d.user.email}</p>
                  {d.user.phone && <p className="text-sm text-neutral-600">{d.user.phone}</p>}
                  {d.vehicle ? (
                    <p className="mt-1 text-sm text-neutral-600">
                      {d.vehicle.make} {d.vehicle.model} &middot; {d.vehicle.plateNumber} &middot;{" "}
                      {d.vehicle.rideType}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-yellow-600">No vehicle on file</p>
                  )}
                </div>

                <div className="text-right text-sm text-neutral-600">
                  <p>
                    <span className="font-medium text-black">{d.totalTrips}</span> trips
                  </p>
                  <p>
                    Rating <span className="font-medium text-black">{d.rating.toFixed(1)}</span>
                  </p>
                  {d.currentLat != null && d.currentLng != null ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${d.currentLat},${d.currentLng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-black"
                    >
                      View location
                    </a>
                  ) : (
                    <p className="text-xs">No location yet</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
