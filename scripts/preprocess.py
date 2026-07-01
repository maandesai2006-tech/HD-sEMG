"""
Preprocess raw CSL-EMG_Array EMG into frame-feature sequences + phoneme targets.

Per utterance:
  raw EMG (T_samples, 41) @ 2048 Hz  ->  drop marker channel (idx 40) -> 40 ch
  bandpass 20-450 Hz + 50 Hz notch (German mains) + harmonics
  z-score PER SPEAKER PER CHANNEL (fit on that speaker's data; critical for
     cross-speaker generalization so absolute channel scale can't leak identity)
  frame: 32 ms window (66 samp) / 16 ms hop (33 samp) -> ~62 fps
  features per frame per channel: RMS, MAV, ZCR, waveform length (WL) -> 40*4=160
  target: promptList sentence -> words -> CMUdict ARPAbet (stress stripped) -> ids

Output: data/processed/dataset.npz  (object arrays)
  X:   list of (T_frames, 160) float32
  Y:   list of (L,) int64 phoneme id sequences
  spk: (N,) speaker id  e.g. 'Spk1'
  mode:(N,) 'aud' | 'sil'
  block:(N,) e.g. 'Block1-Initial'
  meta saved separately (phoneme vocab)
"""
import os, re, json, glob
import numpy as np
from scipy.signal import butter, sosfiltfilt, iirnotch, tf2sos
from nltk.corpus import cmudict

RAW = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "raw"))
PROC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "processed"))

FS = 2048.0
WIN = 66      # ~32 ms
HOP = 33      # ~16 ms
N_CH = 40     # EMG channels (drop marker idx 40)

_CMU = cmudict.dict()
# fixed 39-phone ARPAbet inventory + blank(0)
PHONES = ['AA','AE','AH','AO','AW','AY','B','CH','D','DH','EH','ER','EY','F','G',
          'HH','IH','IY','JH','K','L','M','N','NG','OW','OY','P','R','S','SH','T',
          'TH','UH','UW','V','W','Y','Z','ZH']
PH2ID = {p: i + 1 for i, p in enumerate(PHONES)}  # 0 reserved for CTC blank
BLANK = 0


def sentence_to_ids(sent):
    ids = []
    oov = 0
    for w in re.findall(r"[A-Za-z']+", sent):
        wl = w.lower()
        if wl in _CMU:
            for p in _CMU[wl][0]:
                p = re.sub(r"\d", "", p)
                ids.append(PH2ID[p])
        else:
            oov += 1
    return ids, oov


def make_filters():
    sos_bp = butter(4, [20.0, 450.0], btype="band", fs=FS, output="sos")
    notches = []
    for f0 in (50, 100, 150, 200, 250):
        b, a = iirnotch(f0, 30.0, FS)
        notches.append(tf2sos(b, a))
    return sos_bp, notches


SOS_BP, NOTCHES = make_filters()


def filter_emg(x):  # x: (T, 40)
    y = sosfiltfilt(SOS_BP, x, axis=0)
    for sos in NOTCHES:
        y = sosfiltfilt(sos, y, axis=0)
    return y


def frame_features(x):  # x: (T, 40) already filtered + normalized
    T = x.shape[0]
    if T < WIN:
        return None
    n = 1 + (T - WIN) // HOP
    feats = np.empty((n, N_CH * 4), dtype=np.float32)
    for i in range(n):
        w = x[i * HOP: i * HOP + WIN]          # (WIN, 40)
        rms = np.sqrt(np.mean(w ** 2, axis=0))
        mav = np.mean(np.abs(w), axis=0)
        zcr = np.mean(((w[:-1] * w[1:]) < 0), axis=0)
        wl = np.sum(np.abs(np.diff(w, axis=0)), axis=0)
        feats[i] = np.concatenate([rms, mav, zcr, wl]).astype(np.float32)
    return feats


def parse_session(sess):
    m = re.match(r"(Spk\d+)(-Sil)?_(Block\d+-\w+)", sess)
    spk, sil, block = m.group(1), m.group(2), m.group(3)
    return spk, ("sil" if sil else "aud"), block


def main():
    os.makedirs(PROC, exist_ok=True)
    sessions = sorted(d for d in os.listdir(RAW) if os.path.isdir(os.path.join(RAW, d)))

    # Pass 1: accumulate per-speaker channel stats on FILTERED signal
    print("Pass 1: per-speaker channel stats ...")
    stats = {}  # spk -> [sum, sumsq, count] per channel
    raw_cache = {}
    for sess in sessions:
        spk, mode, block = parse_session(sess)
        for f in sorted(glob.glob(os.path.join(RAW, sess, "*_emg.npy"))):
            arr = np.load(f)[:, :N_CH].astype(np.float64)
            arr = filter_emg(arr)
            raw_cache[f] = arr.astype(np.float32)
            s = stats.setdefault(spk, [np.zeros(N_CH), np.zeros(N_CH), 0])
            s[0] += arr.sum(axis=0)
            s[1] += (arr ** 2).sum(axis=0)
            s[2] += arr.shape[0]
    norm = {}
    for spk, (ssum, ssq, cnt) in stats.items():
        mean = ssum / cnt
        var = np.maximum(ssq / cnt - mean ** 2, 1e-8)
        norm[spk] = (mean.astype(np.float32), np.sqrt(var).astype(np.float32))
        print(f"  {spk}: {cnt} samples, mean|ch| ~ {np.abs(mean).mean():.2e}")

    # Pass 2: normalize + featurize + phonemize
    print("Pass 2: featurize + phonemize ...")
    X, Y, SPK, MODE, BLOCK, TXT = [], [], [], [], [], []
    n_drop = 0
    total_oov = 0
    for sess in sessions:
        spk, mode, block = parse_session(sess)
        logp = os.path.join(RAW, sess, "recordingLog.json")
        if not os.path.exists(logp):
            continue
        prompts = json.load(open(logp)).get("promptList", {})
        mean, std = norm[spk]
        for f in sorted(glob.glob(os.path.join(RAW, sess, "*_emg.npy"))):
            utt = re.search(r"_(\d{4})_emg\.npy$", f).group(1)
            sent = prompts.get(utt)
            if not sent:
                n_drop += 1; continue
            ids, oov = sentence_to_ids(sent)
            total_oov += oov
            arr = raw_cache[f]
            if not np.all(np.isfinite(arr)):
                n_drop += 1; continue
            arr = (arr - mean) / std
            feats = frame_features(arr)
            if feats is None or len(ids) == 0:
                n_drop += 1; continue
            # CTC needs input length >= output length
            if feats.shape[0] < len(ids):
                n_drop += 1; continue
            X.append(feats); Y.append(np.array(ids, dtype=np.int64))
            SPK.append(spk); MODE.append(mode); BLOCK.append(block); TXT.append(sent)

    print(f"Kept {len(X)} utts, dropped {n_drop}, total OOV words {total_oov}")
    np.savez(os.path.join(PROC, "dataset.npz"),
             X=np.array(X, dtype=object), Y=np.array(Y, dtype=object),
             spk=np.array(SPK), mode=np.array(MODE), block=np.array(BLOCK),
             txt=np.array(TXT, dtype=object),
             phones=np.array(PHONES))
    print("Saved", os.path.join(PROC, "dataset.npz"))
    # brief summary
    import collections
    print("By speaker x mode:", dict(collections.Counter(zip(SPK, MODE))))


if __name__ == "__main__":
    main()
