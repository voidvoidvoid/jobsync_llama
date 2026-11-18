import { termInText } from "../ats/rank";

// How feeds say "no location restriction".
const OPEN_LOCATION = /\b(worldwide|anywhere|global|international|any ?location)\b/i;

// Feeds name the same place differently (Jobicy "USA", Himalayas "United
// States"), so the commonest two are matched under any of their spellings.
const ALIASES: string[][] = [
  ["us", "usa", "u.s.", "u.s.a.", "united states", "united states of america"],
  ["uk", "u.k.", "united kingdom", "great britain"],
];

function expand(wanted: string[]): string[] {
  const out = new Set<string>();
  for (const raw of wanted) {
    const term = raw.trim().toLowerCase();
    if (!term) continue;
    out.add(term);
    for (const group of ALIASES) {
      if (group.includes(term)) group.forEach((alias) => out.add(alias));
    }
  }
  return [...out];
}

// Strict-location test for remote listings, where "location" means where the
// candidate may live. A listing open to everyone always passes; otherwise it
// must name one of the wanted places. Empty preference = no constraint.
export function remoteLocationMatches(
  jobLocation: string,
  wanted: string[],
): boolean {
  if (!wanted || wanted.length === 0) return true;
  const loc = (jobLocation || "").trim().toLowerCase();
  if (!loc || loc === "remote" || OPEN_LOCATION.test(loc)) return true;
  return expand(wanted).some((term) => termInText(loc, term));
}

// What to save as a job's location. Feeds list every country a role is open
// to, sometimes dozens; saved verbatim, each combination would become its own
// entry in the Locations list. Up to three places are kept as they are.
export function compactRemoteLocation(location: string): string | undefined {
  const places = location
    .split(",")
    .map((place) => place.trim())
    .filter(Boolean);
  return places.length > 3 ? "Multiple countries" : undefined;
}
