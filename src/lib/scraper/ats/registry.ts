import {
  REMOTE_PROVIDER_LABEL,
  type JobBoard,
} from "@/models/automation.model";
import { searchGreenhouseJobs } from "../greenhouse";
import { searchLeverJobs } from "../lever";
import { searchAshbyJobs } from "../ashby";
import { searchRemoteFeeds, remoteLocationMatches } from "../remote";
import type { AtsProvider } from "./types";

// Server-only: imports the real network-calling search fns (fetch, p-limit).
// Never import this from client-bundled code — use ATS_BOARDS from
// automation.model.ts for the plain, dependency-free board list.
export const ATS_PROVIDERS: Partial<Record<JobBoard, AtsProvider>> = {
  greenhouse: {
    id: "greenhouse",
    label: "Greenhouse",
    search: searchGreenhouseJobs,
  },
  lever: { id: "lever", label: "Lever", search: searchLeverJobs },
  ashby: { id: "ashby", label: "Ashby", search: searchAshbyJobs },
  remote: {
    id: "remote",
    label: REMOTE_PROVIDER_LABEL,
    sourceNoun: "job boards",
    search: searchRemoteFeeds,
    keywordSearched: true,
    locationMatches: remoteLocationMatches,
  },
};
