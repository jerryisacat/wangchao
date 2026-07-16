import { getSummaryDisplay } from "../src/lib/summary-status.ts";

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
