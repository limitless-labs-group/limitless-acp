#!/bin/sh
# tsx needs a writable temp directory at startup and exits if it cannot make
# one. Prefer /tmp (present on a normal rootfs, or mounted as an emptyDir),
# and fall back to the writable data volume when the root filesystem is
# read-only and no /tmp volume was provided.
set -e

if [ ! -w /tmp ]; then
  TMPDIR="$(dirname "${LEDGER_PATH:-/data/ledger.json}")/tmp"
  export TMPDIR
  mkdir -p "$TMPDIR"
fi

exec "$@"
