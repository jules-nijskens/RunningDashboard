'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, orderBy, where, onSnapshot } from 'firebase/firestore';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, CartesianGrid } from 'recharts';
import { db } from '@/lib/firebase';

interface HealthPoint {
  timestamp: string;
  label: string;
  fullDate: string;
  hrv: number | null;
  rhr: number | null;
  sleep: number | null;
  hrvStatus?: string;
}

const STATUS_STYLES: Record<string, { badge: string; dot: string }> = {
  Balanced: { badge: 'bg-emerald-100 text-emerald-700', dot: '#10b981' },
  Unbalanced: { badge: 'bg-amber-100 text-amber-700', dot: '#f59e0b' },
  Low: { badge: 'bg-red-100 text-red-700', dot: '#ef4444' },
  High: { badge: 'bg-blue-100 text-blue-700', dot: '#3b82f6' },
};

const toNum = (v: unknown): number | null => {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

const METRICS = [
  { key: 'hrv', title: 'HRV (7d avg)', unit: 'ms', color: '#059669', betterWhen: 'up' },
  { key: 'rhr', title: 'Resting HR (7d avg)', unit: 'bpm', color: '#e11d48', betterWhen: 'down' },
  { key: 'sleep', title: 'Sleep score (7d avg)', unit: '', color: '#4f46e5', betterWhen: 'up' },
] as const;

export default function HealthTrends() {
  const [points, setPoints] = useState<HealthPoint[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const galleryRef = useRef<HTMLDivElement>(null);

  const scrollToSlide = (index: number) => {
    const el = galleryRef.current;
    if (!el) return;
    const bounded = Math.max(0, Math.min(METRICS.length - 1, index));
    const child = el.children[bounded] as HTMLElement | undefined;
    if (child) {
      el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: 'smooth' });
    }
    setActiveIndex(bounded);
  };

  const handleGalleryScroll = () => {
    const el = galleryRef.current;
    if (!el || el.clientWidth === 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== activeIndex && idx >= 0 && idx < METRICS.length) {
      setActiveIndex(idx);
    }
  };

  useEffect(() => {
    // Snapshots from the last 90 days (timestamps are ISO strings, so they sort and compare lexically)
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const q = query(
      collection(db, 'settings', 'user_stats', 'health_history'),
      where('timestamp', '>=', cutoff),
      orderBy('timestamp', 'asc')
    );
    return onSnapshot(q, (snap) => {
      // Keep only the latest snapshot per calendar day
      const byDay = new Map<string, HealthPoint>();
      snap.forEach((d) => {
        const data = d.data();
        const dayKey = String(data.timestamp).slice(0, 10);
        const date = new Date(`${dayKey}T00:00:00Z`);
        byDay.set(dayKey, {
          timestamp: data.timestamp,
          label: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
          fullDate: date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
          hrv: toNum(data.hrv7d),
          rhr: toNum(data.rhr7d),
          sleep: toNum(data.sleep),
          hrvStatus: data.hrvStatus,
        });
      });
      setPoints(Array.from(byDay.values()));
    });
  }, []);

  const domains = useMemo(() => {
    const out: Record<string, [number, number]> = {};
    METRICS.forEach((m) => {
      const vals = points.map((p) => p[m.key]).filter((v): v is number => v !== null);
      if (vals.length === 0) {
        out[m.key] = [0, 100];
      } else {
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const pad = Math.max(2, (max - min) * 0.25);
        out[m.key] = [Math.floor(min - pad), Math.ceil(max + pad)];
      }
    });
    return out;
  }, [points]);

  // Continuous daily series from the first snapshot to today, so days without data
  // still appear on the x axis (their values are null).
  const series = useMemo(() => {
    if (points.length === 0) return [] as HealthPoint[];
    const byKey = new Map(points.map((p) => [p.timestamp.slice(0, 10), p]));
    const DAY = 24 * 60 * 60 * 1000;
    const start = Date.parse(`${points[0].timestamp.slice(0, 10)}T00:00:00Z`);
    const end = Math.max(
      Date.parse(`${points[points.length - 1].timestamp.slice(0, 10)}T00:00:00Z`),
      Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
    );
    const out: HealthPoint[] = [];
    for (let t = start; t <= end; t += DAY) {
      const d = new Date(t);
      const key = d.toISOString().slice(0, 10);
      out.push(
        byKey.get(key) ?? {
          timestamp: d.toISOString(),
          label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
          fullDate: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
          hrv: null,
          rhr: null,
          sleep: null,
        }
      );
    }
    return out;
  }, [points]);

  if (points.length < 1) {
    return (
      <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 mb-8">
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Health Trends</p>
        <p className="text-xs font-bold text-gray-400 mt-2">
          Sync Garmin (or update your stats) to start tracking how your health metrics change over time.
        </p>
      </div>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 mb-8">
      <div className="mb-4">
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Health Trends</p>
        <p className="text-xs font-bold text-gray-600">
          {first.label} → <span className="text-gray-900">{last.label}</span>
        </p>
      </div>

      <div
        ref={galleryRef}
        onScroll={handleGalleryScroll}
        className="flex md:grid md:grid-cols-3 gap-4 overflow-x-auto md:overflow-visible snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {METRICS.map((m) => {
          const value = last[m.key];
          return (
            <div key={m.key} className="min-w-full shrink-0 snap-center md:min-w-0 rounded-xl border border-gray-100 p-3">
              <div className="flex items-end justify-between mb-1">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase">{m.title}</p>
                  <p
                    className="text-2xl font-black leading-none tabular-nums"
                    style={{ color: m.key === 'hrv' ? STATUS_STYLES[last.hrvStatus ?? '']?.dot ?? m.color : m.color }}
                    title={m.key === 'hrv' && last.hrvStatus ? `HRV status: ${last.hrvStatus}` : undefined}
                  >
                    {value ?? '--'}
                    <span className="text-[10px] ml-0.5 uppercase text-gray-400">{m.unit}</span>
                  </p>
                </div>
              </div>
              <div className="h-28 min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis domain={domains[m.key]} tick={{ fontSize: 9 }} width={40} />
                    <Tooltip
                      cursor={{ stroke: m.color, strokeOpacity: 0.3 }}
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const p = payload[0].payload as HealthPoint;
                        const v = p[m.key];
                        if (v === null || v === undefined) {
                          return (
                            <div className="bg-gray-900 text-white rounded-lg px-3 py-2 shadow-xl text-[11px] font-bold">
                              <p className="text-gray-400">{p.fullDate}</p>
                              <p className="text-gray-300 text-[10px]">No data</p>
                            </div>
                          );
                        }
                        return (
                          <div className="bg-gray-900 text-white rounded-lg px-3 py-2 shadow-xl text-[11px] font-bold">
                            <p className="text-gray-400">{p.fullDate}</p>
                            <p
                              style={{
                                color:
                                  m.key === 'hrv'
                                    ? STATUS_STYLES[p.hrvStatus ?? '']?.dot ?? '#6ee7b7'
                                    : m.color === '#4f46e5'
                                      ? '#a5b4fc'
                                      : '#fda4af',
                              }}
                              className="text-sm font-black tabular-nums"
                            >
                              {v} {m.unit}
                            </p>
                            {m.key === 'hrv' && p.hrvStatus && (
                              <p
                                className="text-[9px] font-black uppercase tracking-wider mt-0.5"
                                style={{ color: STATUS_STYLES[p.hrvStatus]?.dot ?? '#d1d5db' }}
                              >
                                {p.hrvStatus}
                              </p>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey={m.key}
                      stroke={m.key === 'hrv' ? 'none' : m.color}
                      strokeWidth={m.key === 'hrv' ? 0 : 2.5}
                      dot={
                        m.key === 'hrv'
                          ? (props: any) => {
                              if (props.cx == null || props.cy == null || props.payload?.hrv == null) {
                                return <g key={props.key ?? props.index} />;
                              }
                              // Points only (no line): colour by HRV status, fall back to the metric colour
                              const color = STATUS_STYLES[props.payload?.hrvStatus]?.dot ?? m.color;
                              return (
                                <circle
                                  key={props.key ?? props.index}
                                  cx={props.cx}
                                  cy={props.cy}
                                  r={4.5}
                                  fill={color}
                                  stroke="#fff"
                                  strokeWidth={1.5}
                                />
                              );
                            }
                          : false
                      }
                      connectNulls
                      isAnimationActive={false}
                    />
                    {value !== null && (
                      <ReferenceDot
                        x={last.label}
                        y={value}
                        r={m.key === 'hrv' ? 6 : 5}
                        fill={m.key === 'hrv' ? STATUS_STYLES[last.hrvStatus ?? '']?.dot ?? m.color : m.color}
                        stroke="#fff"
                        strokeWidth={2}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex md:hidden justify-center items-center gap-1.5 mt-3">
        {METRICS.map((m, idx) => (
          <button
            key={m.key}
            type="button"
            onClick={() => scrollToSlide(idx)}
            aria-label={`View ${m.title}`}
            className={`h-1.5 rounded-full transition-all ${
              activeIndex === idx ? 'w-5 bg-gray-800' : 'w-1.5 bg-gray-300'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
