const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const DANGEROUS_TAGS_PATTERN =
  /<(script|iframe|object|embed|link|style|meta)\b[\s\S]*?<\/\1>/gi;

const DANGEROUS_TAGS_SELF_CLOSING_PATTERN =
  /<(script|iframe|object|embed|link|style|meta)\b[^>]*\/?>/gi;

const DANGEROUS_URL_PATTERN = /(javascript|data):/gi;

const EVENT_HANDLER_PATTERN = /\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

export function sanitizeForDisplay(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);
}

export function sanitizeMarkdownSource(text: string): string {
  return text
    .replace(DANGEROUS_TAGS_PATTERN, " ")
    .replace(DANGEROUS_TAGS_SELF_CLOSING_PATTERN, " ")
    .replace(DANGEROUS_URL_PATTERN, "blocked:")
    .replace(EVENT_HANDLER_PATTERN, " ")
    .trim();
}
