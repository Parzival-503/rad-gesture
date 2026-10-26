<!--
SPDX-FileCopyrightText: Avicina Studio
SPDX-License-Identifier: CC-BY-4.0
-->

# Prior report → pre-read checklist

> **Superseded, kept for reference.** An early standalone prototype of the prior
> checklist. The real one is built into RadGesture: ring > AI Tools > Priors
> (see the root README). Nothing here is built or shipped.

Select a prior report, press **Ctrl+Alt+P**, and a small window pops up with a short
checklist of what that prior obliges you to address on the exam you're about to read.

It is not a summary. Every line is something to do, with the numbers carried across so you
can actually re-measure:

```
CT A/P with contrast - 2024-03-11

IMPRESSION:
- 2.1 cm hypodense liver lesion, seg VI (se 3/im 44) -> re-measure, assess interval change
- Mild L hydronephrosis, no stone -> confirm resolution vs progression
- 8 mm RLL nodule -> Fleischner 6-12 mo CT (due)

ALSO CHECK:
- R IJ port tip at cavoatrial junction -> check position unchanged
- Motion degraded the pancreatic phase -> verify adequate coverage this time
```

## Setup (one time)

1. **Install AutoHotkey v2** from [autohotkey.com](https://www.autohotkey.com/). Version 2,
   not version 1 — the script won't run on v1.
2. **Give it an API key.** Either set an `ANTHROPIC_API_KEY` environment variable, or make
   a file called `api-key.txt` in this folder with the key on the first line and nothing
   else. Don't paste the key into the script itself — the script is in git, the key
   shouldn't be.
3. **Double-click `PriorReportChecklist.ahk`.** A green "H" icon appears in the system
   tray. That's it running. To have it start with Windows, put a shortcut to it in your
   Startup folder (`Win+R`, then `shell:startup`).

## Using it

| Key | What it does |
| --- | --- |
| **Ctrl+Alt+P** | Copies whatever text you have selected, sends it off, shows the checklist |
| **Ctrl+Alt+O** | Re-opens the last checklist without paying for another call |
| **Esc** | Closes the checklist window |

Select the *whole* prior report, including the findings section — the "also check" items
come out of the body, so a selection of just the impression gives you less. If you select
fewer than 200 characters it'll tell you rather than waste a call.

Your clipboard is put back the way it was afterwards.

## Read this before using it on real patients

**The report text leaves your machine.** It goes to the address in `API_URL` near the top
of the script. Out of the box that's Anthropic's public API, which is almost certainly not
somewhere your institution has cleared for patient data. Before you use this on a real
prior, either point `API_URL` at an endpoint your institution has approved, or confirm with
whoever runs compliance that the default is acceptable. Anything that speaks the same API
shape works with no other changes to the script.

This is a reading aid. It can miss things and it can invent things. The prior report is
the source of truth, not the checklist.

## Tuning it

Everything worth changing sits in the first ~40 lines:

- `HOTKEY_RUN` / `HOTKEY_RECALL` — the key combinations (`^` Ctrl, `!` Alt, `+` Shift)
- `API_URL`, `API_MODEL` — where it goes and which model answers
- `MAX_ITEMS` — the cap on checklist length, default 8. This is what keeps it short; raise
  it and you'll start getting back the noise the rules are there to filter out.

The rules themselves are the `PROMPT` block further down, in plain English. If it's giving
you items you don't care about — chronic degenerative findings, say — add a line to the
"Never include" list. If it's dropping something you always want, add it to the "ALSO
CHECK" qualifying list. Save the file, right-click the tray icon, "Reload Script".
