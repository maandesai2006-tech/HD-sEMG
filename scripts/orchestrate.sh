#!/bin/bash
# Autonomous, self-checkpointing experiment runner.
# Survives the user running out of Claude usage: it waits for preprocessing,
# runs all experiments, and commits+pushes partial results to git every few
# minutes so progress persists even if this container is reclaimed.
set -u
cd /home/user/HD-sEMG || exit 1
BRANCH="claude/hdsemg-info-review-l3fq7k"
LOG=".experiments.log"
TRAILER=$'\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01LEERxjfKNF3G3BPmHtkH7W'

checkpoint () {
  # commit + push whatever results exist (CSVs + findings); models are gitignored
  git add results/*.csv results/*.txt 2>/dev/null
  if ! git diff --cached --quiet 2>/dev/null; then
    git commit -q -m "checkpoint: experiment results ($1)${TRAILER}" 2>/dev/null
    for i in 1 2 3 4; do
      git push origin "$BRANCH" 2>/dev/null && break || sleep $((2**i))
    done
    echo "[orchestrate] checkpoint pushed ($1)"
  fi
}

echo "[orchestrate] waiting for preprocessing (data/processed/dataset.npz) ..."
until [ -f data/processed/dataset.npz ]; do sleep 15; done
echo "[orchestrate] dataset ready. launching experiments."

# run experiments in a subprocess; resumable so a restart continues folds
python3 scripts/train_eval.py all > "$LOG" 2>&1 &
EXP_PID=$!

# checkpoint loop while experiments run
while kill -0 "$EXP_PID" 2>/dev/null; do
  sleep 150
  python3 scripts/report.py > /dev/null 2>&1
  checkpoint "in-progress"
done

# final report + push
python3 scripts/report.py > /dev/null 2>&1
checkpoint "final"
echo "ALL_DONE exit=$(tail -1 "$LOG" 2>/dev/null)"
