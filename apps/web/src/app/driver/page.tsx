"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { startRingtone, stopRingtone } from "@/lib/ringtone";
import { SOCKET_EVENTS, type DriverProfile } from "@/lib/types";
import { DriverNav } from "@/components/driver/driver-nav";
import { VehicleSetup, DocumentUpload } from "@/components/driver/vehicle-setup";

interface IncomingRequest {
  tripId: string;
  pickupAddress: string;
  destinationAddress: string;
  fare: number;
  rideType: string;
  distanceToPickupKm?: number;
  etaToPickupMin?: number;
}

export default function DriverDashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [incoming, setIncoming] = useState<IncomingRequest | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [onlineBlockMsg, setOnlineBlockMsg] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const loadProfile = useCallback(() => {
    setLoadError(null);
    apiFetch<DriverProfile>("/drivers/me")
      .then((data) => {
        setProfile(data);
      })
      .catch((err) => {
        setLoadError(
          err instanceof Error
            ? err.message
            : "Could not load your driver profile. The server may be waking up — please retry.",
        );
      });
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    const socket = getSocket();
    const handleRequest = (data: IncomingRequest) => setIncoming(data);
    socket.on(SOCKET_EVENTS.TRIP_REQUESTED, handleRequest);
    return () => {
      socket.off(SOCKET_EVENTS.TRIP_REQUESTED, handleRequest);
    };
  }, []);

  useEffect(() => {
    if (incoming) {
      startRingtone();
    } else {
      stopRingtone();
    }
    return () => stopRingtone();
  }, [incoming]);

  useEffect(() => {
    if (!profile?.isOnline) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }
    if (!navigator.geolocation) return;
    watchIdRef.current = navigator.geolocation.watchPosition((pos) => {
      apiFetch("/drivers/me/location", {
        method: "PATCH",
        body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      }).catch(() => undefined);
    });
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [profile?.isOnline]);

  async function toggleOnline() {
    if (!profile) return;
    setToggling(true);
    try {
      const updated = await apiFetch<DriverProfile>("/drivers/me/availability", {
        method: "PATCH",
        body: JSON.stringify({ isOnline: !profile.isOnline }),
      });
      setProfile({ ...profile, ...updated });
    } catch {
      // approval gate or other error; reload to show banner
      loadProfile();
    } finally {
      setToggling(false);
    }
  }

  async function handleAccept() {
    if (!incoming) return;
    try {
      await apiFetch(`/trips/${incoming.tripId}/accept`, { method: "PATCH" });
      router.push(`/driver/trip/${incoming.tripId}`);
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : "Trip is no longer available");
      setIncoming(null);
    }
  }

  async function handleReject() {
    if (!incoming) return;
    await apiFetch(`/trips/${incoming.tripId}/reject`, { method: "PATCH" });
    setIncoming(null);
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        {loadError ? (
          <>
            <p className="text-sm text-red-600">{loadError}</p>
            <Button onClick={loadProfile}>Retry</Button>
          </>
        ) : (
          <p className="text-neutral-400">Loading...</p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 pb-20">
      {incoming && (
        <div className="fixed inset-x-4 top-4 z-50 rounded-2xl border border-black bg-white p-4 shadow-xl">
          <p className="font-semibold">New ride request</p>
          <p className="text-sm text-neutral-500">
            {incoming.pickupAddress} → {incoming.destinationAddress}
          </p>
          <p className="text-lg font-bold">{incoming.fare?.toLocaleString()} UGX</p>
          {incoming.distanceToPickupKm != null && (
            <p className="mt-1 text-sm font-medium text-neutral-700">
              {incoming.distanceToPickupKm.toFixed(1)} km away
              {incoming.etaToPickupMin != null && ` · ~${incoming.etaToPickupMin} min to pickup`}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" onClick={handleAccept}>
              Accept
            </Button>
            <Button variant="outline" className="flex-1" onClick={handleReject}>
              Reject
            </Button>
          </div>
        </div>
      )}

      {acceptError && (
        <div className="mb-4 flex items-center justify-between rounded-xl bg-red-50 p-3 text-sm text-red-800">
          <span>{acceptError}</span>
          <button type="button" onClick={() => setAcceptError(null)} className="font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {profile.approvalStatus === "PENDING" && (
        <div className="mb-4 rounded-xl bg-yellow-50 p-3 text-sm text-yellow-800">
          Your account is pending admin approval. We will review your application and notify you once it is approved.
        </div>
      )}
      {profile.approvalStatus === "REJECTED" && (
        <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          Your application was rejected. Contact support for details.
        </div>
      )}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{profile.user.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-neutral-500">
            ⭐ {profile.rating.toFixed(1)} · {profile.totalTrips} trips
          </p>
          <Button
            className="mt-4 w-full"
            disabled={toggling}
            onClick={() => {
              if (profile.approvalStatus !== "APPROVED") {
                setOnlineBlockMsg(
                  profile.approvalStatus === "REJECTED"
                    ? "Your application was rejected. Contact support to appeal."
                    : "Your account is still pending admin approval. You will be able to go online once approved.",
                );
                return;
              }
              setOnlineBlockMsg(null);
              toggleOnline();
            }}
          >
            {profile.isOnline ? "Go offline" : "Go online"}
          </Button>
          {onlineBlockMsg && (
            <p className="mt-2 text-center text-xs text-yellow-700">{onlineBlockMsg}</p>
          )}
        </CardContent>
      </Card>

      {!profile.vehicle && <VehicleSetup onDone={loadProfile} />}
      {profile.approvalStatus !== "APPROVED" && profile.documents.length < 4 && (
        <div className="mt-4">
          <DocumentUpload onUploaded={loadProfile} />
        </div>
      )}

      <DriverNav />
    </div>
  );
}
