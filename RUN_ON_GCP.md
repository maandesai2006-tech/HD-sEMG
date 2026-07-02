# Running the full-scale experiment on a GCP GPU (or Colab)

This adapts the cloud advisor's plan to **this repo**. The big change: **do NOT
upload 30 GB from your Mac.** The VM downloads the corpus itself (fast) and
rebuilds the dataset — one script. Your Mac only runs the `gcloud` commands.

## What "full scale" changes
The training auto-detects the GPU and, with `EMG_SCALE=full`, removes the CPU
compromises that made the earlier run underpowered:

| Knob | CPU run | `EMG_SCALE=full` | Env override |
|---|---|---|---|
| training utts / fold | 500 | **all (~2900)** | `EMG_TRAIN_CAP` |
| frame subsample | 2× | **1× (full res)** | `EMG_SUBSAMPLE` |
| LOSO epochs | 45 | **90** | `EMG_LOSO_EPOCHS` |
| batch size | 16 | **64** | `EMG_BATCH` |
| LSTM width | 256 | **512** (via wrapper) | `EMG_HIDDEN` |

Everything is still resumable (per-fold checkpoints) and writes to `results/`.

## Step 0 — before you spend a cent
Provision GPU quota (fresh accounts have 0): **IAM & Admin → Quotas →** filter
`Gpus (all regions)` and `NVIDIA L4 GPUs` in `us-central1` → request **1** each.
Approval takes minutes–hours. Set a **Billing budget alert** ($10/$50/$100).

## Step 1 — create the VM (run on your Mac)
```bash
export PROJECT_ID="hd-semg-project"
export ZONE="us-central1-a"
export INSTANCE_NAME="emg-gpu-lab"
export BUCKET="gs://emg-research-${PROJECT_ID}"
gcloud config set project $PROJECT_ID
gcloud services enable compute.googleapis.com storage.googleapis.com
gcloud storage buckets create $BUCKET --location=us-central1

gcloud compute instances create $INSTANCE_NAME \
  --zone=$ZONE --machine-type=g2-standard-4 \
  --provisioning-model=SPOT --maintenance-policy=TERMINATE \
  --accelerator=count=1,type=nvidia-l4 \
  --create-disk=auto-delete=yes,boot=yes,size=100,type=pd-balanced,\
image=projects/deeplearning-platform-release/global/images/family/pytorch-latest-gpu \
  --scopes=https://www.googleapis.com/auth/cloud-platform
```

## Step 2 — set up + smoke test (on the VM)
```bash
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE
# on the VM:
git clone https://github.com/YOUR_USER/HD-sEMG.git && cd HD-sEMG
bash gcp/setup_vm.sh          # deps + corpus download + dataset build (~30-40 min)

# SMOKE TEST one fold first (cheap insurance the GPU path works end-to-end):
EMG_SCALE=full EMG_LOSO_EPOCHS=3 python3 scripts/train_eval.py loso
# expect it to print device=cuda and finish a couple folds fast with no errors.
```
Delete `results/loso_*.csv` after the smoke test so the real run starts clean.

## Step 3 — the real run
```bash
export BUCKET="gs://emg-research-hd-semg-project"
SHUTDOWN=1 BUCKET=$BUCKET bash gcp/train_and_sync.sh
```
This runs the full sweep (sanity → LOSO baseline vs SupCon → transfer), syncs
`results/` to your bucket every 2 min, prints the findings, and **stops the VM**
when done so you stop paying. Pull results later with:
```bash
gsutil -m rsync -r $BUCKET/results ./results
```

## Colab alternative (free T4, least setup)
New notebook → Runtime → GPU, then:
```python
!git clone https://github.com/YOUR_USER/HD-sEMG.git
%cd HD-sEMG
!bash gcp/setup_vm.sh
!EMG_SCALE=full python3 scripts/train_eval.py all
!python3 scripts/report.py && cat results/research_findings.txt
```
Mount Google Drive and copy `results/` there so they survive a disconnect.

## Reading the outcome
Same interpretation as before — the signal is the **baseline-vs-SupCon
cross-speaker delta** in `results/comparison.csv` / `research_findings.txt`.
The key question this run answers: at full resolution, does cross-speaker PER
drop **below chance (~0.95)** so the SupCon comparison finally has room to show
an effect? If it stays at chance even here, the bottleneck is data/signal
(only 8 speakers), not compute — which is exactly the fork you want to resolve.
