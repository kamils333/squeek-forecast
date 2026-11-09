// Server-side game logic: players, predictions, settlement, public board.
import { createHash, randomBytes } from "node:crypto";
import { store } from "./store";
import {
  CLOSEST_BONUS,
  MAX_KM,
  addDays,
  currentRound,
  openRound,
  roundEnd,
  roundStart,
  scorePrediction,
} from "./rounds";

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const SETTLE_DELAY_MS = 30 * 60 * 1000; // wait for the wheel data to land after a round ends
const VOID_AFTER_MS = 24 * 3600 * 1000; // no data a day after the end -> round void
const LOOKBACK_ROUNDS = 7; // stats API covers 7 days
const PUBLIC_CACHE_SEC = 60;

const K = {
  name: (lc: string) => `n:${lc}`,
  player: (lc: string) => `p:${lc}`,
  history: (lc: string) => `p:${lc}:h`,
  token: (hash: string) => `t:${hash}`,
  preds: (date: string) => `r:${date}:p`,
  result: (date: string) => `r:${date}:res`,
  settling: (date: string) => `r:${date}:settling`,
  board: "lb",
  publicCache: "cache:public",
  settleLock: "lock:settle",
  regLimit: (ip: string) => `rl:reg:${ip}`,
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export class GameError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// ---- players -------------------------------------------------------------------------

export async function register(rawName: string, ip: string) {
  const s = store();
  const name = (rawName ?? "").trim();
  if (!NAME_RE.test(name)) throw new GameError("Name must be 3-16 letters, numbers or _");
  if ((await s.incrWithExpire(K.regLimit(ip), 3600)) > 5) throw new GameError("Too many sign-ups from here, try later", 429);
  const lc = name.toLowerCase();
  const claimed = await s.set(K.name(lc), name, { nx: true });
  if (!claimed) throw new GameError("That name is taken", 409);
  const token = randomBytes(24).toString("base64url");
  const tokenHash = sha(token);
  await s.hset(K.player(lc), { name, tokenHash, createdAt: String(Date.now()), score: "0", rounds: "0", wins: "0" });
  await s.set(K.token(tokenHash), lc);
  return { name, token };
}

export async function auth(token: string | null): Promise<{ lc: string; player: Record<string, string> } | null> {
  if (!token) return null;
  const s = store();
  const lc = await s.get(K.token(sha(token)));
  if (!lc) return null;
  const player = await s.hgetall(K.player(lc));
  return player?.name ? { lc, player } : null;
}

// ---- predictions ---------------------------------------------------------------------

export async function predict(token: string | null, rawKm: unknown) {
  const me = await auth(token);
  if (!me) throw new GameError("Unknown player key", 401);
  const km = Number(rawKm);
  if (!Number.isFinite(km) || km < 0 || km > MAX_KM) throw new GameError(`Enter a distance from 0 to ${MAX_KM} km`);
  const rounded = Math.round(km * 100) / 100;
  const date = openRound();
  if (Date.now() >= roundStart(date)) throw new GameError("Predictions for this round are closed");
  await store().hset(K.preds(date), { [me.lc]: String(rounded) });
  await store().del(K.publicCache);
  return { date, km: rounded };
}

// ---- settlement ----------------------------------------------------------------------

type StatsDay = { date: string; distanceMm: string | number | null };

async function fetchDays(): Promise<StatsDay[] | null> {
  try {
    const res = await fetch("https://api.squeekchain.com/v1/measurement/stats?range=7d", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: string; activity?: { days?: StatsDay[] } };
    if (data.status === "unavailable") return null;
    return data.activity?.days ?? null;
  } catch {
    return null;
  }
}

/** Settles every finished, unsettled round in the lookback window. Safe to call often. */
export async function settleDue(force = false): Promise<string[]> {
  const s = store();
  if (!force && !(await s.set(K.settleLock, "1", { nx: true, ex: 120 }))) return [];
  const now = Date.now();
  const cur = currentRound(now);
  const due: string[] = [];
  for (let i = 1; i <= LOOKBACK_ROUNDS; i++) {
    const date = addDays(cur, -i);
    if (now < roundEnd(date) + SETTLE_DELAY_MS) continue;
    if (await s.hget(K.result(date), "status")) continue;
    due.push(date);
  }
  if (!due.length) return [];

  const days = await fetchDays();
  if (!days) return [];
  const done: string[] = [];
  for (const date of due) {
    const day = days.find((d) => d.date === date);
    const mm = day?.distanceMm == null ? null : Number(day.distanceMm);
    if (mm == null || !Number.isFinite(mm)) {
      if (now > roundEnd(date) + VOID_AFTER_MS) {
        await s.hset(K.result(date), { status: "void", settledAt: String(now), count: "0" });
        done.push(date);
      }
      continue;
    }
    if (!(await s.set(K.settling(date), "1", { nx: true }))) continue;
    await scoreRound(date, mm / 1e6);
    done.push(date);
  }
  if (done.length) await s.del(K.publicCache);
  return done;
}

async function scoreRound(date: string, actualKm: number) {
  const s = store();
  const preds = Object.entries(await s.hgetall(K.preds(date))).map(([lc, v]) => ({ lc, km: Number(v) }));
  const best = preds.length ? Math.min(...preds.map((p) => Math.abs(p.km - actualKm))) : 0;
  const winners: string[] = [];
  let sum = 0;
  for (const p of preds) {
    const player = await s.hgetall(K.player(p.lc));
    if (!player?.name) continue;
    const isWinner = Math.abs(Math.abs(p.km - actualKm) - best) < 1e-9;
    const points = scorePrediction(p.km, actualKm) + (isWinner ? CLOSEST_BONUS : 0);
    if (isWinner) winners.push(player.name);
    sum += p.km;
    const score = Number(player.score ?? 0) + points;
    await s.hset(K.player(p.lc), {
      score: String(score),
      rounds: String(Number(player.rounds ?? 0) + 1),
      wins: String(Number(player.wins ?? 0) + (isWinner ? 1 : 0)),
    });
    await s.zadd(K.board, score, player.name);
    await s.hset(K.history(p.lc), { [date]: JSON.stringify({ km: p.km, points, closest: isWinner }) });
  }
  await s.hset(K.result(date), {
    status: "settled",
    actualKm: actualKm.toFixed(3),
    settledAt: String(Date.now()),
    count: String(preds.length),
    avgKm: preds.length ? (sum / preds.length).toFixed(2) : "",
    winners: JSON.stringify(winners),
  });
}

// ---- read models ---------------------------------------------------------------------

export type PublicState = {
  current: { date: string; start: number; end: number; count: number };
  open: { date: string; deadline: number; count: number };
  leaderboard: { name: string; score: number }[];
  results: { date: string; status: string; actualKm: number | null; count: number; avgKm: number | null; winners: string[] }[];
};

async function publicState(): Promise<PublicState> {
  const s = store();
  const cached = await s.get(K.publicCache);
  const cur = currentRound();
  if (cached) {
    const p = JSON.parse(cached) as PublicState;
    if (p.current.date === cur) return p;
  }
  const open = openRound();
  const [curPreds, openPreds, board] = await Promise.all([
    s.hgetall(K.preds(cur)),
    s.hgetall(K.preds(open)),
    s.zrevrangeWithScores(K.board, 0, 49),
  ]);
  const results: PublicState["results"] = [];
  for (let i = 1; i <= LOOKBACK_ROUNDS; i++) {
    const date = addDays(cur, -i);
    const r = await s.hgetall(K.result(date));
    if (!r?.status) {
      results.push({ date, status: "pending", actualKm: null, count: Object.keys(await s.hgetall(K.preds(date))).length, avgKm: null, winners: [] });
      continue;
    }
    results.push({
      date,
      status: r.status,
      actualKm: r.actualKm ? Number(r.actualKm) : null,
      count: Number(r.count ?? 0),
      avgKm: r.avgKm ? Number(r.avgKm) : null,
      winners: r.winners ? (JSON.parse(r.winners) as string[]) : [],
    });
  }
  const p: PublicState = {
    current: { date: cur, start: roundStart(cur), end: roundEnd(cur), count: Object.keys(curPreds).length },
    open: { date: open, deadline: roundStart(open), count: Object.keys(openPreds).length },
    leaderboard: board.map((b) => ({ name: b.member, score: b.score })),
    results,
  };
  await s.set(K.publicCache, JSON.stringify(p), { ex: PUBLIC_CACHE_SEC });
  return p;
}

export async function state(token: string | null) {
  // settle lazily; the daily cron is only a backup
  await settleDue().catch(() => []);
  const pub = await publicState();
  const me = await auth(token);
  let mine = null;
  if (me) {
    const s = store();
    const [openPred, curPred, hist] = await Promise.all([
      s.hget(K.preds(pub.open.date), me.lc),
      s.hget(K.preds(pub.current.date), me.lc),
      s.hgetall(K.history(me.lc)),
    ]);
    const history = Object.entries(hist)
      .map(([date, v]) => ({ date, ...(JSON.parse(v) as { km: number; points: number; closest: boolean }) }))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 10);
    const rank = pub.leaderboard.findIndex((l) => l.name === me.player.name);
    mine = {
      name: me.player.name,
      score: Number(me.player.score ?? 0),
      rounds: Number(me.player.rounds ?? 0),
      wins: Number(me.player.wins ?? 0),
      rank: rank >= 0 ? rank + 1 : null,
      openPrediction: openPred == null ? null : Number(openPred),
      currentPrediction: curPred == null ? null : Number(curPred),
      history,
    };
  }
  return { now: Date.now(), ...pub, me: mine };
}
