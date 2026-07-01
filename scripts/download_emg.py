"""
Resumable, parallel downloader for a principled subset of CSL-EMG_Array.

We pull EMG only (no audio) via HTTP range requests against the remote zip,
so we never download the full 23.4 GB of EMG (or the audio on top of that).

Subset rationale (see CLAUDE.md):
  - Audible: all 8 speakers (only audible exists for all 8) -> cross-speaker LOSO.
  - Silent : the 4 speakers that recorded it (Spk1,3,6,8) -> audible->silent transfer.
  - Blocks : Block1-Initial (340 utts, diverse vocab) for training pool,
             Block3/5/7-Eval (3 x 50 = 150 parallel sentences) as clean eval sets.

Output layout:
  data/raw/<session>/recordingLog.json
  data/raw/<session>/<utt>_emg.npy
"""
import os, re, sys, time, json, io
import concurrent.futures as cf
import threading
from remotezip import RemoteZip

URL = "https://csl.uni-bremen.de/CorpusData/CSL-EMG_Array.zip"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
OUT = os.path.abspath(OUT)

AUD_SPEAKERS = [1, 2, 3, 4, 5, 6, 7, 8]
SIL_SPEAKERS = [1, 3, 6, 8]
BLOCKS = ["Block1-Initial", "Block3-Eval1", "Block5-Eval2", "Block7-Eval3"]
WORKERS = 10


def target_sessions():
    s = []
    for spk in AUD_SPEAKERS:
        for b in BLOCKS:
            s.append(f"Spk{spk}_{b}")
    for spk in SIL_SPEAKERS:
        for b in BLOCKS:
            s.append(f"Spk{spk}-Sil_{b}")
    return set(s)


_local = threading.local()
def _z(reset=False):
    if reset and hasattr(_local, "z"):
        try:
            _local.z.close()
        except Exception:
            pass
        del _local.z
    if not hasattr(_local, "z"):
        _local.z = RemoteZip(URL)
    return _local.z


def _read_retry(name, tries=6):
    for t in range(tries):
        try:
            return _z(reset=(t > 0)).read(name)
        except Exception as e:
            if t == tries - 1:
                raise
            time.sleep(min(2 ** t, 20))


def main():
    os.makedirs(OUT, exist_ok=True)
    sessions = target_sessions()
    print(f"Target sessions: {len(sessions)}")
    with RemoteZip(URL) as z:
        names = z.namelist()

    # transcripts + emg files for chosen sessions
    logs, emg = [], []
    for n in names:
        parts = n.split("/")
        if len(parts) < 2:
            continue
        sess = parts[1]
        if sess not in sessions:
            continue
        if n.endswith("recordingLog.json"):
            logs.append(n)
        elif n.endswith("_emg.npy"):
            emg.append(n)
    print(f"Transcripts: {len(logs)}  EMG files: {len(emg)}")

    def dest(name):
        parts = name.split("/")
        sess = parts[1]
        if name.endswith("recordingLog.json"):
            return os.path.join(OUT, sess, "recordingLog.json")
        fn = parts[-1]  # Spk1_Block1-Initial_0001_emg.npy
        return os.path.join(OUT, sess, fn)

    todo = [n for n in (logs + emg) if not os.path.exists(dest(n))]
    print(f"To fetch (skipping existing): {len(todo)}")

    done = [0]
    t0 = time.time()
    lock = threading.Lock()

    def fetch(name):
        d = dest(name)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        data = _read_retry(name)
        tmp = d + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, d)
        with lock:
            done[0] += 1
            if done[0] % 200 == 0:
                dt = time.time() - t0
                print(f"  {done[0]}/{len(todo)}  {done[0]/dt:.1f} files/s  "
                      f"{time.time()-t0:.0f}s elapsed", flush=True)
        return len(data)

    total = 0
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for b in ex.map(fetch, todo):
            total += b
    print(f"DONE: fetched {len(todo)} files, {total/1e9:.2f} GB in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
