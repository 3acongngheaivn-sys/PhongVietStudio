#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
go_bin="${GO_BIN:-go}"
if [[ -z "${GO_BIN:-}" && -x "$root/go-toolchain/go/bin/go" ]]; then
  go_bin="$root/go-toolchain/go/bin/go"
fi

output="$root/build"
launcher="$output/PhongVietStudio.exe"
setup="$output/PhongVietStudio-Setup-x64.exe"
mkdir -p -- "$output"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 "$go_bin" -C "$root/launcher" build \
  -buildvcs=false -trimpath -ldflags='-H windowsgui -s -w' -o "$launcher" .
bash "$root/installer/build-setup.sh" "$launcher" "$setup"
python3 "$root/installer/package-release.py" "$("$go_bin" env GOROOT)"
