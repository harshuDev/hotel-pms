"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { cn } from "@/components/ui";

/**
 * THE HOTEL'S LOCATION, on a map, as the client's reference shows it.
 *
 * Theirs is Google Maps. Google needs an API key and a billing account, and
 * this project holds neither, so this is Leaflet over OpenStreetMap -- no key,
 * no account -- with Esri's imagery behind the Satellite button. What theirs
 * does, this does: Map and Satellite, zoom, full screen, and a pin that is the
 * hotel. Street View and Google's own place labels are Google's and are not
 * here.
 *
 * THE PIN IS AN INPUT, not a picture. Drag it, or click anywhere on the map,
 * and the latitude and longitude fields above take the new position; type in
 * those fields and the pin moves. One location, two ways to set it, and they
 * cannot disagree because both write the same two strings.
 *
 * Loaded only in the browser (`next/dynamic` with `ssr: false` in the screen):
 * Leaflet reaches for `window` the moment it is imported.
 */

const MAP_TILES = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

const SATELLITE_TILES = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "Imagery &copy; Esri",
};

/*
 * A red pin drawn in SVG rather than Leaflet's default marker image. The
 * default reaches for PNGs by a path bundlers rewrite, so it arrives as a
 * broken image -- and a red pin is what the reference shows anyway.
 */
const PIN = L.divIcon({
  className: "",
  html: `<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M15 0C6.7 0 0 6.6 0 14.8 0 25.9 15 42 15 42s15-16.1 15-27.2C30 6.6 23.3 0 15 0z" fill="#E53935"/>
    <path d="M15 1.5C7.5 1.5 1.5 7.4 1.5 14.8c0 9.6 11.8 23.4 13.5 25.3C16.7 38.2 28.5 24.4 28.5 14.8 28.5 7.4 22.5 1.5 15 1.5z" fill="none" stroke="#B71C1C" stroke-width="1"/>
    <circle cx="15" cy="14.5" r="5" fill="#7F0000"/>
  </svg>`,
  iconSize: [30, 42],
  iconAnchor: [15, 42],
});

/** Where the map opens with no location: the whole world, one click to pin. */
const WORLD: [number, number] = [20, 0];

/** Six places is about eleven centimetres -- finer than a building needs. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export default function LocationMap({
  latitude,
  longitude,
  onChange,
  disabled,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number) => void;
  disabled: boolean;
}) {
  const [layer, setLayer] = useState<"map" | "satellite">("map");
  const frameRef = useRef<HTMLDivElement>(null);
  const hasPoint = latitude !== null && longitude !== null;
  const tiles = layer === "map" ? MAP_TILES : SATELLITE_TILES;

  return (
    /*
      `relative z-0` IS LOAD-BEARING. Leaflet stacks its panes at z-index 400
      and its controls at 1000, so without a stacking context of its own the
      map's buttons paint over the sticky nav bar (z-50) as the page scrolls.
      z-0 on a positioned element makes one, and keeps all of Leaflet's numbers
      inside it -- the same trap the top nav and the calendar's room menu
      document, met here on purpose rather than by accident.
    */
    <div
      ref={frameRef}
      className="relative z-0 h-[400px] overflow-hidden rounded-md border border-line bg-board"
    >
      <MapContainer
        center={hasPoint ? [latitude, longitude] : WORLD}
        zoom={hasPoint ? 16 : 2}
        zoomControl={false}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer key={layer} url={tiles.url} attribution={tiles.attribution} />
        <ZoomControl position="bottomright" />
        <FollowPoint latitude={latitude} longitude={longitude} />
        {!disabled && <PlaceOnClick onChange={onChange} />}
        {hasPoint && (
          <Marker
            position={[latitude, longitude]}
            icon={PIN}
            draggable={!disabled}
            eventHandlers={{
              dragend: (e) => {
                const at = (e.target as L.Marker).getLatLng();
                onChange(round6(at.lat), round6(at.lng));
              },
            }}
          />
        )}
        <FullScreenResize frame={frameRef} />
      </MapContainer>

      {/* Map / Satellite, top left, where the reference keeps them. */}
      <div className="absolute left-2.5 top-2.5 z-[1000] flex overflow-hidden rounded-sm bg-white text-[14px] shadow-md">
        {(["map", "satellite"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLayer(l)}
            aria-pressed={layer === l}
            className={cn(
              "px-3.5 py-2 outline-none transition-colors focus-visible:bg-shell",
              layer === l ? "font-medium text-ink" : "text-ink-muted hover:bg-shell",
            )}
          >
            {l === "map" ? "Map" : "Satellite"}
          </button>
        ))}
      </div>

      {/* Full screen, top right, where the reference keeps it. */}
      <button
        type="button"
        onClick={() => {
          const el = frameRef.current;
          if (!el) return;
          if (document.fullscreenElement) void document.exitFullscreen();
          else void el.requestFullscreen();
        }}
        aria-label="Toggle full screen"
        title="Full screen"
        className="absolute right-2.5 top-2.5 z-[1000] grid h-10 w-10 place-items-center rounded-sm bg-white text-ink-muted shadow-md outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brass"
      >
        <svg viewBox="0 0 18 18" aria-hidden="true" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4" />
        </svg>
      </button>
    </div>
  );
}

/** Clicking anywhere puts the pin there. */
function PlaceOnClick({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(round6(e.latlng.lat), round6(e.latlng.lng));
    },
  });
  return null;
}

/**
 * Typing a new latitude or longitude moves the view to it. `MapContainer`
 * reads `center` once, at mount, so without this the pin would jump off the
 * edge of the map and stay there.
 */
function FollowPoint({
  latitude,
  longitude,
}: {
  latitude: number | null;
  longitude: number | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (latitude === null || longitude === null) return;
    const point = L.latLng(latitude, longitude);
    // Only when it has left the view: panning on every drag would fight the
    // hand doing the dragging.
    if (!map.getBounds().contains(point)) {
      map.setView(point, Math.max(map.getZoom(), 14));
    }
  }, [map, latitude, longitude]);
  return null;
}

/** Leaflet measures its box once; going full screen changes it. */
function FullScreenResize({ frame }: { frame: React.RefObject<HTMLDivElement | null> }) {
  const map = useMap();
  useEffect(() => {
    const onChange = () => {
      if (frame.current) map.invalidateSize();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [map, frame]);
  return null;
}
