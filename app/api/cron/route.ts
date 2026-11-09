import { settleDue } from "@/lib/server";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";

// Daily backup for settlement (vercel.json). Vercel sends "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is set.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return Response.json({ settled: await settleDue(true) });
  } catch (e) {
    return fail(e);
  }
}
