"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

  const cards: { label: string; value: string | number; href?: string }[] = [
    { label: "Total trips", value: stats.totalTrips, href: "/admin/trips" },
    { label: "Completed trips", value: stats.completedTrips, href: "/admin/trips" },
    { label: "Active drivers", value: stats.activeDrivers, href: "/admin/drivers/active" },
    { label: "Total passengers", value: stats.totalPassengers, href: "/admin/users" },
    { label: "Total revenue (UGX)", value: stats.totalRevenue.toLocaleString() },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map((c) => {
          const body = (
            <CardContent className="pt-6">
              <p className="text-sm text-neutral-600">{c.label}</p>
              <p className="text-2xl font-bold">{c.value}</p>
              {c.href && <p className="mt-1 text-xs text-neutral-600 underline">View details</p>}
            </CardContent>
          );

          return c.href ? (
            <Link key={c.label} href={c.href} className="block">
              <Card className="h-full transition-shadow duration-150 hover:shadow-md">{body}</Card>
            </Link>
          ) : (
            <Card key={c.label} className="h-full">
              {body}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
