import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from showtimes_ingest import titles


class Claude:
    """Answers as Claude would, from a table; records what it was asked."""

    def __init__(self, table, stop="end_turn"):
        self.table, self.stop, self.asked = table, stop, []
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self.stream))

    def stream(self, **request):
        self.asked.append(request)
        batch = request["messages"][0]["content"].split("The titles to clean:\n")[1]
        answers = []
        for line in batch.splitlines():
            number, title = line.split(". ", 1)
            if title in self.table:
                answers.append({"number": int(number), **self.table[title]})
        text = json.dumps({"titles": answers})
        message = SimpleNamespace(
            stop_reason=self.stop,
            content=[SimpleNamespace(type="text", text=text)],
        )

        class Stream:
            def __enter__(self):
                return SimpleNamespace(get_final_message=lambda: message)

            def __exit__(self, *_):
                return False

        return Stream()


def chain_file(folder, name, film_titles):
    with sqlite3.connect(Path(folder) / f"{name}.sqlite") as db:
        db.execute("CREATE TABLE films (id TEXT, title TEXT)")
        db.executemany("INSERT INTO films VALUES (?, ?)", enumerate(film_titles))


TABLE = {
    "(4DX) The Polar Express": {
        "title": "The Polar Express",
        "year": None,
        "tags": [{"label": "4DX", "kind": "Picture"}],
    },
    "The Polar Express": {"title": "The Polar Express", "year": None, "tags": []},
    "IFF: Hamlet": {
        "title": "Hamlet",
        "year": None,
        "tags": [{"label": "IFF", "kind": "Events"}],
    },
}


class TitlesTest(unittest.TestCase):
    def test_new_titles_are_asked_about_once_and_kept(self):
        with tempfile.TemporaryDirectory() as folder:
            chain_file(folder, "odeon", ["(4DX) The Polar Express"])
            chain_file(folder, "rio", ["The Polar Express", "IFF: Hamlet"])
            claude = Claude(TABLE)
            found = titles.clean(folder, claude)
            self.assertEqual(
                found["(4DX) The Polar Express"], TABLE["(4DX) The Polar Express"]
            )
            kept = json.loads((Path(folder) / "titles.json").read_text())
            self.assertEqual(set(kept), set(TABLE))
            # Every title listed goes with each request, for context.
            context = claude.asked[0]["system"][1]["text"]
            self.assertIn("IFF: Hamlet", context)
            self.assertEqual(claude.asked[0]["model"], "claude-opus-5-5")
            # Nothing new: nobody is asked.
            self.assertEqual(titles.clean(folder, Claude({})), {})
            chain_file(folder, "light", ["Hamlet"])
            again = Claude({"Hamlet": {"title": "Hamlet", "year": None, "tags": []}})
            self.assertEqual(list(titles.clean(folder, again)), ["Hamlet"])
            self.assertIn("The Polar Express", again.asked[0]["messages"][0]["content"])

    def test_a_missing_answer_or_an_unfinished_reply_fails_and_keeps_nothing_wrong(
        self,
    ):
        with tempfile.TemporaryDirectory() as folder:
            chain_file(folder, "odeon", ["IFF: Hamlet", "Unknown Film"])
            with self.assertRaisesRegex(RuntimeError, "no answer"):
                titles.clean(folder, Claude(TABLE))
            with self.assertRaisesRegex(RuntimeError, "max_tokens"):
                titles.clean(folder, Claude(TABLE, stop="max_tokens"))
            self.assertFalse((Path(folder) / "titles.json").exists())


if __name__ == "__main__":
    unittest.main()
