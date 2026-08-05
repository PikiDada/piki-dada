"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { TripMap } from "@/components/maps/trip-map";
import { CancelTripDialog } from "@/components/trip/cancel-trip-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { SOCKET_EVENTS, type LatLng, type Trip } from "@/lib/types";

const CANCELLABLE_STATUSES = ["SEARCHING", "ACCEPTED", "ARRIVED"];

const STATUS_LABEL: Record<string, string> = {
  SEARCHING: "Looking for a driver nearby...",
  ACCEPTED: "Driver is on the way",
  ARRIVED: "Driver has arrived",
  IN_PROGRESS: "Trip in progress",
  COMPLETED: "Trip completed",
  CANCELLED: "Trip cancelled",
};

export default function PassengerTripPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [driverLocation, setDriverLocation] = useState<LatLng | undefined>();
  const [stars, setStars] = useState(5);
  const [rated, setRated] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  useEffect(() => {
    apiFetch<Trip>(`/trips/${id}`).then(setTrip);

    const socket = getSocket();
    socket.emit("trip:join", id);

    const handleUpdate = (updated: Trip) => {
      if (updated.id === id) setTrip(updated);
    };
    const handleLocation = (data: { tripId: string; location: LatLng }) => {
      if (data.tripId === id) setDriverLocation(data.location);
    };

    socket.on(SOCKET_EVENTS.TRIP_ACCEPTED, handleUpdate);
    socket.on(SOCKET_EVENTS.TRIP_STATUS_UPDATED, handleUpdate);
    socket.on(SOCKET_EVENTS.TRIP_CANCELLED, handleUpdate);
    socket.on(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, handleLocation);

    return () => {
      socket.off(SOCKET_EVENTS.TRIP_ACCEPTED, handleUpdate);
      socket.off(SOCKET_EVENTS.TRIP_STATUS_UPDATED, handleUpdate);
      socket.off(SOCKET_EVENTS.TRIP_CANCELLED, handleUpdate);
      socket.off(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, handleLocation);
    };
  }, [id]);

  async function handleCancel(reason: string) {
    const updated = await apiFetch<Trip>(`/trips/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "CANCELLED", cancellationReason: reason }),
    });
    setTrip(updated);
    setShowCancelDialog(false);
  }

  async function handleRate() {
    await apiFetch(`/trips/${id}/rate`, { method: "POST", body: JSON.stringify({ stars }) });
    setRated(true);
  }

  async function handlePay(provider: "stripe" | "flutterwave") {
    const { url } = await apiFetch<{ url: string }>(`/payments/${id}/${provider}/checkout`, {
      method: "POST",
    });
    window.location.href = url;
  }

  async function handleConfirmCash() {
    const updated = await apiFetch<Trip>(`/payments/${id}/cash/confirm`, { method: "POST" }).then(
      () => apiFetch<Trip>(`/trips/${id}`),
    );
    setTrip(updated);
  }

  if (!trip) return <div className="p-6 text-center text-neutral-400">Loading trip...</div>;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="p-4">
        <TripMap
          pickup={{ lat: trip.pickupLat, lng: trip.pickupLng }}
          destination={{ lat: trip.destinationLat, lng: trip.destinationLng }}
          driverLocation={
            driverLocation ??
            (trip.driver?.currentLat
              ? { lat: trip.driver.currentLat, lng: trip.driver.currentLng! }
              : undefined)
          }
          height="280px"
        />
      </div>

      <Card className="mx-4">
        <CardContent className="space-y-3 pt-6">
          <p className="text-lg font-semibold">{STATUS_LABEL[trip.status] ?? trip.status}</p>
          {trip.status === "CANCELLED" && trip.cancellationReason && (
            <p className="text-sm text-red-600">Reason: {trip.cancellationReason}</p>
          )}
          <p className="text-sm text-neutral-500">
            {trip.pickupAddress} → {trip.destinationAddress}
          </p>
          <p className="text-2xl font-bold">
            {trip.fare?.toLocaleString()} {trip.currency}
          </p>

          {trip.driver && (
            <div className="rounded-xl bg-neutral-50 p-3 text-sm">
              <p className="font-medium">{trip.driver.user?.name}</p>
              <p className="text-neutral-500">
                {trip.driver.vehicle?.make} {trip.driver.vehicle?.model} ·{" "}
                {trip.driver.vehicle?.plateNumber}
              </p>
              {trip.driver.user?.phone && (
                <a href={`tel:${trip.driver.user.phone}`} className="mt-2 inline-block">
                  <Button size="sm" variant="outline">
                    Call driver
                  </Button>
                </a>
              )}
            </div>
          )}

          {CANCELLABLE_STATUSES.includes(trip.status) && (
            <Button variant="destructive" className="w-full" onClick={() => setShowCancelDialog(true)}>
              Cancel ride
            </Button>
          )}

          {trip.status === "COMPLETED" &&
            trip.paymentMethod !== "CASH" &&
            trip.payment?.status !== "PAID" && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Complete your payment</p>
                {trip.paymentMethod === "STRIPE" && (
                  <Button className="w-full" onClick={() => handlePay("stripe")}>
                    Pay with card
                  </Button>
                )}
                {trip.paymentMethod === "FLUTTERWAVE" && (
                  <Button className="w-full" onClick={() => handlePay("flutterwave")}>
                    Pay with Mobile Money
                  </Button>
                )}
              </div>
            )}

          {trip.status === "COMPLETED" &&
            trip.paymentMethod === "CASH" &&
            trip.payment?.status !== "PAID" && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Confirm you've paid the driver {trip.fare?.toLocaleString()} {trip.currency} in cash
                </p>
                <Button className="w-full" onClick={handleConfirmCash}>
                  I've paid in cash
                </Button>
              </div>
            )}

          {trip.status === "COMPLETED" && !rated && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Rate your driver</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => setStars(n)} className="text-2xl">
                    {n <= stars ? "⭐" : "☆"}
                  </button>
                ))}
              </div>
              <Button className="w-full" onClick={handleRate}>
                Submit rating
              </Button>
            </div>
          )}

          {(trip.status === "COMPLETED" || trip.status === "CANCELLED") && (
            <Button variant="outline" className="w-full" onClick={() => router.push("/passenger")}>
              Back to home
            </Button>
          )}
        </CardContent>
      </Card>

      {showCancelDialog && (
        <CancelTripDialog onConfirm={handleCancel} onDismiss={() => setShowCancelDialog(false)} />
      )}
    </div>
  );
}
