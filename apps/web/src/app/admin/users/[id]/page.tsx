"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, apiUrl } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import type { DocumentType, DriverApprovalStatus, RideType, TripStatus } from "@/lib/types";

const ROLE_LABELS: Record<string, string> = {
  PASSENGER: "Passenger",
  DRIVER: "Rider",
  ADMIN: "Admin",
};

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  NATIONAL_ID: "National ID",
  DRIVING_PERMIT: "Driving Permit",
  VEHICLE_REGISTRATION: "Motorcycle Registration",
  INSURANCE: "Insurance",
};

interface DetailTrip {
  id: string;
  status: TripStatus;
  rideType: RideType;
  fare: number | null;
  currency: string;
  pickupAddress: string;
  destinationAddress: string;
  createdAt: string;
  driver?: { user: { name: string } } | null;
  passenger?: { name: string };
}

interface UserDetail {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  emailVerifiedAt: string | null;
  createdAt: string;
  wallet: { balance: number; currency: string } | null;
  savedPlaces: { id: string; label: string; address: string }[];
  emergencyContact: { id: string; name: string; phone: string }[];
  driverProfile: {
    id: string;
    approvalStatus: DriverApprovalStatus;
    isOnline: boolean;
    rating: number;
    totalTrips: number;
    vehicle: {
      make: string;
      model: string;
      color: string;
      plateNumber: string;
      rideType: RideType;
    } | null;
    documents: { id: string; type: DocumentType; fileUrl: string }[];
  } | null;
  passengerTrips: DetailTrip[];
  driverTrips: DetailTrip[];
  ratingsReceived: {
    id: string;
    stars: number;
    comment: string | null;
    createdAt: string;
    fromUser: { name: string };
  }[];
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-8 text-neutral-600">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
      <span className="text-sm">Loading...</span>
    </div>
  );
}

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>{children}</span>;
}

async function viewDocument(docId: string, docType: DocumentType, personName: string) {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(apiUrl(`/admin/documents/${docId}`), {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    alert("Could not load document. Please try again.");
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  void docType;
  void personName;
}

function TripRow({ trip, otherPartyLabel }: { trip: DetailTrip; otherPartyLabel: string }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-100 py-2 text-sm last:border-0">
      <div>
        <p className="font-medium">{otherPartyLabel}</p>
        <p className="text-neutral-600">
          {trip.pickupAddress} &rarr; {trip.destinationAddress}
        </p>
        <p className="text-xs text-neutral-500">{new Date(trip.createdAt).toLocaleString()}</p>
      </div>
      <div className="text-right">
        <p className="font-semibold">
          {trip.fare?.toLocaleString() ?? "-"} {trip.currency}
        </p>
        <p className="text-neutral-600">{trip.status}</p>
      </div>
    </div>
  );
}

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<UserDetail>(`/admin/users/${id}`)
      .then(setUser)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load user"))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div>
      <Link href="/admin/users" className="text-sm text-neutral-600 underline hover:text-black">
        &larr; Back to users
      </Link>

      {loading ? (
        <Spinner />
      ) : error || !user ? (
        <p className="mt-4 text-red-600">{error ?? "User not found"}</p>
      ) : (
        <>
          <div className="mt-3 mb-6 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{user.name}</h1>
            <Pill className="bg-neutral-100 text-neutral-700">{ROLE_LABELS[user.role] ?? user.role}</Pill>
            {!user.isActive && <Pill className="bg-red-100 text-red-700">Suspended</Pill>}
            {!user.emailVerifiedAt && <Pill className="bg-amber-100 text-amber-800">Unverified</Pill>}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Contact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 pt-0 text-sm">
                <p>{user.email}</p>
                <p>{user.phone ?? "No phone on file"}</p>
                <p className="text-neutral-600">
                  Joined {new Date(user.createdAt).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>

            {user.wallet && (
              <Card>
                <CardHeader>
                  <CardTitle>Wallet</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-lg font-semibold">
                    {user.wallet.balance.toLocaleString()} {user.wallet.currency}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {user.emergencyContact.length > 0 && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Emergency contacts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 pt-0 text-sm">
                {user.emergencyContact.map((c) => (
                  <p key={c.id}>
                    {c.name} &middot; {c.phone}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}

          {user.savedPlaces.length > 0 && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Saved places</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 pt-0 text-sm">
                {user.savedPlaces.map((p) => (
                  <p key={p.id}>
                    <span className="font-medium">{p.label}:</span> {p.address}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}

          {user.driverProfile && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Rider profile</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0 text-sm">
                <p>
                  Approval: <span className="font-medium">{user.driverProfile.approvalStatus}</span>{" "}
                  &middot; {user.driverProfile.isOnline ? "Online now" : "Offline"}
                </p>
                <p>
                  <span className="font-medium">{user.driverProfile.totalTrips}</span> trips &middot;
                  rating <span className="font-medium">{user.driverProfile.rating.toFixed(1)}</span>
                </p>
                {user.driverProfile.vehicle ? (
                  <p>
                    {user.driverProfile.vehicle.make} {user.driverProfile.vehicle.model} &middot;{" "}
                    {user.driverProfile.vehicle.color} &middot; {user.driverProfile.vehicle.plateNumber}{" "}
                    &middot; {user.driverProfile.vehicle.rideType}
                  </p>
                ) : (
                  <p className="text-yellow-600">No vehicle on file</p>
                )}
                {user.driverProfile.documents.length === 0 ? (
                  <p className="text-xs text-neutral-600">No documents uploaded</p>
                ) : (
                  <div className="flex flex-wrap gap-3 pt-1">
                    {user.driverProfile.documents.map((doc) => {
                      const isImage = /\.(jpe?g|png|webp)/i.test(doc.fileUrl);
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => viewDocument(doc.id, doc.type, user.name)}
                          className="flex flex-col items-center gap-1 text-xs text-neutral-600 hover:text-black"
                        >
                          {isImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={doc.fileUrl}
                              alt={DOCUMENT_LABELS[doc.type]}
                              className="h-16 w-24 rounded-md border border-neutral-200 object-cover"
                            />
                          ) : (
                            <span className="flex h-16 w-24 items-center justify-center rounded-md border border-neutral-200 text-[11px] uppercase">
                              PDF
                            </span>
                          )}
                          <span className="underline">{DOCUMENT_LABELS[doc.type]}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {user.ratingsReceived.length > 0 && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Ratings received</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0 text-sm">
                {user.ratingsReceived.map((r) => (
                  <div key={r.id} className="border-b border-neutral-100 pb-2 last:border-0">
                    <p>
                      <span className="font-medium">{"★".repeat(r.stars)}</span>{" "}
                      <span className="text-neutral-500">by {r.fromUser.name}</span>
                    </p>
                    {r.comment && <p className="text-neutral-600">{r.comment}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {user.role === "PASSENGER" && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Recent trips</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {user.passengerTrips.length === 0 ? (
                  <p className="text-sm text-neutral-600">No trips yet.</p>
                ) : (
                  user.passengerTrips.map((t) => (
                    <TripRow key={t.id} trip={t} otherPartyLabel={t.driver?.user.name ?? "Unassigned"} />
                  ))
                )}
              </CardContent>
            </Card>
          )}

          {user.driverProfile && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Recent trips</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {user.driverTrips.length === 0 ? (
                  <p className="text-sm text-neutral-600">No trips yet.</p>
                ) : (
                  user.driverTrips.map((t) => (
                    <TripRow key={t.id} trip={t} otherPartyLabel={t.passenger?.name ?? "Unknown"} />
                  ))
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
