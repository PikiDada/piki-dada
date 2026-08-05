export type RideType = "ECONOMY" | "COMFORT" | "BODA";
export type TripStatus =
  | "REQUESTED"
  | "SEARCHING"
  | "ACCEPTED"
  | "ARRIVED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";
export type PaymentMethod = "CASH" | "STRIPE" | "FLUTTERWAVE" | "WALLET";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  color: string;
  plateNumber: string;
  rideType: RideType;
  photoUrl?: string | null;
}

export interface Trip {
  id: string;
  status: TripStatus;
  rideType: RideType;
  fare: number;
  currency: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  passengerId: string;
  driverId?: string | null;
  paymentMethod: PaymentMethod;
  cancellationReason?: string | null;
  createdAt: string;
  passenger?: { id: string; name: string; phone?: string | null };
  payment?: { id: string; status: "PENDING" | "PAID" | "FAILED" | "REFUNDED" } | null;
  driver?: {
    id: string;
    rating: number;
    currentLat?: number | null;
    currentLng?: number | null;
    vehicle?: Vehicle | null;
    user?: { id: string; name: string; phone?: string | null };
  } | null;
}

export type DriverApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type DocumentType =
  | "NATIONAL_ID"
  | "DRIVING_PERMIT"
  | "VEHICLE_REGISTRATION"
  | "INSURANCE";

export interface DriverDocument {
  id: string;
  type: DocumentType;
  fileUrl: string;
}

export interface DriverProfile {
  id: string;
  approvalStatus: DriverApprovalStatus;
  isOnline: boolean;
  rating: number;
  totalTrips: number;
  vehicle: Vehicle | null;
  documents: DriverDocument[];
  user: { id: string; name: string; email: string; phone?: string | null };
}

export const SOCKET_EVENTS = {
  TRIP_REQUESTED: "trip:requested",
  TRIP_ACCEPTED: "trip:accepted",
  TRIP_REJECTED: "trip:rejected",
  TRIP_STATUS_UPDATED: "trip:status_updated",
  TRIP_CANCELLED: "trip:cancelled",
  DRIVER_LOCATION_UPDATE: "driver:location_update",
  DRIVER_AVAILABILITY_CHANGED: "driver:availability_changed",
} as const;
