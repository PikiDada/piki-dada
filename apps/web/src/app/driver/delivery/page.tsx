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
  type Delivery,
  type DeliveryStatus,
} from "@/lib/types";

const NEXT_STATUS: Record<string, { next: DeliveryStatus; label: string } | undefined> = {
  ACCEPTED: { next: "ARRIVED_PICKUP", label: "I've arrived at pickup" },
  ARRIVED_PICKUP: { next: "PICKED_UP", label: "I've picked up the item" },
  PICKED_UP: { next: "ARRIVED_DROPOFF", label: "I've arrived at drop-off" },
  ARRIVED_DROPOFF: { next: "DELIVERED", label: "Complete delivery" },
};

const CANCELLABLE_STATUSES = ["ACCEPTED", "ARRIVED_PICKUP"];

// Before pickup, the rider needs the pickup contact and pickup address; once the item is
// collected, both switch to the drop-off side.
const PICKUP_PHASE_STATUSES = ["ACCEPTED", "ARRIVED_PICKUP"];

function DriverDeliveryView({ id }: { id: string }) {
  const router = useRouter();
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [updating, setUpdating] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Delivery>(`/deliveries/${id}`).then(setDelivery);
    const socket = getSocket();
    socket.emit("delivery:join", id);

    const handleUpdate = (updated: Delivery) => {
      if (updated.id === id) setDelivery(updated);
    };
    socket.on(SOCKET_EVENTS.DELIVERY_STATUS_UPDATED, handleUpdate);
    socket.on(SOCKET_EVENTS.DELIVERY_CANCELLED, handleUpdate);
    return () => {
      socket.off(SOCKET_EVENTS.DELIVERY_STATUS_UPDATED, handleUpdate);
      socket.off(SOCKET_EVENTS.DELIVERY_CANCELLED, handleUpdate);
    };
  }, [id]);

  useEffect(() => {
    if (!delivery || delivery.status === "DELIVERED" || delivery.status === "CANCELLED") return;
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition((pos) => {
      getSocket().emit(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, {
        deliveryId: id,
        location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      });
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [delivery, id]);

  async function advanceStatus() {
    if (!delivery) return;
    const step = NEXT_STATUS[delivery.status];
    if (!step) return;
    setUpdating(true);
    setError(null);
    try {
      const updated = await apiFetch<Delivery>(`/deliveries/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: step.next }),
      });
      setDelivery(updated);
      if (step.next === "DELIVERED") {
        setTimeout(() => router.push("/driver"), 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the delivery");
    } finally {
      setUpdating(false);
    }
  }

  async function stopAction(stopId: string, action: "arrive" | "depart") {
    setUpdating(true);
    setError(null);
    try {
      const updated = await apiFetch<Delivery>(
        `/deliveries/${id}/stops/${stopId}/${action}`,
        { method: "PATCH" },
      );
      setDelivery(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the drop-off");
    } finally {
      setUpdating(false);
    }
  }

  async function handleCancel(reason: string) {
    const updated = await apiFetch<Delivery>(`/deliveries/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "CANCELLED", cancellationReason: reason }),
    });
    setDelivery(updated);
    setShowCancelDialog(false);
    setTimeout(() => router.push("/driver"), 1500);
  }

  if (!delivery) return <div className="p-6 text-center text-neutral-600">Loading delivery...</div>;

  const step = NEXT_STATUS[delivery.status];
  const inPickupPhase = PICKUP_PHASE_STATUSES.includes(delivery.status);
  const pickedUp = delivery.status === "PICKED_UP";
  const { current: currentStop, next: nextStop } = stopProgress(delivery.stops);
  // While carrying the item, the rider deals with whichever extra drop-off is in play before
  // the final one.
  const activeStop = pickedUp ? (currentStop ?? nextStop) : undefined;
  const stopNumber = (stopId: string) =>
    (delivery.stops ?? []).findIndex((s) => s.id === stopId) + 1;

  const target = inPickupPhase
    ? { lat: delivery.pickupLat, lng: delivery.pickupLng }
    : (activeStop ?? { lat: delivery.destinationLat, lng: delivery.destinationLng });
  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`;
  const contactName = inPickupPhase
    ? delivery.pickupContactName
    : (activeStop?.contactName ?? delivery.dropoffContactName);
  const contactPhone = inPickupPhase
    ? delivery.pickupContactPhone
    : (activeStop?.contactPhone ?? delivery.dropoffContactPhone);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="p-4">
        <TripMap
          pickup={{ lat: delivery.pickupLat, lng: delivery.pickupLng }}
          destination={{ lat: delivery.destinationLat, lng: delivery.destinationLng }}
          stops={stopLocations(delivery.stops)}
          height="280px"
        />
      </div>

      <Card className="mx-4">
        <CardContent className="space-y-3 pt-6">
          <RouteStops
            pickupAddress={delivery.pickupAddress}
            destinationAddress={delivery.destinationAddress}
            stops={delivery.stops}
            noun="Drop-off"
          />
          <div className="rounded-xl bg-neutral-50 p-3 text-sm">
            <p className="font-medium">{delivery.itemDescription}</p>
            {delivery.sizeTier && <p className="text-neutral-600">{delivery.sizeTier.name}</p>}
            {delivery.isFragile && <p className="text-amber-700">Fragile — handle with care</p>}
            {delivery.isLiquid && <p className="text-amber-700">Liquid/spillable — keep upright</p>}
            {delivery.cashOnDeliveryAmount != null && (
              <p className="text-neutral-600">
                Collect {delivery.cashOnDeliveryAmount.toLocaleString()} {delivery.currency} from
                recipient
              </p>
            )}
          </div>
          <p className="text-2xl font-bold">
            {delivery.fare?.toLocaleString()} {delivery.currency}
          </p>
          {!!delivery.waitingFee && (
            <p className="text-sm text-neutral-600">
              Includes {delivery.waitingFee.toLocaleString()} {delivery.currency} for waiting at
              drop-offs
            </p>
          )}

          <div className="rounded-xl bg-neutral-50 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {inPickupPhase
                ? "Pickup contact"
                : activeStop
                  ? `Drop-off ${stopNumber(activeStop.id)} contact`
                  : "Final drop-off contact"}
            </p>
            <p className="font-medium">{contactName}</p>
            <a href={`tel:${contactPhone}`} className="mt-1 inline-block">
              <Button size="sm" variant="outline">
                Call {inPickupPhase ? "sender" : "recipient"}
              </Button>
            </a>
          </div>

          <a href={navUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="w-full">
              Open navigation
            </Button>
          </a>

          {pickedUp && currentStop && (
            <>
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                At drop-off {stopNumber(currentStop.id)} since{" "}
                {new Date(currentStop.arrivedAt!).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                . The first {FREE_WAIT_MINUTES_PER_STOP} minutes are free; after that the sender
                pays per minute.
              </p>
              <Button
                className="w-full"
                disabled={updating}
                onClick={() => stopAction(currentStop.id, "depart")}
              >
                {updating ? "Updating..." : `Handed over at drop-off ${stopNumber(currentStop.id)}`}
              </Button>
            </>
          )}

          {pickedUp && !currentStop && nextStop && (
            <Button
              className="w-full"
              disabled={updating}
              onClick={() => stopAction(nextStop.id, "arrive")}
            >
              {updating ? "Updating..." : `Arrived at drop-off ${stopNumber(nextStop.id)}`}
            </Button>
          )}

          {/* Every extra drop-off must be handed over before the final one (the API enforces
              this too), so the normal status button only appears once none remain. */}
          {step && !activeStop && (
            <Button className="w-full" disabled={updating} onClick={advanceStatus}>
              {updating
                ? "Updating..."
                : pickedUp && delivery.stops?.length
                  ? "I've arrived at the final drop-off"
                  : step.label}
            </Button>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {CANCELLABLE_STATUSES.includes(delivery.status) && (
            <Button
              variant="destructive"
              className="w-full"
              disabled={updating}
              onClick={() => setShowCancelDialog(true)}
            >
              Cancel delivery
            </Button>
          )}

          {delivery.status === "DELIVERED" && delivery.payment?.status !== "PAID" && (
            <p className="text-center text-green-600">
              Delivery completed! Earnings are added to your wallet once payment is confirmed.
            </p>
          )}
          {delivery.status === "DELIVERED" && delivery.payment?.status === "PAID" && (
            <p className="text-center text-green-600">Delivery completed and paid!</p>
          )}
          {delivery.status === "CANCELLED" && (
            <p className="text-center text-red-600">
              Delivery cancelled{delivery.cancellationReason ? `: ${delivery.cancellationReason}` : ""}
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

export default function DriverDeliveryPage() {
  return <IdFromQuery>{(id) => <DriverDeliveryView id={id} />}</IdFromQuery>;
}
