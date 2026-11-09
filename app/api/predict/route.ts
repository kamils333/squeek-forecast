import { predict } from "@/lib/server";
import { bearer, fail } from "@/lib/http";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { km?: unknown };
    return Response.json(await predict(bearer(req), body.km));
  } catch (e) {
    return fail(e);
  }
}
