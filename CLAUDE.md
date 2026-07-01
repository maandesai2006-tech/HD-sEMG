# Project context for Claude

## What this is
Viability study for a **silent-speech / subvocal phoneme decoder** from facial
surface-EMG. Long-term product vision: read jaw/face/throat EMG (+ a piezo
laryngeal mic) → phoneme decoder → LLM composition/reasoning layer → text.
Markets: loud-environment hands-free input (easy mode, voicing present) and
covert/silent comms (hard mode, voicing largely absent). Anti-open-vocab:
compose phonemes, don't classify whole words.

## Core research question
Can a **subject-independent** phoneme decoder be trained so a new user needs
minimal calibration, and does a **SupCon contrastive phoneme embedding** beat a
plain CTC baseline at cross-speaker generalization?

## Prior findings (earlier sessions)
- On **NinaPro DB5** (forearm-gesture proxy): SupCon beat plain CTC on 10/10
  held-out subjects; the *contrastive layer*, not just "more subjects," drove
  the gain. Right mechanism, wrong modality.
- First **CSL-EMG_Array** attempt on a tiny subset (60–180 utts): phoneme CTC
  **failed to converge** → binding constraint is **data scale**, now confirmed
  on the correct modality.

## This session
Full pipeline on a real, larger CSL-EMG_Array subset:
- **CSL-EMG_Array**: 8 speakers, 40-ch facial EMG @ 2048 Hz, audible + silent,
  same eval sentences across speakers. Transcripts in each session's
  `recordingLog.json` (`promptList`). Silent only exists for Spk1,3,6,8.
- Subset fetched via range requests: audible (8 spk) + silent (4 spk), blocks
  Initial (train) + Eval1/2/3 (parallel test).
- Target: **phoneme decoder only** (ARPAbet, 39 phones + blank), CTC.
- Experiments: within-speaker sanity; cross-speaker LOSO baseline vs SupCon;
  audible→silent transfer.

## Environment notes
- This runs in an **ephemeral cloud container** (4 CPU, 15 GB RAM, ~31 GB disk,
  **no GPU**). It **cannot** see the user's Mac or its external drive
  (`/Volumes/...`). Data downloaded here does not persist; only git does.
- To get the corpus on the user's hard drive: `scripts/download_corpus_local.sh`
  run on the Mac.
- Downloader must use retries + modest concurrency (server drops SSL under load).

## Honest boundaries
- No open **multi-speaker phoneme-EMG at the product's exact montage** exists;
  CSL-EMG_Array (facial array, speech) is the closest and what we use.
- CPU-only: experiments cap training utts/fold and epochs for tractability;
  absolute PER is not the product number, the **cross-speaker delta** is the signal.
