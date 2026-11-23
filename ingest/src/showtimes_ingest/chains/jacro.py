"""The public programme conventions shared by Jacro cinema sites."""

import re
from datetime import datetime
from urllib.parse import urlsplit

from showtimes_ingest import refresh
from showtimes_ingest.chains import admitone
from showtimes_ingest.chains.pages import parse
from showtimes_ingest.http import Client, NotFound
from showtimes_ingest.log import log
from showtimes_ingest.store import utc
from showtimes_ingest.week import TZ


def fields(root, cls, label_tag):
    container = next(root.find(cls=cls), None)
    props = {}
    if container:
        for node in container.find("li" if cls == "movie-info" else "p"):
            label = next(node.find(label_tag), None)
            if label:
                props[label.text.rstrip(":")] = node.text.removeprefix(
                    label.text
                ).strip()
    return props


def listing_day(text, today):
    text = re.sub(r"(\d+)(st|nd|rd|th)\b", r"\1", text).replace(",", "")
    # Checking the weekday also dates next spring's advance bookings in November.
    years = (
        (None,)
        if re.search(r"\b\d{4}$", text)
        else (today.year - 1, today.year, today.year + 1)
    )
    for year in years:
        try:
            day = datetime.strptime(
                text if year is None else f"{text} {year}", "%A %d %B %Y"
            ).date()
        except ValueError:
            continue
        if day.strftime("%A") == text.split()[0]:
            return day
    raise RuntimeError(f"Unrecognised programme date {text}")


def directory(client, base, legacy):
    root = parse(client.text("/"))
    select = next(
        (
            node
            for node in root.find("select")
            if node.attrs.get("id") == "cinemaSelect"
        ),
        None,
    )
    if select is None:
        raise RuntimeError("Jacro: no cinema directory")
    sites = []
    for option in select.find("option"):
        url = option.attrs.get("value") or ""
        if not url:
            continue
        host = urlsplit(url)
        if host.scheme != "https" or not (
            host.hostname == urlsplit(base).hostname
            or (host.hostname or "").endswith("." + urlsplit(base).hostname)
        ):
            raise RuntimeError("Jacro: unexpected cinema URL")
        sites.append(
            {
                "id": host.path.strip("/"),
                "name": option.text,
                "url": url,
                "stored": host.hostname == urlsplit(base).hostname
                or host.hostname
                in {f"{name}.{urlsplit(base).hostname}" for name in legacy},
            }
        )
    if not sites:
        raise RuntimeError("Jacro: empty cinema directory")
    return sites


def film_links(root, cinema, site):
    pattern = re.compile(re.escape(site + "/" + cinema) + r"/film/\d+/[^/?#]+/?$")
    return sorted(
        {
            link.attrs["href"]
            for link in root.find("a")
            if pattern.fullmatch(link.attrs.get("href", ""))
        }
    )


def withdrawn(root):
    """A film still linked from the programme that the cinema has since stopped showing."""
    return any(node.text == "Film not available here" for node in root.find("h2"))


def movie_page(root, cinema, url, today, site):
    """The film and its showings, or None when the cinema no longer shows it."""
    title = next(root.find("h1"), None)
    if title is None and withdrawn(root):
        return None
    if title is None:
        raise RuntimeError(f"Jacro: missing film information on {url}")
    props = fields(root, "movie-info", "i")
    runtime = re.search(r"\d+", props.get("Running time", ""))
    plot = next(root.find(cls="plot"), None)
    synopsis = next(plot.find("p"), None) if plot else None
    film = f"{cinema}/{urlsplit(url).path.split('/film/')[1].split('/')[0]}"
    people = [
        {"name": name.strip(), "roles": [role]}
        for label, role in (("Directed by", "Director"), ("Starring", "Actor"))
        for name in props.get(label, "").split(",")
        if name.strip()
    ]
    row = {
        "id": film,
        "title": title.text,
        "runtime": int(runtime[0]) if runtime else None,
        "certificate": props.get("Rating", ""),
        "release_date": props.get("Released")
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", props.get("Released", ""))
        else None,
        "genres": [
            genre.strip()
            for genre in props.get("Genre", "").split(",")
            if genre.strip()
        ],
        "people": people,
        "distributor": "",
        "synopsis": synopsis.text if synopsis else "",
        "trailer_url": None,
    }
    shows = {}
    for date_row in root.find(cls="date-row"):
        heading = next(date_row.find("span"), None)
        if heading is None:
            raise RuntimeError("Jacro: missing programme date")
        day = listing_day(heading.text, today)
        if day < today:
            continue
        for showing in date_row.find(cls="singlefilmperfs"):
            link = next(showing.find("a", "show_time_in"), None)
            if link is None:
                continue
            booking = re.fullmatch(
                re.escape(site + "/" + cinema) + r"/booknow/(\d+)/?",
                link.attrs.get("href", ""),
            )
            if not booking:
                raise RuntimeError("Jacro: unexpected booking link")
            starts = datetime.combine(
                day, datetime.strptime(link.text, "%H:%M").time(), TZ
            )
            details = fields(showing, "popup-details", "span")
            screen = details.get("Screen") or "Screen"
            tags = [
                node.text for node in showing.find(cls="show_time_label") if node.text
            ]
            if details.get("2D / 3D"):
                tags.append(details["2D / 3D"])
            if details.get("Subtitled"):
                tags.append("Subtitled")
            shows[booking[1]] = {
                "cinema_id": cinema,
                "id": booking[1],
                "film_id": film,
                "business_date": str(day),
                "starts_at": utc(starts),
                "time": link.text,
                "film_starts_at": None,
                "film_ends_at": None,
                "screen": screen,
                "screen_id": screen if details.get("Screen") else "?",
                "experiences": tags,
                "seating": [],
                "sold_out": None,
            }
    return row, list(shows.values())


def programme(html, today, site, cinema):
    films, shows = {}, {}
    for block in parse(html).find("div", "jacro-event"):
        title = next(block.find("a", "liveeventtitle"), None)
        match = (
            re.fullmatch(
                re.escape(site) + r"/film/(\d+)/[^/?#]+/?", title.attrs.get("href", "")
            )
            if title
            else None
        )
        if match is None:
            raise RuntimeError("Jacro: missing film identity")
        film = match[1]
        detail = next(block.find("div", "running-time"), None)
        parts = [n.text for n in detail.find("span")] if detail else []
        runtime = next(
            (
                int(m[1])
                for part in parts
                if (m := re.fullmatch(r"(\d+)\s*mins?", part))
            ),
            None,
        )
        cert = next(
            (
                part.strip("()")
                for part in parts
                if re.fullmatch(r"\((?:U|PG|12A?|15|18|TBC)\)", part)
            ),
            "",
        )
        synopsis = next(block.find("p"), None)
        people = []
        for span in block.find("span"):
            for prefix, role in (("Directed by ", "Director"), ("Starring ", "Actor")):
                if span.text.startswith(prefix):
                    people += [
                        {"name": name.strip(), "roles": [role]}
                        for name in span.text.removeprefix(prefix).split(",")
                        if name.strip()
                    ]
        films[film] = {
            "id": film,
            "title": title.text,
            "runtime": runtime,
            "certificate": cert,
            "release_date": None,
            "genres": [],
            "people": people,
            "distributor": "",
            "synopsis": synopsis.text if synopsis else "",
            "trailer_url": None,
        }
        for performances in block.find("ul", "performance-list-items"):
            day = None
            for node in performances.find():
                if "heading" in node.attrs.get("class", "").split():
                    day = listing_day(node.text, today)
                if node.tag != "li":
                    continue
                time = next(node.find("span", "time"), None)
                if time is None:
                    continue
                if day is None:
                    raise RuntimeError("Jacro: showing without a date")
                if day < today:
                    continue
                link = next(node.find("a", "film_book_button"), None)
                href = link.attrs.get("href", "") if link else ""
                booking = re.fullmatch(
                    re.escape(site + "/" + cinema) + r"/booknow/(\d+)/?", href
                )
                sold = (
                    not href
                    or "soldout"
                    in (
                        node.attrs.get("class", "")
                        + " "
                        + (link.attrs.get("class", "") if link else "")
                    ).lower()
                )
                if href and booking is None:
                    raise RuntimeError("Jacro: unexpected booking link")
                starts = datetime.combine(
                    day, datetime.strptime(time.text.upper(), "%I:%M %p").time(), TZ
                )
                id = booking[1] if booking else f"soldout/{film}/{day}/{starts:%H%M}"
                shows[id] = {
                    "cinema_id": cinema,
                    "id": id,
                    "film_id": film,
                    "business_date": str(day),
                    "starts_at": utc(starts),
                    "time": starts.strftime("%H:%M"),
                    "film_starts_at": None,
                    "film_ends_at": None,
                    "screen": "Screen",
                    "screen_id": "?",
                    "experiences": [n.text for n in node.find("span", "tag") if n.text],
                    "seating": [],
                    "sold_out": 1 if sold else None,
                    **({"booking_url": None} if booking is None else {}),
                }
    if not shows:
        raise RuntimeError("Jacro: no showings in the programme")
    return list(films.values()), list(shows.values())


class Jacro:
    """Shared WordPress/Jacro adapter with documented page-layout variants.

    A mixed operator can route its older venues to the common Admit One reader.
    Cinemas, URLs and routing are configuration rather than copied collectors.
    """

    def __init__(self, name, site, cinemas=None, programme_path=None, legacy=()):
        self.NAME, self.site = name, site
        self.cinemas, self.programme_path = cinemas, programme_path
        self.legacy = set(legacy)

    def directory(self, client):
        return (
            self.cinemas
            if self.cinemas is not None
            else directory(client, self.site, self.legacy)
        )

    def movie_page(self, root, cinema, url, today):
        return movie_page(root, cinema, url, today, self.site)

    def collect(self, client, today, known=None):
        cinemas, films, shows, availability = [], {}, {}, {}
        for source in self.directory(client):
            cinema = source["id"]
            previous = (known or {}).get(cinema, {})
            cinemas.append(
                {
                    "id": cinema,
                    "name": source["name"],
                    "stored": source.get("stored", True),
                    "address": source.get("address")
                    or previous.get("address")
                    or {"line1": "", "city": source["name"], "postcode": ""},
                    "latitude": source.get("latitude", previous.get("latitude")),
                    "longitude": source.get("longitude", previous.get("longitude")),
                }
            )
            if not source.get("stored", True):
                continue
            if cinema in self.legacy:
                movies, screenings = admitone.programme(
                    client.text(source["url"].rstrip("/") + "/whatson"), cinema, today
                )
            elif self.programme_path:
                movies, screenings = programme(
                    client.text(self.programme_path), today, self.site, cinema
                )
            else:
                links = film_links(parse(client.text(source["url"])), cinema, self.site)
                if not links:
                    raise RuntimeError(f"Jacro: no film directory for {cinema}")
                movies, screenings = [], []
                for url in links:
                    # A film page gone entirely is a film withdrawn, as "Film not available here" is.
                    try:
                        html = client.text(url)
                    except NotFound:
                        log.warning("%s: %s is gone; skipping it", cinema, url)
                        continue
                    page = self.movie_page(parse(html), cinema, url, today)
                    if page is None:
                        continue
                    film, rows = page
                    movies.append(film)
                    screenings.extend(rows)
            if not screenings:
                raise RuntimeError(f"Jacro: no published showings for {cinema}")
            films.update((movie["id"], movie) for movie in movies)
            shows.update(((cinema, row["id"]), row) for row in screenings)
            availability.update(
                ((cinema, row["film_id"]), ["NowShowing"]) for row in screenings
            )
        return {
            "cinemas": cinemas,
            "films": list(films.values()),
            "screenings": list(shows.values()),
            "availability": availability,
        }

    def ingest(self, path=None, today=None, client=None):
        return refresh.ingest(
            path, self.NAME, self.collect, client or Client(self.site), today
        )

    def check(self, path=None, moment=None, client=None):
        return refresh.check(
            path, self.NAME, self.collect, client or Client(self.site), moment
        )

    def settled_reason(self, path=None, today=None):
        return refresh.settled_reason(path, self.NAME, today)
