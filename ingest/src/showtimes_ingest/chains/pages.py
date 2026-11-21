"""Read the public HTML a cinema publishes, without executing its scripts."""

import json
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser

VOID = set(
    "area base br col embed hr img input link meta param source track wbr".split()
)


@dataclass
class Node:
    tag: str
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)
    parent: object = field(default=None, repr=False, compare=False)

    @property
    def text(self):
        return " ".join(self.content().split())

    def content(self):
        return "".join(
            child if isinstance(child, str) else child.content()
            for child in self.children
        )

    def find(self, tag=None, cls=None):
        for child in self.children:
            if isinstance(child, Node):
                if (tag is None or child.tag == tag) and (
                    cls is None or cls in child.attrs.get("class", "").split()
                ):
                    yield child
                yield from child.find(tag, cls)


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Node("document")
        self.stack = [self.root]
        self.feed(html)
        self.close()

    def handle_starttag(self, tag, attrs):
        node = Node(tag, dict(attrs), parent=self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, text):
        self.stack[-1].children.append(text)


def parse(html):
    return Page(html).root


def embedded(html, variable):
    """Read a JSON-valued script assignment without evaluating JavaScript."""
    match = re.search(r"\b" + re.escape(variable) + r"\s*=\s*", html)
    if match:
        try:
            return json.JSONDecoder().raw_decode(html[match.end() :])[0]
        except ValueError:
            pass
    raise RuntimeError(f"Missing or invalid public page data: {variable}")
