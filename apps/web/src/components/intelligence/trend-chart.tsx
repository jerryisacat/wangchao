// Issue #185 (Plan Task 4.7) — 趋势条形图组件。
// SPEC §5.8 Dashboard：7/30 天事件/类别/实体/来源质量趋势。
// 纯 CSS 条形图，不引入图表库依赖，mobile-first。
// FRONTEND §4.4：移动端单列阅读，无横向滚动，点击区 ≥44px。

import { Badge } from "@/components/ui/badge";
import { decodeHtmlEntities } from "@/lib/display-text";

interface TrendBarChartProps {
  buckets: Array<{ label: string; value: number }>;
  emptyMessage: string;
  ariaLabel: string;
}

/**
 * 纯 CSS 横向条形图。
 * 每个条形按相对最大值归一化宽度。
 * 空数据显示 emptyMessage。
 */
export function TrendBarChart({
  buckets,
  emptyMessage,
  ariaLabel,
}: TrendBarChartProps) {
  if (buckets.length === 0) {
    return (
      <p className="rounded-[16px] bg-muted p-4 text-sm text-muted-foreground">{emptyMessage}</p>
    );
  }

  const maxValue = Math.max(...buckets.map((b) => b.value), 1);

  return (
    <div className="grid gap-3" role="img" aria-label={ariaLabel}>
      {buckets.map((bucket, index) => {
        const widthPercent = Math.max(
          (bucket.value / maxValue) * 100,
          bucket.value > 0 ? 4 : 0,
        );
        return (
          <div className="grid min-w-0 grid-cols-[minmax(72px,0.45fr)_minmax(0,1fr)_auto] items-center gap-2" key={`${bucket.label}-${index}`}>
            <span className="truncate text-sm text-muted-foreground" title={bucket.label}>
              {bucket.label}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${widthPercent}%` }}
              />
            </div>
            <span className="text-sm font-medium tabular-nums">{bucket.value}</span>
          </div>
        );
      })}
    </div>
  );
}

interface DailyTrendChartProps {
  buckets: Array<{ date: string; count: number }>;
  ariaLabel: string;
}

/**
 * 每日事件趋势柱状图。
 * 竖向柱形，按日期排列，归一化高度。
 * 空日期显示零高度占位。
 */
export function DailyTrendChart({ buckets, ariaLabel }: DailyTrendChartProps) {
  if (buckets.length === 0) {
    return <p className="rounded-[16px] bg-muted p-4 text-sm text-muted-foreground">该时间窗口内暂无事件。</p>;
  }

  const maxValue = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <div className="min-w-0" role="img" aria-label={ariaLabel}>
      <div className="flex h-36 min-w-0 items-end gap-2 border-b border-border pb-2">
        {buckets.map((bucket) => {
          const heightPercent = Math.max(
            (bucket.count / maxValue) * 100,
            bucket.count > 0 ? 4 : 0,
          );
          const shortDate = bucket.date.slice(5); // MM-DD
          return (
            <div
              className="flex h-full min-w-0 flex-1 flex-col items-center gap-2"
              key={bucket.date}
              title={`${bucket.date}: ${bucket.count} 个事件`}
            >
              <div className="relative w-full flex-1 overflow-hidden rounded-t-[8px] bg-muted">
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t-[8px] bg-primary"
                  style={{ height: `${heightPercent}%` }}
                />
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">{shortDate}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface SourceHealthListProps {
  sources: Array<{
    sourceId: string;
    name: string;
    status: "ACTIVE" | "CANDIDATE" | "MUTED" | "REJECTED";
    qualityScore: number;
    hitRate: number;
    noiseRate: number;
    duplicateRate: number;
    totalItems: number;
    eventCount: number;
    lastFetchedAt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
  }>;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "活跃",
  CANDIDATE: "候选",
  MUTED: "静音",
  REJECTED: "拒绝",
};

const STATUS_VARIANTS: Record<
  string,
  "success" | "warning" | "muted" | "danger"
> = {
  ACTIVE: "success",
  CANDIDATE: "warning",
  MUTED: "muted",
  REJECTED: "danger",
};

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatScore(value: number): string {
  return value.toFixed(2);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function SourceHealthList({ sources }: SourceHealthListProps) {
  if (sources.length === 0) {
    return <p className="rounded-[16px] bg-muted p-4 text-sm text-muted-foreground">该主题暂无信源。</p>;
  }

  return (
    <div className="divide-y divide-border">
      {sources.map((source) => (
        <div className="grid gap-3 py-4 first:pt-0 last:pb-0" key={source.sourceId}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
              {decodeHtmlEntities(source.name)}
            </span>
            <Badge variant={STATUS_VARIANTS[source.status] ?? "muted"}>
              {STATUS_LABELS[source.status] ?? source.status}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-[16px] bg-muted p-3">
              <span className="block text-xs text-muted-foreground">质量分</span>
              <span className="mt-1 block font-medium tabular-nums">
                {formatScore(source.qualityScore)}
              </span>
            </div>
            <div className="rounded-[16px] bg-muted p-3">
              <span className="block text-xs text-muted-foreground">命中率</span>
              <span className="mt-1 block font-medium tabular-nums">
                {formatPercent(source.hitRate)}
              </span>
            </div>
            <div className="rounded-[16px] bg-muted p-3">
              <span className="block text-xs text-muted-foreground">噪音率</span>
              <span className="mt-1 block font-medium tabular-nums">
                {formatPercent(source.noiseRate)}
              </span>
            </div>
            <div className="rounded-[16px] bg-muted p-3">
              <span className="block text-xs text-muted-foreground">事件数</span>
              <span className="mt-1 block font-medium tabular-nums">
                {source.eventCount}
              </span>
            </div>
            <div className="rounded-[16px] bg-muted p-3">
              <span className="block text-xs text-muted-foreground">抓取条目</span>
              <span className="mt-1 block font-medium tabular-nums">
                {source.totalItems}
              </span>
            </div>
            <div className="rounded-[16px] bg-muted p-3">
              <span className="block text-xs text-muted-foreground">最近抓取</span>
              <span className="mt-1 block text-sm font-medium tabular-nums">
                {formatDate(source.lastFetchedAt)}
              </span>
            </div>
          </div>
          {source.consecutiveFailures > 0 ? (
            <p className="rounded-[16px] bg-warning/10 p-3 text-sm leading-6 text-warning">
              连续失败 {source.consecutiveFailures} 次
              {source.lastError
                ? `：${decodeHtmlEntities(source.lastError)}`
                : ""}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
