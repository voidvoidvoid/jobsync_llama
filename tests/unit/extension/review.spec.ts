import { describe, it, expect } from "vitest";
import { answersToRemember, guessJob } from "../../../extension/src/shared/review";
import type { AutofillField, AutofillValue } from "@/lib/autofill/types";

const fields: AutofillField[] = [
  { id: "0:f1", label: "Email", type: "email" },
  { id: "0:f2", label: "Notice period", type: "text" },
  { id: "0:f3", label: "Gender", type: "select", options: ["Male", "Decline"] },
  { id: "0:f4", label: "Current company", type: "text" },
  { id: "0:f5", label: "Resume", type: "file" },
  { id: "0:f6", label: "Why us?", type: "textarea" },
  { id: "0:f7", label: "I agree", type: "checkbox" },
];
const filled = new Map<string, AutofillValue>([
  ["0:f1", { id: "0:f1", value: "a@b.c", source: "profile", confidence: "high" }],
  ["0:f2", { id: "0:f2", value: "", source: "none", confidence: "low" }],
  ["0:f3", { id: "0:f3", value: "", source: "none", confidence: "low" }],
  ["0:f4", { id: "0:f4", value: "Acme", source: "ai", confidence: "high" }],
  ["0:f6", { id: "0:f6", value: "Because", source: "ai", confidence: "medium" }],
]);

describe("answersToRemember", () => {
  it("offers what the user typed or changed, not contact details, files, ticks or essays", () => {
    const out = answersToRemember(fields, filled, [
      { id: "0:f1", value: "other@b.c" },
      { id: "0:f2", value: "Two weeks" },
      { id: "0:f3", value: "Decline" },
      { id: "0:f4", value: "Acme" },
      { id: "0:f5", value: "cv.pdf" },
      { id: "0:f6", value: "x".repeat(400) },
      { id: "0:f7", value: "yes" },
    ]);
    expect(out.map((c) => [c.question, c.answer])).toEqual([
      ["Notice period", "Two weeks"],
      ["Gender", "Decline"],
    ]);
  });

  it("offers an AI answer the user corrected", () => {
    const out = answersToRemember(fields, filled, [{ id: "0:f4", value: "Globex" }]);
    expect(out).toEqual([{ id: "0:f4", question: "Current company", answer: "Globex" }]);
  });
});

describe("guessJob", () => {
  it("reads Greenhouse, Lever and generic page titles", () => {
    expect(guessJob("Job Application for Senior Engineer at Acme", "https://job-boards.greenhouse.io/acme/jobs/1")).toEqual({
      jobTitle: "Senior Engineer",
      company: "Acme",
    });
    expect(guessJob("Acme - Backend Developer", "https://jobs.lever.co/acme/x")).toEqual({
      company: "Acme",
      jobTitle: "Backend Developer",
    });
    expect(guessJob("Data Engineer @ Globex | Careers", "https://jobs.ashbyhq.com/globex/x")).toEqual({
      jobTitle: "Data Engineer",
      company: "Globex",
    });
    expect(guessJob("Platform Engineer", "https://careers.initech.com/jobs/1")).toEqual({
      jobTitle: "Platform Engineer",
      company: "Initech",
    });
  });
});
