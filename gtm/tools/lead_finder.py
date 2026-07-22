#!/usr/bin/env python3
"""
Free public-web clinic lead collector.

This intentionally uses only Python's standard library. It searches DuckDuckGo's
HTML endpoint, visits public result pages, extracts visible emails/phone numbers,
and writes a deduped CSV.
"""

from __future__ import annotations

import argparse
import csv
import html
import os
import re
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote_plus, unquote, urlparse
from urllib.request import Request, urlopen


DEFAULT_CITY = "Bangalore"
DEFAULT_LOCALITIES = [
    "Indiranagar",
    "Koramangala",
    "HSR Layout",
    "Whitefield",
    "Jayanagar",
    "JP Nagar",
    "BTM Layout",
    "Marathahalli",
    "Electronic City",
    "Bellandur",
    "Hebbal",
    "Yelahanka",
    "Malleshwaram",
    "Rajajinagar",
    "Basavanagudi",
    "Banashankari",
    "Sarjapur Road",
    "Bannerghatta Road",
    "Domlur",
    "MG Road",
]
INTERACTIVE_DEFAULT_LOCALITIES = DEFAULT_LOCALITIES[:5]
LOCALITY_ALIASES = {
    "hsr": "HSR Layout",
    "jp": "JP Nagar",
    "j p": "JP Nagar",
    "btm": "BTM Layout",
    "mg": "MG Road",
    "m g": "MG Road",
    "blr": "Bangalore",
    "bengaluru": "Bangalore",
}

SKIP_DOMAINS = {
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "youtube.com",
    "twitter.com",
    "x.com",
    "amazon.in",
}

GENERIC_TITLES = {
    "home",
    "mysite",
    "lybrate",
    "justdial",
    "practo",
    "sulekha",
}

EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE_RE = re.compile(
    r"""
    (?:
        (?:\+91[\s-]?)?
        [6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4}
        |
        0?80[\s-]?\d{3,4}[\s-]?\d{4}
        |
        \(?080\)?[\s-]?\d{3,4}[\s-]?\d{4}
    )
    """,
    re.X,
)
PIN_RE = re.compile(r"\b56\d{4}\b")
DEFAULT_TERMS = ["clinic", "medical clinic"]
QUERY_PATTERNS = [
    '"{term}" "{locality}" "{city}" phone',
    '{term} {locality} {city} contact',
    'site:practo.com "{term}" "{locality}" "{city}"',
    'site:justdial.com "{term}" "{locality}" "{city}"',
]


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str


class DuckDuckGoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.results: list[SearchResult] = []
        self._in_title = False
        self._in_snippet = False
        self._pending_href = ""
        self._title_parts: list[str] = []
        self._snippet_parts: list[str] = []
        self._last_title = ""
        self._last_url = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key: value or "" for key, value in attrs}
        classes = attrs_dict.get("class", "")
        if tag == "a" and "result__a" in classes:
            self._in_title = True
            self._pending_href = attrs_dict.get("href", "")
            self._title_parts = []
        elif tag in {"a", "td", "div"} and "result__snippet" in classes:
            self._in_snippet = True
            self._snippet_parts = []

    def handle_endtag(self, tag: str) -> None:
        if self._in_title and tag == "a":
            self._in_title = False
            self._last_title = clean_text(" ".join(self._title_parts))
            self._last_url = normalize_ddg_url(self._pending_href)
        elif self._in_snippet and tag in {"a", "td", "div"}:
            self._in_snippet = False
            snippet = clean_text(" ".join(self._snippet_parts))
            if self._last_url:
                self.results.append(SearchResult(self._last_title, self._last_url, snippet))
                self._last_title = ""
                self._last_url = ""

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_parts.append(data)
        elif self._in_snippet:
            self._snippet_parts.append(data)


class BingParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.results: list[SearchResult] = []
        self._in_result = False
        self._in_title = False
        self._in_snippet = False
        self._href = ""
        self._title_parts: list[str] = []
        self._snippet_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key: value or "" for key, value in attrs}
        classes = attrs_dict.get("class", "")
        if tag == "li" and "b_algo" in classes:
            self._in_result = True
            self._href = ""
            self._title_parts = []
            self._snippet_parts = []
        elif self._in_result and tag == "a" and not self._href:
            self._href = attrs_dict.get("href", "")
            self._in_title = True
        elif self._in_result and tag == "p":
            self._in_snippet = True

    def handle_endtag(self, tag: str) -> None:
        if self._in_title and tag == "a":
            self._in_title = False
        elif self._in_snippet and tag == "p":
            self._in_snippet = False
        elif self._in_result and tag == "li":
            title = clean_text(" ".join(self._title_parts))
            snippet = clean_text(" ".join(self._snippet_parts))
            if self._href and title:
                self.results.append(SearchResult(title, self._href, snippet))
            self._in_result = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_parts.append(data)
        elif self._in_snippet:
            self._snippet_parts.append(data)


class PageTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.h1 = ""
        self.meta: dict[str, str] = {}
        self.links: list[str] = []
        self._tag_stack: list[str] = []
        self._title_parts: list[str] = []
        self._h1_parts: list[str] = []
        self._text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): value or "" for key, value in attrs}
        self._tag_stack.append(tag)
        if tag == "meta":
            key = attrs_dict.get("property") or attrs_dict.get("name")
            content = attrs_dict.get("content")
            if key and content:
                self.meta[key.lower()] = content
        elif tag == "a":
            href = attrs_dict.get("href", "")
            if href.startswith("mailto:"):
                self.links.append(href)

    def handle_endtag(self, tag: str) -> None:
        if self._tag_stack:
            self._tag_stack.pop()
        if tag == "title":
            self.title = clean_text(" ".join(self._title_parts))
        elif tag == "h1" and not self.h1:
            self.h1 = clean_text(" ".join(self._h1_parts))

    def handle_data(self, data: str) -> None:
        current = self._tag_stack[-1] if self._tag_stack else ""
        if current in {"script", "style", "noscript"}:
            return
        if current == "title":
            self._title_parts.append(data)
        elif current == "h1":
            self._h1_parts.append(data)
        self._text_parts.append(data)

    @property
    def text(self) -> str:
        return clean_text(" ".join(self._text_parts))


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def normalize_ddg_url(url: str) -> str:
    if not url:
        return ""
    if url.startswith("//"):
        url = f"https:{url}"
    parsed = urlparse(url)
    if parsed.path.startswith("/l/"):
        uddg = parse_qs(parsed.query).get("uddg", [""])[0]
        return unquote(uddg)
    return url


def fetch(url: str, timeout: int) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
            )
        },
    )
    with urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get("content-type", "")
        charset = "utf-8"
        match = re.search(r"charset=([\w-]+)", content_type)
        if match:
            charset = match.group(1)
        return response.read(1_500_000).decode(charset, errors="ignore")


def search_duckduckgo(query: str, max_results: int, timeout: int) -> list[SearchResult]:
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    parser = DuckDuckGoParser()
    parser.feed(fetch(url, timeout))
    return parser.results[:max_results]


def search_bing(query: str, max_results: int, timeout: int) -> list[SearchResult]:
    url = f"https://www.bing.com/search?q={quote_plus(query)}"
    parser = BingParser()
    parser.feed(fetch(url, timeout))
    return parser.results[:max_results]


def search(query: str, max_results: int, timeout: int) -> list[SearchResult]:
    providers = [("DuckDuckGo", search_duckduckgo), ("Bing", search_bing)]
    last_error: Exception | None = None
    for provider_name, provider in providers:
        try:
            results = provider(query, max_results, timeout)
        except (HTTPError, URLError, TimeoutError) as exc:
            last_error = exc
            print(f"  {provider_name} failed: {exc}", flush=True)
            continue
        if results:
            return results
        print(f"  {provider_name} returned no results", flush=True)
    if last_error:
        raise last_error
    return []


def normalize_locality(value: str) -> str:
    cleaned = clean_text(value)
    return LOCALITY_ALIASES.get(cleaned.lower(), cleaned)


def search_queries(term: str, locality: str, city: str) -> list[str]:
    return [
        pattern.format(term=term, locality=locality, city=city)
        for pattern in QUERY_PATTERNS
    ]


def visible_emails(text: str, mailto_links: Iterable[str]) -> list[str]:
    found = set(EMAIL_RE.findall(text))
    for link in mailto_links:
        email = link.removeprefix("mailto:").split("?")[0]
        if EMAIL_RE.fullmatch(email):
            found.add(email)
    return sorted(found)


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("0") and digits[1] in "6789":
        digits = digits[1:]
    return digits


def visible_phones(text: str) -> list[str]:
    phones = {normalize_phone(match.group(0)) for match in PHONE_RE.finditer(text)}
    return sorted(phone for phone in phones if 8 <= len(phone) <= 11)


def likely_clinic_name(page: PageTextParser, fallback_title: str) -> str:
    for candidate in [
        page.meta.get("og:site_name", ""),
        page.meta.get("og:title", ""),
        page.h1,
        page.title,
        fallback_title,
    ]:
        candidate = clean_text(candidate)
        candidate = re.split(r"\s+[-|]\s+", candidate)[0].strip()
        if candidate and candidate.lower() not in GENERIC_TITLES:
            return candidate
    return ""


def likely_location(text: str, locality: str, city: str, snippet: str) -> str:
    candidates = []
    for source in [snippet, text]:
        for sentence in re.split(r"(?<=[.;])\s+|\n", source):
            sentence = clean_text(sentence)
            if not sentence:
                continue
            has_city = city.lower() in sentence.lower() or "bengaluru" in sentence.lower()
            has_locality = locality.lower() in sentence.lower()
            has_pin = bool(PIN_RE.search(sentence))
            if (has_city or has_locality or has_pin) and len(sentence) <= 240:
                candidates.append(sentence)
    return candidates[0] if candidates else f"{locality}, {city}"


def source_type(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if "practo" in host or "justdial" in host or "lybrate" in host or "sulekha" in host:
        return "directory"
    return "website"


def should_skip(url: str) -> bool:
    host = urlparse(url).netloc.lower().removeprefix("www.")
    return any(host == domain or host.endswith(f".{domain}") for domain in SKIP_DOMAINS)


def lead_key(phone: str, email: str, website: str, name: str) -> str:
    if phone:
        return f"phone:{phone}"
    if email:
        return f"email:{email.lower()}"
    host = urlparse(website).netloc.lower().removeprefix("www.")
    if host:
        return f"host:{host}"
    return f"name:{name.lower()}"


def collect(args: argparse.Namespace) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen: set[str] = set()

    for locality in args.locality:
        for term in args.term:
            results_by_url: dict[str, SearchResult] = {}
            for query in search_queries(term, locality, args.city):
                print(f"Searching: {query}", flush=True)
                try:
                    results = search(query, args.results_per_query, args.timeout)
                except (HTTPError, URLError, TimeoutError) as exc:
                    print(f"  search failed: {exc}", flush=True)
                    continue
                for result in results:
                    results_by_url.setdefault(result.url, result)
                time.sleep(args.delay)

            if not results_by_url:
                print(f"  no search results for {term} in {locality}", flush=True)
            for result in results_by_url.values():
                if should_skip(result.url):
                    continue

                page = PageTextParser()
                page_text = ""
                try:
                    body = fetch(result.url, args.timeout)
                    page.feed(body)
                    page_text = page.text
                except (HTTPError, URLError, TimeoutError, UnicodeError) as exc:
                    print(f"  page failed: {result.url} ({exc})", flush=True)

                text = f"{result.title} {result.snippet} {page_text}"
                phones = visible_phones(text)
                emails = visible_emails(text, page.links)
                name = likely_clinic_name(page, result.title)
                phone = phones[0] if phones else ""
                email = emails[0] if emails else ""
                key = lead_key(phone, email, result.url, name)
                if key in seen:
                    continue

                seen.add(key)
                rows.append(
                    {
                        "clinic_name": name,
                        "city": args.city,
                        "area": locality,
                        "phone": phone,
                        "email": email,
                        "website": result.url,
                        "location": likely_location(page_text, locality, args.city, result.snippet),
                        "source_url": result.url,
                        "source_type": source_type(result.url),
                        "search_term": term,
                    }
                )
                print(f"  + {name or result.url} {phone or email or ''}".rstrip(), flush=True)
                time.sleep(args.delay)

    return rows


def write_csv(path: str, rows: list[dict[str, str]]) -> None:
    fieldnames = [
        "clinic_name",
        "city",
        "area",
        "phone",
        "email",
        "website",
        "location",
        "source_url",
        "source_type",
        "search_term",
    ]
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def parse_csv_input(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def parse_localities(value: str) -> list[str]:
    return [normalize_locality(item) for item in parse_csv_input(value)]


def ask_text(prompt: str, default: str) -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{prompt}{suffix}: ").strip()
    return value or default


def ask_list(prompt: str, default: list[str]) -> list[str]:
    default_text = ", ".join(default)
    value = input(f"{prompt} [{default_text}]: ").strip()
    return parse_csv_input(value) or default


def ask_localities(prompt: str, default: list[str]) -> list[str]:
    default_text = ", ".join(default)
    value = input(f"{prompt} [{default_text}]: ").strip()
    return parse_localities(value) or default


def ask_int(prompt: str, default: int, minimum: int = 1) -> int:
    while True:
        value = input(f"{prompt} [{default}]: ").strip()
        if not value:
            return default
        try:
            parsed = int(value)
        except ValueError:
            print("Enter a whole number.", flush=True)
            continue
        if parsed >= minimum:
            return parsed
        print(f"Enter {minimum} or higher.", flush=True)


def ask_float(prompt: str, default: float, minimum: float = 0.0) -> float:
    while True:
        value = input(f"{prompt} [{default}]: ").strip()
        if not value:
            return default
        try:
            parsed = float(value)
        except ValueError:
            print("Enter a number.", flush=True)
            continue
        if parsed >= minimum:
            return parsed
        print(f"Enter {minimum} or higher.", flush=True)


def ask_yes_no(prompt: str, default: bool) -> bool:
    default_text = "Y/n" if default else "y/N"
    while True:
        value = input(f"{prompt} [{default_text}]: ").strip().lower()
        if not value:
            return default
        if value in {"y", "yes"}:
            return True
        if value in {"n", "no"}:
            return False
        print("Enter y or n.", flush=True)


def apply_interactive_inputs(args: argparse.Namespace) -> argparse.Namespace:
    print("Lead Finder", flush=True)
    print("Press Enter to accept defaults. Use commas for multiple values.", flush=True)
    print("", flush=True)

    args.city = ask_text("City", args.city)
    args.locality = ask_localities("Localities", args.locality or INTERACTIVE_DEFAULT_LOCALITIES)
    args.term = ask_list("Clinic specialties/search terms", args.term or DEFAULT_TERMS)
    args.results_per_query = ask_int("Results per locality + specialty", args.results_per_query)
    args.delay = ask_float("Delay between page requests, seconds", args.delay)
    args.output = ask_text("Output CSV path", args.output)

    total_queries = len(args.locality) * len(args.term) * len(QUERY_PATTERNS)
    print("", flush=True)
    print("Run summary:", flush=True)
    print(f"  City: {args.city}", flush=True)
    print(f"  Localities: {', '.join(args.locality)}", flush=True)
    print(f"  Terms: {', '.join(args.term)}", flush=True)
    print(f"  Queries: {total_queries}", flush=True)
    print(f"  Max search results checked: {total_queries * args.results_per_query}", flush=True)
    print(f"  Output: {args.output}", flush=True)
    print("", flush=True)

    if not ask_yes_no("Start collection", True):
        print("Cancelled.", flush=True)
        raise SystemExit(0)
    return args


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect free public leads from search results.")
    parser.add_argument(
        "-i",
        "--interactive",
        action="store_true",
        help="Ask for city, localities, specialties, and output before running.",
    )
    parser.add_argument("--city", default=DEFAULT_CITY)
    parser.add_argument(
        "--locality",
        action="append",
        default=[],
        help="Locality to search. Can be repeated. Defaults to common Bangalore localities.",
    )
    parser.add_argument(
        "--term",
        action="append",
        default=[],
        help='Search term. Can be repeated. Defaults to "clinic" and "medical clinic".',
    )
    parser.add_argument("--results-per-query", type=int, default=10)
    parser.add_argument("--delay", type=float, default=1.5)
    parser.add_argument("--timeout", type=int, default=12)
    parser.add_argument("--output", default="gtm/batches/bangalore_clinics_raw.csv")
    parser.add_argument(
        "--allow-empty-output",
        action="store_true",
        help="Overwrite the output CSV even when no leads are found.",
    )
    args = parser.parse_args()
    if args.interactive:
        return apply_interactive_inputs(args)
    args.locality = [normalize_locality(locality) for locality in (args.locality or DEFAULT_LOCALITIES)]
    args.term = args.term or DEFAULT_TERMS
    return args


def main() -> None:
    args = parse_args()
    rows = collect(args)
    if not rows and os.path.exists(args.output) and not args.allow_empty_output:
        print(
            f"No leads found. Keeping existing {args.output}. "
            "Pass --allow-empty-output to overwrite it.",
            flush=True,
        )
        return
    write_csv(args.output, rows)
    print(f"Wrote {len(rows)} leads to {args.output}", flush=True)


if __name__ == "__main__":
    main()
