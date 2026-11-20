import type { AutofillField } from "./types";

// Question kinds that are recognized by wording. Sensitive ones are never
// sent to the AI to guess: they are filled only from an answer the user saved
// in JobSync, or left for the user.
export type AutofillTopic =
  | "work_auth"
  | "sponsorship"
  | "salary"
  | "gender"
  | "pronouns"
  | "race"
  | "hispanic"
  | "veteran"
  | "disability"
  | "orientation"
  | "age"
  | "criminal"
  | "government_id"
  | "consent"
  | "relocate"
  | "start_date"
  | "referral_source"
  | "cover_letter";

const TOPIC_RULES: Array<[AutofillTopic, RegExp]> = [
  // "authorized to work ... without sponsorship" is one yes/no about status
  ["work_auth", /without (?:\w+ ){0,3}sponsorship/],
  ["sponsorship", /sponsor|\bvisa\b|h-?1b|immigration (?:status|support)/],
  [
    "work_auth",
    /authori[sz]ed to work|authori[sz]ation to work|(?:legally|lawfully) (?:authori[sz]ed|eligible|able|entitled|permitted)|right to work|eligib(?:le|ility) to work|work authori[sz]ation|work permit|citizenship status/,
  ],
  ["salary", /salary|compensation|pay (?:expectation|requirement|range)|(?:desired|expected|target) (?:pay|rate|base)|hourly rate|rate expectation/],
  ["orientation", /sexual orientation|\blgbt|transgender/],
  ["pronouns", /pronoun/],
  ["gender", /\bgender\b|\bsex\b/],
  ["hispanic", /hispanic|latin[oax]\b|latine/],
  ["race", /\brace\b|ethnicit|racial/],
  ["veteran", /veteran|military (?:service|status)|armed forces|protected veteran/],
  ["disability", /disabilit|handicap/],
  ["age", /date of birth|birth ?date|\bage\b|over (?:the age of )?(?:18|eighteen)|(?:18|eighteen) years/],
  ["criminal", /convicted|conviction|criminal|felony|misdemeanor/],
  ["government_id", /social security|\bssn\b|national (?:id|identity|insurance) (?:number|no)|\bsin\b|passport number|driver'?s licen[cs]e number/],
  [
    "consent",
    /\bi (?:agree|acknowledge|consent|certify|confirm|understand|accept|have read)|privacy (?:policy|notice)|terms (?:of|and)|data (?:processing|retention)|gdpr|consent/,
  ],
  ["relocate", /relocat/],
  ["start_date", /start date|earliest.{0,20}start|available to start|availability to start|notice period|when can you start/],
  ["referral_source", /how did you (?:hear|find|learn)|where did you (?:hear|find|learn)|referr(?:al|ed) (?:source|by)|source of application/],
  ["cover_letter", /cover letter|letter of motivation|motivation letter/],
];

export const SENSITIVE_TOPICS: ReadonlySet<AutofillTopic> = new Set([
  "work_auth",
  "sponsorship",
  "salary",
  "gender",
  "pronouns",
  "race",
  "hispanic",
  "veteran",
  "disability",
  "orientation",
  "age",
  "criminal",
  "government_id",
  "consent",
]);

export function topicOf(text: string): AutofillTopic | undefined {
  const t = text.toLowerCase();
  for (const [topic, re] of TOPIC_RULES) {
    if (re.test(t)) return topic;
  }
  return undefined;
}

export function isSensitiveTopic(topic: AutofillTopic | undefined): boolean {
  return !!topic && SENSITIVE_TOPICS.has(topic);
}

// Lowercase words only, for comparing a page's question with a saved one.
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(required\)|\*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ProfileKey =
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "linkedin"
  | "github"
  | "website";

const AUTOCOMPLETE_KEYS: Record<string, ProfileKey> = {
  "given-name": "firstName",
  "family-name": "lastName",
  name: "fullName",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
};

const TEXT_TYPES = new Set(["text", "email", "tel", "url"]);

// The contact detail a field asks for, when that is plain from its type,
// autocomplete hint or wording. Such fields never go to the AI.
export function profileKeyOf(field: AutofillField): ProfileKey | undefined {
  if (!TEXT_TYPES.has(field.type)) return undefined;
  const hint = (field.autocomplete ?? "").toLowerCase().split(/\s+/).pop() ?? "";
  if (AUTOCOMPLETE_KEYS[hint]) return AUTOCOMPLETE_KEYS[hint];
  if (field.type === "email") return "email";

  const label = `${field.label} ${field.name ?? ""}`.toLowerCase();
  const words = normalizeQuestion(field.label);
  // A question about the person, not a reference, emergency contact or
  // company ("Company name", "Referrer's email")
  if (/refer|emergency|manager|supervisor|company|employer|school|recruiter/.test(label)) {
    return undefined;
  }
  if (/linkedin/.test(label)) return "linkedin";
  if (/github/.test(label)) return "github";
  if (/first name|given name|forename|first_name|firstname/.test(label)) return "firstName";
  if (/last name|surname|family name|last_name|lastname/.test(label)) return "lastName";
  if (/^(?:your |full |legal |full legal )?name$/.test(words)) return "fullName";
  if (/e-?mail/.test(label)) return "email";
  if (field.type === "tel" || /\b(?:phone|mobile|telephone|cell)\b/.test(label)) {
    return /extension|\bext\b|country code/.test(label) ? undefined : "phone";
  }
  if (/portfolio|personal (?:web)?site|website|blog/.test(label)) return "website";
  return undefined;
}
