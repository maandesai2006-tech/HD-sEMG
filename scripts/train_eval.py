"""
Experiments on real CSL-EMG_Array facial speech EMG:

  sanity   : within-speaker convergence check (does phoneme CTC learn at all).
  loso     : leave-one-speaker-out cross-speaker zero-shot, baseline vs SupCon
             (audible).  -> the "does contrastive help cross-speaker" question.
  transfer : audible-trained model evaluated on the SAME held-out speaker's
             SILENT speech -> audible->silent generalization gap.

Resumable: each completed row is appended to results/*.csv; finished folds are
skipped on restart.  Everything is CPU / torch.set_num_threads(4).
"""
import os, sys, csv, time, json, random
import numpy as np
import torch
import torch.nn as nn
import torchaudio.functional as AF

sys.path.insert(0, os.path.dirname(__file__))
from model import SubvocalCTC, SubvocalCTCV2, supcon_loss, N_CLASS, BLANK

random.seed(0); np.random.seed(0); torch.manual_seed(0)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PROC = os.path.join(ROOT, "data", "processed", "dataset.npz")
RES = os.path.join(ROOT, "results")
os.makedirs(RES, exist_ok=True)


def _envi(name, default):
    return int(os.environ.get(name, default))


# ---- device: auto-detect cuda -> mps -> cpu (override with EMG_DEVICE) ----
_dev = os.environ.get("EMG_DEVICE")
if not _dev:
    if torch.cuda.is_available():
        _dev = "cuda"
    elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        _dev = "mps"
    else:
        _dev = "cpu"
DEV = torch.device(_dev)
if DEV.type == "cpu":
    torch.set_num_threads(_envi("EMG_THREADS", 4))

# ---- scale profile: EMG_SCALE=full unshrinks the CPU compromises ----
_FULL = os.environ.get("EMG_SCALE", "").lower() == "full"
BATCH = _envi("EMG_BATCH", 64 if _FULL else 16)
CLIP = 5.0
# TRAIN_CAP 0 => use ALL available training utts for the fold
TRAIN_CAP = _envi("EMG_TRAIN_CAP", 0 if _FULL else 500)
SUBSAMPLE = _envi("EMG_SUBSAMPLE", 1 if _FULL else 2)
CKPT_EVERY = _envi("EMG_CKPT_EVERY", 5)
SANITY_EPOCHS = _envi("EMG_SANITY_EPOCHS", 100 if _FULL else 60)
LOSO_EPOCHS = _envi("EMG_LOSO_EPOCHS", 90 if _FULL else 45)
EVAL_BLOCKS = ("Block3-Eval1", "Block5-Eval2", "Block7-Eval3")

print(f"[config] device={DEV.type} scale={'full' if _FULL else 'cpu'} "
      f"batch={BATCH} train_cap={TRAIN_CAP or 'ALL'} subsample={SUBSAMPLE} "
      f"sanity_ep={SANITY_EPOCHS} loso_ep={LOSO_EPOCHS}", flush=True)


# ---------------- data ----------------
def load():
    d = np.load(PROC, allow_pickle=True)
    return dict(X=d["X"], Y=d["Y"], spk=d["spk"], mode=d["mode"],
                block=d["block"], phones=d["phones"])


def _sub(x, L):
    # frame subsample by SUBSAMPLE (speeds LSTM + eases CTC), but never below
    # target length L (CTC requires T >= L).
    if SUBSAMPLE > 1 and x.shape[0] // SUBSAMPLE >= L:
        return x[::SUBSAMPLE]
    return x


def collate(idx, X, Y):
    ys = [torch.from_numpy(Y[i]).long() for i in idx]
    xs = [torch.from_numpy(_sub(X[i], len(Y[i]))).float() for i in idx]
    ilen = torch.tensor([x.shape[0] for x in xs], dtype=torch.long)
    tlen = torch.tensor([y.shape[0] for y in ys], dtype=torch.long)
    xp = nn.utils.rnn.pad_sequence(xs, batch_first=True)         # (B,T,F)
    yp = nn.utils.rnn.pad_sequence(ys, batch_first=True)         # (B,Lmax)
    # inputs/targets go to the device; CTC & alignment lengths stay on CPU
    return xp.to(DEV), yp.to(DEV), ilen, tlen


# ---------------- metrics ----------------
def greedy_decode(logp, ilen):
    out = []
    arg = logp.argmax(-1).cpu()                 # (B,T)
    for b in range(arg.shape[0]):
        seq = arg[b, :ilen[b]].tolist()
        prev = None; dec = []
        for s in seq:
            if s != prev and s != BLANK:
                dec.append(s)
            prev = s
        out.append(dec)
    return out


def per(ref, hyp):
    # Levenshtein / len(ref)
    n, m = len(ref), len(hyp)
    if n == 0:
        return 1.0 if m else 0.0
    dp = list(range(m + 1))
    for i in range(1, n + 1):
        prev = dp[0]; dp[0] = i
        for j in range(1, m + 1):
            cur = dp[j]
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1,
                        prev + (ref[i - 1] != hyp[j - 1]))
            prev = cur
    return dp[m] / n


# ---------------- train / eval ----------------
def frame_labels(logp, yp, ilen, tlen):
    """CTC forced alignment -> per-frame phoneme ids (0=blank). Returns list."""
    labs = []
    for b in range(logp.shape[0]):
        T = int(ilen[b]); L = int(tlen[b])
        if L == 0 or T < L:
            labs.append(None); continue
        lp = logp[b:b + 1, :T].contiguous()
        tgt = yp[b:b + 1, :L].contiguous().int()
        try:
            aligned, _ = AF.forced_align(lp, tgt,
                                         input_lengths=torch.tensor([T]),
                                         target_lengths=torch.tensor([L]),
                                         blank=BLANK)
            labs.append(aligned[0])              # (T,)
        except Exception:
            labs.append(None)
    return labs


def train(method, tr_idx, X, Y, epochs, lam=0.5, log=print, ckpt=None):
    model = (SubvocalCTCV2() if method == "supcon" else SubvocalCTC()).to(DEV)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    ctc = nn.CTCLoss(blank=BLANK, zero_infinity=True)
    start_ep = 0
    if ckpt and os.path.exists(ckpt):
        try:
            st = torch.load(ckpt, map_location=DEV)
            model.load_state_dict(st["model"]); opt.load_state_dict(st["opt"])
            start_ep = st["epoch"] + 1
            log(f"    resumed mid-fold from epoch {start_ep}")
        except Exception as e:                       # corrupt/partial ckpt -> fresh
            log(f"    ckpt load failed ({e}); starting fold fresh")
    tr_idx = list(tr_idx)
    for ep in range(start_ep, epochs):
        model.train(); random.shuffle(tr_idx)
        tot = 0.0; nb = 0
        for s in range(0, len(tr_idx), BATCH):
            idx = tr_idx[s:s + BATCH]
            xp, yp, ilen, tlen = collate(idx, X, Y)
            opt.zero_grad()
            if method == "supcon":
                logp, z = model(xp)
                closs = ctc(logp.transpose(0, 1), yp, ilen, tlen)
                # phoneme-level contrastive on aligned non-blank frames
                # (alignment runs on CPU for device portability)
                labs = frame_labels(logp.detach().cpu(), yp.cpu(), ilen, tlen)
                embs, lbls = [], []
                for b, fl in enumerate(labs):
                    if fl is None:
                        continue
                    nz = fl > 0
                    if nz.any():
                        embs.append(z[b, :int(ilen[b])][nz.to(z.device)])
                        lbls.append(fl[nz])
                if embs:
                    E = torch.cat(embs); Lb = torch.cat(lbls).to(DEV)
                    # subsample frames to bound cost
                    if E.shape[0] > 256:
                        sel = torch.randperm(E.shape[0])[:256]
                        E, Lb = E[sel], Lb[sel]
                    sloss = supcon_loss(E, Lb)
                else:
                    sloss = torch.tensor(0.0)
                loss = closs + lam * sloss
            else:
                logp = model(xp)
                loss = ctc(logp.transpose(0, 1), yp, ilen, tlen)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), CLIP)
            opt.step()
            tot += float(loss); nb += 1
        if ckpt and (ep % CKPT_EVERY == 0 or ep == epochs - 1):
            tmp = ckpt + ".tmp"
            torch.save({"model": model.state_dict(), "opt": opt.state_dict(),
                        "epoch": ep, "method": method}, tmp)
            os.replace(tmp, ckpt)                     # atomic: never leaves partial ckpt
        if ep % 5 == 0 or ep == epochs - 1:
            log(f"    ep{ep:02d} loss {tot/max(nb,1):.3f}")
    return model


@torch.no_grad()
def evaluate(model, method, idx, X, Y):
    model.eval()
    pers = []
    for s in range(0, len(idx), BATCH):
        b = idx[s:s + BATCH]
        xp, yp, ilen, tlen = collate(b, X, Y)
        logp = model(xp)[0] if method == "supcon" else model(xp)
        dec = greedy_decode(logp, ilen)
        for k, i in enumerate(b):
            pers.append(per(Y[i].tolist(), dec[k]))
    return float(np.mean(pers)), len(pers)


# ---------------- experiments ----------------
def append_csv(name, row, header):
    p = os.path.join(RES, name)
    new = not os.path.exists(p)
    with open(p, "a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(header)
        w.writerow(row)


def done_folds(name, keycols=2):
    p = os.path.join(RES, name)
    if not os.path.exists(p):
        return set()
    out = set()
    with open(p) as f:
        r = csv.reader(f); next(r, None)
        for row in r:
            out.add(tuple(row[:keycols]))
    return out


def run_sanity(D):
    if done_folds("sanity_within_speaker.csv", 1):
        print("[sanity] already done"); return
    spk = "Spk1"
    aud = (D["mode"] == "aud")
    sel = np.where((D["spk"] == spk) & aud)[0]
    is_eval = np.isin(D["block"][sel], EVAL_BLOCKS)
    tr = sel[~is_eval]; te = sel[is_eval]
    print(f"[sanity] {spk} aud: train {len(tr)} test {len(te)}")
    t0 = time.time()
    cap = tr[:TRAIN_CAP] if TRAIN_CAP else tr
    m = train("baseline", cap, D["X"], D["Y"], epochs=SANITY_EPOCHS,
              log=lambda s: print("[sanity]" + s))
    tr_per, _ = evaluate(m, "baseline", list(tr[:300]), D["X"], D["Y"])
    te_per, n = evaluate(m, "baseline", list(te), D["X"], D["Y"])
    print(f"[sanity] train PER {tr_per:.3f}  held-out-same-spk PER {te_per:.3f}  ({time.time()-t0:.0f}s)")
    append_csv("sanity_within_speaker.csv",
               [spk, round(tr_per, 4), round(te_per, 4), n],
               ["speaker", "train_per", "val_per", "n_val"])


def run_loso(D, method, epochs=None):
    epochs = epochs or LOSO_EPOCHS
    speakers = sorted(set(D["spk"][D["mode"] == "aud"]))
    name = f"loso_{method}.csv"
    done = done_folds(name, 1)
    for held in speakers:
        if (held,) in done:
            print(f"[loso:{method}] {held} already done"); continue
        aud = (D["mode"] == "aud")
        tr = np.where(aud & (D["spk"] != held))[0]
        te = np.where(aud & (D["spk"] == held) &
                      np.isin(D["block"], EVAL_BLOCKS))[0]
        tr = list(tr); random.Random(1).shuffle(tr)   # actually shuffle (was a no-op)
        if TRAIN_CAP:
            tr = tr[:TRAIN_CAP]
        print(f"[loso:{method}] held={held} train {len(tr)} test {len(te)}")
        ckpt = os.path.join(RES, f"ckpt_{method}_hold_{held}.pt")
        t0 = time.time()
        m = train(method, tr, D["X"], D["Y"], epochs=epochs, ckpt=ckpt,
                  log=lambda s: print(f"[loso:{method}:{held}]" + s))
        p, n = evaluate(m, method, list(te), D["X"], D["Y"])
        dt = time.time() - t0
        print(f"[loso:{method}] {held} cross-speaker PER {p:.3f} ({dt:.0f}s)")
        append_csv(name, [held, round(p, 4), n, method, round(dt, 0)],
                   ["held_speaker", "cross_per", "n_test", "method", "sec"])
        # save final model for transfer reuse; drop the mid-fold checkpoint
        torch.save(m.state_dict(), os.path.join(RES, f"model_{method}_hold_{held}.pt"))
        if os.path.exists(ckpt):
            os.remove(ckpt)


def run_transfer(D, method="supcon"):
    """Eval the audible-trained held-out model on that speaker's SILENT speech."""
    sil_speakers = sorted(set(D["spk"][D["mode"] == "sil"]))
    name = "transfer_aud2sil.csv"
    done = done_folds(name, 1)
    for held in sil_speakers:
        if (held,) in done:
            continue
        ckpt = os.path.join(RES, f"model_{method}_hold_{held}.pt")
        if not os.path.exists(ckpt):
            print(f"[transfer] no model for {held}, skip"); continue
        m = SubvocalCTCV2() if method == "supcon" else SubvocalCTC()
        m.load_state_dict(torch.load(ckpt, map_location=DEV)); m.to(DEV); m.eval()
        te_sil = np.where((D["spk"] == held) & (D["mode"] == "sil") &
                          np.isin(D["block"], EVAL_BLOCKS))[0]
        te_aud = np.where((D["spk"] == held) & (D["mode"] == "aud") &
                          np.isin(D["block"], EVAL_BLOCKS))[0]
        p_sil, n_s = evaluate(m, method, list(te_sil), D["X"], D["Y"])
        p_aud, n_a = evaluate(m, method, list(te_aud), D["X"], D["Y"])
        print(f"[transfer] {held} audible PER {p_aud:.3f} -> silent PER {p_sil:.3f}")
        append_csv(name,
                   [held, round(p_aud, 4), round(p_sil, 4), n_a, n_s, method],
                   ["held_speaker", "aud_per", "sil_per", "n_aud", "n_sil", "method"])


def main():
    exp = sys.argv[1] if len(sys.argv) > 1 else "all"
    D = load()
    print("Loaded", len(D["X"]), "utts. phones:", len(D["phones"]))
    if exp in ("sanity", "all"):
        run_sanity(D)
    if exp in ("loso", "all"):
        run_loso(D, "baseline")
        run_loso(D, "supcon")
    if exp in ("transfer", "all"):
        run_transfer(D, "supcon")
    print("EXPERIMENTS_DONE")


if __name__ == "__main__":
    main()
