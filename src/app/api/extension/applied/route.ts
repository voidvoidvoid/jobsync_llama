import { z } from "zod";
import { authenticate, json, preflight } from "@/lib/autofill/http";
import { markJobApplied } from "@/lib/autofill/applied";
import { log } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

const AppliedSchema = z.union([
  z.object({ jobId: z.string().min(1).max(100) }),
  z.object({
    url: z.url().max(4000),
    jobTitle: z.string().trim().min(1).max(300),
    company: z.string().trim().min(1).max(300),
    description: z.string().max(200000).optional(),
  }),
]);

export async function POST(req: Request) {
  const auth = await authenticate(req, { rateLimited: true });
  if (auth instanceof Response) return auth;
  let body: z.infer<typeof AppliedSchema>;
  try {
    body = AppliedSchema.parse(await req.json());
  } catch {
    return json(req, { error: "Give the job, or its URL, title and company." }, 400);
  }
  try {
    const result = await markJobApplied(auth.userId, body);
    return json(req, result, result.ok ? 200 : 404);
  } catch (error) {
    log.error("[Autofill] Mark applied failed", { error: String(error) });
    return json(req, { ok: false, message: "Could not update JobSync." }, 500);
  }
}

export const OPTIONS = preflight;
