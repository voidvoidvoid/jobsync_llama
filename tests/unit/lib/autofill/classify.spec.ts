import { describe, it, expect } from "vitest";
import { isSensitiveTopic, profileKeyOf, topicOf } from "@/lib/autofill/classify";
import type { AutofillField } from "@/lib/autofill/types";

const f = (label: string, extra: Partial<AutofillField> = {}): AutofillField => ({
  id: "0:f1",
  label,
  type: "text",
  ...extra,
});

describe("topicOf", () => {
  it.each([
    ["Are you legally authorized to work in the United States?", "work_auth"],
    ["Are you authorized to work in the US without visa sponsorship?", "work_auth"],
    ["Will you now or in the future require sponsorship for employment visa status (e.g. H-1B)?", "sponsorship"],
    ["What are your salary expectations?", "salary"],
    ["Desired pay", "salary"],
    ["Gender", "gender"],
    ["Are you Hispanic/Latino?", "hispanic"],
    ["Please identify your race", "race"],
    ["Veteran Status", "veteran"],
    ["Disability Status", "disability"],
    ["Have you ever been convicted of a felony?", "criminal"],
    ["I agree to the privacy policy", "consent"],
    ["Are you willing to relocate?", "relocate"],
    ["When is the earliest you can start?", "start_date"],
    ["How did you hear about us?", "referral_source"],
    ["Cover Letter", "cover_letter"],
  ])("%s -> %s", (label, topic) => {
    expect(topicOf(label)).toBe(topic);
  });

  it("leaves ordinary questions alone", () => {
    expect(topicOf("Current company")).toBeUndefined();
    expect(topicOf("Years of experience with Python")).toBeUndefined();
    expect(topicOf("Which page of our site did you like?")).toBeUndefined();
  });

  it("marks personal and legal topics sensitive", () => {
    expect(isSensitiveTopic("sponsorship")).toBe(true);
    expect(isSensitiveTopic("gender")).toBe(true);
    expect(isSensitiveTopic("relocate")).toBe(false);
    expect(isSensitiveTopic(undefined)).toBe(false);
  });
});

describe("profileKeyOf", () => {
  it.each([
    [f("First Name"), "firstName"],
    [f("Last name"), "lastName"],
    [f("Full legal name"), "fullName"],
    [f("Name"), "fullName"],
    [f("Email", { type: "email" }), "email"],
    [f("Phone"), "phone"],
    [f("Mobile number", { type: "tel" }), "phone"],
    [f("LinkedIn Profile"), "linkedin"],
    [f("GitHub URL", { type: "url" }), "github"],
    [f("Portfolio / Website"), "website"],
    [f("anything", { autocomplete: "given-name" }), "firstName"],
    [f("anything", { autocomplete: "section-x family-name" }), "lastName"],
  ])("%o", (field, key) => {
    expect(profileKeyOf(field)).toBe(key);
  });

  it("does not take other people's or company details", () => {
    expect(profileKeyOf(f("Company name"))).toBeUndefined();
    expect(profileKeyOf(f("Referrer's email"))).toBeUndefined();
    expect(profileKeyOf(f("Emergency contact phone"))).toBeUndefined();
    expect(profileKeyOf(f("Phone extension"))).toBeUndefined();
  });

  it("never fills a choice field from the profile", () => {
    expect(profileKeyOf(f("Phone", { type: "select", options: ["+1", "+44"] }))).toBeUndefined();
  });
});
