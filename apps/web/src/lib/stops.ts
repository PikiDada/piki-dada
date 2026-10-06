import type { LatLng, TripStop, WaitingPolicy } from "./types";

// "Waiting at each stop is free for 3 minutes, then 200 UGX per minute."
export function waitingPolicyText(policy: WaitingPolicy, noun = "stop") {
  if (policy.waitingPerMinute <= 0) return `Waiting at each ${noun} is free.`;
  const rate = `${policy.waitingPerMinute.toLocaleString()} ${policy.currency ?? "UGX"} per minute`;
  return policy.freeWaitMinutes > 0
    ? `Waiting at each ${noun} is free for ${policy.freeWaitMinutes} minutes, then ${rate}.`
    : `Waiting at each ${noun} costs ${rate}.`;
}

export interface StopDraft {
  // Stable React key, so removing a middle stop doesn't hand its input state to the next one.
  key: string;
  address: string;
  location?: LatLng;
  contactName?: string;
  contactPhone?: string;
}

let draftCounter = 0;

export function newStopDraft(from?: Partial<StopDraft>): StopDraft {
  draftCounter += 1;
  return { address: "", ...from, key: `stop-${draftCounter}` };
}

export function draftsFromStops(
  stops: (TripStop & { contactName?: string; contactPhone?: string })[],
): StopDraft[] {
  return stops.map((s) =>
    newStopDraft({
      address: s.address,
      location: { lat: s.lat, lng: s.lng },
      contactName: s.contactName,
      contactPhone: s.contactPhone,
    }),
  );
}

export function stopsReady(stops: StopDraft[], withContact: boolean) {
  return stops.every(
    (s) => s.address && s.location && (!withContact || (s.contactName && s.contactPhone)),
  );
}

export function stopsPayload(stops: StopDraft[], withContact: boolean) {
  return stops.map((s) => ({
    address: s.address,
    lat: s.location!.lat,
    lng: s.location!.lng,
    ...(withContact ? { contactName: s.contactName, contactPhone: s.contactPhone } : {}),
  }));
}

// Where the driver is in the stop sequence: waiting at `current`, or heading to `next`.
export function stopProgress<T extends TripStop>(stops: T[] = []) {
  const current = stops.find((s) => s.arrivedAt && !s.departedAt);
  const next = stops.find((s) => !s.arrivedAt);
  const locked = stops.filter((s) => s.arrivedAt);
  const pending = stops.filter((s) => !s.arrivedAt);
  return { current, next, locked, pending };
}

export function stopLocations(stops: TripStop[] = []): LatLng[] {
  return stops.map((s) => ({ lat: s.lat, lng: s.lng }));
}
