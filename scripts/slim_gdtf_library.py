#!/usr/bin/env python3
"""Slim packaged GDTF archives to their real description.xml.

The original archives from gdtf-lights.com store every entry uncompressed,
including hundreds of wheel thumbnails per fixture (~900 MB total). The app's
DMX engine only needs description.xml, so we keep that original XML verbatim
and store it deflated. The result is still a genuine .gdtf archive that the
existing JSZip/DOMParser pipeline can ingest.
"""
from __future__ import annotations

import concurrent.futures
import os
import zipfile

FILES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "public",
    "gdtf-library",
    "files",
)


def slim(path: str):
    before = os.path.getsize(path)
    try:
        with zipfile.ZipFile(path, "r") as src:
            names = src.namelist()
            desc = next(
                (n for n in names if n.lower().endswith("description.xml")), None
            )
            if desc is None:
                return before, before
            xml = src.read(desc)
    except zipfile.BadZipFile:
        return before, before

    tmp = path + ".slim"
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as out:
        out.writestr("description.xml", xml)
    after = os.path.getsize(tmp)
    os.replace(tmp, path)
    return before, after


def main():
    paths = [os.path.join(FILES, n) for n in os.listdir(FILES) if n.endswith(".gdtf")]
    total_before = total_after = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for i, (before, after) in enumerate(pool.map(slim, paths), 1):
            total_before += before
            total_after += after
            if i % 200 == 0:
                print(f"{i}/{len(paths)}", flush=True)
    print(
        f"Slimmed {len(paths)} archives: "
        f"{total_before / 1e6:.1f} MB -> {total_after / 1e6:.1f} MB",
        flush=True,
    )


if __name__ == "__main__":
    main()
