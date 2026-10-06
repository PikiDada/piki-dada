"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Banknote, Crosshair, Package, User } from "lucide-react";
import { PlaceInput } from "@/components/maps/place-input";
import { TripMap } from "@/components/maps/trip-map";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  FREE_WAIT_MINUTES_PER_STOP,
  MAX_STOPS,
  type LatLng,
  type Delivery,
  type DeliveryCategory,
  type DeliverySizeTier,
} from "@/lib/types";
import { stopsPayload, stopsReady, type StopDraft } from "@/lib/stops";
import { PassengerNav } from "@/components/passenger/passenger-nav";
import { StopListEditor } from "@/components/trip/stop-list-editor";

export default function NewDeliveryPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<DeliveryCategory[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sizeTiers, setSizeTiers] = useState<DeliverySizeTier[]>([]);
  const [sizeTierId, setSizeTierId] = useState<string | null>(null);

  const [pickupAddress, setPickupAddress] = useState("");
  const [pickup, setPickup] = useState<LatLng | undefined>();
  const [pickupContactName, setPickupContactName] = useState("");
  const [pickupContactPhone, setPickupContactPhone] = useState("");
  const [locating, setLocating] = useState(false);

  const [destinationAddress, setDestinationAddress] = useState("");
  const [destination, setDestination] = useState<LatLng | undefined>();
  const [dropoffContactName, setDropoffContactName] = useState("");
  const [dropoffContactPhone, setDropoffContactPhone] = useState("");
  const [stops, setStops] = useState<StopDraft[]>([]);

  const [itemDescription, setItemDescription] = useState("");
  const [itemPhotoUrl, setItemPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [isFragile, setIsFragile] = useState(false);
  const [isLiquid, setIsLiquid] = useState(false);
  const [cashOnDeliveryAmount, setCashOnDeliveryAmount] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<DeliveryCategory[]>("/deliveries/categories").then((list) => {
      setCategories(list);
      setCategoryId((current) => current ?? list[0]?.id ?? null);
    });
    apiFetch<DeliverySizeTier[]>("/deliveries/size-tiers").then((list) => {
      setSizeTiers(list);
      setSizeTierId((current) => current ?? list[0]?.id ?? null);
    });
  }, []);

  const canRequest =
    categoryId &&
    sizeTierId &&
    pickup &&
    destination &&
    pickupContactName &&
    pickupContactPhone &&
    dropoffContactName &&
    dropoffContactPhone &&
    itemDescription &&
    stopsReady(stops, true);

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

  async function handlePhotoChange(file: File | undefined) {
    if (!file) return;
    setUploadingPhoto(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { fileUrl } = await apiFetch<{ fileUrl: string }>("/deliveries/upload-photo", {
        method: "POST",
        body: formData,
      });
      setItemPhotoUrl(fileUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload photo");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleRequestDelivery() {
    if (!pickup || !destination || !categoryId || !sizeTierId) return;
    setLoading(true);
    setError(null);
    try {
      const { delivery } = await apiFetch<{ delivery: Delivery; candidateRiderCount: number }>(
        "/deliveries",
        {
          method: "POST",
          body: JSON.stringify({
            categoryId,
            sizeTierId,
            pickupLat: pickup.lat,
            pickupLng: pickup.lng,
            pickupAddress,
            pickupContactName,
            pickupContactPhone,
            destinationLat: destination.lat,
            destinationLng: destination.lng,
            destinationAddress,
            dropoffContactName,
            dropoffContactPhone,
            stops: stopsPayload(stops, true),
            itemDescription,
            itemPhotoUrl,
            isFragile,
            isLiquid,
            cashOnDeliveryAmount: cashOnDeliveryAmount ? Number(cashOnDeliveryAmount) : undefined,
            paymentMethod: "CASH",
          }),
        },
      );
      router.push(`/passenger/delivery?id=${delivery.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request delivery");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 pb-24">
      <div className="relative">
        <TripMap
          pickup={pickup}
          destination={destination}
          stops={stops.flatMap((s) => (s.location ? [s.location] : []))}
          height="220px"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-neutral-50 to-transparent" />
      </div>

      <Card className="relative z-10 mx-3 -mt-8 rounded-3xl shadow-lift">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl">Send a delivery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 pb-1">
            <Link
              href="/passenger"
              className="flex flex-col items-center gap-1 rounded-2xl border border-neutral-200 bg-neutral-50 py-3.5 text-sm font-medium text-neutral-700 transition-all duration-200 ease-out hover:border-neutral-300 hover:bg-white hover:shadow-card active:scale-[0.985]"
            >
              <User className="h-5 w-5" strokeWidth={1.8} aria-hidden />
              Book a ride
            </Link>
            <button
              type="button"
              aria-pressed
              className="flex flex-col items-center gap-1 rounded-2xl border border-neutral-900 bg-neutral-900 py-3.5 text-sm font-medium text-white shadow-card transition-all duration-200 ease-out active:scale-[0.985]"
            >
              <Package className="h-5 w-5" strokeWidth={2.2} aria-hidden />
              Send a delivery
            </button>
          </div>

          {categories.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                What are you sending?
              </p>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={categoryId === c.id}
                    onClick={() => setCategoryId(c.id)}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150",
                      categoryId === c.id
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-300 text-neutral-700 hover:border-neutral-400",
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {sizeTiers.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                How big/heavy is it?
              </p>
              <div className="flex flex-wrap gap-2">
                {sizeTiers.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={sizeTierId === t.id}
                    onClick={() => setSizeTierId(t.id)}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150",
                      sizeTierId === t.id
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-300 text-neutral-700 hover:border-neutral-400",
                    )}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-neutral-500">
                Price depends on this, not the category above — a small parcel and a heavy
                cargo item cost differently even in the same category.
              </p>
            </div>
          )}

          <div className="space-y-2 rounded-2xl bg-neutral-100 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Pickup</p>
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
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 disabled:opacity-50"
            >
              <Crosshair className="h-3.5 w-3.5" aria-hidden />
              {locating ? "Getting your location..." : "Use my current location"}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Contact name"
                value={pickupContactName}
                onChange={(e) => setPickupContactName(e.target.value)}
              />
              <Input
                placeholder="Contact phone"
                value={pickupContactPhone}
                onChange={(e) => setPickupContactPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <StopListEditor
              stops={stops}
              onChange={setStops}
              max={MAX_STOPS}
              withContact
              noun="drop-off"
            />
            {stops.length > 0 && (
              <p className="text-xs text-neutral-500">
                The rider visits these in order before the final drop-off. Waiting at each is
                free for {FREE_WAIT_MINUTES_PER_STOP} minutes, then charged per minute.
              </p>
            )}
          </div>

          <div className="space-y-2 rounded-2xl bg-neutral-100 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {stops.length > 0 ? "Final drop-off" : "Drop-off"}
            </p>
            <PlaceInput
              placeholder="Drop-off location"
              value={destinationAddress}
              onChange={setDestinationAddress}
              onSelect={(address, location) => {
                setDestinationAddress(address);
                setDestination(location);
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Recipient name"
                value={dropoffContactName}
                onChange={(e) => setDropoffContactName(e.target.value)}
              />
              <Input
                placeholder="Recipient phone"
                value={dropoffContactPhone}
                onChange={(e) => setDropoffContactPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="itemDescription">What&apos;s the item?</Label>
            <textarea
              id="itemDescription"
              value={itemDescription}
              onChange={(e) => setItemDescription(e.target.value)}
              placeholder="e.g. A sealed envelope with documents"
              rows={2}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-black"
            />
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-200">
                {uploadingPhoto ? "Uploading..." : itemPhotoUrl ? "Photo added ✓" : "Add a photo (optional)"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploadingPhoto}
                  onChange={(e) => handlePhotoChange(e.target.files?.[0])}
                />
              </label>
              <label className="inline-flex items-center gap-1.5 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={isFragile}
                  onChange={(e) => setIsFragile(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300"
                />
                Fragile
              </label>
              <label className="inline-flex items-center gap-1.5 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={isLiquid}
                  onChange={(e) => setIsLiquid(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300"
                />
                Liquid/spillable
              </label>
            </div>
            {(isFragile || isLiquid) && (
              <p className="text-xs text-neutral-500">
                A small handling fee applies for fragile/liquid items.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cod">Cash to collect from recipient (optional)</Label>
            <Input
              id="cod"
              type="number"
              min={0}
              placeholder="e.g. 50000"
              value={cashOnDeliveryAmount}
              onChange={(e) => setCashOnDeliveryAmount(e.target.value)}
            />
          </div>

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
            disabled={!canRequest || loading || uploadingPhoto}
            onClick={handleRequestDelivery}
          >
            {loading ? "Requesting..." : "Find a rider"}
          </Button>
        </CardContent>
      </Card>

      <PassengerNav />
    </div>
  );
}
