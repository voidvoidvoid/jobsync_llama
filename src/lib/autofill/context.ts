import db from "@/lib/db";
import { convertResumeToText } from "@/lib/ai/tools/preprocessing";
import { resumeDetailInclude } from "@/lib/jobs/resumeDetailInclude";
import type { Resume } from "@/models/profile.model";
import { normalizeSavedAnswers } from "./answers";
import type { ProfileKey } from "./classify";
import type { AutofillResumeRef, SavedAnswer } from "./types";

// Server-only. Everything a fill draws on for one user.
export interface AutofillContext {
  profile: Partial<Record<ProfileKey, string>> & {
    headline?: string;
    address?: string;
    otherLinks?: string[];
  };
  resume: (AutofillResumeRef & { text: string }) | null;
  answers: SavedAnswer[];
}

const RESUME_TEXT_LIMIT = 12000;

function splitLinks(urls: Array<string | null | undefined>) {
  const out: { linkedin?: string; github?: string; website?: string; otherLinks: string[] } = {
    otherLinks: [],
  };
  for (const raw of urls) {
    const url = raw?.trim();
    if (!url) continue;
    if (/linkedin\.com/i.test(url) && !out.linkedin) out.linkedin = url;
    else if (/github\.com/i.test(url) && !out.github) out.github = url;
    else if (!out.website) out.website = url;
    else out.otherLinks.push(url);
  }
  return out;
}

export async function getSavedAnswers(userId: string): Promise<SavedAnswer[]> {
  const row = await db.userSettings.findUnique({ where: { userId } });
  if (!row) return [];
  try {
    return normalizeSavedAnswers(JSON.parse(row.settings)?.autofill?.answers);
  } catch {
    return [];
  }
}

// The resume to fill from: the one given (if the user owns it), else the
// default resume, else the most recently edited one.
async function loadResume(userId: string, resumeId?: string | null) {
  if (resumeId) {
    const own = await db.resume.findFirst({
      where: { id: resumeId, profile: { userId } },
      include: resumeDetailInclude,
    });
    if (own) return own;
  }
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { defaultResumeId: true },
  });
  if (user?.defaultResumeId) {
    const def = await db.resume.findFirst({
      where: { id: user.defaultResumeId, profile: { userId } },
      include: resumeDetailInclude,
    });
    if (def) return def;
  }
  return db.resume.findFirst({
    where: { profile: { userId } },
    orderBy: { updatedAt: "desc" },
    include: resumeDetailInclude,
  });
}

export async function loadAutofillContext(
  userId: string,
  resumeId?: string | null,
): Promise<AutofillContext> {
  const [resume, user, answers] = await Promise.all([
    loadResume(userId, resumeId),
    db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    getSavedAnswers(userId),
  ]);

  const contact = resume?.ContactInfo ?? null;
  const links = splitLinks([contact?.url1, contact?.url2]);
  const nameParts = (user?.name ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName = contact?.firstName?.trim() || nameParts[0] || "";
  const lastName =
    contact?.lastName?.trim() || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");

  const profile: AutofillContext["profile"] = {
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    fullName: [firstName, lastName].filter(Boolean).join(" ") || undefined,
    email: contact?.email?.trim() || user?.email || undefined,
    phone: contact?.phone?.trim() || undefined,
    headline: contact?.headline?.trim() || undefined,
    address: contact?.address?.trim() || undefined,
    linkedin: links.linkedin,
    github: links.github,
    website: links.website,
    otherLinks: links.otherLinks,
  };

  let resumeRef: AutofillContext["resume"] = null;
  if (resume) {
    let text = "";
    try {
      text = (await convertResumeToText(resume as unknown as Resume)).slice(
        0,
        RESUME_TEXT_LIMIT,
      );
    } catch {
      text = "";
    }
    resumeRef = {
      id: resume.id,
      title: resume.title,
      hasFile: !!resume.File?.filePath,
      fileName: resume.File?.fileName ?? undefined,
      text,
    };
  }

  return { profile, resume: resumeRef, answers };
}
