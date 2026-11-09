import { state } from "@/lib/server";
import { bearer, fail } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    return Response.json(await state(bearer(req)), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
