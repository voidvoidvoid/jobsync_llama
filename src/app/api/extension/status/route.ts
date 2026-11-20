import db from "@/lib/db";
import { authenticate, json, preflight } from "@/lib/autofill/http";
import { getUserAiSettings } from "@/lib/scraper/automation-run/aiSettings";

export const dynamic = "force-dynamic";

// Connection check for the extension's options page
export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const [user, ai] = await Promise.all([
    db.user.findUnique({ where: { id: auth.userId }, select: { name: true, email: true } }),
    getUserAiSettings(auth.userId),
  ]);
  return json(req, {
    ok: true,
    user: user?.name || user?.email || "",
    provider: ai.provider,
    model: ai.model ?? "",
  });
}

export const OPTIONS = preflight;
