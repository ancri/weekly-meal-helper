from __future__ import annotations

import posixpath
import re
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"m": MAIN_NS, "r": OFFICE_REL_NS, "p": PACKAGE_REL_NS}


@dataclass(frozen=True)
class HistoricalMeal:
    week_start: date
    eaten_on: date
    recipe_name: str


@dataclass(frozen=True)
class HistoricalOrderItem:
    week_start: date
    ordered_on: date
    retailer: str
    whole_foods: bool
    raw_text: str


def monday_for(value: date) -> date:
    return value - timedelta(days=value.weekday())


def parse_sheet_date(name: str) -> date | None:
    """Parse compact M/D/YY or M/D/YYYY worksheet names."""
    if not name.isdigit():
        return None

    candidates: list[date] = []
    for year_digits in (4, 2):
        if len(name) <= year_digits + 1:
            continue
        year_text = name[-year_digits:]
        year = int(year_text)
        if year_digits == 2:
            year += 2000
        if not 2020 <= year <= 2100:
            continue
        prefix = name[:-year_digits]
        for month_digits in (1, 2):
            if len(prefix) <= month_digits:
                continue
            month_text = prefix[:month_digits]
            day_text = prefix[month_digits:]
            if len(day_text) not in (1, 2):
                continue
            try:
                candidates.append(date(year, int(month_text), int(day_text)))
            except ValueError:
                pass

    if not candidates:
        return None
    # The source workbook is organized weekly, normally on Fridays.
    return min(candidates, key=lambda value: (abs(value.weekday() - 4), value.month > 12))


def _cell_text(cell: ET.Element | None, shared_strings: list[str]) -> str:
    if cell is None:
        return ""
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{{{MAIN_NS}}}t"))
    value = cell.find("m:v", NS)
    if value is None or value.text is None:
        return ""
    if cell_type == "s":
        return shared_strings[int(value.text)]
    return value.text


def _shared_strings(archive: ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return [
        "".join(node.text or "" for node in item.iter(f"{{{MAIN_NS}}}t"))
        for item in root.findall("m:si", NS)
    ]


def _workbook_sheets(archive: ZipFile) -> list[tuple[str, str]]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {
        node.attrib["Id"]: node.attrib["Target"]
        for node in relationships.findall(f"{{{PACKAGE_REL_NS}}}Relationship")
    }
    sheets = []
    for sheet in workbook.findall(".//m:sheet", NS):
        relationship_id = sheet.attrib[f"{{{OFFICE_REL_NS}}}id"]
        target = targets[relationship_id]
        if target.startswith("/"):
            worksheet_path = target.lstrip("/")
        else:
            worksheet_path = posixpath.normpath(posixpath.join("xl", target))
        sheets.append((sheet.attrib["name"], worksheet_path))
    return sheets


def read_historical_meals(path: str | Path) -> list[HistoricalMeal]:
    meals: list[HistoricalMeal] = []
    with ZipFile(path) as archive:
        shared_strings = _shared_strings(archive)
        for sheet_name, worksheet_path in _workbook_sheets(archive):
            eaten_on = parse_sheet_date(sheet_name)
            if eaten_on is None:
                continue
            worksheet = ET.fromstring(archive.read(worksheet_path))
            cells = {
                cell.attrib.get("r", ""): cell
                for cell in worksheet.findall(".//m:c", NS)
            }
            for reference in ("B3", "B4", "B5", "B6"):
                name = re.sub(r"\s+", " ", _cell_text(cells.get(reference), shared_strings)).strip()
                if name:
                    meals.append(HistoricalMeal(monday_for(eaten_on), eaten_on, name))
    return meals


def read_historical_orders(path: str | Path) -> list[HistoricalOrderItem]:
    orders: list[HistoricalOrderItem] = []
    with ZipFile(path) as archive:
        shared_strings = _shared_strings(archive)
        for sheet_name, worksheet_path in _workbook_sheets(archive):
            ordered_on = parse_sheet_date(sheet_name)
            if ordered_on is None:
                continue
            worksheet = ET.fromstring(archive.read(worksheet_path))
            cells = {
                cell.attrib.get("r", ""): cell
                for cell in worksheet.findall(".//m:c", NS)
            }
            for column in ("G", "H", "J"):
                retailer = re.sub(
                    r"\s+", " ", _cell_text(cells.get(f"{column}1"), shared_strings)
                ).strip()
                whole_foods = "whole foods" in retailer.casefold()
                for reference, cell in cells.items():
                    match = re.fullmatch(rf"{column}(\d+)", reference)
                    if match is None or int(match.group(1)) < 2:
                        continue
                    raw_text = re.sub(r"\s+", " ", _cell_text(cell, shared_strings)).strip()
                    if raw_text:
                        orders.append(
                            HistoricalOrderItem(
                                week_start=monday_for(ordered_on),
                                ordered_on=ordered_on,
                                retailer=retailer,
                                whole_foods=whole_foods,
                                raw_text=raw_text,
                            )
                        )
    return orders


def infer_category(recipe_name: str) -> str:
    name = recipe_name.casefold()
    soup_words = ("soup", "stew", "chili", "curry", "dal", "gumbo", "broth")
    pasta_words = (
        "pasta",
        "spaghetti",
        "lasagna",
        "ravioli",
        "gnocchi",
        "tortellini",
        "macaroni",
        "bolognese",
        "noodle",
    )
    if any(word in name for word in soup_words):
        return "soups_stews"
    if any(word in name for word in pasta_words):
        return "pastas"
    return "oven_roasted"
