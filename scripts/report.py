"""
Compile experiment CSVs in results/ into a human-readable findings file and a
comparison table.  Robust to PARTIAL results (folds still running / container
reclaimed mid-run) so it can be run at any checkpoint.

Reads:
  results/sanity_within_speaker.csv   speaker, train_per, val_per, n_val
  results/loso_baseline.csv           held_speaker, cross_per, n_test, method, sec
  results/loso_supcon.csv             held_speaker, cross_per, n_test, method, sec
  results/transfer_aud2sil.csv        held_speaker, aud_per, sil_per, n_aud, n_sil, method

Writes:
  results/comparison.csv
  results/research_findings.txt
"""
import os, csv, statistics as st

RES = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "results"))


def read(name):
    p = os.path.join(RES, name)
    if not os.path.exists(p):
        return []
    with open(p) as f:
        return list(csv.DictReader(f))


def fmt_per(x):
    # PER is an error rate in [0,1]; report as accuracy-ish too
    return f"{x*100:.1f}%"


def mean_std(vals):
    if not vals:
        return None, None
    m = sum(vals) / len(vals)
    s = st.pstdev(vals) if len(vals) > 1 else 0.0
    return m, s


def main():
    sanity = read("sanity_within_speaker.csv")
    base = read("loso_baseline.csv")
    sup = read("loso_supcon.csv")
    trans = read("transfer_aud2sil.csv")

    base_per = [float(r["cross_per"]) for r in base]
    sup_per = [float(r["cross_per"]) for r in sup]
    bm, bs = mean_std(base_per)
    sm, ss = mean_std(sup_per)

    # paired delta on speakers both methods completed
    bmap = {r["held_speaker"]: float(r["cross_per"]) for r in base}
    smap = {r["held_speaker"]: float(r["cross_per"]) for r in sup}
    shared = sorted(set(bmap) & set(smap))
    paired = [(bmap[k] - smap[k]) for k in shared]  # positive => supcon lower PER => better
    n_supcon_wins = sum(1 for d in paired if d > 0)

    # comparison.csv
    with open(os.path.join(RES, "comparison.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["method", "n_folds", "mean_cross_speaker_PER", "std_PER",
                    "mean_cross_speaker_acc"])
        if base_per:
            w.writerow(["baseline_CTC", len(base_per), round(bm, 4), round(bs, 4),
                        round(1 - bm, 4)])
        if sup_per:
            w.writerow(["supcon_CTC", len(sup_per), round(sm, 4), round(ss, 4),
                        round(1 - sm, 4)])

    L = []
    L.append("=" * 70)
    L.append("SILENT-SPEECH EMG PHONEME DECODER  —  CROSS-SPEAKER FINDINGS")
    L.append("Corpus: CSL-EMG_Array (8 speakers, 40-ch facial EMG @ 2048 Hz)")
    L.append("Task: ARPAbet phoneme CTC.  Metric: Phoneme Error Rate (lower=better)")
    L.append("=" * 70)
    L.append("")

    L.append("STATUS (partial-safe snapshot)")
    L.append(f"  sanity folds:          {len(sanity)}")
    L.append(f"  LOSO baseline folds:   {len(base_per)}/8")
    L.append(f"  LOSO supcon folds:     {len(sup_per)}/8")
    L.append(f"  transfer folds:        {len(trans)}")
    L.append("")

    if sanity:
        L.append("1) WITHIN-SPEAKER SANITY (does phoneme CTC learn at all on this modality)")
        for r in sanity:
            L.append(f"   {r['speaker']}: train PER {fmt_per(float(r['train_per']))}  "
                     f"held-out-same-speaker PER {fmt_per(float(r['val_per']))} (n={r['n_val']})")
        tp = float(sanity[0]["train_per"])
        verdict = ("CONVERGES — train PER low, so the signal carries phoneme info."
                   if tp < 0.6 else
                   "DOES NOT CONVERGE — train PER high; data scale / optimization is the wall.")
        L.append(f"   -> {verdict}")
        L.append("")

    if base_per or sup_per:
        L.append("2) CROSS-SPEAKER ZERO-SHOT (leave-one-speaker-out, audible)")
        if bm is not None:
            L.append(f"   Baseline CTC : mean cross-speaker PER {fmt_per(bm)} +/- {fmt_per(bs)} "
                     f"(n={len(base_per)} folds)")
        if sm is not None:
            L.append(f"   SupCon  CTC : mean cross-speaker PER {fmt_per(sm)} +/- {fmt_per(ss)} "
                     f"(n={len(sup_per)} folds)")
        if shared:
            md, _ = mean_std(paired)
            L.append(f"   Paired on {len(shared)} shared speakers: SupCon wins {n_supcon_wins}/{len(shared)}, "
                     f"mean PER reduction {fmt_per(md)}")
            if md > 0:
                L.append("   -> Contrastive embedding HELPS cross-speaker generalization.")
            else:
                L.append("   -> No cross-speaker benefit from contrastive embedding (so far).")
        L.append("")

    if trans:
        L.append("3) AUDIBLE -> SILENT TRANSFER (same held speaker, audible-trained model)")
        for r in trans:
            L.append(f"   {r['held_speaker']}: audible PER {fmt_per(float(r['aud_per']))} "
                     f"-> silent PER {fmt_per(float(r['sil_per']))}")
        gaps = [float(r["sil_per"]) - float(r["aud_per"]) for r in trans]
        gm, _ = mean_std(gaps)
        L.append(f"   -> mean audible->silent PER gap: +{fmt_per(gm)} "
                 f"(how much harder the silent/covert regime is)")
        L.append("")

    L.append("HONEST BOUNDARY")
    L.append("  Absolute PER is not the product number; CPU-only caps utts/epochs per")
    L.append("  fold.  The signal to read is the CROSS-SPEAKER DELTA (baseline vs SupCon)")
    L.append("  and the audible->silent gap.  Real facial speech EMG, real phonemes.")
    L.append("")

    with open(os.path.join(RES, "research_findings.txt"), "w") as f:
        f.write("\n".join(L) + "\n")
    print("wrote results/research_findings.txt and results/comparison.csv")
    print("\n".join(L))


if __name__ == "__main__":
    main()
