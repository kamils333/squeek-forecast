import { register } from "@/lib/server";
import { clientIp, fail } from "@/lib/http";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    return Response.json(await register(body.name ?? "", clientIp(req)));
  } catch (e) {
    return fail(e);
  }
}
