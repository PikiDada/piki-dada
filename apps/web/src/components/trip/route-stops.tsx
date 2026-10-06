import { cn } from "@/lib/utils";
import type { TripStop } from "@/lib/types";

interface RouteStopsProps {
  pickupAddress: string;
  destinationAddress: string;
  stops?: (TripStop & { contactName?: string })[];
  noun?: string;
  // The trip has ended, so a stop never reached was skipped rather than still to come.
  finished?: boolean;
}

function stopState(stop: TripStop, finished: boolean) {
  if (stop.departedAt) return { label: "Done", className: "text-neutral-500" };
  if (stop.arrivedAt) return { label: "Waiting here", className: "text-amber-700 font-semibold" };
  if (finished) return { label: "Skipped", className: "text-neutral-500 line-through" };
  return { label: "Upcoming", className: "text-neutral-500" };
}

export function RouteStops({
  pickupAddress,
  destinationAddress,
  stops = [],
  noun = "Stop",
  finished = false,
}: RouteStopsProps) {
  return (
    <ol className="space-y-1.5 text-sm">
      <li className="flex gap-2">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-600 text-[11px] font-bold text-white">
          P
        </span>
        <span className="text-neutral-700">{pickupAddress}</span>
      </li>
      {stops.map((stop, i) => {
        const state = stopState(stop, finished);
        return (
          <li key={stop.id} className="flex gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-600 text-[11px] font-bold text-white">
              {i + 1}
            </span>
            <span className="flex-1 text-neutral-700">
              <span className="sr-only">
                {noun} {i + 1}:{" "}
              </span>
              {stop.address}
              {stop.contactName && (
                <span className="block text-xs text-neutral-500">For {stop.contactName}</span>
              )}
            </span>
            <span className={cn("shrink-0 text-xs", state.className)}>{state.label}</span>
          </li>
        );
      })}
      <li className="flex gap-2">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold text-white">
          D
        </span>
        <span className="text-neutral-700">{destinationAddress}</span>
      </li>
    </ol>
  );
}
