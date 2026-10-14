"""Safe vector evidence extraction; SVG presentation dimensions are not meters."""

import math
import re

from defusedxml import ElementTree

from app.contracts import (
    Component,
    CoordinateFrame,
    Dimension,
    Proposal,
    SourceRef,
    dimension_values,
)

NUMBER = r"[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?"
IDENTITY = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]


def numbers(text):
    if re.sub(NUMBER, "", text).strip(" ,\t\r\n"):
        raise ValueError("Invalid SVG numeric data")
    result = [float(n) for n in re.findall(NUMBER, text)]
    if any(not math.isfinite(n) or abs(n) > 1e7 for n in result):
        raise ValueError("Invalid SVG coordinate")
    return result


def multiply(a, b):
    return [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
    ]


def transform(text):
    result = IDENTITY
    pattern = r"([A-Za-z]+)\s*\(([^)]*)\)"
    if re.sub(pattern, "", text).strip(" ,\t\r\n"):
        raise ValueError("Unsupported SVG transform")
    for name, args in re.findall(pattern, text):
        v = numbers(args)
        if name == "matrix" and len(v) == 6:
            t = v
        elif name == "translate" and len(v) in (1, 2):
            t = [1, 0, 0, 1, v[0], v[1] if len(v) == 2 else 0]
        elif name == "scale" and len(v) in (1, 2):
            t = [v[0], 0, 0, v[-1], 0, 0]
        elif name == "rotate" and len(v) in (1, 3):
            angle = math.radians(v[0])
            t = [math.cos(angle), math.sin(angle), -math.sin(angle), math.cos(angle), 0, 0]
            if len(v) == 3:
                t = multiply(multiply([1, 0, 0, 1, v[1], v[2]], t), [1, 0, 0, 1, -v[1], -v[2]])
        elif name in ("skewX", "skewY") and len(v) == 1:
            t = [1, 0, 0, 1, 0, 0]
            t[2 if name == "skewX" else 1] = math.tan(math.radians(v[0]))
        else:
            raise ValueError("Unsupported SVG transform")
        result = multiply(result, t)
    if abs(result[0] * result[3] - result[1] * result[2]) < 1e-12:
        raise ValueError("Singular SVG transform")
    return result


def point(x, y, t):
    return (t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5])


def footprint(node, t):
    tag = node.tag.split("}")[-1]
    if tag == "polygon":
        v = numbers(node.get("points", ""))
        if len(v) % 2 or len(v) > 1026:
            raise ValueError("Invalid polygon points")
        points = list(zip(v[::2], v[1::2]))
    elif tag == "rect":
        x, y, w, h = [float(node.get(k, 0)) for k in ("x", "y", "width", "height")]
        if w <= 0 or h <= 0 or float(node.get("rx", 0)) or float(node.get("ry", 0)):
            raise ValueError("Unsupported rectangle")
        points = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
    elif tag == "path":
        data = node.get("d", "")
        token_pattern = r"[MmLlHhVvZz]|" + NUMBER
        if re.sub(token_pattern, "", data).strip(" ,\t\r\n"):
            raise ValueError("Only closed linear SVG paths are supported")
        tokens = re.findall(token_pattern, data)
        if not tokens or tokens[0] not in {"M", "m"}:
            raise ValueError("SVG path must begin with move-to")
        points, command, cursor, i = [], None, (0, 0), 0
        while i < len(tokens):
            if tokens[i].isalpha():
                command = tokens[i]
                if command in {"M", "m"} and points:
                    raise ValueError("Multiple SVG path contours are unsupported")
                i += 1
                if command.lower() == "z":
                    if i != len(tokens):
                        raise ValueError("Multiple SVG path contours are unsupported")
                    break
            if command is None:
                raise ValueError("SVG path must begin with a command")
            count = 1 if command in "HhVv" else 2
            if i + count > len(tokens) or any(v.isalpha() for v in tokens[i : i + count]):
                raise ValueError("Malformed linear SVG path")
            v = [float(x) for x in tokens[i : i + count]]
            if command in "Hh":
                cursor = (v[0] + (cursor[0] if command == "h" else 0), cursor[1])
            elif command in "Vv":
                cursor = (cursor[0], v[0] + (cursor[1] if command == "v" else 0))
            else:
                cursor = (
                    v[0] + (cursor[0] if command.islower() else 0),
                    v[1] + (cursor[1] if command.islower() else 0),
                )
                if command == "M":
                    command = "L"
                elif command == "m":
                    command = "l"
            points.append(cursor)
            i += count
        if not tokens or tokens[-1].lower() != "z":
            raise ValueError("Open SVG paths are unsupported")
    else:
        raise ValueError(f"Unsupported footprint element: {tag}")
    return [point(x, y, t) for x, y in points]


def validate_svg(data: bytes):
    if len(data) > 10 * 1024 * 1024:
        raise ValueError("SVG exceeds 10 MiB limit")
    try:
        root = ElementTree.fromstring(
            data, forbid_dtd=True, forbid_entities=True, forbid_external=True
        )
    except Exception as e:
        raise ValueError("Invalid or unsafe SVG XML") from e
    if root.tag.split("}")[-1] != "svg":
        raise ValueError("Expected an SVG document")
    nodes = list(root.iter())
    if len(nodes) > 30000:
        raise ValueError("SVG exceeds element limit")
    for node in nodes:
        if node.tag.split("}")[-1] in {
            "script",
            "foreignObject",
            "image",
            "use",
            "style",
            "animate",
            "set",
        }:
            raise ValueError("SVG contains active or externally referenced content")
        if any(
            k.split("}")[-1].lower().startswith("on")
            or k.split("}")[-1] in {"href", "src"}
            or "url("
            in re.sub(
                r"""url\(\s*["']?#[A-Za-z0-9_.:-]+["']?\s*\)""", "", v, flags=re.IGNORECASE
            ).lower()
            for k, v in node.attrib.items()
        ):
            raise ValueError("SVG contains active or externally referenced attributes")
    vb = numbers(root.get("viewBox", ""))
    if not vb:
        vb = [0, 0, float(root.get("width", 1000)), float(root.get("height", 1000))]
    if len(vb) != 4 or vb[2] <= 0 or vb[3] <= 0:
        raise ValueError("Invalid SVG viewBox")
    return root, vb


def extract_svg(data: bytes, job_id: str, source_hash: str) -> Proposal:
    root, vb = validate_svg(data)
    components, dimensions, floors = [], [], set()
    kinds = {
        "Wall": "wall",
        "Space": "room",
        "Column": "column",
        "Door": "door",
        "Window": "window",
    }

    def walk(node, parent, visible, owner=None, depth=0, geometry_context=True):
        if depth > 64:
            raise ValueError("SVG nesting exceeds limit")
        t = multiply(parent, transform(node.get("transform", "")))
        classes = node.get("class", "").split()
        visible = (
            visible
            and node.get("display") != "none"
            and not re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", node.get("style", ""))
        )
        if "Floorplan" in classes:
            floors.add(node.get("id", str(len(floors))))
        kind = next((kinds[c] for c in classes if c in kinds), None)
        if kind:
            owner = {"type": kind, "node": node, "seen": False}
            geometry_context = True
        tag = node.tag.split("}")[-1]
        if tag == "g" and classes and not kind and owner:
            geometry_context = False
        if tag == "text":
            text = "".join(node.itertext()).strip()
            if text:
                x = numbers(node.get("x", "0"))[0]
                # SVG text y may be em; text position is approximate when font-relative.
                y_text = node.get("y", "0")
                y = 0 if y_text.endswith("em") else numbers(y_text)[0]
                for value, unit in dimension_values(text) or [(None, None)]:
                    dimensions.append(
                        Dimension(
                            text=text,
                            position=point(x, y, t),
                            visible=visible,
                            source_element_id=node.get("id"),
                            value=value,
                            unit=unit,
                        )
                    )
        if (
            owner
            and geometry_context
            and tag in {"polygon", "rect", "path", "circle", "ellipse", "polyline"}
        ):
            pts = footprint(node, t)
            group = owner["node"]
            index = len(components)
            components.append(
                Component(
                    id=f"{job_id}:f0:c{index}",
                    type=owner["type"],
                    label=group.get("class"),
                    polygon=pts,
                    source=SourceRef(element_id=group.get("id"), occurrence=index, transform=t),
                )
            )
            owner["seen"] = True
        for child in node:
            walk(child, t, visible, owner, depth + 1, geometry_context)
        if kind and not owner["seen"]:
            raise ValueError(f"No supported footprint for {kind}")

    walk(root, IDENTITY, True)
    if len(floors) > 1:
        raise ValueError("This experiment supports one floor per drawing")
    return Proposal(
        job_id=job_id,
        source_hash=source_hash,
        source_kind="svg",
        coordinate_frame=CoordinateFrame(width=vb[2], height=vb[3], origin=(vb[0], vb[1])),
        components=components,
        dimensions=dimensions,
        validation_issues=[
            "SVG coordinates require confirmed scale; hidden labels are retained as hidden evidence."
        ],
    )
