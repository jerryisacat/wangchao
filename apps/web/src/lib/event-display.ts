export interface EventDisplayFields {
  explanation: string;
  primaryItemUrl: string;
  summary: string;
}

interface ExtractedRssSummary {
  articleUrl: string;
  commentsCount: string;
  commentsUrl: string;
  points: string;
}

export function buildEventDisplayFields(input: {
  explanation?: string | null;
  primaryItemUrl?: string | null;
  summary: string;
  title?: string | null;
}): EventDisplayFields {
  const extracted = extractRssSummary(input.summary);

  return {
    explanation: formatEventExplanation(input.explanation ?? ""),
    primaryItemUrl: extracted?.articleUrl ?? input.primaryItemUrl ?? "",
    summary: formatEventSummary(input.summary, extracted, input.title ?? ""),
  };
}

function formatEventSummary(
  rawSummary: string,
  extracted: ExtractedRssSummary | null,
  title: string,
): string {
  if (extracted) {
    const cleaned = stripHtml(rawSummary)
      .replace(/Article URL:\s*[^\n]+/gi, " ")
      .replace(/Comments URL:\s*[^\n]+/gi, " ")
      .replace(/Points:\s*[^\n]+/gi, " ")
      .replace(/#\s*Comments:\s*[^\n]+/gi, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned) {
      return truncateText(cleaned, 220);
    }

    return title.trim() || "AI 摘要待生成，可点击“原文”查看完整内容。";
  }

  const plainText = stripHtml(rawSummary);
  const withoutBareUrls = plainText
    .replace(/Article URL:\s*https?:\/\/\S+/gi, " ")
    .replace(/Comments URL:\s*https?:\/\/\S+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!withoutBareUrls) {
    return title.trim() || "AI 摘要待生成，可点击“原文”查看完整内容。";
  }

  return truncateText(withoutBareUrls, 220);
}

function formatEventExplanation(rawExplanation: string): string {
  const matchedKeywords = rawExplanation.match(/Matched topic keywords:\s*([^.]+)\./i)?.[1];

  if (matchedKeywords) {
    return `命中主题关键词：${matchedKeywords.trim()}`;
  }

  if (/Matched default relevance threshold/i.test(rawExplanation)) {
    return "达到默认相关性阈值。";
  }

  return stripHtml(rawExplanation);
}

function extractRssSummary(rawSummary: string): ExtractedRssSummary | null {
  if (!/Article URL:/i.test(rawSummary)) {
    return null;
  }

  return {
    articleUrl: extractLabeledUrl(rawSummary, "Article URL"),
    commentsCount: rawSummary.match(/#\s*Comments:\s*([^<\n]+)/i)?.[1]?.trim() ?? "",
    commentsUrl: extractLabeledUrl(rawSummary, "Comments URL"),
    points: rawSummary.match(/Points:\s*([^<\n]+)/i)?.[1]?.trim() ?? "",
  };
}

function extractLabeledUrl(rawSummary: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linkMatch = rawSummary.match(
    new RegExp(`${escapedLabel}:\\s*<a\\b[^>]*href=["']([^"']+)["'][^>]*>`, "i"),
  );
  if (linkMatch?.[1] && isHttpUrl(linkMatch[1])) {
    return decodeHtmlEntities(linkMatch[1]);
  }

  const bareMatch = rawSummary.match(
    new RegExp(`${escapedLabel}:\\s*(https?:\\/\\/\\S+)`, "i"),
  );
  if (bareMatch?.[1]) {
    const url = bareMatch[1].replace(/[),.;]+$/, "");
    return isHttpUrl(url) ? decodeHtmlEntities(url) : "";
  }

  return "";
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
