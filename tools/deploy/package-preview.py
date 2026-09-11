"""Package a tested static build with an exact per-file deployment inventory."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import zipfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dist", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    root = args.dist.resolve(strict=True)
    if not (root / "index.html").is_file():
        parser.error("no index.html in build directory")
    output = args.output.resolve()
    if output.is_relative_to(root):
        parser.error("package must be outside build directory")
    entries = []
    total = 0
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            parser.error("symlink in build directory")
        if path.is_dir():
            continue
        if not stat.S_ISREG(path.stat().st_mode):
            parser.error("non-regular build entry")
        name = path.relative_to(root).as_posix()
        if not re.fullmatch(r"[A-Za-z0-9_./-]+", name) or any(part.startswith(".") for part in name.split("/")):
            parser.error("unexpected build filename")
        if path.stat().st_size > 16777216:
            parser.error("build entry exceeds size limit")
        data = path.read_bytes()
        total += len(data)
        if total > 67108864 or len(entries) >= 512:
            parser.error("build exceeds deployment bounds")
        entries.append((name, data))
    inventory = {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in entries}
    encoded = json.dumps(inventory, sort_keys=True, separators=(",", ":")).encode()
    release = hashlib.sha256(encoded).hexdigest()
    # Exclusive creation prevents overwriting an earlier reviewed package.
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    descriptor = {"release_digest": release, "archive_sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "files": inventory}
    with output.with_suffix(".manifest.json").open("x") as target:
        json.dump(descriptor, target, indent=2)
        target.write("\n")
    print(json.dumps({"release_digest": release, "files": len(entries), "bytes": total}))


if __name__ == "__main__":
    main()
