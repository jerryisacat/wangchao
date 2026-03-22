import json
import re
from difflib import SequenceMatcher
from typing import Any, Iterable

FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.IGNORECASE | re.DOTALL)
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
ZERO_WIDTH_RE = re.compile(r"[\u200b-\u200f\u2060\ufeff]")
SMART_PUNCT_TRANSLATION = str.maketrans({
    "“": '"',
    "”": '"',
    "‘": "'",
    "’": "'",
})


def _iter_text_candidates(obj: Any) -> Iterable[str]:
    if obj is None:
        return
    if isinstance(obj, str):
        yield obj
        return
    if isinstance(obj, bytes):
        yield obj.decode("utf-8", errors="replace")
        return

    for attr in ("output_text", "text", "content"):
        value = getattr(obj, attr, None)
        if isinstance(value, str) and value.strip():
            yield value

    choices = getattr(obj, "choices", None)
    if choices:
        for choice in choices:
            message = getattr(choice, "message", None)
            if message is not None:
                content = getattr(message, "content", None)
                if isinstance(content, str) and content.strip():
                    yield content
                elif isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict):
                            text = part.get("text") or part.get("content")
                        else:
                            text = getattr(part, "text", None) or getattr(part, "content", None)
                        if isinstance(text, str) and text.strip():
                            yield text
            text = getattr(choice, "text", None)
            if isinstance(text, str) and text.strip():
                yield text

    if isinstance(obj, dict):
        for key in ("output_text", "text", "content"):
            value = obj.get(key)
            if isinstance(value, str) and value.strip():
                yield value
        choices = obj.get("choices") or []
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            message = choice.get("message") or {}
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                yield content
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict):
                        text = part.get("text") or part.get("content")
                        if isinstance(text, str) and text.strip():
                            yield text
            text = choice.get("text")
            if isinstance(text, str) and text.strip():
                yield text


def extract_text_response(response: Any) -> str | None:
    for candidate in _iter_text_candidates(response):
        if candidate and candidate.strip():
            return candidate.strip()

    if response is None:
        return None

    response_str = str(response).strip()
    return response_str or None


def sanitize_text(text: str | None) -> str | None:
    if text is None:
        return None
    text = text.translate(SMART_PUNCT_TRANSLATION)
    text = ZERO_WIDTH_RE.sub("", text)
    text = CONTROL_RE.sub("", text)
    return text.strip()


def extract_json_blob(text: str) -> str:
    text = sanitize_text(text) or ""
    fence_match = FENCE_RE.search(text)
    if fence_match:
        text = fence_match.group(1).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start:end + 1]
    return text.strip()


def _repair_common_json_issues(text: str) -> str:
    repaired = text
    # Remove trailing commas before } or ]
    repaired = re.sub(r",\s*([}\]])", r"\1", repaired)
    # Quote common unquoted keys after { or ,
    repaired = re.sub(r'([\{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)', r'\1"\2"\3', repaired)
    # Normalize null-ish bare blanks for context/sources-ish fields if model emitted empty values
    repaired = re.sub(r'(:\s*)(?=,|}|\])', r'\1null', repaired)
    return repaired


def parse_json_response(text: str) -> tuple[Any | None, str]:
    cleaned = extract_json_blob(text)
    if not cleaned:
        return None, ""

    attempts = [cleaned, _repair_common_json_issues(cleaned)]
    seen = set()
    for candidate in attempts:
        if candidate in seen:
            continue
        seen.add(candidate)
        try:
            return json.loads(candidate), candidate
        except json.JSONDecodeError:
            continue
    return None, cleaned


def normalize_title(title: str | None) -> str:
    if not title:
        return ""
    title = sanitize_text(title) or ""
    title = re.sub(r"\s+", " ", title)
    title = title.replace("|", " ").replace("_", " ")
    return title.strip().lower()


def best_title_match(target_title: str | None, candidates: list[dict], threshold: float = 0.72):
    target = normalize_title(target_title)
    if not target:
        return None, 0.0

    best = None
    best_score = 0.0
    for candidate in candidates:
        candidate_title = normalize_title(candidate.get("title"))
        if not candidate_title:
            continue
        if candidate_title == target or candidate_title in target or target in candidate_title:
            score = 0.99
        else:
            score = SequenceMatcher(None, target, candidate_title).ratio()
        if score > best_score:
            best = candidate
            best_score = score

    if best_score >= threshold:
        return best, best_score
    return None, best_score
