#!/bin/bash
# One-shot setup on a fresh GPU VM (or Colab). Idempotent.
# Gets the code ready to train: deps -> corpus download -> dataset build.
# Run from the repo root:  bash gcp/setup_vm.sh
set -uo pipefail
cd "$(dirname "$0")/.."

echo "[setup] python: $(python3 --version)"
python3 - <<'PY'
import torch
print("[setup] torch", torch.__version__,
      "| cuda available:", torch.cuda.is_available(),
      "|", (torch.cuda.get_device_name(0) if torch.cuda.is_available() else "no GPU"))
PY

echo "[setup] installing python deps ..."
pip install -q -r requirements-gpu.txt
python3 -c "import nltk; nltk.download('cmudict', quiet=True); print('[setup] cmudict ready')"

# 1) corpus: EMG-only, resumable, skips files already present
echo "[setup] downloading corpus (~5880 EMG files) ..."
for a in $(seq 1 25); do
  n=$(find data/raw -name '*_emg.npy' 2>/dev/null | wc -l)
  [ "$n" -ge 5880 ] && { echo "[setup] corpus complete: $n/5880"; break; }
  echo "[setup]   attempt $a: $n/5880"
  python3 scripts/download_emg.py || true
done

# 2) dataset (filter + normalize + featurize + phonemize)
if [ -f data/processed/dataset.npz ]; then
  echo "[setup] dataset already built."
else
  echo "[setup] building dataset (preprocess) ..."
  python3 scripts/preprocess.py
fi

echo "[setup] READY:"; ls -la data/processed/dataset.npz
echo "[setup] next: bash gcp/train_and_sync.sh   (set BUCKET=gs://... to persist results)"
