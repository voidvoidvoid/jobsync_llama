---
type: how-to
title: AI Matching
description: Setting up an automation that gives AI match scores to saved jobs that have none, on a daily schedule, newest or oldest first.
feature: automations
tags: [automations, ai matching, match score, job match, resume match, analyze, unmatched jobs, backlog, schedule, resume, threshold, local model, llama.cpp, ollama]
aliases: [ai match automation, auto match, automatic matching, score unmatched jobs, analyze all, match backlog]
status: stable
stale_after: 2027-09-30
---

# AI Matching

## What does an AI Matching automation do?

It gives an AI match score to jobs you have already saved that do not have one yet, once a day at the hour you choose. It searches for nothing new. The scores are the same kind the **Analyze** button on a discovered job and the **Match** button in My Jobs produce, saved in the same place, so a job scored this way looks exactly like one you matched by hand.

Two kinds of job go without a score:

- **Listings from search automations.** Each search run AI-analyzes only its top few matches ("Jobs analyzed per run"); the other relevant listings are saved with just a keyword ranking. Dismissed listings are never scored.
- **Jobs in My Jobs with no score** — ones you added yourself, or an agent added, and never matched.

Jobs you have rejected, archived or withdrawn from, declined an offer for, or that expired are never scored.

## How do I set one up?

Create an automation and choose **AI Matching (score saved jobs)** as the job board. The second step replaces the company or job-board picker:

- **Jobs to score** — either or both of the two kinds above. Below the switches, the wizard shows how many jobs are unmatched right now.
- **Jobs to score per run** — the most one run scores, 1 to 200. Each job is one AI request. With a local model the jobs are scored one at a time, so a large number makes a long run.
- **Newest jobs first** — on by default: the most recently added jobs are scored first. Turn it off to work through a backlog from the oldest. "Newest" means most recently saved in JobSync, not the date the employer posted the job.
- **Resume to match against** — by default each job's own resume: the resume of the search automation that found it, or the one linked to the job in My Jobs. A job with neither, or whose resume has been deleted, uses the resume you choose in the next step. You can instead use that one resume for every job.

The threshold step sets **Strong match at**: jobs scoring at or above it are counted as strong matches in the run summary. Every score is saved either way, and nothing is removed or hidden. The schedule works as for any automation, one automation per hour of the day.

Each match also checks the job against your [Deal Breakers](./deal-breakers.md); a job that has one is flagged, moved to Withdrawn if it is still New or Draft, and not counted as strong.

A job whose description is too short to judge is skipped without taking a place in the run, so it never blocks the jobs behind it.

## How do I see what a run did?

Use **Run now** on the automation's row in the list, or on its page, to run it immediately. The run's log streams on the **Logs** tab, naming each job and its score. Its **Run History** row counts the jobs that were **Unmatched** when it started, the ones **Selected** for the run, those **Scored**, and those at or above the strong-match threshold (**Strong**). There is no Discovered Jobs tab, because the automation finds no jobs of its own. The scores appear on each job in My Jobs and on the automation that discovered it.

A notification at the end says how many jobs were scored and how many are still unmatched.

## What if the AI is unavailable or a job cannot be scored?

If a local model is not running when the run starts, the run fails straight away, as any automation does. If the AI stops answering part-way, the run stops, keeps the scores it already saved, and finishes with errors; the remaining jobs are picked up next time. A reply without a score leaves that job unmatched and is counted in the run's error note.

A job you match by hand while a run is working is left as you scored it.

## How much does it cost?

One AI request per job scored. With a local model such as llama.cpp or Ollama that costs only time on your machine. With a hosted provider it is billed like any other request, and appears on the AI usage page under Automations.
