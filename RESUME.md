# How to resume this work (read this first)

Everything runs autonomously and checkpoints to git. Resuming is one step.

## ⏰ Tomorrow morning — do exactly this
Open the session and say **`continue`** (or run `bash scripts/resume_all.sh`).

That's it. The script is safe to run from any state and only does what's missing:
1. **Re-downloads the corpus if it was wiped overnight** (resumable, ~25 min) —
   likely, because the cloud container gets reclaimed after hours idle.
2. **Rebuilds `data/processed/dataset.npz` if missing** (~15 min).
3. **Continues the experiments**, automatically skipping every fold already
   recorded in `results/*.csv` (those are safe in git and are NOT recomputed).

So a cold start tomorrow = ~40 min of rebuild, then it picks up the remaining
folds on its own. A warm container = it just continues immediately.

## Why it needs resuming at all
The container **pauses background work whenever the session goes idle** and is
**fully reclaimed after long inactivity** (overnight). Only git persists —
raw data (`data/raw/`), the dataset, and model checkpoints (`*.pt`) do NOT.
That's why results are pushed to git every ~2.5 min: nothing important is lost.

## Where the results live (always current in git)
- `results/research_findings.txt` — human-readable summary (auto-updates)
- `results/comparison.csv` — baseline vs SupCon cross-speaker table
- `results/loso_baseline.csv`, `results/loso_supcon.csv`,
  `results/sanity_within_speaker.csv`, `results/transfer_aud2sil.csv`

## State of play (as of tonight)
- **Pipeline validated.** Earlier non-convergence was undertraining, now fixed
  (input feature normalization + enough epochs + 2x frame subsample).
- **Within-speaker sanity (Spk1):** train PER **0.042**, held-out-same-speaker
  PER **0.79** — the decoder genuinely learns; overfits at this data size.
- **Cross-speaker LOSO — in progress:**
  - baseline fold done: **held=Spk1 → cross-speaker PER 0.895**
  - remaining: baseline Spk2–Spk8, then all 8 SupCon folds, then transfer.
  - **Folds now checkpoint every 5 epochs and resume mid-fold** after a pause
    (verified), so an interrupted fold continues instead of restarting.
- **The core question is still open:** we need the SupCon folds to compare
  against baseline. That comparison is what tests the moat hypothesis.

## What the experiments are
On real CSL-EMG_Array facial speech EMG (8 speakers, 40 ch @ 2048 Hz; 5,880
utts, 39 ARPAbet phonemes):
- **sanity** — does the phoneme CTC decoder converge within one speaker? (yes)
- **loso** — leave-one-speaker-out zero-shot, **baseline CTC vs SupCon**.
- **transfer** — audible-trained model on the same speaker's **silent** speech.

Absolute PER is not the product number (CPU caps data/epochs); the signal is the
**baseline-vs-SupCon cross-speaker delta** and the **audible→silent gap**.

## Getting the corpus onto your own hard drive (permanent, one time)
Run on your Mac, not here (the cloud container cannot reach your drive):
```bash
bash scripts/download_corpus_local.sh
```

## Config knobs (scripts/train_eval.py)
`TRAIN_CAP=500`, `SUBSAMPLE=2`, sanity 60 epochs, loso 45 epochs. Lower caps/
epochs = faster but noisier; raise them if you move to a GPU box.
