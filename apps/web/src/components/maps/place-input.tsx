"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import type { LatLng } from "@/lib/types";
import { useMapsReady } from "./map-provider";

interface PlaceInputProps {
  placeholder: string;
  value: string;
  onChange: (address: string) => void;
  onSelect: (address: string, location: LatLng) => void;
}

export function PlaceInput({ placeholder, value, onChange, onSelect }: PlaceInputProps) {
  const isLoaded = useMapsReady();
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(text: string) {
    onChange(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isLoaded || text.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => search(text), 400);
  }

  async function search(text: string) {
    const { suggestions: results } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: text,
      includedRegionCodes: ["ug"],
    });
    setSuggestions(results);
    setOpen(results.length > 0);
  }

  async function selectSuggestion(suggestion: google.maps.places.AutocompleteSuggestion) {
    const prediction = suggestion.placePrediction;
    if (!prediction) return;

    const description = prediction.text.text;
    onChange(description);
    setSuggestions([]);
    setOpen(false);

    const place = prediction.toPlace();
    await place.fetchFields({ fields: ["location"] });
    if (place.location) {
      onSelect(description, { lat: place.location.lat(), lng: place.location.lng() });
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
              <li key={s.placePrediction?.placeId}>
                <button
                  type="button"
                  onClick={() => selectSuggestion(s)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                >
                  {s.placePrediction?.text.text}
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
          className="text-xs text-neutral-600 underline hover:text-neutral-800"
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
