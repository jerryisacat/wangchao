import { getSummaryDisplay } from "../src/lib/summary-status.ts";
import { decodeHtmlEntities, formatCategoryLabel } from "../src/lib/display-text.ts";

const ready = getSummaryDisplay("READY", "这是已经生成的摘要。");
if (!ready.available || ready.text !== "这是已经生成的摘要。") {
  throw new Error("READY summary should render stored content.");
}

const failed = getSummaryDisplay("CONTENT_FETCH_FAILED", "");
if (failed.available || !failed.text.includes("原文采集失败") || !failed.text.includes("打开原文")) {
  throw new Error("Capture failure should be explicit while preserving the original-link instruction.");
}

const aiFailed = getSummaryDisplay("AI_FAILED", "stale summary must not render");
if (aiFailed.available || !aiFailed.text.includes("AI 摘要生成失败")) {
  throw new Error("AI failure must not render stale summary content.");
}

const decodedEntities = decodeHtmlEntities(
  "What&#039;s &amp; What&#x27;s &quot;new&quot;&nbsp;today",
);
if (decodedEntities !== 'What\'s & What\'s "new" today') {
  throw new Error(`Common named, padded and hexadecimal entities should decode: ${decodedEntities}`);
}

if (formatCategoryLabel("keyword:AI&#039;s future") !== "关键词 · AI's future") {
  throw new Error("Internal event categories should render as localized, decoded labels.");
}
