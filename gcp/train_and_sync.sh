#!/bin/bash
# Full-scale GPU training with periodic GCS sync + optional auto-shutdown.
# The training auto-detects CUDA and, with EMG_SCALE=full, removes every CPU
# compromise (all utts/fold, no frame subsampling, more epochs, bigger model).
# Per-fold checkpointing means a Spot preemption resumes instead of restarting.
#
# Usage:
#   BUCKET=gs://my-bucket bash gcp/train_and_sync.sh              # sync results, keep VM up
#   BUCKET=gs://my-bucket SHUTDOWN=1 bash gcp/train_and_sync.sh   # + stop VM at the end (save $)
#   EMG_HIDDEN=768 EMG_LOSO_EPOCHS=120 BUCKET=gs://b bash gcp/train_and_sync.sh   # tune
set -uo pipefail
cd "$(dirname "$0")/.."

BUCKET="${BUCKET:-}"
export EMG_SCALE="${EMG_SCALE:-full}"     # full = all data, subsample 1, more epochs, batch 64
export EMG_HIDDEN="${EMG_HIDDEN:-512}"    # LSTM width (256 on CPU); raise on big GPUs

sync_results() {
  [ -n "$BUCKET" ] && gsutil -m rsync -r results "$BUCKET/results" >/dev/null 2>&1 || true
}

# background sync loop so a preemption still leaves fresh results in GCS
if [ -n "$BUCKET" ]; then
  ( while true; do sleep 120; sync_results; done ) & SYNC_PID=$!
  echo "[train] syncing results -> $BUCKET/results every 120s"
else
  SYNC_PID=""
  echo "[train] WARNING: no BUCKET set; results stay on local disk only"
fi

echo "[train] launching full-scale run (resumable) ..."
python3 scripts/train_eval.py all 2>&1 | tee -a .experiments_gpu.log
python3 scripts/report.py || true

[ -n "$SYNC_PID" ] && kill "$SYNC_PID" 2>/dev/null || true
sync_results
echo "[train] complete. results in ${BUCKET:-local ./results}"
cat results/research_findings.txt 2>/dev/null || true

if [ "${SHUTDOWN:-0}" = "1" ]; then
  echo "[train] auto-shutdown in 30s (Ctrl-C to cancel) ..."; sleep 30
  sudo shutdown -h now
fi
