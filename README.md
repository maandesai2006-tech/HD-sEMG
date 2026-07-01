# HD-sEMG — Silent-Speech Phoneme Decoding (viability study)

Can a **subject-independent phoneme decoder** be trained on facial surface-EMG
so a new user needs minimal calibration, and does a **contrastive (SupCon)
embedding** improve cross-speaker generalization over a plain CTC baseline?
This repo tests that on **real** multi-speaker facial speech EMG
(**CSL-EMG_Array**, Bremen; 8 speakers, 40-channel array @ 2048 Hz, audible +
silent speech, CC-BY-4.0), not a gesture proxy.

## Pipeline

| Step | Script | What it does |
|------|--------|--------------|
| 1 | `scripts/download_emg.py` | Pulls an EMG-only subset from the remote zip via HTTP range requests (no full 30 GB download). All 8 speakers audible + 4 speakers silent. |
| 2 | `scripts/preprocess.py` | Bandpass+notch filter, per-speaker per-channel z-score, 32 ms/16 ms frame features (RMS/MAV/ZCR/WL), text→ARPAbet (CMUdict). |
| 3 | `scripts/model.py` | CNN→BiLSTM→CTC baseline and V2 with a 64-d phoneme embedding + SupCon loss on forced-aligned frames. |
| 4 | `scripts/train_eval.py` | `sanity` (within-speaker), `loso` (cross-speaker baseline vs SupCon), `transfer` (audible→silent). |

## Run

```bash
pip install -r requirements.txt
python3 scripts/download_emg.py      # ~18 GB subset via range requests
python3 scripts/preprocess.py        # -> data/processed/dataset.npz
python3 scripts/train_eval.py all     # -> results/*.csv
```

Everything is CPU-only (`torch.set_num_threads(4)`).

## Get the full corpus onto your own drive

The cloud session that produced this **cannot** write to your Mac's external
drive. To keep the full corpus locally, run `scripts/download_corpus_local.sh`
in your Mac's Terminal (edit the drive name first).

## Results

See `results/` (CSVs) and `research_findings.md` for the honest write-up,
including the binding constraint and next steps.

## Data source / citation
Diener, Roustay Vishkasougheh, Schultz. *CSL-EMG_Array*, Interspeech 2020.
https://csl.uni-bremen.de/ (CC-BY-4.0). Not redistributed here; scripts fetch it.
