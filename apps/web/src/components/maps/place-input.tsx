"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import type { LatLng } from "@/lib/types";
import { useMapsReady } from "./map-provider";

// Places riders have actually reached, from our own gazetteer (GET /places/search).
interface OwnPlace extends LatLng {
  label: string;
}

type Suggestion =
  | { kind: "own"; key: string; label: string; place: OwnPlace }
  | { kind: "google"; key: string; label: string; prediction: google.maps.places.PlacePrediction };

// Our own suggestions come first. Google is only asked when we know fewer places than this,
// so every place we know well saves a paid Google lookup.
const ENOUGH_OWN_RESULTS = 3;

async function searchOwn(text: string): Promise<OwnPlace[]> {
  try {
    const { places } = await apiFetch<{ places: OwnPlace[] }>(
      `/places/search?q=${encodeURIComponent(text)}`,
    );
    return places;
  } catch {
    return [];
  }
}

interface PlaceInputProps {
  placeholder: string;
  value: string;
  onChange: (address: string) => void;
  onSelect: (address: string, location: LatLng) => void;
}

export function PlaceInput({ placeholder, value, onChange, onSelect }: PlaceInputProps) {
  const isLoaded = useMapsReady();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Google bills the keystrokes and the final place lookup of one search as one session when
  // they share a token; without it every keystroke is billed separately.
  const sessionRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const searchSeq = useRef(0);

  function handleChange(text: string) {
    onChange(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => search(text), 400);
  }

  async function search(text: string) {
    const seq = ++searchSeq.current;
    const own = await searchOwn(text);
    let results: Suggestion[] = own.map((place, i) => ({
      kind: "own",
      key: `own-${i}-${place.label}`,
      label: place.label,
      place,
    }));

    if (own.length < ENOUGH_OWN_RESULTS && isLoaded) {
      sessionRef.current ??= new google.maps.places.AutocompleteSessionToken();
      const fromGoogle = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: text,
        includedRegionCodes: ["ug"],
        sessionToken: sessionRef.current,
      }).then(
        (r) => r.suggestions,
        () => [], // Google down: our own suggestions still show
      );
      const known = new Set(own.map((p) => p.label.trim().toLowerCase()));
      for (const s of fromGoogle) {
        const prediction = s.placePrediction;
        if (!prediction || known.has(prediction.text.text.trim().toLowerCase())) continue;
        results = [
          ...results,
          { kind: "google", key: prediction.placeId, label: prediction.text.text, prediction },
        ];
      }
    }

    // A slower earlier search must not overwrite the results of a later one.
    if (seq !== searchSeq.current) return;
    setSuggestions(results);
    setOpen(results.length > 0);
  }

  async function selectSuggestion(suggestion: Suggestion) {
    onChange(suggestion.label);
    setSuggestions([]);
    setOpen(false);

    if (suggestion.kind === "own") {
      onSelect(suggestion.label, { lat: suggestion.place.lat, lng: suggestion.place.lng });
      return;
    }

    // toPlace() carries the session token, closing the billing session.
    const place = suggestion.prediction.toPlace();
    sessionRef.current = null;
    await place.fetchFields({ fields: ["location"] });
    if (place.location) {
      onSelect(suggestion.label, { lat: place.location.lat(), lng: place.location.lng() });
    }
  }

  function applyManualCoords(nextLat: string, nextLng: string) {
    const parsedLat = Number(nextLat);
    const parsedLng = Number(nextLng);
    if (value && Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
      onSelect(value, { lat: parsedLat, lng: parsedLng });
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Input
          placeholder={placeholder}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setOpen(suggestions.length > 0)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && (
          <ul className="absolute z-10 mt-1 w-full rounded-lg border border-neutral-200 bg-white shadow-lg">
            {suggestions.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => selectSuggestion(s)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!manualMode ? (
        <button
          type="button"
          onClick={() => setManualMode(true)}
          className="text-xs text-neutral-500 transition-colors hover:text-neutral-800 hover:underline"
        >
          Can&apos;t find it? Enter coordinates manually
        </button>
      ) : (
        <div className="flex gap-2">
          <Input
            type="number"
            step="any"
            placeholder="Latitude"
            value={lat}
            onChange={(e) => {
              setLat(e.target.value);
              applyManualCoords(e.target.value, lng);
            }}
            className="h-9 text-sm"
          />
          <Input
            type="number"
            step="any"
            placeholder="Longitude"
            value={lng}
            onChange={(e) => {
              setLng(e.target.value);
              applyManualCoords(lat, e.target.value);
            }}
            className="h-9 text-sm"
          />
        </div>
      )}
    </div>
  );
}
