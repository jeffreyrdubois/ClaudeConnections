#!/usr/bin/env python3
"""
Parse a GEDCOM file exported from Ancestry.com, filter to individuals born
since 1900, and write a compact JSON file for the ancestry MCP server.

Usage:
  python process_gedcom.py <input.ged> <output.json>

The script handles GEDCOM 5.5 / 5.5.1 format as exported by Ancestry.com.
Only individuals with a known birth year >= 1900 are kept.  Individuals with
no recorded birth year are also kept (they may be living relatives).
Family records are kept when at least one member passes the filter.
"""

import json
import re
import sys
from pathlib import Path


# ── GEDCOM parser ──────────────────────────────────────────────────────────────

def parse_gedcom(filepath: str) -> tuple[dict, dict]:
    """Return (individuals, families) dicts keyed by GEDCOM xref id."""
    individuals: dict = {}
    families: dict = {}

    current_record: dict | None = None
    current_type: str | None = None  # 'INDI' | 'FAM'
    current_tag: str | None = None   # most recent level-1 tag

    with open(filepath, encoding="utf-8-sig", errors="replace") as fh:
        for raw_line in fh:
            line = raw_line.rstrip()
            if not line:
                continue

            # GEDCOM line format: level tag [value]
            m = re.match(r"^(\d+)\s+(\S+)\s*(.*)?$", line)
            if not m:
                continue

            level = int(m.group(1))
            tag   = m.group(2).strip()
            value = m.group(3).strip() if m.group(3) else ""

            # ── Level 0: start of a new record ────────────────────────────────
            if level == 0:
                current_record = None
                current_type   = None
                current_tag    = None

                # Syntax: 0 @XREF@ INDI   or   0 @XREF@ FAM
                if tag.startswith("@") and value in ("INDI", "FAM"):
                    xref         = tag
                    current_type = value
                    if current_type == "INDI":
                        current_record = {
                            "id": xref,
                            "name": None,
                            "birth_year": None,
                            "birth_date": None,
                            "birth_place": None,
                            "death_year": None,
                            "death_date": None,
                            "death_place": None,
                            "sex": None,
                            "fams": [],   # family IDs as spouse
                            "famc": [],   # family IDs as child
                        }
                        individuals[xref] = current_record
                    else:
                        current_record = {
                            "id": xref,
                            "husb": None,
                            "wife": None,
                            "chil": [],
                            "marr_date": None,
                            "marr_place": None,
                        }
                        families[xref] = current_record
                continue

            if current_record is None:
                continue

            # ── Individual record ──────────────────────────────────────────────
            if current_type == "INDI":
                if level == 1:
                    current_tag = tag
                    if tag == "NAME":
                        # GEDCOM names look like: Given /Surname/ Suffix
                        current_record["name"] = value.replace("/", " ").split()
                        current_record["name"] = " ".join(current_record["name"])
                    elif tag == "SEX":
                        current_record["sex"] = value
                    elif tag == "FAMS":
                        current_record["fams"].append(value)
                    elif tag == "FAMC":
                        current_record["famc"].append(value)

                elif level == 2:
                    if tag == "DATE":
                        if current_tag == "BIRT":
                            current_record["birth_date"] = value
                            current_record["birth_year"] = _extract_year(value)
                        elif current_tag == "DEAT":
                            current_record["death_date"] = value
                            current_record["death_year"] = _extract_year(value)
                    elif tag == "PLAC":
                        if current_tag == "BIRT":
                            current_record["birth_place"] = value
                        elif current_tag == "DEAT":
                            current_record["death_place"] = value

            # ── Family record ──────────────────────────────────────────────────
            elif current_type == "FAM":
                if level == 1:
                    current_tag = tag
                    if tag == "HUSB":
                        current_record["husb"] = value
                    elif tag == "WIFE":
                        current_record["wife"] = value
                    elif tag == "CHIL":
                        current_record["chil"].append(value)
                elif level == 2:
                    if tag == "DATE" and current_tag == "MARR":
                        current_record["marr_date"] = value
                    elif tag == "PLAC" and current_tag == "MARR":
                        current_record["marr_place"] = value

    return individuals, families


def _extract_year(date_str: str) -> int | None:
    """Pull the first 4-digit year out of a GEDCOM date string."""
    if not date_str:
        return None
    m = re.search(r"\b(\d{4})\b", date_str)
    return int(m.group(1)) if m else None


# ── Filter ─────────────────────────────────────────────────────────────────────

def filter_since_1900(
    individuals: dict,
    families: dict,
    min_year: int = 1900,
) -> tuple[dict, dict]:
    """
    Keep individuals whose birth year is >= min_year OR is unknown.
    Keep families that have at least one kept member.
    """
    kept_ids: set[str] = {
        xref
        for xref, ind in individuals.items()
        if ind["birth_year"] is None or ind["birth_year"] >= min_year
    }

    filtered_individuals = {k: v for k, v in individuals.items() if k in kept_ids}

    filtered_families: dict = {}
    for fid, fam in families.items():
        husb_kept = fam["husb"] in kept_ids if fam["husb"] else False
        wife_kept = fam["wife"] in kept_ids if fam["wife"] else False
        chil_kept = any(c in kept_ids for c in fam["chil"])
        if husb_kept or wife_kept or chil_kept:
            filtered_families[fid] = fam

    # Remove dangling family references inside individual records
    for ind in filtered_individuals.values():
        ind["fams"] = [f for f in ind["fams"] if f in filtered_families]
        ind["famc"] = [f for f in ind["famc"] if f in filtered_families]

    return filtered_individuals, filtered_families


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <input.ged> <output.json>")
        sys.exit(1)

    input_path  = sys.argv[1]
    output_path = sys.argv[2]

    if not Path(input_path).exists():
        print(f"Error: input file not found: {input_path}")
        sys.exit(1)

    print(f"Parsing {input_path} ...")
    individuals, families = parse_gedcom(input_path)
    print(f"  Total individuals : {len(individuals)}")
    print(f"  Total families    : {len(families)}")

    print("Filtering to individuals born 1900 or later (or unknown birth year) ...")
    filtered_inds, filtered_fams = filter_since_1900(individuals, families)
    print(f"  Kept individuals  : {len(filtered_inds)}")
    print(f"  Kept families     : {len(filtered_fams)}")

    output = {
        "individuals": filtered_inds,
        "families":    filtered_fams,
        "metadata": {
            "source_file":         str(Path(input_path).name),
            "total_before_filter": len(individuals),
            "total_after_filter":  len(filtered_inds),
            "filter":              "birth_year >= 1900 or unknown",
        },
    }

    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2, ensure_ascii=False)

    print(f"Output written to {output_path}")


if __name__ == "__main__":
    main()
