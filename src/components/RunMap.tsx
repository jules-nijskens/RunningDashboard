'use client';

import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface RunMapProps {
  coordinates: { lat: number; lon: number }[];
}

export default function RunMap({ coordinates }: RunMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || coordinates.length === 0) return;

    const latLngs: L.LatLngExpression[] = coordinates.map(c => [c.lat, c.lon]);

    // Clean up existing map instance if it exists
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Initialize map
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      scrollWheelZoom: false, // Prevent page scrolling zoom interference
    }).setView(latLngs[0], 14);

    mapInstanceRef.current = map;

    // Use a clean, premium light map tile layer (CartoDB Positron)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    // Draw route polyline
    const polyline = L.polyline(latLngs, {
      color: '#3b82f6', // Premium blue
      weight: 5,
      opacity: 0.85,
      lineJoin: 'round'
    }).addTo(map);

    // Start point: Green circle
    L.circleMarker(latLngs[0], {
      radius: 7,
      fillColor: '#10b981', // Emerald green
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 1
    }).addTo(map).bindPopup('<b>Start Location</b>');

    // End point: Red circle
    L.circleMarker(latLngs[latLngs.length - 1], {
      radius: 7,
      fillColor: '#ef4444', // Red
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 1
    }).addTo(map).bindPopup('<b>Finish Location</b>');

    // Auto-fit to route bounds with padding
    try {
      const bounds = polyline.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [30, 30] });
      }
    } catch (e) {
      console.warn("Could not fit map bounds:", e);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [coordinates]);

  return (
    <div className="relative w-full h-[400px] rounded-2xl overflow-hidden shadow-md border border-gray-200">
      <div ref={mapContainerRef} className="w-full h-full" style={{ minHeight: '400px' }} />
    </div>
  );
}
