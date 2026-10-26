<!--
SPDX-FileCopyrightText: Avicina Studio
SPDX-License-Identifier: MIT
-->

# RadChecklist

> **Superseded, kept for reference.** An early standalone prototype of the prior
> checklist. The real one is built into RadGesture: ring > AI Tools > Priors
> (see the root README). Nothing here is built or shipped.

Paste in a prior report, get back a short tick-list of what to compare on today's
study. Built for FDG PET/CT, where the prior can run to forty lines and it is
easy to lose a finding to follow-up.

## What it does

You copy the prior report and press **Ctrl+Alt+P**. A small always-on-top window
appears with one tick box per finding worth chasing, grouped by priority:

```
Prior: Stage IIIB NSCLC restaging; partial response, new hepatic lesion.
3 of 7 addressed  -  2 must-address items still open

MUST ADDRESS
  [x] Hepatic segment 7 lesion      -  New, 1.9 cm, SUVmax 8.4
  [ ] Left upper lobe primary mass  -  4.8 x 3.9 cm, SUVmax 14.6, ser 3/im 42
  [ ] Right upper lobe nodule       -  7 mm non-avid, ser 3/im 28, follow-up advised

SHOULD ADDRESS
  [x] Left hilar nodal conglomerate -  2.4 cm short axis, SUVmax 9.8
  ...
```

Tick each one as you dictate it. Before you sign, press **Copy unaddressed** —
that puts everything you have *not* ticked on the clipboard. That is the bit
that catches the finding you were going to come back to and didn't.

The three tiers are:

| Tier | What lands there |
| --- | --- |
| **Must address** | Target and measurable lesions, anything the prior called new or worsening, anything with a stated recommendation or follow-up interval, and actionable non-oncologic findings (PE, dissection, large aneurysm, new nodule, fracture, obstruction, abscess). |
| **Should address** | Other FDG-avid or measurable disease sites, and anything the prior called indeterminate. |
| **Mention if changed** | Real but low-yield baseline findings. |

Deliberately thrown away, because they are what make a prior report feel long:
steatosis, diverticulosis, degenerative change, dependent atelectasis,
physiologic uptake, technique and dose text, clinical history, stable hardware,
vascular calcification, simple cysts, calcified granulomas, and every
"unremarkable" negative.

The list is capped at 14 items and the prompt is told that fewer is better, so a
short prior gives a short list rather than fourteen padded ones.

## Setup

1. Install [AutoHotkey v2](https://www.autohotkey.com/). v1 will not run this.
2. Put `RadChecklist.ahk` somewhere permanent.
3. Give it an API key, either:
   - set a `ANTHROPIC_API_KEY` environment variable (preferred — the key never
     touches a file), or
   - copy `RadChecklist.example.ini` to `RadChecklist.ini` next to the script and
     put the key under `[api]`.
4. Double-click the script. A tray icon appears; the tray menu has everything.
5. To start it with Windows, put a shortcut to it in
   `shell:startup` (Win+R, type `shell:startup`).

## Hotkeys

| Key | Action |
| --- | --- |
| `Ctrl+Alt+P` | Build a checklist from the selection, or from the clipboard if nothing is selected |
| `Ctrl+Alt+O` | Show / hide the checklist window |
| `Esc` | Hides the checklist; cancels a request that is still running |

Both hotkeys are configurable in the ini file.

## Settings

`RadChecklist.ini`, next to the script:

```ini
[api]
key=                      ; blank = use the ANTHROPIC_API_KEY environment variable
base_url=https://api.anthropic.com/v1/messages
model=claude-opus-5
effort=medium             ; low | medium | high | xhigh | max
max_tokens=4000

[behavior]
scrub_phi=1               ; strip identifier lines before sending
max_items=14
hotkey_build=^!p
hotkey_toggle=^!o
```

`effort` is the quality/latency dial. `medium` is the default because this is
extraction and triage rather than hard reasoning, and you are waiting on it at
the workstation. If you find it is missing findings, raise it to `high`.

## About patient data — read this before using it on real studies

**The report text is sent to the Anthropic API.** That is a third party. Before
you use this on real patient studies:

- Your institution needs a **Business Associate Agreement** with Anthropic, or
  you need to be running against an endpoint that is already covered by one.
  Change `base_url` if your institution provides its own endpoint.
- Check your local policy on sending report text to external services. This is
  the kind of thing that is fine at one shop and a fireable offence at another.

`scrub_phi=1` removes obvious identifier lines before sending — name, MRN,
accession, DOB, referring and signing physician, phone, room, encounter — and
replaces any run of six or more digits with `[ID]`.

**This is risk reduction, not de-identification.** Study dates and the full
clinical narrative are deliberately kept, because the comparison is worthless
without them, and a narrative can identify someone on its own. Do not treat the
scrubbed text as a de-identified data set.

Nothing is written to disk except the window position and your settings. The
checklist itself lives only in memory and disappears when you close the script.

## Known limits

- **Windows only.** AutoHotkey is a Windows tool.
- **It has not been run end-to-end yet.** The parsing, the identifier scrubber
  and the request encoding are tested; the AutoHotkey syntax and the live API
  round-trip are not, because neither AutoHotkey nor an API key was available
  where this was written. Expect to shake out one or two things on first run.
- **The window does not scroll.** At the 14-item cap it is about 700 px tall,
  which fits a reading monitor. Lower `max_items` if you want it smaller.
- **It reads only what you paste.** It cannot see the images, and it does not
  know anything about today's study. It tells you where to look; the reading is
  yours.
- **It is a safety net, not a substitute for reading the prior.** A finding the
  model drops is a finding you will not be reminded of.
