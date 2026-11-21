"""Clean every chain's film titles with Claude: showtimes-titles <folder>.

Chains put what is special about a showing into the film's title: a format
("(4DX) Wicked"), a year, a language, subtitles, a kind of screening ("Relaxed:"),
a festival or a cinema's own series ("LDNDOCS 2026:", "Harbour Highlights:"), an
add-on ("+ Q&A"). So one film appears under many names. Claude reads every title
the chains list and, for each one not seen before, gives the film's own name and
what the rest of the title said, as tags.

Decisions are kept in <folder>/titles.json, so each title is asked about once; the
site's export reads that file. The folder holds the chains' <chain>.sqlite files.
Needs Claude credentials when there are new titles: in the Deploy, Workload Identity
Federation (the ANTHROPIC_FEDERATION_* variables and an identity token file).
"""

import json
import sqlite3
import sys
from pathlib import Path

import anthropic

MODEL = "claude-opus-5-5"
# Titles asked about in one request; every request also carries every title listed.
BATCH = 150
KINDS = ["Picture", "Language", "Accessibility", "Events"]

INSTRUCTIONS = """You clean film titles for a UK cinema listings site that merges \
the listings of many cinema chains and independent cinemas. Each chain writes \
titles its own way, so one film appears under many names. Listings with the same \
clean title become one film on the site.

For each title you are asked about, give:
- title: the film's own name as people know it, in normal title capitalisation \
(not ALL CAPS), spelt exactly as you give it for every other listing of the same \
film. Take off everything that is not part of the name: formats ("(4DX)", "- 3D", \
"IMAX", "35mm", "4K Restoration"), a year, a language version, subtitles, kinds of \
screening (relaxed, autism friendly, parent and baby, senior, dog friendly, members' \
or insider previews), a festival, season or cinema programme put before or after \
the name ("LDNDOCS 2026:", "Harbour Highlights:", "Black Beyond:", "Kung Fu Cinema:", \
"Little Theatre's 90th"), anniversaries, encores and add-ons ("+ Q&A", "+ Director \
Intro", "+ Mulled Wine"). Keep what is part of the name: a franchise and its \
subtitle ("Dune: Part Three", "Avengers: Doomsday", "Mission: Impossible - Dead \
Reckoning"), and both films of a double bill ("Tabby McTat + The Room on the \
Broom"). A live broadcast is "<Company>: <Work>", with one company name for each \
company ("Royal Ballet & Opera: The Nutcracker", "Met Opera: Manon", "National \
Theatre Live: Hamlet"), whatever season or year the chain adds. Use the list of \
every title listed to recognise a festival or series: a prefix shared by several \
different films is usually one. When unsure whether words belong to the name, \
keep them.
- year: the year the title itself gives as the film's year ("Heat (1995)"), so that \
remakes stay apart; null when it gives none. A re-release year is not the film's.
- tags: one for each thing taken off that says something about the showing: \
kind Picture for formats, Language for a language version or subtitles ("Tamil", \
"English subtitles"), Accessibility for relaxed or autism friendly screenings, \
Events for everything else (festivals and series by their name without the year, \
"Preview", "Q&A", "Anniversary", "Encore", "Live"). Short labels, the same label \
for the same thing every time. A year or a decoration that says nothing (2D) is \
no tag.

Answer for every title asked about, by its number."""

SCHEMA = {
    "type": "object",
    "properties": {
        "titles": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "number": {"type": "integer"},
                    "title": {"type": "string"},
                    "year": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                    "tags": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "kind": {"type": "string", "enum": KINDS},
                            },
                            "required": ["label", "kind"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["number", "title", "year", "tags"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["titles"],
    "additionalProperties": False,
}


def listed(folder):
    """Every film title in the chains' files."""
    titles = set()
    for path in sorted(Path(folder).glob("*.sqlite")):
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
            titles.update(title for (title,) in db.execute("SELECT title FROM films"))
    return titles


def ask(client, every, decided, batch):
    """Claude's clean title, year and tags for each title of the batch."""
    names = sorted({entry["title"] for entry in decided.values()})
    asked = "\n".join(f"{number}. {title}" for number, title in enumerate(batch))
    with client.beta.messages.stream(
        model=MODEL,
        max_tokens=64000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={
            "effort": "medium",
            "format": {"type": "json_schema", "schema": SCHEMA},
        },
        system=[
            {"type": "text", "text": INSTRUCTIONS},
            # The same in every request of a run, so it is read from the cache.
            {
                "type": "text",
                "text": "Every title listed:\n" + "\n".join(sorted(every)),
                "cache_control": {"type": "ephemeral"},
            },
        ],
        messages=[
            {
                "role": "user",
                "content": "Clean titles already decided, to spell the same films "
                "the same way:\n"
                + ("\n".join(names) or "(none yet)")
                + "\n\nThe titles to clean:\n"
                + asked,
            }
        ],
    ) as stream:
        response = stream.get_final_message()
    if response.stop_reason != "end_turn":
        raise RuntimeError(f"Claude stopped with {response.stop_reason}")
    text = next(block.text for block in response.content if block.type == "text")
    answers = {item["number"]: item for item in json.loads(text)["titles"]}
    missing = [title for number, title in enumerate(batch) if number not in answers]
    if missing:
        raise RuntimeError(f"Claude gave no answer for {missing[:5]}")
    return {
        title: {
            "title": answers[number]["title"].strip(),
            "year": answers[number]["year"],
            "tags": answers[number]["tags"],
        }
        for number, title in enumerate(batch)
    }


def clean(folder, client=None):
    """Decide every new title, keeping each batch's answers as they come; returns them."""
    path = Path(folder) / "titles.json"
    decided = json.loads(path.read_text()) if path.exists() else {}
    every = listed(folder)
    new = sorted(every - decided.keys())
    found = {}
    for at in range(0, len(new), BATCH):
        client = client or anthropic.Anthropic()
        answers = ask(client, every, decided, new[at : at + BATCH])
        decided.update(answers)
        found.update(answers)
        path.write_text(
            json.dumps(decided, ensure_ascii=False, indent=1, sort_keys=True)
        )
    return found


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    folder = args[0] if args else "/data"
    found = clean(folder)
    # A list for people to check, as the Deploy run's summary shows it.
    print(f"Claude cleaned {len(found)} new titles.")
    for raw, answer in sorted(found.items()):
        tags = ", ".join(tag["label"] for tag in answer["tags"])
        if raw != answer["title"] or tags:
            year = f" ({answer['year']})" if answer["year"] else ""
            print(f"- {raw} → {answer['title']}{year}{f' [{tags}]' if tags else ''}")
    print(f"changed={'true' if found else 'false'}")
