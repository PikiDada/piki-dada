"use client";

import { createContext, useContext } from "react";
import { useJsApiLoader } from "@react-google-maps/api";

const MapsReadyContext = createContext(false);

const GOOGLE_MAPS_LIBRARIES: "places"[] = ["places"];

export function MapsProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded } = useJsApiLoader({
    id: "piki-dada-google-maps",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  return <MapsReadyContext.Provider value={isLoaded}>{children}</MapsReadyContext.Provider>;
}

export function useMapsReady() {
  return useContext(MapsReadyContext);
}
