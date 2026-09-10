"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

interface Stats {
  totalTrips: number;
  completedTrips: number;
  activeDrivers: number;
  totalPassengers: number;
  totalRevenue: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    apiFetch<Stats>("/admin/stats").then(setStats);
  }, []);

  if (!stats) return <p className="text-neutral-600">Loading...</p>;

  const cards = [
    { label: "Total trips", value: stats.totalTrips },
    { label: "Completed trips", value: stats.completedTrips },
    { label: "Active drivers", value: stats.activeDrivers },
    { label: "Total passengers", value: stats.totalPassengers },
    { label: "Total revenue (UGX)", value: stats.totalRevenue.toLocaleString() },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-6">
              <p className="text-sm text-neutral-600">{c.label}</p>
              <p className="text-2xl font-bold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
