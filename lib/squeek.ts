// Browser-side reads of the public Squeekchain API (direct first, /sq rewrite as fallback).
const DIRECT = "https://api.squeekchain.com";
const PROXY = "/sq";
let useProxy = false;

async function getJson<T>(path: string): Promise<T | null> {
  for (const base of useProxy ? [PROXY] : [DIRECT, PROXY]) {
    try {
      const res = await fetch(base + path, { cache: "no-cache" });
      if (!res.ok) return null;
      const data = (await res.json()) as T;
      if (base === PROXY) useProxy = true;
      return data;
    } catch {
      /* try next */
    }
  }
  return null;
}

export type Live = {
  freshness: "online" | "stale";
  observedAt: string;
  counterEpoch: string;
  cumulativeWorkUnits: string;
  speedMmPerSecond: number | null;
  rpmMilli: number | null;
  distanceMm: number | null;
};

export async function fetchLive(): Promise<Live | null> {
  const d = await getJson<{ status?: string; measurement?: Live | null }>("/v1/status");
  if (!d || d.status === "unavailable") return null;
  return d.measurement ?? null;
}

export type DayDistance = { date: string; km: number | null };

export async function fetchRecentDays(): Promise<DayDistance[] | null> {
  const d = await getJson<{ status?: string; activity?: { days?: { date: string; distanceMm: string | number | null }[] } }>(
    "/v1/measurement/stats?range=7d",
  );
  if (!d || d.status === "unavailable") return null;
  return (d.activity?.days ?? []).map((x) => ({ date: x.date, km: x.distanceMm == null ? null : Number(x.distanceMm) / 1e6 }));
}
