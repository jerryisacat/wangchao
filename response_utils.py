import json
import re
from difflib import SequenceMatcher
from typing import Any, Iterable

FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.IGNORECASE | re.DOTALL)
THINKING_TAG_RE = re.compile(r"<(thinking|reasoning)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
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
    return None


def sanitize_text(text: str | None) -> str | None:
    if text is None:
        return None
    text = text.translate(SMART_PUNCT_TRANSLATION)
    text = ZERO_WIDTH_RE.sub("", text)
    text = CONTROL_RE.sub("", text)
    return text.strip()


def extract_json_blob(text: str) -> str:
    text = sanitize_text(text) or ""
    text = THINKING_TAG_RE.sub("", text)
    fence_match = FENCE_RE.search(text)
    if fence_match:
        text = fence_match.group(1).strip()
    return text.strip()


def _extract_json_object_candidates(text: str) -> list[str]:
    text = extract_json_blob(text)
    candidates = []
    start_indices = [i for i, ch in enumerate(text) if ch == '{']

    for start in start_indices:
        depth = 0
        in_string = False
        escape = False
        for idx in range(start, len(text)):
            ch = text[idx]
            if in_string:
                if escape:
                    escape = False
                elif ch == '\\':
                    escape = True
                elif ch == '"':
                    in_string = False
                continue

            if ch == '"':
                in_string = True
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    candidate = text[start:idx + 1].strip()
                    if candidate:
                        candidates.append(candidate)
                    break

    if text and text not in candidates:
        candidates.append(text)
    return candidates


def _repair_common_json_issues(text: str) -> str:
    repaired = text
    # Remove trailing commas before } or ]
    repaired = re.sub(r",\s*([}\]])", r"\1", repaired)
    # Quote common unquoted keys after { or ,
    repaired = re.sub(r'([\{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)', r'\1"\2"\3', repaired)
    # Normalize null-ish bare blanks for context/sources-ish fields if model emitted empty values
    repaired = re.sub(r'(:\s*)(?=,|}|\])', r'\1null', repaired)
    return repaired


def _score_parsed_json_candidate(obj: Any) -> int:
    if not isinstance(obj, dict):
        return 0

    score = 1
    if any(k in obj for k in ("AI_Algorithms", "Aerospace_HardTech", "Major_Industry_Moves")):
        score += 10
    if "feed" in obj:
        score += 10
    if any(k in obj for k in ("id", "title", "score", "context", "title_optimized", "technical_summary", "category")):
        score += 2
    return score


def parse_json_response(text: str) -> tuple[Any | None, str]:
    candidates = _extract_json_object_candidates(text)
    if not candidates:
        return None, ""

    seen = set()
    repaired_fallback = ""
    parsed_candidates = []

    for raw_candidate in candidates:
        for candidate in (raw_candidate, _repair_common_json_issues(raw_candidate)):
            if candidate in seen:
                continue
            seen.add(candidate)
            repaired_fallback = candidate
            try:
                obj = json.loads(candidate)
                parsed_candidates.append((candidate, obj))
            except json.JSONDecodeError:
                continue

    if not parsed_candidates:
        return None, repaired_fallback

    parsed_candidates.sort(key=lambda item: (_score_parsed_json_candidate(item[1]), candidates.index(item[0]) if item[0] in candidates else -1))
    best_candidate, best_obj = parsed_candidates[-1]
    return best_obj, best_candidate


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
