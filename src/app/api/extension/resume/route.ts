import fs from "fs";
import path from "path";
import db from "@/lib/db";
import { authenticate, corsFor, json, preflight } from "@/lib/autofill/http";
import { isResumeFilePath } from "@/lib/resumeFiles";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// The uploaded file of one of the user's resumes, for a form's upload field
export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const resumeId = new URL(req.url).searchParams.get("resumeId");
  if (!resumeId) return json(req, { error: "resumeId is required" }, 400);

  // The path comes from the caller's own resume row, never from the client
  const resume = await db.resume.findFirst({
    where: { id: resumeId, profile: { userId: auth.userId } },
    select: { File: { select: { filePath: true, fileName: true } } },
  });
  const stored = resume?.File?.filePath;
  if (!stored || !isResumeFilePath(stored) || !fs.existsSync(path.resolve(stored))) {
    return json(req, { error: "File not found" }, 404);
  }
  const full = path.resolve(stored);
  const type = TYPES[path.extname(full).toLowerCase()];
  if (!type) return json(req, { error: "Unsupported file type" }, 400);

  const name = (resume?.File?.fileName || path.basename(full)).replace(/[\r\n"]/g, "_");
  return new Response(fs.readFileSync(full), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${name}"`,
      ...corsFor(req),
    },
  });
}

export const OPTIONS = preflight;
