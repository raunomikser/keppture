#!/usr/bin/env python3
"""Build a catalog of real 3D Warehouse (SketchUp) GLB truss models.

Sources: public 3D Warehouse v1 search and collection endpoints.  Only models
that actually expose a public GLB binary are downloaded.  Dimensions are read
from the GLB itself (node transforms + POSITION accessor bounds), with the
3D Warehouse SKP attributes as a fallback.

Produces:
    public/skp-library/catalog.json
    public/skp-library/files/<sanitized-name>-<shortid>.glb

The script is rerunnable: existing files are reused, stale catalog entries are
rebuilt from scratch, and transient HTTP errors are retried.
"""
from __future__ import annotations

import concurrent.futures
import datetime
import json
import math
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://3dwarehouse.sketchup.com/warehouse/v1.0"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "skp-library")
FILES = os.path.join(OUT, "files")
CATALOG = os.path.join(OUT, "catalog.json")
MAX_BYTES = 25 * 1024 * 1024  # skip oversized binaries, report on stdout
USER_AGENT = "capture-lighting-visualizer/1.0 (truss library builder)"

EUROTRUSS_COLLECTIONS = ["ebc69688-5d0a-441d-bee0-51444f97e9cf"]
ALUTRUSS_COLLECTIONS = [
    "9b2ab675-b273-43f5-a3e8-2906d3fb2b54",
    "1f5f6448-124d-40e6-a5e6-a135c2f5c9c4",
    "bbd8b8f6-aa62-4920-9ce8-dde48aba5752",
    "5b89aec1-5091-4203-8518-dd70c5684a42",
    "eed4e056-6264-4cb6-8f92-4419b10b24cc",
]
SEARCHES = ["Eurotruss", "Eurotruss truss", "Alutruss", "Prolyte truss", "Prolyte", "Milos truss", "Milos"]
MANUFACTURERS = ["Eurotruss", "Prolyte", "Alutruss", "Milos"]

# Series/connector tokens used for folders and connectorSeries.
SERIES_PATTERNS = [
    re.compile(r"\bFD\s?\d{2}[A-Z]?\b", re.I),
    re.compile(r"\bTD\s?-?\d{2}\b", re.I),
    re.compile(r"\bH\s?\d{2}[A-Z]{0,2}\b", re.I),
    re.compile(r"\bX\s?\d{2}[A-Z]{0,2}\b", re.I),
    re.compile(r"\bS\s?\d{2,3}[A-Z]{0,2}\b", re.I),
    re.compile(r"\bE\s?\d{2}[A-Z]{0,2}\b", re.I),
    re.compile(r"\bB\s?\d{3}[A-Z]{0,2}\b", re.I),
    re.compile(r"\bM\s?\d{3}[A-Z]{0,2}\b", re.I),
    re.compile(r"\bQ[A-Z]{1,2}\d{0,4}\b", re.I),
    re.compile(r"\bQTL\d{0,4}\b", re.I),
    re.compile(r"\bSBPM\b", re.I),
    re.compile(r"\bQUADLOCK\s*\d{4}[A-Z]?\b", re.I),
]

NON_TRUSS = re.compile(
    r"bistro|bar stool|lectern|display stand|exhibition|\blcd\b|\bpix\b|"
    r"stage ?dex|stagedex|steeldeck|stage deck|coupler|\bclamp\b|led stacking|"
    r"downhill|\broof\b|arc roof|pani.re|embase|spigot|hoist|sleeve block|"
    r"tower hinge|mounting bracket|\bpins?\b|\bheader\b|gigapointe|"
    r"trusslight|bar neu|\btent\b|\bchair\b|torneira|banheiro|minecraft|"
    r"\bhotel\b|museum|sword|\bbow\b|\bdrill\b|aluminium tube|"
    r"panor.mica|music festival|car show|event space|labyrinthe|"
    r"stand tutorial|espa.o|boja zida|baseplate for|trigger clamp",
    re.I,
)
TRUSTED_TRUSS_WORD = re.compile(r"\btruss(?:es|ing)?\b|\btraverse\b", re.I)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
def get_json(url: str, attempts: int = 5):
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - network errors are varied
            last = exc
            if i < attempts - 1:
                time.sleep(min(8.0, 1.0 + i * 1.5))
    raise RuntimeError(f"failed GET {url}: {last}")


def fetch_search(query: str):
    results, offset = [], 0
    while True:
        params = urllib.parse.urlencode(
            {
                "sortBy": "relevance desc",
                "q": query,
                "contentType": "3dw",
                "showBinaryAttributes": "true",
                "showBinaryMetadata": "true",
                "showAttributes": "true",
                "show": "all",
                "recordEvent": "false",
                "fq": "binaryNames=exists=true",
                "offset": offset,
                "count": 100,
            }
        )
        data = get_json(f"{BASE}/entities?{params}")
        batch = data.get("entries", [])
        results.extend(batch)
        offset += len(batch)
        total = int(data.get("total") or 0)
        if not batch or offset >= total:
            break
    return results


def fetch_collection(collection_id: str):
    results, offset = [], 0
    while True:
        params = urllib.parse.urlencode(
            {
                "contentType": "3dw",
                "count": 100,
                "offset": offset,
                "showAttributes": "true",
                "showBinaryMetadata": "true",
                "recordEvent": "false",
            }
        )
        data = get_json(f"{BASE}/collections/{collection_id}/entities?{params}")
        batch = data.get("entries", [])
        results.extend(batch)
        offset += len(batch)
        total = int(data.get("total") or 0)
        if not batch or offset >= total:
            break
    return results


def glb_info(entity):
    binaries = entity.get("binaries") or {}
    glb = binaries.get("glb") if isinstance(binaries, dict) else None
    return glb if isinstance(glb, dict) else None


def text_of(entity):
    return " ".join(
        str(entity.get(k) or "")
        for k in ("title", "description", "details")
    )


def attr_mm(entity, key):
    skp = (entity.get("attributes") or {}).get("skp") or {}
    value = (skp.get(key) or {}).get("value")
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def attribute_dimensions(entity):
    width = attr_mm(entity, "modelWidthmm")
    height = attr_mm(entity, "modelHeightmm")
    depth = attr_mm(entity, "modelDepthmm")
    if not all(v is not None for v in (width, height, depth)):
        return None
    horizontal = sorted((width, depth), reverse=True)
    dims = [horizontal[0] / 1000.0, horizontal[1] / 1000.0, height / 1000.0]
    return dims if sane(dims) else None


def sane(dims):
    if not dims or len(dims) != 3:
        return False
    if not all(math.isfinite(v) and v > 0 for v in dims):
        return False
    longest = max(dims)
    return 0.02 <= longest <= 120.0 and min(dims) < 25.0


# ---------------------------------------------------------------------------
# Candidate selection / manufacturer attribution
# ---------------------------------------------------------------------------
def normalized_title(title):
    return re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip()


EUROTRUSS_STRUCTURE = re.compile(
    r"\btruss(?:es|ing)?\b|FD\s?3[34]|TD\s?-?\d{2}|\btower\b|baseplate|"
    r"base plate|spacer|corner|\bset\b|various|accessor|FD\+HD",
    re.I,
)


def is_eurotruss(entity, from_collection=False):
    title = (entity.get("title") or "").strip()
    text = text_of(entity)
    brand_in_title = bool(re.search(r"\beurotruss\b", title, re.I))
    brand_in_text = bool(re.search(r"\beurotruss\b", text, re.I))
    if not (
        from_collection
        or brand_in_title
        or (brand_in_text and re.search(r"FD\s?3[34]|TD\s?-?\d{2}|\btruss\b", title, re.I))
    ):
        return False
    if re.search(NON_TRUSS, title):
        return False
    return bool(EUROTRUSS_STRUCTURE.search(title)) or bool(from_collection and TRUSTED_TRUSS_WORD.search(text))


ALUTRUSS_STRUCTURE = re.compile(
    r"\btruss(?:es|ing)?\b|\btraverse\b|quadlock|singlelock|tower system|"
    r"cross piece|cross beam|kreuzst.ck|t.st.ck|eckteil|t-piece|\bcorner\b|\bcross\b",
    re.I,
)


def is_alutruss(entity, from_collection=False):
    title = (entity.get("title") or "").strip()
    text = text_of(entity)
    if re.search(NON_TRUSS, title):
        return False
    brand = bool(re.search(r"alu\s?-?truss", title, re.I))
    if not (brand or re.search(r"quadlock|singlelock", title, re.I)):
        if not (from_collection and re.search(r"alu\s?-?truss", text, re.I)):
            return False
    if not ALUTRUSS_STRUCTURE.search(title):
        return bool(from_collection and ALUTRUSS_STRUCTURE.search(text))
    return True


PROLYTE_SERIES = re.compile(r"\b(?:H|X|S|E|B)\s?\d{2,3}[A-Z]{0,3}\b", re.I)
PROLYTE_STRUCTURE = re.compile(
    r"\btruss(?:es|ing)?\b|\btraverse\b|corner|angles?|\bcercle\b|\bcerce\b|"
    r"circles?|lengths?|components?|pieces?|goalpost|rounded|box|stempelverbindung|eckteil|eckst.ck",
    re.I,
)


def is_prolyte(entity):
    title = (entity.get("title") or "").strip()
    text = text_of(entity)
    if re.search(NON_TRUSS, title):
        return False
    brand = bool(re.search(r"prolyte", title, re.I))
    series = bool(PROLYTE_SERIES.search(title))
    if not brand and not series:
        return False
    if re.search(r"dura truss", title, re.I) and not brand:
        return False
    if brand and series:
        return True
    return bool(TRUSTED_TRUSS_WORD.search(title) or PROLYTE_STRUCTURE.search(title))


MILOS_SERIES = re.compile(r"\bM\s?\d{3}[A-Z]{0,2}\b", re.I)
MILOS_STRUCTURE = re.compile(
    r"\btruss(?:es|ing)?\b|quattro|\bduo\b|rigging|multicube|"
    r"\bQTL\d*\b|\bQTV\d*\b|\bSTV\d*\b|\bSTL\d*\b|\bQ[A-Z]{1,2}\d{0,4}\b|"
    r"\bMT2\b|section|\bcorner\b|kuubik",
    re.I,
)


def is_milos(entity):
    title = (entity.get("title") or "").strip()
    text = text_of(entity)
    if re.search(NON_TRUSS, title):
        return False
    if re.search(r"\bF\s?33\b", title, re.I):
        return False
    brand = bool(re.search(r"\bmilos\b", title, re.I))
    series = bool(MILOS_SERIES.search(title))
    if not (brand or series):
        return False
    if brand and re.search(r"\bmilo\b(?!s)", title, re.I) and not series:
        return False
    return bool(MILOS_STRUCTURE.search(title) and (brand or series))


def collect_candidates():
    candidates = {}
    euro_collection_ids = set()
    alu_collection_ids = set()
    for query in SEARCHES:
        entries = fetch_search(query)
        for entity in entries:
            candidates.setdefault(entity["id"], entity)
        print(f"search {query!r}: {len(entries)} results", flush=True)
    for label, collection_ids, id_set in (
        ("Eurotruss", EUROTRUSS_COLLECTIONS, euro_collection_ids),
        ("Alutruss", ALUTRUSS_COLLECTIONS, alu_collection_ids),
    ):
        for collection_id in collection_ids:
            entries = fetch_collection(collection_id)
            id_set.update(entity["id"] for entity in entries)
            for entity in entries:
                candidates.setdefault(entity["id"], entity)
            print(f"{label} collection {collection_id}: {len(entries)} results", flush=True)

    selected = {}
    for entity_id, entity in candidates.items():
        glb = glb_info(entity)
        if not glb or not glb.get("contentUrl"):
            continue
        manufacturer = None
        if entity_id in euro_collection_ids and is_eurotruss(entity, True):
            manufacturer = "Eurotruss"
        elif entity_id in alu_collection_ids and is_alutruss(entity, True):
            manufacturer = "Alutruss"
        elif is_eurotruss(entity):
            manufacturer = "Eurotruss"
        elif is_alutruss(entity):
            manufacturer = "Alutruss"
        elif is_prolyte(entity):
            manufacturer = "Prolyte"
        elif is_milos(entity):
            manufacturer = "Milos"
        if manufacturer:
            selected[entity_id] = (entity, manufacturer)
    return selected


# ---------------------------------------------------------------------------
# GLB bounds
# ---------------------------------------------------------------------------
IDENTITY = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]
COMPONENT_BYTES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5124: 4, 5125: 4, 5126: 4}
NUM_COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def multiply(a, b):
    """Column-major 4x4 matrix multiplication (parent * child)."""
    return [
        sum(a[i + k * 4] * b[k + j * 4] for k in range(4))
        for j in range(4)
        for i in range(4)
    ]


def node_matrix(node):
    if node.get("matrix"):
        return [float(v) for v in node["matrix"][:16]]
    tx, ty, tz = (float(v) for v in node.get("translation", [0.0, 0.0, 0.0]))
    sx, sy, sz = (float(v) for v in node.get("scale", [1.0, 1.0, 1.0]))
    x, y, z, w = (float(v) for v in node.get("rotation", [0.0, 0.0, 0.0, 1.0]))
    rotation = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0.0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0.0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0.0,
        0.0, 0.0, 0.0, 1.0,
    ]
    matrix = multiply(rotation, [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1])
    matrix[12], matrix[13], matrix[14] = tx, ty, tz
    return matrix


def apply_matrix(matrix, point):
    return [
        matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
        matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
        matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
    ]


def accessor_values(gltf, binary, index, limit=400000):
    """Return POSITION values as a list of [x,y,z] floats (or [])."""
    if index is None or index >= len(gltf.get("accessors", [])):
        return []
    accessor = gltf["accessors"][index]
    count = int(accessor.get("count") or 0)
    ncomp = NUM_COMPONENTS.get(accessor.get("type"))
    ctype = accessor.get("componentType")
    if not ncomp or ctype not in COMPONENT_BYTES or count <= 0:
        return []
    view_index = accessor.get("bufferView")
    if view_index is None or binary is None:
        return []
    view = gltf["bufferViews"][view_index]
    offset = int(view.get("byteOffset") or 0) + int(accessor.get("byteOffset") or 0)
    stride = int(view.get("byteStride") or COMPONENT_BYTES[ctype] * ncomp)
    if stride < COMPONENT_BYTES[ctype] * ncomp:
        return []
    fmt = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5124: "i", 5125: "I", 5126: "f"}[ctype]
    size = COMPONENT_BYTES[ctype]
    values = []
    for i in range(count):
        base = offset + i * stride
        try:
            components = struct.unpack_from("<" + fmt * ncomp, binary, base)
        except struct.error:
            break
        values.append([float(v) for v in components[:3]])
        if len(values) >= limit:  # guard against pathological models
            break
    return values


def glb_bounds(path):
    """Return raw [x,y,z] extents in GLB units by walking all node transforms."""
    with open(path, "rb") as handle:
        data = handle.read()
    if len(data) < 20 or struct.unpack_from("<I", data, 0)[0] != 0x46546C67:
        raise ValueError("not a GLB file")
    offset, json_chunk, binary = 12, None, None
    while offset + 8 <= len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        if offset + length > len(data):
            break
        chunk = data[offset:offset + length]
        if chunk_type == 0x4E4F534A:
            json_chunk = chunk
        elif chunk_type == 0x004E4942:
            binary = chunk
        offset += length
    if json_chunk is None:
        raise ValueError("GLB has no JSON chunk")
    gltf = json.loads(json_chunk.decode("utf-8").rstrip("\x00 \n\r\t"))
    nodes = gltf.get("nodes", [])
    meshes = gltf.get("meshes", [])
    low = [math.inf] * 3
    high = [-math.inf] * 3
    visited = set()

    def walk(index, parent):
        if index in visited or index >= len(nodes):
            return
        visited.add(index)
        node = nodes[index]
        matrix = multiply(parent, node_matrix(node))
        mesh_index = node.get("mesh")
        if mesh_index is not None and mesh_index < len(meshes):
            for primitive in meshes[mesh_index].get("primitives", []):
                position = (primitive.get("attributes") or {}).get("POSITION")
                accessor = gltf["accessors"][position] if position is not None and position < len(gltf.get("accessors", [])) else None
                points = []
                if accessor:
                    if int(accessor.get("count") or 0) <= 400000:
                        points = accessor_values(gltf, binary, position)
                    if not points and "min" in accessor and "max" in accessor:
                        mn, mx = accessor["min"], accessor["max"]
                        points = [
                            [mn[0] if not i & 1 else mx[0], mn[1] if not i & 2 else mx[1], mn[2] if not i & 4 else mx[2]]
                            for i in range(8)
                        ]
                for point in points:
                    transformed = apply_matrix(matrix, point)
                    for axis in range(3):
                        low[axis] = min(low[axis], transformed[axis])
                        high[axis] = max(high[axis], transformed[axis])
        for child in node.get("children", []):
            walk(child, matrix)

    scene = gltf.get("scene", 0)
    scenes = gltf.get("scenes", [])
    roots = scenes[scene].get("nodes", []) if scenes and scene < len(scenes) else []
    if not roots:
        roots = list(range(len(nodes)))
    for root in roots:
        walk(root, IDENTITY)
    if any(math.isinf(v) for v in low):
        raise ValueError("GLB has no POSITION bounds")
    return [high[i] - low[i] for i in range(3)]


def normalize_dimensions(raw):
    """Put the longest axis first; swap x/z (and x/y) when needed."""
    x, y, z = [abs(float(v)) for v in raw]
    if z > x:
        x, z = z, x
    if y > x:
        x, y = y, x
    return [x, y, z]


def plausible_truss(dims):
    """Truss sections are normally between 5 cm and 2.5 m across."""
    return (
        sane(dims)
        and dims[0] <= 60.0
        and 0.05 <= dims[1] <= 2.5
        and 0.05 <= dims[2] <= 2.5
    )


def dimensions_for(path, entity):
    try:
        raw = glb_bounds(path)
        dims = normalize_dimensions(raw)
        if plausible_truss(dims):
            return dims, "glb"
        # Some SketchUp exports keep millimetre (or centimetre) units in the GLB.
        for divisor in (1000.0, 100.0):
            scaled = normalize_dimensions([v / divisor for v in raw])
            if plausible_truss(scaled):
                return scaled, "glb-scaled"
        if sane(dims):
            return dims, "glb"
    except Exception as exc:  # noqa: BLE001 - fall back to warehouse metadata
        print(f"  bounds failed for {entity['id']}: {exc}", file=sys.stderr, flush=True)
    fallback = attribute_dimensions(entity)
    if fallback:
        return fallback, "attributes"
    return None, "none"


# ---------------------------------------------------------------------------
# Catalog construction
# ---------------------------------------------------------------------------
def connector_series(name, manufacturer):
    for pattern in SERIES_PATTERNS:
        match = pattern.search(name)
        if match:
            token = (match.group(1) if match.lastindex else match.group(0)) or match.group(0)
            return re.sub(r"[\s-]+", "", token.upper())
    return None


def safe_filename(name, entity_id):
    base = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_")[:96] or "truss"
    return f"{base}-{entity_id[:8]}.glb"


def build_entries(selected):
    entries = []
    seen_titles = set()
    for entity_id, (entity, manufacturer) in selected.items():
        title = re.sub(r"\s+", " ", (entity.get("title") or "Truss")).strip()
        key = (manufacturer, normalized_title(title))
        if key in seen_titles:
            continue
        seen_titles.add(key)
        glb = glb_info(entity)
        if "/content/public/" not in glb["contentUrl"]:
            print(f"SKIP restricted binary: {title} [{entity_id}]", flush=True)
            continue
        size = int(glb.get("fileSize") or 0)
        if size > MAX_BYTES:
            print(
                f"SKIP oversized ({size / 1024 / 1024:.1f} MB): {title} [{entity_id}]",
                flush=True,
            )
            continue
        series = connector_series(title, manufacturer)
        folder = manufacturer + (f"/{series}" if series else "")
        entries.append(
            {
                "id": entity_id,
                "name": title,
                "manufacturer": manufacturer,
                "folder": folder,
                "fileName": safe_filename(title, entity_id),
                "sourceUrl": f"https://3dwarehouse.sketchup.com/model/{entity_id}",
                "_contentUrl": glb["contentUrl"],
                "_expectedSize": size,
                "_entity": entity,
                "_series": series,
            }
        )
    entries.sort(key=lambda e: (MANUFACTURERS.index(e["manufacturer"]), e["folder"].lower(), e["name"].lower()))
    return entries


def fetch_entry(entry):
    """Download (or reuse) one GLB and compute its dimensions in a worker."""
    path = os.path.join(FILES, entry["fileName"])
    expected = entry["_expectedSize"]
    if os.path.exists(path) and os.path.getsize(path) > 0 and (not expected or os.path.getsize(path) == expected):
        dims, source = dimensions_for(path, entry["_entity"])
        return entry, path, None, dims, source
    last = None
    for attempt in range(5):
        try:
            req = urllib.request.Request(entry["_contentUrl"], headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as response:
                payload = response.read()
            if len(payload) > MAX_BYTES:
                return entry, None, f"oversized download ({len(payload)} bytes)", None, None
            tmp = path + ".part"
            with open(tmp, "wb") as handle:
                handle.write(payload)
            os.replace(tmp, path)
            dims, source = dimensions_for(path, entry["_entity"])
            return entry, path, None, dims, source
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt < 4:
                time.sleep(min(8.0, 1.0 + attempt * 2.0))
    return entry, None, str(last), None, None


def main():
    os.makedirs(FILES, exist_ok=True)
    selected = collect_candidates()
    print(f"matched {len(selected)} entities with GLB binaries", flush=True)
    entries = build_entries(selected)
    print(f"catalog candidates: {len(entries)}", flush=True)

    used_names = set()
    for entry in entries:
        filename = entry["fileName"]
        if filename in used_names:
            entry["fileName"] = filename.replace(".glb", f"-{entry['id'][8:12]}.glb")
        used_names.add(entry["fileName"])

    catalog = []
    skipped = []
    failed = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(fetch_entry, entry) for entry in entries]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            entry, path, error, dims, source = future.result()
            if error:
                (skipped if "oversized" in error else failed).append((entry, error))
                if index % 50 == 0:
                    print(f"  processed {index}/{len(entries)}", flush=True)
                continue
            if not dims:
                failed.append((entry, "no usable GLB or SKP dimensions"))
                continue
            rounded_dims = [round(v, 4) for v in dims]
            length = rounded_dims[0]
            item = {
                "id": entry["id"],
                "name": entry["name"],
                "manufacturer": entry["manufacturer"],
                "folder": entry["folder"],
                "fileName": entry["fileName"],
                "sourceUrl": entry["sourceUrl"],
                "fileSize": os.path.getsize(path),
                "dimensions": rounded_dims,
                "sectionWidth": rounded_dims[1],
                "sectionHeight": rounded_dims[2],
                "endpoints": [[-length / 2, 0.0, 0.0], [length / 2, 0.0, 0.0]],
            }
            if entry["_series"]:
                item["connectorSeries"] = entry["_series"]
            if source == "attributes":
                print(f"  SKP fallback {entry['name']} [{entry['id']}]", flush=True)
            catalog.append(item)
            if index % 50 == 0:
                print(f"  processed {index}/{len(entries)}", flush=True)

    catalog.sort(key=lambda e: (MANUFACTURERS.index(e["manufacturer"]), e["folder"].lower(), e["name"].lower()))
    payload = {
        "version": 1,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "entries": catalog,
    }
    with open(CATALOG, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)

    counts = {manufacturer: 0 for manufacturer in MANUFACTURERS}
    total_bytes = 0
    for item in catalog:
        counts[item["manufacturer"]] += 1
        total_bytes += item["fileSize"]
    print(f"wrote {CATALOG}", flush=True)
    print("entries per manufacturer: " + ", ".join(f"{k}={v}" for k, v in counts.items()), flush=True)
    print(f"total bytes: {total_bytes} ({total_bytes / 1024 / 1024:.1f} MB)", flush=True)
    print(f"skipped oversized: {len(skipped)}, failed: {len(failed)}", flush=True)
    for entry, error in skipped[:20]:
        print(f"  SKIP {entry['name']}: {error}", flush=True)
    for entry, error in failed[:20]:
        print(f"  FAIL {entry['name']}: {error}", flush=True)


if __name__ == "__main__":
    main()
