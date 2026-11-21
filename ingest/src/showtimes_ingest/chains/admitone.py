"""Admit One's complete public programme, including hidden future-date panels."""

import re
from datetime import datetime, timedelta

from showtimes_ingest.chains.pages import parse
from showtimes_ingest.store import utc
from showtimes_ingest.week import TZ


def programme_date(label, today):
    if label in ("Today", "Tomorrow"):
        return today + timedelta(days=int(label == "Tomorrow"))
    for year in (today.year - 1, today.year, today.year + 1):
        try:
            day = datetime.strptime(f"{label} {year}", "%a %d %b %Y").date()
        except ValueError:
            continue
        if day.strftime("%a") == label.split()[0]:
            return day
    raise RuntimeError(f"Admit One: unrecognised date tab {label}")


def programme(html, cinema, today):
    root = parse(html)
    days = {
        "panel" + n.attrs["data-target"]: programme_date(n.text, today)
        for n in root.find("button", "tab")
        if n.attrs.get("data-target") is not None
    }
    films, shows = {}, {}
    for panel in root.find():
        day = days.get(panel.attrs.get("id"))
        if day is None or day < today:
            continue
        film, category = None, ""
        for node in panel.find():
            if node.tag == "h2":
                link = next(node.find("a"), None)
                match = (
                    re.fullmatch(
                        r"/" + re.escape(cinema) + r"/event/(\d+)/[^/?#]+/?",
                        link.attrs.get("href", ""),
                    )
                    if link
                    else None
                )
                if match is None:
                    raise RuntimeError("Admit One: unexpected film identity")
                film, category = f"{cinema}/{match[1]}", ""
                detail = node.parent.parent
                runtime = re.search(r"Running time:\s*(\d+)\s*mins", detail.text)
                certificate = next(
                    (
                        m[1]
                        for img in detail.find("img")
                        if (
                            m := re.search(
                                r"/ratings/UK/(U|PG|12A?|15|18)lrg\.png",
                                img.attrs.get("src", ""),
                            )
                        )
                    ),
                    "",
                )
                films[film] = {
                    "id": film,
                    "title": node.text,
                    "runtime": int(runtime[1]) if runtime else None,
                    "certificate": certificate,
                    "release_date": None,
                    "genres": [],
                    "people": [],
                    "distributor": "",
                    "synopsis": "",
                    "trailer_url": None,
                }
            if (
                node.tag == "p"
                and "font-semibold" in node.attrs.get("class", "").split()
            ):
                category = node.text
            if (
                node.tag != "a"
                or "perfButton" not in node.attrs.get("class", "").split()
            ):
                continue
            match = re.fullmatch(
                r"/" + re.escape(cinema) + r"/booking/(\d+/[^/?#]+)",
                node.attrs.get("href", ""),
            )
            if match is None or film is None:
                raise RuntimeError("Admit One: unexpected booking or missing film")
            starts = datetime.combine(
                day, datetime.strptime(node.text, "%H:%M").time(), TZ
            )
            tags = [category] if category else []
            if films[film]["title"].endswith(" - Subtitled Screening"):
                tags.append("Subtitled")
            shows.setdefault(
                match[1],
                {
                    "cinema_id": cinema,
                    "id": match[1],
                    "film_id": film,
                    "business_date": str(day),
                    "starts_at": utc(starts),
                    "time": starts.strftime("%H:%M"),
                    "film_starts_at": None,
                    "film_ends_at": None,
                    "screen": "Screen",
                    "screen_id": "?",
                    "experiences": tags,
                    "seating": [],
                    "sold_out": 1
                    if "soldOutOverride_color" in node.attrs.get("class", "").split()
                    else None,
                },
            )
    if not shows:
        raise RuntimeError(f"Admit One: no published showings for {cinema}")
    return list(films.values()), list(shows.values())
