"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlaceInput } from "@/components/maps/place-input";
import { TripMap } from "@/components/maps/trip-map";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LatLng, RideType, Trip } from "@/lib/types";
import { PassengerNav } from "@/components/passenger/passenger-nav";

const RIDE_TYPES: { value: RideType; label: string; emoji: string }[] = [
  { value: "BODA", label: "Passenger", emoji: "🧍" },
  { value: "BODA", label: "Package Delivery", emoji: "📦" },
];


export default function PassengerBookingPage() {
  const router = useRouter();
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickup, setPickup] = useState<LatLng | undefined>();
  const [destinationAddress, setDestinationAddress] = useState("");
  const [destination, setDestination] = useState<LatLng | undefined>();
  const rideType: RideType = "BODA";
  const [serviceLabel, setServiceLabel] = useState(RIDE_TYPES[0].label);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const canRequest = pickup && destination && pickupAddress && destinationAddress;

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError("Location is not available on this device");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPickup({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setPickupAddress("Current location");
        setLocating(false);
      },
      () => {
        setError("Could not get your location. Enable location access and try again.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function handleRequestRide() {
    if (!pickup || !destination) return;
    setLoading(true);
    setError(null);
    try {
      const { trip } = await apiFetch<{ trip: Trip; candidateDriverCount: number }>("/trips", {
        method: "POST",
        body: JSON.stringify({
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          pickupAddress,
          destinationLat: destination.lat,
          destinationLng: destination.lng,
          destinationAddress,
          rideType,
          paymentMethod: "CASH",
        }),
      });
      router.push(`/passenger/trip/${trip.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request ride");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col pb-20">
      <div className="p-4">
        <TripMap pickup={pickup} destination={destination} height="260px" />
      </div>

      <Card className="mx-4 -mt-6">
        <CardHeader>
          <CardTitle>Where to?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <PlaceInput
            placeholder="Pickup location"
            value={pickupAddress}
            onChange={setPickupAddress}
            onSelect={(address, location) => {
              setPickupAddress(address);
              setPickup(location);
            }}
          />
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="text-xs text-neutral-600 underline hover:text-neutral-700"
          >
            {locating ? "Getting your location..." : "📍 Use my current location"}
          </button>
          <PlaceInput
            placeholder="Destination"
            value={destinationAddress}
            onChange={setDestinationAddress}
            onSelect={(address, location) => {
              setDestinationAddress(address);
              setDestination(location);
            }}
          />

          <div>
            <p className="mb-2 text-sm font-medium text-neutral-600">Ride type</p>
            <div className="grid grid-cols-2 gap-2">
              {RIDE_TYPES.map((rt) => (
                <button
                  key={rt.label}
                  type="button"
                  onClick={() => setServiceLabel(rt.label)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border py-3 text-sm transition-all duration-150 hover:scale-[1.08] active:scale-[0.92]",
                    serviceLabel === rt.label ? "border-black bg-black text-white" : "border-neutral-300 hover:border-[#F4C12C] hover:bg-yellow-50",
                  )}
                >
                  <span className="text-xl">{rt.emoji}</span>
                  {rt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 px-4 py-2 text-center text-sm font-medium">
            Payment - Cash
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button
            className="w-full"
            size="lg"
            disabled={!canRequest || loading}
            onClick={handleRequestRide}
          >
            {loading ? "Requesting..." : "Request Ride"}
          </Button>
        </CardContent>
      </Card>

      <PassengerNav />
    </div>
  );
}
