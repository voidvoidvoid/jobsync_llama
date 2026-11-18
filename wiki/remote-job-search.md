---
type: how-to
title: Remote Job Search
description: Setting up an automation that searches remote job boards by job title and keyword with no company list, and limiting it to roles open to where you live.
feature: automations
tags: [automations, remote, remote jobs, keyword search, himalayas, jobicy, remote ok, we work remotely, working nomads, arbeitnow, job boards, work from anywhere, locations, countries, skills, job search]
aliases: [remote job boards, search without companies, open job search, keyword job search, remote automation]
status: stable
stale_after: 2027-09-30
---

# Remote Job Search

## How do I search for remote jobs without picking companies?

Create an [automation](./automations.md) and choose **Remote job boards (keyword search)** as the job board in the first step. The Search step then shows six boards to switch on or off instead of a company picker. Two are searched with your terms:

- **Himalayas** — the largest. JobSync runs a search there for each of your titles and keywords and takes the newest results.
- **Jobicy** — a curated board, searched with your first three terms of three characters or more because it asks integrations to keep requests few.

The other four have no search of their own, so JobSync downloads their current listings and filters them with your terms:

- **Remote OK** — its newest 100 postings.
- **We Work Remotely** — the newest postings from its public feed.
- **Working Nomads** — its whole current list.
- **Arbeitnow** — its newest remote postings. It is a European board, largely German employers, and many listings are written in German, so it is the one board that starts switched off.

Every listing on these boards is a remote role from whichever employer posted it, so there is no company list to build and no remote filter to set. The rest of the wizard — resume, match threshold, schedule — works exactly as it does for a company-board automation, and so do ranking, AI scoring and the discovered-jobs list.

## Which titles and keywords should I enter?

What you type under **Target job titles** and **Keywords / skills** does double duty. The first six, titles first, are sent to the boards as searches, and all of them rank what comes back. Put your most important terms first, and prefer specific ones: `Data Engineer` and `Airflow` find more of what you want than `Engineer`.

With no titles and no keywords the boards are only asked for their newest postings and nothing can be ranked, so the run saves nothing. The wizard shows an amber warning when both are empty.

The skills on your matching resume still count toward ranking, as they do for company boards, but they are not sent to the boards as searches.

Ranking is simpler here than on company boards. There, a rare word outweighs a common one; here every matching title word or keyword counts the same, because results that were fetched by searching for your terms all contain them. The more of your terms a listing matches, the higher it ranks.

## How do I keep only jobs I can take from where I live?

A remote role often still requires you to live in certain countries, and that is what the boards report as its location. Under **Where you can work from**, add the countries or regions that apply to you — `United States`, `Canada`, `Europe` — and turn on **Only show jobs open to these locations**. Roles restricted to somewhere else are then dropped before ranking. Roles open worldwide always pass.

`US`, `USA` and `United States` are treated as the same place, as are `UK` and `United Kingdom`. Anything else must be spelled the way a posting would spell it, and a country does not match a region that contains it: `Germany` will not match a role listed as `Europe`, so add both if you want both.

Leave the toggle off to see every remote role regardless of where it is open.

## Why does Arbeitnow show a city for a remote job?

Arbeitnow lists the employer's city — `Berlin`, `Munich` — rather than where the role is open to, and a remote role there is usually open to that country, not the world. So with **Only show jobs open to these locations** on, an Arbeitnow listing passes only if you added its city; a `United States` filter drops it. With the toggle off, every remote Arbeitnow listing that matches your terms is kept.

## What happens to duplicates, and where do saved jobs link to?

A posting that appears on more than one board, or under more than one of your search terms, is saved once. Each discovered job links back to its posting on the board it came from, and that board is recorded as the job's source.

## How often should a remote search run?

Once a day, which is what the schedule does. The boards refresh about daily, and they provide their listings free on the understanding that integrations stay light, so a run makes only a handful of requests to each. Running the same search by hand several times a day finds nothing new.

If one board is down or rate-limits the run, the run continues with the others, finishes as completed with errors, and a notification names the board that failed. If every selected board fails, the run is marked failed.
