#!/usr/bin/env bash
# Download the FULL CSL-EMG_Array corpus onto your Mac's external hard drive.
# Run this in your Mac's Terminal (NOT in the cloud Claude Code session -- the
# cloud container cannot see /Volumes). ~11.3 GB zip, ~30 GB unzipped.
#
# Usage:
#   1. Plug in the drive, find its name:   ls /Volumes
#   2. Edit DRIVE below to match, then:    bash download_corpus_local.sh
#
set -euo pipefail

DRIVE="ASMT"                       # <-- change to your drive's name under /Volumes
DEST="/Volumes/${DRIVE}/CSL-EMG_Array"
URL="https://csl.uni-bremen.de/CorpusData/CSL-EMG_Array.zip"

mkdir -p "${DEST}"
echo "Downloading corpus to ${DEST} (resumable) ..."
curl -L -C - -o "${DEST}/CSL-EMG_Array.zip" "${URL}"

echo "Unzipping (~30 GB) ..."
cd "${DEST}"
unzip -q -o CSL-EMG_Array.zip
echo "Done. Corpus at ${DEST}/CSL-EMG_Array/"
echo "You can delete the zip to reclaim space: rm '${DEST}/CSL-EMG_Array.zip'"
