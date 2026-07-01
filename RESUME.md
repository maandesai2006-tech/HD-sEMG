# How to resume this work (minimal usage)

Everything is autonomous and checkpoints to git. You almost never need to babysit it.

## The one thing to know
The experiments run in the background and **push results to git (`results/`) every ~2.5 minutes**.
So the latest numbers are always in the repo, even if this container gets wiped.

## If you just want the results
Look in the repo:
- `results/research_findings.txt` — human-readable summary (updates as folds finish)
- `results/comparison.csv` — baseline vs SupCon cross-speaker table
- `results/loso_baseline.csv`, `results/loso_supcon.csv`, `results/sanity_within_speaker.csv`,
  `results/transfer_aud2sil.csv` — raw per-fold numbers

## If the run stopped (container was reclaimed) — resume with ONE command
```bash
bash scripts/resume_all.sh
```
This is safe from any state. It will only do what's still missing:
1. finish the corpus download if needed (resumable),
2. rebuild `data/processed/dataset.npz` if missing,
3. relaunch the experiments (which skip folds already recorded in `results/*.csv`).

Or in a fresh Claude session, just say **"continue"** and it will run the same thing.

## What the experiments are
On real CSL-EMG_Array facial speech EMG (8 speakers, 40 ch, 2048 Hz; 5,880 utts, 39 phonemes):
- **sanity** — does the phoneme CTC decoder converge within one speaker at this data scale?
- **loso** — leave-one-speaker-out cross-speaker zero-shot, **baseline CTC vs SupCon** (the moat question).
- **transfer** — audible-trained model evaluated on the same speaker's **silent** speech (the covert regime gap).

## Getting the corpus onto your own hard drive (permanent, independent of this container)
Run on your Mac (not here):
```bash
bash scripts/download_corpus_local.sh   # or the direct curl in that script
```
The cloud container cannot reach your drive; this is the only way the data lands on it permanently.

## State of play (last updated by the run itself in results/)
- Corpus: 5,880 / 5,880 EMG files downloaded, dataset built (0 dropped, 12 OOV words).
- Experiments: launched; see `results/` for live progress.
