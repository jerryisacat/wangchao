export function createContentHash(value: string): string {
  return createEventHash(value).replace("event:", "content:");
}

export function createEventHash(value: string): string {
  let hash = 0x811c9dc5;
  const chars = Array.from(value);
  for (let index = 0; index < chars.length; index += 1) {
    const code = chars[index]!.codePointAt(0) ?? 0;
    hash ^= code & 0xffff;
    hash = Math.imul(hash, 0x01000193);
  }
  return `event:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitleForFuzzyMatch(title: string): string {
  return title
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s*[｜|-–-]\s*[^｜|-–-]*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function createTitleHash(title: string): string {
  return `title:${createEventHash(normalizeTitleForFuzzyMatch(title)).replace("event:", "")}`;
}
