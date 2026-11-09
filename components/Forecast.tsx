"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLive, fetchRecentDays, type DayDistance, type Live } from "@/lib/squeek";

type Result = { date: string; status: string; actualKm: number | null; count: number; avgKm: number | null; winners: string[] };
type Me = {
  name: string;
  score: number;
  rounds: number;
  wins: number;
  rank: number | null;
  openPrediction: number | null;
  currentPrediction: number | null;
  history: { date: string; km: number; points: number; closest: boolean }[];
};
type State = {
  now: number;
  current: { date: string; start: number; end: number; count: number };
  open: { date: string; deadline: number; count: number };
  leaderboard: { name: string; score: number }[];
  results: Result[];
  me: Me | null;
};

const KEY = "squeek-forecast:key";
const STATE_POLL_MS = 5 * 60 * 1000;
const LIVE_POLL_MS = 10 * 1000;

function readKey(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function writeKey(k: string | null) {
  try {
    if (k) localStorage.setItem(KEY, k);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

function countdown(ms: number): string {
  if (ms <= 0) return "0m";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Forecast() {
  const [data, setData] = useState<State | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [running, setRunning] = useState(false);
  const [days, setDays] = useState<DayDistance[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [name, setName] = useState("");
  const [km, setKm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [restore, setRestore] = useState("");
  const skew = useRef(0);
  const lastCount = useRef<{ epoch: string; cum: string; at: number } | null>(null);

  const load = useCallback(async (k: string | null) => {
    try {
      const res = await fetch("/api/state", { headers: k ? { authorization: `Bearer ${k}` } : {}, cache: "no-store" });
      if (!res.ok) return;
      const s = (await res.json()) as State;
      skew.current = s.now - Date.now();
      setData(s);
      if (k && !s.me) setMsg({ ok: false, text: "Your saved player key was not recognised." });
    } catch {
      /* keep last state */
    }
  }, []);

  useEffect(() => {
    const k = readKey();
    setKey(k);
    load(k);
    const id = setInterval(() => load(readKey()), STATE_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const m = await fetchLive();
      if (stop) return;
      setLive(m);
      if (m) {
        const prev = lastCount.current;
        let at = prev?.at ?? 0;
        if (prev && prev.epoch === m.counterEpoch && prev.cum !== m.cumulativeWorkUnits) at = Date.now();
        lastCount.current = { epoch: m.counterEpoch, cum: m.cumulativeWorkUnits, at };
        setRunning(m.freshness === "online" && Date.now() - at < 30000);
      } else setRunning(false);
    };
    poll();
    fetchRecentDays().then(setDays);
    const id = setInterval(poll, LIVE_POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // reload when the open round's deadline passes
  useEffect(() => {
    if (!data) return;
    const t = data.open.deadline - (Date.now() + skew.current);
    if (t <= 0) return;
    const id = setTimeout(() => load(readKey()), t + 2000);
    return () => clearTimeout(id);
  }, [data, load]);

  useEffect(() => {
    if (data?.me?.openPrediction != null && km === "") setKm(String(data.me.openPrediction));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.me?.openPrediction]);

  const post = async (path: string, body: unknown, k?: string | null) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(k ? { authorization: `Bearer ${k}` } : {}) },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Something went wrong");
    return json;
  };

  const doRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = (await post("/api/register", { name })) as { name: string; token: string };
      writeKey(r.token);
      setKey(r.token);
      setMsg({ ok: true, text: `Welcome, ${r.name}! Your key is saved in this browser.` });
      await load(r.token);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const doPredict = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = (await post("/api/predict", { km }, key)) as { km: number };
      setKm(String(r.km));
      setMsg({ ok: true, text: `Locked in ${r.km.toFixed(2)} km. You can change it until the round starts.` });
      await load(key);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    const k = restore.trim();
    if (!k) return;
    writeKey(k);
    setKey(k);
    setRestore("");
    setMsg(null);
    await load(k);
  };

  if (!data) return <main className="loading">Warming up the wheel…</main>;

  const t = now + skew.current;
  const me = data.me;
  const liveKm = live?.distanceMm != null ? live.distanceMm / 1e6 : null;
  const known = (days ?? []).filter((d) => d.km != null && d.date !== data.current.date) as { date: string; km: number }[];
  const avg = known.length ? known.reduce((a, d) => a + d.km, 0) / known.length : null;
  const maxBar = Math.max(1, ...known.map((d) => d.km));

  return (
    <main>
      <header className="top">
        <div>
          <h1>SQUEEK FORECAST</h1>
          <p className="sub">How far will Squeektoshi run? Predict the real wheel&apos;s daily distance on Squeekchain.</p>
        </div>
        <span className={running ? "badge live" : live ? "badge" : "badge off"}>
          {running ? "● RUNNING NOW" : live ? (live.freshness === "online" ? "RESTING" : "WHEEL OFFLINE") : "FEED OFFLINE"}
        </span>
      </header>

      <section className="grid">
        <div className="panel">
          <h2>TODAY&apos;S ROUND</h2>
          <p className="muted">
            {when(data.current.start)} → {when(data.current.end)}
          </p>
          <div className="big">{liveKm != null ? `${liveKm.toFixed(2)} km` : "—"}</div>
          <p className="muted">run so far · ends in {countdown(data.current.end - t)}</p>
          <dl className="stats">
            <div>
              <dt>Predictions</dt>
              <dd>{data.current.count}</dd>
            </div>
            <div>
              <dt>Your call</dt>
              <dd>{me?.currentPrediction != null ? `${me.currentPrediction.toFixed(2)} km` : "—"}</dd>
            </div>
          </dl>
        </div>

        <div className="panel accent">
          <h2>NEXT ROUND · PREDICT</h2>
          <p className="muted">
            {when(data.open.deadline)} → {when(data.open.deadline + 86400000)}
          </p>
          <p>
            Closes in <b className="hl">{countdown(data.open.deadline - t)}</b> · {data.open.count} prediction
            {data.open.count === 1 ? "" : "s"}
          </p>

          {me ? (
            <form onSubmit={doPredict} className="row">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max="50"
                placeholder="km"
                value={km}
                onChange={(e) => setKm(e.target.value)}
                required
              />
              <span className="unit">km</span>
              <button disabled={busy}>{me.openPrediction != null ? "Update" : "Lock in"}</button>
            </form>
          ) : (
            <form onSubmit={doRegister} className="row">
              <input
                placeholder="Pick a nickname (3-16: A-Z 0-9 _)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={16}
                required
              />
              <button disabled={busy}>Join</button>
            </form>
          )}
          {msg && <p className={msg.ok ? "ok" : "err"}>{msg.text}</p>}

          {known.length > 0 && (
            <div className="hint">
              <p className="muted">
                Last {known.length} days{avg != null && <> · avg {avg.toFixed(2)} km</>}
              </p>
              <div className="bars">
                {known.map((d) => (
                  <div key={d.date} className="bar" title={`${d.date}: ${d.km.toFixed(2)} km`}>
                    <span style={{ height: `${(d.km / maxBar) * 100}%` }} />
                    <small>{d.km.toFixed(1)}</small>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>LEADERBOARD</h2>
          {me && (
            <p className="muted">
              You: <b className="hl">{me.name}</b> · {me.score} pts · {me.rank ? `#${me.rank}` : "unranked"} · {me.wins} closest call
              {me.wins === 1 ? "" : "s"}
            </p>
          )}
          {data.leaderboard.length === 0 ? (
            <p className="muted">No settled rounds yet. Be the first on the board.</p>
          ) : (
            <ol className="board">
              {data.leaderboard.map((l) => (
                <li key={l.name} className={me?.name === l.name ? "me" : ""}>
                  <span>{l.name}</span>
                  <b>{l.score}</b>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="panel">
          <h2>RECENT ROUNDS</h2>
          <table>
            <thead>
              <tr>
                <th>Round</th>
                <th>Actual</th>
                <th>Crowd avg</th>
                <th>Closest</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.date}>
                  <td>{r.date}</td>
                  <td>{r.status === "settled" && r.actualKm != null ? `${r.actualKm.toFixed(2)} km` : r.status === "void" ? "void" : "settling…"}</td>
                  <td>{r.avgKm != null ? `${r.avgKm.toFixed(2)} km` : "—"}</td>
                  <td>{r.winners.length ? r.winners.join(", ") : r.count ? "—" : "no entries"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {me && me.history.length > 0 && (
            <>
              <h2 className="gap">YOUR CALLS</h2>
              <table>
                <tbody>
                  {me.history.map((h) => (
                    <tr key={h.date}>
                      <td>{h.date}</td>
                      <td>{h.km.toFixed(2)} km</td>
                      <td>
                        +{h.points} {h.closest && "🏆"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </section>

      <section className="panel rules">
        <h2>HOW IT WORKS</h2>
        <ul>
          <li>Each round is one Squeekchain day: 12:00 → 12:00 UTC. Predict the next round before it starts; you can change your call until then.</li>
          <li>Score = 100 × (1 − your error ÷ actual distance), never below 0. The closest call(s) get +25.</li>
          <li>Rounds settle about 30 minutes after they end, from the public wheel stats. No data within a day → the round is void.</li>
          <li>Points are a game score only, not SQK or tokens. No wallet needed.</li>
        </ul>
        {me && (
          <p className="muted small">
            Your player key lives in this browser.{" "}
            <button className="link" onClick={() => setShowKey((v) => !v)}>
              {showKey ? "Hide key" : "Show key to back it up"}
            </button>
            {showKey && <code className="key">{key}</code>}
          </p>
        )}
        {!me && (
          <p className="muted small row">
            Have a key from another browser?
            <input value={restore} onChange={(e) => setRestore(e.target.value)} placeholder="Paste player key" />
            <button className="link" onClick={doRestore}>
              Restore
            </button>
          </p>
        )}
      </section>

      <footer>
        <p>
          Wheel data from the public{" "}
          <a href="https://docs.squeekchain.com/" target="_blank" rel="noreferrer">
            Squeekchain API
          </a>{" "}
          (Sepolia). Community project for the{" "}
          <a href="https://squeekchain.com/genesis" target="_blank" rel="noreferrer">
            Squeekchain Genesis
          </a>{" "}
          Buildooooor badge. Not affiliated with Squeekchain. Also try{" "}
          <a href="https://squeek-burrow.kamilfactory.com" target="_blank" rel="noreferrer">
            Squeek Burrow
          </a>
          , the idle game.
        </p>
      </footer>
    </main>
  );
}
