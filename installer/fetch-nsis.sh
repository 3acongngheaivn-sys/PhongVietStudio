#!/usr/bin/env bash
set -euo pipefail

installer_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
toolchain="$(dirname -- "$installer_dir")/toolchain"
mkdir -p -- "$toolchain"
cd -- "$toolchain"

mirror='https://deb.debian.org/debian/pool/main/n/nsis'
while read -r digest package; do
  if ! printf '%s  %s\n' "$digest" "$package" | sha256sum --check --status; then
    curl --fail --silent --show-error --location --retry 2 "$mirror/$package" --output "$package"
  fi
  printf '%s  %s\n' "$digest" "$package" | sha256sum --check
  dpkg-deb -x "$package" nsis
done <<'PACKAGES'
e6eb6ffb70f0df09e95dedb2d2cf55ad3c2679f7c2ae357d0c00cc4c83178690 nsis_3.11-1_amd64.deb
103a3284c1a5356efa0aba90fdfc391c3cde8e7df8726377cef0f98471584047 nsis-common_3.11-1_all.deb
PACKAGES

NSISDIR="$toolchain/nsis/usr/share/nsis" nsis/usr/bin/makensis -VERSION
