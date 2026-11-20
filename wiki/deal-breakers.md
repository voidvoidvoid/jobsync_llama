---
type: how-to
title: Deal Breakers
description: Listing conditions you will not accept in a job, so every AI match flags postings that have them and moves those jobs to Withdrawn.
feature: automations
tags: [deal breakers, ai matching, match score, job match, withdrawn, travel, relocation, filter, settings, automations]
aliases: [dealbreakers, deal-breaker tags, red flags, disqualifiers, auto withdraw, must not have]
status: stable
stale_after: 2027-11-30
---

# Deal Breakers

## What are deal breakers?

Deal breakers are conditions you will not accept in a job, such as "occasional travel" or "must be willing to relocate". Every AI match checks the job description for each one, alongside the match score. When the description has one, the match is flagged and, by default, the job is moved to **Withdrawn**.

The AI looks for the meaning, not your exact words: "up to 25% travel" counts for "occasional travel". It counts something only when the description states or requires it, so a posting that merely offers relocation help does not count for "must be willing to relocate". It never uses your resume for this check, and a deal breaker does not change the match score.

This is different from **Exclude keywords** on a search automation, which drops listings by exact word before any AI is involved. Use exclude keywords for clear-cut words in a title or description, and deal breakers for conditions that are worded many ways.

## How do I set them up?

Open **Settings → Deal Breakers**. Type a condition in your own words and press **Enter** or **Add**; remove one with the **×** on its tag. Up to 25 are kept, each up to 80 characters. Click **Save deal breakers**.

**Move matching jobs to Withdrawn** is on by default. Only jobs still in **New** or **Draft** are moved. A job you have applied to, are interviewing for, or have closed keeps its status and is only flagged. Turn the switch off to flag jobs without changing any status.

Changes apply to matches made from then on. Re-run a match to check an older job against your current list.

## Where are deal breakers checked?

Everywhere JobSync runs an AI match:

- **Search automations** — a job that scores at or above the threshold but has a deal breaker is saved straight to **Withdrawn** and is not counted as a strong match. The run log names the deal breaker.
- **AI Matching automations** — see [AI Matching](./ai-matching.md). A deal-broken job is not counted as strong, and the run log and summary say how many were found and withdrawn.
- **Analyze** on a discovered job, and **Match** on a job in My Jobs or in AI chat.

A match made by an external agent over [MCP](./mcp.md) is not checked.

## How do I see what was found?

A job's match panel starts with a red **Deal breaker found** box naming each condition, and says whether the job was moved to Withdrawn. The analysis below it has a **Deal Breakers Found** section quoting the description. When nothing was found, a short line says how many were checked. In My Jobs and on an automation's Discovered Jobs tab, a **Deal breaker** tag sits under the match score; hover it for the names.

If the AI judged wrongly, set the job's status back by hand. A later match will not withdraw it again unless it is in New or Draft.
