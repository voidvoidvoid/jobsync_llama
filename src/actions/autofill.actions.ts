"use server";

import { requireUser } from "./shared";
import { getSavedAnswers } from "@/lib/autofill/context";
import { replaceAnswersForUser } from "@/lib/autofill/store";
import type { SavedAnswer } from "@/lib/autofill/types";
import { createMcpToken } from "./mcpToken.actions";

export async function getAutofillAnswers(): Promise<SavedAnswer[]> {
  const user = await requireUser();
  return getSavedAnswers(user.id);
}

export async function saveAutofillAnswers(
  answers: SavedAnswer[],
): Promise<{ success: true; answers: SavedAnswer[] } | { success: false; message: string }> {
  try {
    const user = await requireUser();
    const now = new Date().toISOString();
    const saved = await replaceAnswersForUser(
      user.id,
      answers.map((a) => ({ ...a, updatedAt: a.updatedAt || now })),
    );
    return { success: true, answers: saved };
  } catch {
    return { success: false, message: "Failed to save answers." };
  }
}

// A year-long access token named for the extension; shown once
export async function createExtensionToken() {
  await requireUser();
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return createMcpToken({ name: `Firefox extension ${stamp}`, expiryDays: 365 });
}
