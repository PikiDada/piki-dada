"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Banknote, Crosshair, Package, User } from "lucide-react";
import { PlaceInput } from "@/components/maps/place-input";
import { TripMap } from "@/components/maps/trip-map";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import {
  FREE_WAIT_MINUTES_PER_STOP,
  MAX_STOPS,
  type LatLng,
  type RideType,
  type Trip,
} from "@/lib/types";
import { stopsPayload, stopsReady, type StopDraft } from "@/lib/stops";
import { PassengerNav } from "@/components/passenger/passenger-nav";
import { StopListEditor } from "@/components/trip/stop-list-editor";

export default function PassengerBookingPage() {
  const router = useRouter();
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickup, setPickup] = useState<LatLng | undefined>();
  const [destinationAddress, setDestinationAddress] = useState("");
  const [destination, setDestination] = useState<LatLng | undefined>();
  const [stops, setStops] = useState<StopDraft[]>([]);
  const rideType: RideType = "BODA";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const canRequest =
    pickup && destination && pickupAddress && destinationAddress && stopsReady(stops, false);

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
          stops: stopsPayload(stops, false),
          rideType,
          paymentMethod: "CASH",
        }),
      });
      router.push(`/passenger/trip?id=${trip.id}`);
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
        <TripMap
          pickup={pickup}
          destination={destination}
          stops={stops.flatMap((s) => (s.location ? [s.location] : []))}
          height="300px"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-neutral-50 to-transparent" />
      </div>

      <Card className="relative z-10 mx-3 -mt-8 rounded-3xl shadow-lift">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl">Where to?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Ride vs delivery are separate flows with genuinely different shapes (a rider
              travels with you; a delivery has separate pickup/drop-off contacts who often
              aren't you) rather than two labels over the same request, so this switches page
              entirely instead of toggling a field inline. */}
          <div className="grid grid-cols-2 gap-2 pb-1">
            <button
              type="button"
              aria-pressed
              className="flex flex-col items-center gap-1 rounded-2xl border border-neutral-900 bg-neutral-900 py-3.5 text-sm font-medium text-white shadow-card transition-all duration-200 ease-out active:scale-[0.985]"
            >
              <User className="h-5 w-5" strokeWidth={2.2} aria-hidden />
              Book a ride
            </button>
            <Link
              href="/passenger/delivery/new"
              className="flex flex-col items-center gap-1 rounded-2xl border border-neutral-200 bg-neutral-50 py-3.5 text-sm font-medium text-neutral-700 transition-all duration-200 ease-out hover:border-neutral-300 hover:bg-white hover:shadow-card active:scale-[0.985]"
            >
              <Package className="h-5 w-5" strokeWidth={1.8} aria-hidden />
              Send a delivery
            </Link>
          </div>

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
          <StopListEditor stops={stops} onChange={setStops} max={MAX_STOPS} />
          {stops.length > 0 && (
            <p className="text-xs text-neutral-500">
              Waiting at each stop is free for {FREE_WAIT_MINUTES_PER_STOP} minutes, then charged
              per minute.
            </p>
          )}
          <PlaceInput
            placeholder="Destination"
            value={destinationAddress}
            onChange={setDestinationAddress}
            onSelect={(address, location) => {
              setDestinationAddress(address);
              setDestination(location);
            }}
          />

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
