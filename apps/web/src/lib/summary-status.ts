export type EventSummaryStatus =
  | "PENDING"
  | "READY"
  | "CONTENT_FETCH_FAILED"
  | "CONTENT_INSUFFICIENT"
  | "CONTENT_UNSUPPORTED"
  | "AI_FAILED";

export interface SummaryDisplay {
  available: boolean;
  text: string;
}

export function getSummaryDisplay(
  status: EventSummaryStatus,
  summary: string,
): SummaryDisplay {
  if (status === "READY" && summary.trim()) {
    return { available: true, text: summary.trim() };
  }

  const messages: Record<Exclude<EventSummaryStatus, "READY">, string> = {
    PENDING: "正在等待原文采集，暂时无法生成摘要。你仍可打开原文查看。",
    CONTENT_FETCH_FAILED: "原文采集失败，暂时无法生成摘要。你仍可打开原文查看。",
    CONTENT_INSUFFICIENT: "采集到的原文内容不足，暂时无法生成摘要。你仍可打开原文查看。",
    CONTENT_UNSUPPORTED: "当前暂不支持自动采集该平台，无法生成摘要。你仍可打开原文查看。",
    AI_FAILED: "原文已采集，但 AI 摘要生成失败。你仍可打开原文查看或重新生成。",
  };

  return {
    available: false,
    text: status === "READY" ? "摘要暂不可用，你仍可打开原文查看。" : messages[status],
  };
}
