// Tiny storage layer: Upstash Redis in production, in-memory for local `npm run dev` without credentials.
import { Redis } from "@upstash/redis";

export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { nx?: boolean; ex?: number }): Promise<boolean>;
  del(key: string): Promise<void>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, values: Record<string, string>): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  zincrby(key: string, inc: number, member: string): Promise<void>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrevrangeWithScores(key: string, start: number, stop: number): Promise<{ member: string; score: number }[]>;
  incrWithExpire(key: string, seconds: number): Promise<number>;
}

function upstash(url: string, token: string): Store {
  const r = new Redis({ url, token, automaticDeserialization: false });
  return {
    get: async (k) => ((await r.get<string>(k)) ?? null),
    set: async (k, v, o) => {
      const res = o?.nx
        ? o.ex
          ? await r.set(k, v, { nx: true, ex: o.ex })
          : await r.set(k, v, { nx: true })
        : o?.ex
          ? await r.set(k, v, { ex: o.ex })
          : await r.set(k, v);
      return res === "OK";
    },
    del: async (k) => {
      await r.del(k);
    },
    hget: async (k, f) => ((await r.hget<string>(k, f)) ?? null),
    hset: async (k, v) => {
      await r.hset(k, v);
    },
    hgetall: async (k) => ((await r.hgetall<Record<string, string>>(k)) ?? {}),
    zincrby: async (k, inc, m) => {
      await r.zincrby(k, inc, m);
    },
    zadd: async (k, s, m) => {
      await r.zadd(k, { score: s, member: m });
    },
    zrevrangeWithScores: async (k, a, b) => {
      const flat = (await r.zrange(k, a, b, { rev: true, withScores: true })) as (string | number)[];
      const out: { member: string; score: number }[] = [];
      for (let i = 0; i < flat.length; i += 2) out.push({ member: String(flat[i]), score: Number(flat[i + 1]) });
      return out;
    },
    incrWithExpire: async (k, sec) => {
      const n = await r.incr(k);
      if (n === 1) await r.expire(k, sec);
      return n;
    },
  };
}

function memory(): Store {
  const g = globalThis as unknown as { __sqMem?: { kv: Map<string, string>; h: Map<string, Map<string, string>>; z: Map<string, Map<string, number>> } };
  const m = (g.__sqMem ??= { kv: new Map(), h: new Map(), z: new Map() });
  const hash = (k: string) => m.h.get(k) ?? m.h.set(k, new Map()).get(k)!;
  const zset = (k: string) => m.z.get(k) ?? m.z.set(k, new Map()).get(k)!;
  return {
    get: async (k) => m.kv.get(k) ?? null,
    set: async (k, v, o) => {
      if (o?.nx && m.kv.has(k)) return false;
      m.kv.set(k, v);
      if (o?.ex) setTimeout(() => m.kv.delete(k), o.ex * 1000).unref?.();
      return true;
    },
    del: async (k) => {
      m.kv.delete(k);
    },
    hget: async (k, f) => m.h.get(k)?.get(f) ?? null,
    hset: async (k, v) => {
      const h = hash(k);
      for (const [f, val] of Object.entries(v)) h.set(f, val);
    },
    hgetall: async (k) => Object.fromEntries(m.h.get(k) ?? []),
    zincrby: async (k, inc, mem) => {
      const z = zset(k);
      z.set(mem, (z.get(mem) ?? 0) + inc);
    },
    zadd: async (k, s, mem) => {
      zset(k).set(mem, s);
    },
    zrevrangeWithScores: async (k, a, b) =>
      [...zset(k).entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(a, b + 1)
        .map(([member, score]) => ({ member, score })),
    incrWithExpire: async (k) => {
      const n = Number(m.kv.get(k) ?? 0) + 1;
      m.kv.set(k, String(n));
      return n;
    },
  };
}

let cached: Store | null = null;

export function store(): Store {
  if (cached) return cached;
  // Vercel's Upstash integration sets KV_REST_API_*; a direct Upstash setup uses UPSTASH_REDIS_REST_*.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  cached = url && token ? upstash(url, token) : memory();
  return cached;
}

export const usingMemory = () => !(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL);
