"use client";

import { IdFromQuery } from "@/components/routing/id-from-query";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TripMap } from "@/components/maps/trip-map";
import { CancelTripDialog } from "@/components/trip/cancel-trip-dialog";
import { RouteStops } from "@/components/trip/route-stops";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { stopLocations, stopProgress } from "@/lib/stops";
import {
  FREE_WAIT_MINUTES_PER_STOP,
  SOCKET_EVENTS,
  type Trip,
  type TripStatus,
} from "@/lib/types";

const NEXT_STATUS: Record<string, { next: TripStatus; label: string } | undefined> = {
  ACCEPTED: { next: "ARRIVED", label: "I've arrived" },
  ARRIVED: { next: "IN_PROGRESS", label: "Start trip" },
  IN_PROGRESS: { next: "COMPLETED", label: "Complete trip" },
};

const CANCELLABLE_STATUSES = ["ACCEPTED", "ARRIVED"];

function DriverTripView({ id }: { id: string }) {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [updating, setUpdating] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Trip>(`/trips/${id}`).then(setTrip);
    const socket = getSocket();
    socket.emit("trip:join", id);

    const handleUpdate = (updated: Trip) => {
      if (updated.id === id) setTrip(updated);
    };
    socket.on(SOCKET_EVENTS.TRIP_STATUS_UPDATED, handleUpdate);
    socket.on(SOCKET_EVENTS.TRIP_CANCELLED, handleUpdate);
    return () => {
      socket.off(SOCKET_EVENTS.TRIP_STATUS_UPDATED, handleUpdate);
      socket.off(SOCKET_EVENTS.TRIP_CANCELLED, handleUpdate);
    };
  }, [id]);

  useEffect(() => {
    if (!trip || trip.status === "COMPLETED" || trip.status === "CANCELLED") return;
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition((pos) => {
      getSocket().emit(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, {
        tripId: id,
        location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      });
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [trip, id]);

  async function advanceStatus() {
    if (!trip) return;
    const step = NEXT_STATUS[trip.status];
    if (!step) return;
    setUpdating(true);
    try {
      const updated = await apiFetch<Trip>(`/trips/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: step.next }),
      });
      setTrip(updated);
      if (step.next === "COMPLETED") {
        setTimeout(() => router.push("/driver"), 1500);
      }
    } finally {
      setUpdating(false);
    }
  }

  async function stopAction(stopId: string, action: "arrive" | "depart") {
    setUpdating(true);
    setError(null);
    try {
      const updated = await apiFetch<Trip>(`/trips/${id}/stops/${stopId}/${action}`, {
        method: "PATCH",
      });
      setTrip(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the stop");
    } finally {
      setUpdating(false);
    }
  }

  async function handleCancel(reason: string) {
    const updated = await apiFetch<Trip>(`/trips/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "CANCELLED", cancellationReason: reason }),
    });
    setTrip(updated);
    setShowCancelDialog(false);
    setTimeout(() => router.push("/driver"), 1500);
  }

  if (!trip) return <div className="p-6 text-center text-neutral-600">Loading trip...</div>;

  const step = NEXT_STATUS[trip.status];
  const inProgress = trip.status === "IN_PROGRESS";
  const { current: currentStop, next: nextStop } = stopProgress(trip.stops);
  const stopNumber = (stopId: string) => (trip.stops ?? []).findIndex((s) => s.id === stopId) + 1;
  const target = !inProgress
    ? { lat: trip.pickupLat, lng: trip.pickupLng }
    : (nextStop ?? { lat: trip.destinationLat, lng: trip.destinationLng });
  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="p-4">
        <TripMap
          pickup={{ lat: trip.pickupLat, lng: trip.pickupLng }}
          destination={{ lat: trip.destinationLat, lng: trip.destinationLng }}
          stops={stopLocations(trip.stops)}
          height="280px"
        />
      </div>

      <Card className="mx-4">
        <CardContent className="space-y-3 pt-6">
          <RouteStops
            pickupAddress={trip.pickupAddress}
            destinationAddress={trip.destinationAddress}
            stops={trip.stops}
          />
          <p className="text-2xl font-bold">
            {trip.fare?.toLocaleString()} {trip.currency}
          </p>
          {!!trip.waitingFee && (
            <p className="text-sm text-neutral-600">
              Includes {trip.waitingFee.toLocaleString()} {trip.currency} for waiting at stops
            </p>
          )}

          {trip.passenger?.phone && (
            <a href={`tel:${trip.passenger.phone}`} className="inline-block">
              <Button size="sm" variant="outline">
                Call passenger
              </Button>
            </a>
          )}

          <a href={navUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="w-full">
              Open navigation
            </Button>
          </a>

          {inProgress && currentStop && (
            <>
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Waiting at stop {stopNumber(currentStop.id)} since{" "}
                {new Date(currentStop.arrivedAt!).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                . The first {FREE_WAIT_MINUTES_PER_STOP} minutes are free; after that the
                passenger pays per minute.
              </p>
              <Button
                className="w-full"
                disabled={updating}
                onClick={() => stopAction(currentStop.id, "depart")}
              >
                {updating ? "Updating..." : `Leave stop ${stopNumber(currentStop.id)}`}
              </Button>
            </>
          )}

          {inProgress && !currentStop && nextStop && (
            <Button
              className="w-full"
              disabled={updating}
              onClick={() => stopAction(nextStop.id, "arrive")}
            >
              {updating ? "Updating..." : `Arrived at stop ${stopNumber(nextStop.id)}`}
            </Button>
          )}

          {step && (
            <Button
              className="w-full"
              variant={inProgress && (currentStop || nextStop) ? "outline" : "default"}
              disabled={updating}
              onClick={advanceStatus}
            >
              {updating
                ? "Updating..."
                : inProgress && (currentStop || nextStop)
                  ? "End trip here"
                  : step.label}
            </Button>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {CANCELLABLE_STATUSES.includes(trip.status) && (
            <Button
              variant="destructive"
              className="w-full"
              disabled={updating}
              onClick={() => setShowCancelDialog(true)}
            >
              Cancel trip
            </Button>
          )}

          {trip.status === "COMPLETED" && trip.payment?.status !== "PAID" && (
            <p className="text-center text-green-600">
              Trip completed! Earnings are added to your wallet once the passenger's payment is
              confirmed.
            </p>
          )}
          {trip.status === "COMPLETED" && trip.payment?.status === "PAID" && (
            <p className="text-center text-green-600">Trip completed and paid!</p>
          )}
          {trip.status === "CANCELLED" && (
            <p className="text-center text-red-600">
              Trip cancelled{trip.cancellationReason ? `: ${trip.cancellationReason}` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      {showCancelDialog && (
        <CancelTripDialog onConfirm={handleCancel} onDismiss={() => setShowCancelDialog(false)} />
      )}
    </div>
  );
}

export default function DriverTripPage() {
  return <IdFromQuery>{(id) => <DriverTripView id={id} />}</IdFromQuery>;
}
