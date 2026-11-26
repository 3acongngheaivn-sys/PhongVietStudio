"""Create the Windows installer download with installation notes and licenses."""

import argparse
from hashlib import sha256
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"


def package(goroot: Path) -> None:
    setup = BUILD / "PhongVietStudio-Setup-x64.exe"
    output = BUILD / "PhongVietStudio-Windows-x64.zip"
    guide = (ROOT / "HUONG-DAN-CAI-DAT.txt").read_text(encoding="utf-8")
    files = {
        setup.name: setup.read_bytes(),
        "HUONG-DAN-CAI-DAT.txt": guide.replace("\n", "\r\n").encode("utf-8-sig"),
        "licenses/Go-LICENSE.txt": (goroot / "LICENSE").read_bytes(),
        "licenses/Go-PATENTS.txt": (goroot / "PATENTS").read_bytes(),
        "licenses/DejaVu.txt": (ROOT / "launcher/web/demo-license.txt").read_bytes(),
    }
    digest = sha256(files[setup.name]).hexdigest()
    with NamedTemporaryFile(dir=BUILD, suffix=".zip", delete=False) as temp:
        temporary = Path(temp.name)
    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED) as archive:
            for name, data in files.items():
                archive.writestr(name, data)
            archive.writestr("SHA256.txt", f"{digest}  {setup.name}\n")
        with ZipFile(temporary) as archive:
            assert archive.testzip() is None
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("goroot", type=Path)
    package(parser.parse_args().goroot)
