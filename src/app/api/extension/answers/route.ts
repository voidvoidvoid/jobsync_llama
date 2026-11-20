import { z } from "zod";
import { authenticate, json, preflight } from "@/lib/autofill/http";
import { getSavedAnswers } from "@/lib/autofill/context";
import { saveAnswersForUser } from "@/lib/autofill/store";

export const dynamic = "force-dynamic";

const SaveSchema = z.object({
  answers: z
    .array(z.object({ question: z.string().min(1).max(2000), answer: z.string().min(1).max(5000) }))
    .min(1)
    .max(100),
});

export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  return json(req, { answers: await getSavedAnswers(auth.userId) });
}

export async function POST(req: Request) {
  const auth = await authenticate(req, { rateLimited: true });
  if (auth instanceof Response) return auth;
  let body: z.infer<typeof SaveSchema>;
  try {
    body = SaveSchema.parse(await req.json());
  } catch {
    return json(req, { error: "Invalid answers" }, 400);
  }
  const answers = await saveAnswersForUser(auth.userId, body.answers);
  return json(req, { saved: body.answers.length, total: answers.length });
}

export const OPTIONS = preflight;
