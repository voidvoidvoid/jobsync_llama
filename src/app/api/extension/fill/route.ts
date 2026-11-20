import { z } from "zod";
import { authenticate, json, preflight } from "@/lib/autofill/http";
import { runAutofill } from "@/lib/autofill/fill";
import { AUTOFILL_LIMITS } from "@/lib/autofill/types";
import { log } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
// A local model can take a while over a long form
export const maxDuration = 300;

const FIELD_TYPES = [
  "text", "email", "tel", "url", "number", "date", "textarea", "select",
  "radio", "checkbox", "checkbox-group", "combobox", "file",
] as const;

const FillSchema = z.object({
  url: z.string().max(4000),
  frameUrls: z.array(z.string().max(4000)).max(20).optional(),
  title: z.string().max(500).optional(),
  pageText: z.string().max(200000).optional(),
  fields: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        label: z.string().max(2000),
        type: z.enum(FIELD_TYPES),
        options: z.array(z.string().max(500)).max(1000).optional(),
        required: z.boolean().optional(),
        name: z.string().max(300).optional(),
        autocomplete: z.string().max(100).optional(),
        placeholder: z.string().max(500).optional(),
        maxLength: z.number().int().nonnegative().optional(),
        accept: z.string().max(300).optional(),
      }),
    )
    .max(500),
});

export async function POST(req: Request) {
  const auth = await authenticate(req, { rateLimited: true });
  if (auth instanceof Response) return auth;

  let body: z.infer<typeof FillSchema>;
  try {
    body = FillSchema.parse(await req.json());
  } catch {
    return json(req, { error: "Invalid fill request" }, 400);
  }

  try {
    const result = await runAutofill(auth.userId, {
      ...body,
      pageText: body.pageText?.slice(0, AUTOFILL_LIMITS.maxPageText),
    });
    return json(req, result);
  } catch (error) {
    log.error("[Autofill] Fill failed", { error: String(error) });
    return json(req, { error: "Autofill failed" }, 500);
  }
}

export const OPTIONS = preflight;
