---
type: how-to
title: Application Autofill
description: Using the JobSync Firefox extension to fill in job application forms from your resume, saved answers and AI provider, then reviewing and submitting yourself.
feature: ai
tags: [autofill, firefox, extension, browser extension, job application, apply, form, saved answers, greenhouse, lever, ashby, workday, llama.cpp, local model]
aliases: [auto fill, auto apply, application helper, fill application, firefox add-on, browser plugin, jobsync extension]
status: stable
stale_after: 2027-11-30
---

# Application Autofill

## What does the extension do?

On a job application page, click the JobSync button in the Firefox toolbar (or press **Alt+Shift+J**). The extension reads the form's questions and sends them to JobSync, and JobSync works out an answer for each one:

- **Contact details** — name, email, phone, LinkedIn, GitHub and website come from the contact information on your resume in JobSync, with no AI involved.
- **Saved answers** — answers you saved earlier, matched to the same kind of question even when it is worded differently.
- **Your AI provider** — everything else (current employer, years of experience, short "why us" answers) is answered from your resume and the job description, by the provider and model set under **Settings → AI Provider**. A local model such as llama.cpp works; nothing goes anywhere else.
- **Resume upload** — the file of your resume is attached to a resume or CV upload field.

The extension fills the form, outlines each field and opens a review panel. **Green** means the value came from your profile, a saved answer or your resume file. **Yellow** means the AI wrote it. **Red** means it needs you. Click a row in the panel to jump to that field. Nothing is ever submitted for you.

If the job is saved in JobSync (matched by its link, including Greenhouse, Lever and Ashby job ids), its description and resume are used, and the panel names it. Otherwise the text of the page is used as the description and your default resume is used.

## Which questions are never guessed?

Questions about work authorization, visas and sponsorship, salary, gender, race and ethnicity, veteran status, disability, sexual orientation, age, criminal history and ID numbers, and consent or privacy checkboxes, are never sent to the AI. They are filled only from an answer you saved, and only when it matches one of the form's choices. Otherwise they stay red.

A value already in a field is left alone. Fields already filled count as green and are listed as "already filled".

## How do I install it?

It needs Firefox 142 or later. Open **Settings → Application Autofill** in JobSync and download the extension. Firefox only installs extensions signed by Mozilla permanently, so pick one of these:

- **Try it out** — open `about:debugging`, choose **This Firefox**, then **Load Temporary Add-on**, and pick the downloaded file. It stays until Firefox restarts.
- **Firefox Developer Edition, Nightly or ESR** — set `xpinstall.signatures.required` to `false` in `about:config`, then open the downloaded file in Firefox.
- **Sign it for your own use** — create API credentials on addons.mozilla.org, then run `npx web-ext sign --channel=unlisted --source-dir extension/dist` with them from a copy of the JobSync source, after `npm run build:extension`. Mozilla signs it without publishing it, and the signed file installs in any Firefox.

Then connect it:

1. Open the extension's settings: `about:addons`, **JobSync Autofill**, **Preferences**.
2. Enter the JobSync address shown on the settings page.
3. In JobSync, click **Create access token**, copy the token and paste it into the extension. The token is shown once, lasts a year, and can be revoked under **Settings → MCP Access**.
4. Click **Save and test**. If Firefox has not granted the extension access to websites, click **Grant site access**; it needs it to reach JobSync and to read forms embedded from another site.

## How do saved answers work?

Add answers under **Settings → Application Autofill → Saved answers**. Buttons offer common questions, such as sponsorship, salary expectations and the demographic questions, so you can answer them once.

On a form, after you correct or fill in fields yourself, click **Remember my answers** in the panel. It lists the answers you typed or changed; untick any you do not want, then **Save selected**. Contact details, uploads, checkboxes and answers over 300 characters are not offered.

## How do I record that I applied?

After you submit, click **Mark as applied** in the panel. A job saved in JobSync moves to **Applied**, unless it is already further along. A job not in JobSync is added as Applied: check the title and company the panel guessed from the page, then confirm.

## What does it not handle?

Multi-page forms are filled one page at a time: click the button again on each page. Forms that open only after clicking **Apply** need that click first. Custom dropdowns are typed into and their matching option chosen; when none matches, the field is reported as not filled. Workday and other heavily customised forms may only partly fill. Cover letter uploads are left for you.
