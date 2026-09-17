"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Crosshair, Package, User, type LucideIcon } from "lucide-react";
import { PlaceInput } from "@/components/maps/place-input";
import { TripMap } from "@/components/maps/trip-map";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LatLng, RideType, Trip } from "@/lib/types";
import { PassengerNav } from "@/components/passenger/passenger-nav";

// Line icons rather than colour emoji: emoji render differently on every platform
// and sit oddly against the rest of the app's iconography.
const RIDE_TYPES: { value: RideType; label: string; icon: LucideIcon }[] = [
  { value: "BODA", label: "Passenger", icon: User },
  { value: "BODA", label: "Package Delivery", icon: Package },
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
    <div className="flex min-h-screen flex-col bg-neutral-50 pb-24">
      {/* Full-bleed map with the sheet riding over it: the map reads as the
          surface of the app rather than a widget parked inside a padded box. */}
      <div className="relative">
        <TripMap pickup={pickup} destination={destination} height="300px" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-neutral-50 to-transparent" />
      </div>

      <Card className="relative z-10 mx-3 -mt-8 rounded-3xl shadow-lift">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl">Where to?</CardTitle>
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
            className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 disabled:opacity-50"
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden />
            {locating ? "Getting your location..." : "Use my current location"}
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

          <div className="pt-1">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Ride type
            </p>
            <div className="grid grid-cols-2 gap-2">
              {RIDE_TYPES.map(({ icon: Icon, ...rt }) => (
                <button
                  key={rt.label}
                  type="button"
                  aria-pressed={serviceLabel === rt.label}
                  onClick={() => setServiceLabel(rt.label)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-2xl border py-3.5 text-sm font-medium transition-all duration-200 ease-out active:scale-[0.985]",
                    serviceLabel === rt.label
                      ? "border-neutral-900 bg-neutral-900 text-white shadow-card"
                      : "border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300 hover:bg-white hover:shadow-card",
                  )}
                >
                  <Icon
                    className="h-5 w-5"
                    strokeWidth={serviceLabel === rt.label ? 2.2 : 1.8}
                    aria-hidden
                  />
                  {rt.label}
                </button>
              ))}
            </div>
          </div>

          {/* A labelled row, not a centred box -- it reads as a setting you could
              one day change rather than a stray notice. */}
          <div className="flex items-center justify-between rounded-2xl bg-neutral-100 px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Payment
            </span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
              <Banknote className="h-4 w-4 text-neutral-600" aria-hidden />
              Cash
            </span>
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
