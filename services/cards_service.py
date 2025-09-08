from __future__ import annotations

def shape_card(cell: dict | None) -> dict:
    """
    Convert a raw schedule cell into a UI-friendly 'card' dict without
    breaking existing keys. Returns a consistent structure.
    """
    if not cell or cell.get("empty"):
        return {
            "empty": True,
            "title": "Empty",
            "subtitle": "",
            "badges": [],
            "meta": {},
            "reasons": cell.get("reasons", ["no_candidates_left"]) if cell else ["empty"],
            "locked": False,
        }

    title = " ".join([str(cell.get("name","")).strip(), str(cell.get("vintage","")).strip()]).strip()
    badges = []
    if cell.get("locked"): badges.append("🔒 Locked")
    if cell.get("type"): badges.append(str(cell.get("type")))
    if cell.get("region"): badges.append(str(cell.get("region")))
    if cell.get("price"): badges.append(f"CHF {cell.get('price')}")

    meta = {}
    if "stock" in cell: meta["Stock"] = cell.get("stock")
    if "score" in cell: meta["Score"] = cell.get("score")

    return {
        "empty": False,
        "title": title or cell.get("id",""),
        "subtitle": cell.get("id",""),
        "badges": badges,
        "meta": meta,
        "reasons": cell.get("reasons", []),
        "locked": bool(cell.get("locked")),
    }

def attach_cards(schedule: dict) -> dict:
    # Non-destructive: add 'card' field to each cell
    out = {}
    for day, slots in schedule.items():
        shaped = []
        for cell in (slots or []):
            c = cell or {"empty": True}
            c = dict(c)
            c["card"] = shape_card(c)
            shaped.append(c)
        out[day] = shaped
    return out
