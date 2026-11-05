#!/usr/bin/env bash
# Regenerate logo v2 end to end: artwork -> layer bitmaps -> traces -> SVGs.
#
#   pip install numpy scipy pillow        # what build.py needs
#   ./trace.sh
#
# Deterministic: a clean run reproduces traces/*.svg and out/*.svg byte for
# byte. That is the check to run after touching anything in this directory.
set -euo pipefail
cd "$(dirname "$0")"
PY=${PYTHON:-python3}

"$PY" build.py
for m in body ink cream; do
  potrace -s --flat -t 40 -a 1.0 -O 0.35 -o "traces/$m.svg" "traces/$m.pbm"
done
rm -f traces/*.pbm
"$PY" compose.py
