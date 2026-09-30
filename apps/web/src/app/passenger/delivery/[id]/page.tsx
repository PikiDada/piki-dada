"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { TripMap } from "@/components/maps/trip-map";
import { CancelTripDialog } from "@/components/trip/cancel-trip-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { SOCKET_EVENTS, type Delivery, type LatLng } from "@/lib/types";

const CANCELLABLE_STATUSES = ["SEARCHING", "ACCEPTED", "ARRIVED_PICKUP"];

const STATUS_LABEL: Record<string, string> = {
  SEARCHING: "Looking for a rider nearby...",
  ACCEPTED: "Rider is on the way to pickup",
  ARRIVED_PICKUP: "Rider has arrived at pickup",
  PICKED_UP: "Rider has your item, on the way to drop-off",
  ARRIVED_DROPOFF: "Rider has arrived at drop-off",
  DELIVERED: "Delivered",
  CANCELLED: "Delivery cancelled",
};

export default function PassengerDeliveryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [riderLocation, setRiderLocation] = useState<LatLng | undefined>();
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  useEffect(() => {
    apiFetch<Delivery>(`/deliveries/${id}`).then(setDelivery);

    const socket = getSocket();
    socket.emit("delivery:join", id);

    const handleUpdate = (updated: Delivery) => {
      if (updated.id === id) setDelivery(updated);
    };
    const handleLocation = (data: { deliveryId?: string; location: LatLng }) => {
      if (data.deliveryId === id) setRiderLocation(data.location);
    };

    socket.on(SOCKET_EVENTS.DELIVERY_ACCEPTED, handleUpdate);
    socket.on(SOCKET_EVENTS.DELIVERY_STATUS_UPDATED, handleUpdate);
    socket.on(SOCKET_EVENTS.DELIVERY_CANCELLED, handleUpdate);
    socket.on(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, handleLocation);

    return () => {
      socket.off(SOCKET_EVENTS.DELIVERY_ACCEPTED, handleUpdate);
      socket.off(SOCKET_EVENTS.DELIVERY_STATUS_UPDATED, handleUpdate);
      socket.off(SOCKET_EVENTS.DELIVERY_CANCELLED, handleUpdate);
      socket.off(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, handleLocation);
    };
  }, [id]);

  async function handleCancel(reason: string) {
    const updated = await apiFetch<Delivery>(`/deliveries/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "CANCELLED", cancellationReason: reason }),
    });
    setDelivery(updated);
    setShowCancelDialog(false);
  }

  async function handlePay(provider: "stripe" | "flutterwave") {
    const { url } = await apiFetch<{ url: string }>(`/payments/delivery/${id}/${provider}/checkout`, {
      method: "POST",
    });
    window.location.href = url;
  }

  async function handleConfirmCash() {
    const updated = await apiFetch<Delivery>(`/payments/delivery/${id}/cash/confirm`, {
      method: "POST",
    }).then(() => apiFetch<Delivery>(`/deliveries/${id}`));
    setDelivery(updated);
  }

  if (!delivery) return <div className="p-6 text-center text-neutral-600">Loading delivery...</div>;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="p-4">
        <TripMap
          pickup={{ lat: delivery.pickupLat, lng: delivery.pickupLng }}
          destination={{ lat: delivery.destinationLat, lng: delivery.destinationLng }}
          driverLocation={
            riderLocation ??
            (delivery.rider?.currentLat
              ? { lat: delivery.rider.currentLat, lng: delivery.rider.currentLng! }
              : undefined)
          }
          height="280px"
        />
      </div>

      <Card className="mx-4">
        <CardContent className="space-y-3 pt-6">
          <p className="text-lg font-semibold">{STATUS_LABEL[delivery.status] ?? delivery.status}</p>
          {delivery.status === "CANCELLED" && delivery.cancellationReason && (
            <p className="text-sm text-red-600">Reason: {delivery.cancellationReason}</p>
          )}
          <p className="text-sm text-neutral-600">
            {delivery.pickupAddress} → {delivery.destinationAddress}
          </p>
          <div className="rounded-xl bg-neutral-50 p-3 text-sm">
            <p className="font-medium">{delivery.itemDescription}</p>
            {delivery.sizeTier && <p className="text-neutral-600">{delivery.sizeTier.name}</p>}
            {delivery.isFragile && <p className="text-amber-700">Fragile</p>}
            {delivery.isLiquid && <p className="text-amber-700">Liquid/spillable</p>}
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

          {delivery.rider && (
            <div className="rounded-xl bg-neutral-50 p-3 text-sm">
              <p className="font-medium">{delivery.rider.user?.name}</p>
              <p className="text-neutral-600">
                {delivery.rider.vehicle?.make} {delivery.rider.vehicle?.model} ·{" "}
                {delivery.rider.vehicle?.plateNumber}
              </p>
              {delivery.rider.user?.phone && (
                <a href={`tel:${delivery.rider.user.phone}`} className="mt-2 inline-block">
                  <Button size="sm" variant="outline">
                    Call rider
                  </Button>
                </a>
              )}
            </div>
          )}

          {CANCELLABLE_STATUSES.includes(delivery.status) && (
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => setShowCancelDialog(true)}
            >
              Cancel delivery
            </Button>
          )}

          {delivery.status === "DELIVERED" &&
            delivery.paymentMethod !== "CASH" &&
            delivery.payment?.status !== "PAID" && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Complete your payment</p>
                {delivery.paymentMethod === "STRIPE" && (
                  <Button className="w-full" onClick={() => handlePay("stripe")}>
                    Pay with card
                  </Button>
                )}
                {delivery.paymentMethod === "FLUTTERWAVE" && (
                  <Button className="w-full" onClick={() => handlePay("flutterwave")}>
                    Pay with Mobile Money
                  </Button>
                )}
              </div>
            )}

          {delivery.status === "DELIVERED" &&
            delivery.paymentMethod === "CASH" &&
            delivery.payment?.status !== "PAID" && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Confirm you&apos;ve paid the rider {delivery.fare?.toLocaleString()}{" "}
                  {delivery.currency} in cash
                </p>
                <Button className="w-full" onClick={handleConfirmCash}>
                  I&apos;ve paid in cash
                </Button>
              </div>
            )}

          {(delivery.status === "DELIVERED" || delivery.status === "CANCELLED") && (
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
