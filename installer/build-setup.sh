#!/usr/bin/env bash
set -euo pipefail

installer_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
stage="$(dirname -- "$installer_dir")"
launcher="${1:-$stage/build/PhongVietStudio.exe}"
setup="${2:-$stage/build/PhongVietStudio-Setup-x64.exe}"
compiler="$stage/toolchain/nsis/usr/bin/makensis"

if [[ ! -f "$launcher" ]]; then
  printf 'Launcher not found: %s\n' "$launcher" >&2
  exit 1
fi
if [[ -x "$compiler" ]]; then
  export NSISDIR="$stage/toolchain/nsis/usr/share/nsis"
else
  compiler="$(command -v makensis || true)"
  if [[ -z "$compiler" ]]; then
    printf 'Install NSIS 3.11 or run installer/fetch-nsis.sh on Debian x86-64.\n' >&2
    exit 1
  fi
fi

launcher="$(realpath -- "$launcher")"
setup="$(realpath -m -- "$setup")"
mkdir -p -- "$(dirname -- "$setup")"
"$compiler" -V3 -WX "-DLAUNCHER_EXE=$launcher" "-DSETUP_EXE=$setup" "$installer_dir/PhongVietStudio.nsi"
