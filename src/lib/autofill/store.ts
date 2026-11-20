import db from "@/lib/db";
import { mergeSavedAnswers, normalizeSavedAnswers } from "./answers";
import type { SavedAnswer } from "./types";

// Server-only. Saved answers live in the user's settings JSON.

async function readSettings(userId: string): Promise<Record<string, unknown>> {
  const row = await db.userSettings.findUnique({ where: { userId } });
  if (!row) return {};
  try {
    return JSON.parse(row.settings) ?? {};
  } catch {
    return {};
  }
}

async function writeAnswers(userId: string, answers: SavedAnswer[]) {
  const settings = await readSettings(userId);
  const next = { ...settings, autofill: { ...(settings.autofill as object), answers } };
  await db.userSettings.upsert({
    where: { userId },
    update: { settings: JSON.stringify(next) },
    create: { userId, settings: JSON.stringify(next) },
  });
}

export async function saveAnswersForUser(
  userId: string,
  incoming: Array<{ question: string; answer: string }>,
): Promise<SavedAnswer[]> {
  const settings = await readSettings(userId);
  const existing = normalizeSavedAnswers(
    (settings.autofill as { answers?: unknown } | undefined)?.answers,
  );
  const merged = mergeSavedAnswers(existing, incoming);
  await writeAnswers(userId, merged);
  return merged;
}

export async function replaceAnswersForUser(
  userId: string,
  answers: SavedAnswer[],
): Promise<SavedAnswer[]> {
  const clean = normalizeSavedAnswers(answers);
  await writeAnswers(userId, clean);
  return clean;
}
