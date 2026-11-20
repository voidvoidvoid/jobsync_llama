import { describe, it, expect } from "vitest";
import {
  coerceValue,
  findSavedAnswer,
  matchOption,
  mergeSavedAnswers,
  normalizeSavedAnswers,
} from "@/lib/autofill/answers";
import type { AutofillField, SavedAnswer } from "@/lib/autofill/types";

const field = (label: string, extra: Partial<AutofillField> = {}): AutofillField => ({
  id: "0:f1",
  label,
  type: "text",
  ...extra,
});
const saved = (question: string, answer: string, updatedAt = "2026-01-01T00:00:00.000Z"): SavedAnswer => ({
  id: question,
  question,
  answer,
  updatedAt,
});

describe("matchOption", () => {
  it("matches exactly, by prefix, by yes/no and by decline wording", () => {
    expect(matchOption("yes", ["Yes", "No"])).toBe("Yes");
    expect(matchOption("Yes", ["Yes, I am authorized", "No, I am not"])).toBe("Yes, I am authorized");
    expect(matchOption("No", ["I am authorized (yes)", "No, I will need sponsorship"])).toBe("No, I will need sponsorship");
    expect(matchOption("Decline to self-identify", ["Male", "Female", "I don't wish to answer"])).toBe("I don't wish to answer");
    expect(matchOption("United States", ["Canada", "United States", "United Kingdom"])).toBe("United States");
  });

  it("refuses to pick when nothing is close", () => {
    expect(matchOption("Purple", ["Red", "Green"])).toBeNull();
    expect(matchOption("", ["Yes"])).toBeNull();
  });
});

describe("coerceValue", () => {
  it("keeps choices to the options", () => {
    expect(coerceValue(field("Q", { type: "select", options: ["Yes", "No"] }), "no")).toBe("No");
    expect(coerceValue(field("Q", { type: "radio", options: ["A", "B"] }), "C")).toBeNull();
    expect(
      coerceValue(field("Q", { type: "checkbox-group", options: ["Python", "Go", "Rust"] }), ["go", "rust", "cobol"]),
    ).toEqual(["Go", "Rust"]);
  });

  it("normalizes checkboxes, numbers, dates and length", () => {
    expect(coerceValue(field("Q", { type: "checkbox" }), "Yes, I agree")).toBe("yes");
    expect(coerceValue(field("Q", { type: "checkbox" }), "false")).toBe("no");
    expect(coerceValue(field("Q", { type: "number" }), "about 7 years")).toBe("7");
    expect(coerceValue(field("Q", { type: "date" }), "Start on 2026-12-01")).toBe("2026-12-01");
    expect(coerceValue(field("Q", { type: "date" }), "next month")).toBeNull();
    expect(coerceValue(field("Q", { maxLength: 5 }), "abcdefgh")).toBe("abcde");
    expect(coerceValue(field("Q", { type: "file" }), "resume.pdf")).toBeNull();
  });
});

describe("findSavedAnswer", () => {
  const answers = [
    saved("Will you require visa sponsorship?", "No", "2026-02-01T00:00:00.000Z"),
    saved("Gender", "Decline to self-identify"),
    saved("What is your notice period?", "Two weeks"),
  ];

  it("matches the same kind of question in other words", () => {
    const f = field("Will you now or in the future require sponsorship for employment visa status?", {
      type: "radio",
      options: ["Yes", "No"],
    });
    expect(findSavedAnswer(f, answers)?.answer).toBe("No");
  });

  it("skips a same-topic answer that fits none of the choices", () => {
    const f = field("Gender identity", { type: "select", options: ["Man", "Woman"] });
    expect(findSavedAnswer(f, answers)).toBeUndefined();
  });

  it("matches exact and near-identical wording", () => {
    expect(findSavedAnswer(field("What is your notice period?"), answers)?.answer).toBe("Two weeks");
    expect(findSavedAnswer(field("What's your notice period"), answers)?.answer).toBe("Two weeks");
    expect(findSavedAnswer(field("Favourite colour"), answers)).toBeUndefined();
  });
});

describe("saved answer storage", () => {
  it("merges by wording, newest first, and drops blanks and duplicates", () => {
    const merged = mergeSavedAnswers(
      [saved("Gender", "Male")],
      [
        { question: "gender", answer: "Decline to self-identify" },
        { question: "Notice period?", answer: "2 weeks" },
        { question: "Empty", answer: "  " },
      ],
      new Date("2026-03-01T00:00:00.000Z"),
    );
    expect(merged.map((a) => [a.question, a.answer])).toEqual([
      ["gender", "Decline to self-identify"],
      ["Notice period?", "2 weeks"],
    ]);
    expect(merged[0].id).toBe("Gender");
  });

  it("ignores malformed stored data", () => {
    expect(normalizeSavedAnswers("nope")).toEqual([]);
    expect(normalizeSavedAnswers([{ question: "Q" }, null, { question: "Q2", answer: "A" }])).toHaveLength(1);
  });
});
