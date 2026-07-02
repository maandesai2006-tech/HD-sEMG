#!/bin/bash
# ONE-COMMAND RESUME — safe to run from ANY state (fresh container, partial
# download, dataset built, experiments half-done).  Idempotent: it only does
# the work that's still missing, and it won't start a second experiment run if
# one is already going.
#
#   bash scripts/resume_all.sh
#
# It will, in order:
#   1. finish the corpus download if < 5880 EMG files (resumable, skips existing)
#   2. build data/processed/dataset.npz if missing
#   3. (re)launch the autonomous, self-checkpointing experiment orchestrator
#
# All experiment progress is pushed to git every ~2.5 min, so nothing is lost.
set -u
cd "$(dirname "$0")/.." || exit 1

# 0. don't double-run experiments
if pgrep -f "python3 scripts/train_eval.py" >/dev/null 2>&1; then
  echo "[resume] experiments already running — nothing to do."
  echo "[resume] tail progress: tail -f .experiments.log"
  exit 0
fi

# 1. corpus
cnt=$(find data/raw -name '*_emg.npy' 2>/dev/null | wc -l)
if [ ! -f data/processed/dataset.npz ] && [ "$cnt" -lt 5880 ]; then
  echo "[resume] corpus incomplete ($cnt/5880) — downloading (resumable) ..."
  for attempt in $(seq 1 20); do
    cnt=$(find data/raw -name '*_emg.npy' 2>/dev/null | wc -l)
    [ "$cnt" -ge 5880 ] && break
    echo "[resume] download attempt $attempt: $cnt/5880"
    python3 scripts/download_emg.py >> .download.log 2>&1 || true
    sleep 2
  done
fi

# 2. dataset
if [ ! -f data/processed/dataset.npz ]; then
  echo "[resume] building dataset (preprocess) ..."
  python3 scripts/preprocess.py > .preprocess.log 2>&1
  echo "[resume] preprocess exit=$?"
fi

# 3. experiments (detached, self-pushing)
echo "[resume] launching autonomous experiment orchestrator ..."
nohup bash scripts/orchestrate.sh > .orchestrate.log 2>&1 &
echo "[resume] orchestrator pid=$!  —  results push to git as folds finish."
echo "[resume] watch: tail -f .experiments.log   |   cat results/research_findings.txt"
