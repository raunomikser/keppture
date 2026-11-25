#!/usr/bin/env python3
"""Fetch real GDTF fixtures from the public gdtf-lights.com catalog.

Produces:
  public/gdtf-library/catalog.json   lightweight index (names, modes, file paths)
  public/gdtf-library/files/*.gdtf   original .gdtf archives (unmodified)
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import time
import urllib.request

BASE = "https://gdtf-lights.com"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "gdtf-library")
FILES = os.path.join(OUT, "files")

MANUFACTURERS = [
    "StairVille",
    "Eurolite",
    "Robe Lighting",
    "Martin Professional",
    "ACME",
    "Atomic Pro",
]


def get_json(url: str, attempts: int = 4):
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "capture-lighting-visualizer/1.0"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            if i == attempts - 1:
                raise
            time.sleep(1.0 + i)


def list_manufacturer(name: str):
    items = []
    offset = 0
    while True:
        url = f"{BASE}/api/catalog/list?manufacturer={urllib.parse.quote(name)}&limit=100&offset={offset}"
        data = get_json(url)
        batch = data.get("list", {}).get("items", [])
        items.extend(batch)
        remaining = data.get("list", {}).get("remaining", 0)
        if not batch or remaining <= 0:
            break
        offset += len(batch)
    return items


def download_file(entry):
    file_field = entry.get("file")
    if not file_field:
        return entry, None
    filename = os.path.basename(file_field)
    path = os.path.join(FILES, filename)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return entry, os.path.getsize(path)
    url = BASE + "/gdtf/" + filename
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "capture-lighting-visualizer/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                payload = r.read()
            with open(path, "wb") as f:
                f.write(payload)
            return entry, len(payload)
        except Exception:
            if i == 3:
                return entry, None
            time.sleep(1.0 + i)


def main():
    os.makedirs(FILES, exist_ok=True)
    all_items = []
    by_manufacturer = {}
    for man in MANUFACTURERS:
        items = list_manufacturer(man)
        by_manufacturer[man] = len(items)
        print(f"{man}: {len(items)} fixtures", flush=True)
        all_items.extend(items)

    catalog = []
    for item in all_items:
        rel = item.get("fixtureGdtf") or ""
        filename = os.path.basename(rel)
        modes = item.get("modes") or []
        default_mode = next((m["name"] for m in modes if m.get("default")), None)
        catalog.append(
            {
                "id": item.get("id", ""),
                "name": item.get("n") or item.get("fullName") or "",
                "manufacturer": item.get("manufacturer", ""),
                "description": item.get("de", ""),
                "category": item.get("cat", ""),
                "modes": [
                    {
                        "name": m.get("name", ""),
                        "channels": m.get("channels", 0),
                        "default": bool(m.get("default")),
                    }
                    for m in modes
                ],
                "defaultMode": default_mode or (modes[0]["name"] if modes else None),
                "file": f"files/{filename}" if filename else None,
                "image": item.get("img") or None,
                "beamAngle": item.get("beamAngle") or None,
            }
        )

    catalog.sort(key=lambda e: (e["manufacturer"].lower(), e["name"].lower()))
    with open(os.path.join(OUT, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=1)

    print(f"Downloading {len(catalog)} .gdtf archives ...", flush=True)
    failed = []
    total_bytes = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for idx, (entry, size) in enumerate(pool.map(download_file, catalog), 1):
            if size is None:
                failed.append(entry["id"])
            else:
                total_bytes += size
            if idx % 100 == 0:
                print(f"  {idx}/{len(catalog)}  {total_bytes / 1024 / 1024:.1f} MB", flush=True)

    with open(os.path.join(OUT, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=1)

    missing_file = [e["id"] for e in catalog if not e["file"]]
    print(
        f"Done: {len(catalog)} entries, {total_bytes / 1024 / 1024:.1f} MB, "
        f"failed={len(failed)}, missing-link={len(missing_file)}",
        flush=True,
    )
    if failed:
        print("Failed IDs:", ", ".join(failed[:40]), flush=True)
    if missing_file:
        print("Missing file links:", ", ".join(missing_file[:40]), flush=True)


if __name__ == "__main__":
    import urllib.parse

    main()
