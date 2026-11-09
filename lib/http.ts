import { GameError } from "./server";

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() || null : null;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
}

export function fail(e: unknown): Response {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Server error" }, { status: 500 });
}
