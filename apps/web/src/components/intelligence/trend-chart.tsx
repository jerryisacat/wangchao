// Issue #185 (Plan Task 4.7) — 趋势条形图组件。
// SPEC §5.8 Dashboard：7/30 天事件/类别/实体/来源质量趋势。
// 纯 CSS 条形图，不引入图表库依赖，mobile-first。
// FRONTEND §4.4：移动端单列阅读，无横向滚动，点击区 ≥44px。

import { Badge } from "@/components/ui/badge";

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
      <p className="trend-chart-empty">{emptyMessage}</p>
    );
  }

  const maxValue = Math.max(...buckets.map((b) => b.value), 1);

  return (
    <div className="trend-chart" role="img" aria-label={ariaLabel}>
      {buckets.map((bucket, index) => {
        const widthPercent = Math.max(
          (bucket.value / maxValue) * 100,
          bucket.value > 0 ? 4 : 0,
        );
        return (
          <div className="trend-chart-row" key={`${bucket.label}-${index}`}>
            <span className="trend-chart-label" title={bucket.label}>
              {bucket.label}
            </span>
            <div className="trend-chart-bar-track">
              <div
                className="trend-chart-bar"
                style={{ width: `${widthPercent}%` }}
              />
            </div>
            <span className="trend-chart-value">{bucket.value}</span>
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
    return <p className="trend-chart-empty">该时间窗口内暂无事件。</p>;
  }

  const maxValue = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <div className="daily-trend-chart" role="img" aria-label={ariaLabel}>
      <div className="daily-trend-chart-bars">
        {buckets.map((bucket) => {
          const heightPercent = Math.max(
            (bucket.count / maxValue) * 100,
            bucket.count > 0 ? 4 : 0,
          );
          const shortDate = bucket.date.slice(5); // MM-DD
          return (
            <div
              className="daily-trend-chart-bar-wrapper"
              key={bucket.date}
              title={`${bucket.date}: ${bucket.count} 个事件`}
            >
              <div className="daily-trend-chart-bar-track">
                <div
                  className="daily-trend-chart-bar"
                  style={{ height: `${heightPercent}%` }}
                />
              </div>
              <span className="daily-trend-chart-label">{shortDate}</span>
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
    return <p className="trend-chart-empty">该主题暂无信源。</p>;
  }

  return (
    <div className="source-health-list">
      {sources.map((source) => (
        <div className="source-health-row" key={source.sourceId}>
          <div className="source-health-header">
            <span className="source-health-name">{source.name}</span>
            <Badge variant={STATUS_VARIANTS[source.status] ?? "muted"}>
              {STATUS_LABELS[source.status] ?? source.status}
            </Badge>
          </div>
          <div className="source-health-metrics">
            <div className="source-health-metric">
              <span className="source-health-metric-label">质量分</span>
              <span className="source-health-metric-value">
                {formatScore(source.qualityScore)}
              </span>
            </div>
            <div className="source-health-metric">
              <span className="source-health-metric-label">命中率</span>
              <span className="source-health-metric-value">
                {formatPercent(source.hitRate)}
              </span>
            </div>
            <div className="source-health-metric">
              <span className="source-health-metric-label">噪音率</span>
              <span className="source-health-metric-value">
                {formatPercent(source.noiseRate)}
              </span>
            </div>
            <div className="source-health-metric">
              <span className="source-health-metric-label">事件数</span>
              <span className="source-health-metric-value">
                {source.eventCount}
              </span>
            </div>
            <div className="source-health-metric">
              <span className="source-health-metric-label">抓取条目</span>
              <span className="source-health-metric-value">
                {source.totalItems}
              </span>
            </div>
            <div className="source-health-metric">
              <span className="source-health-metric-label">最近抓取</span>
              <span className="source-health-metric-value">
                {formatDate(source.lastFetchedAt)}
              </span>
            </div>
          </div>
          {source.consecutiveFailures > 0 ? (
            <p className="source-health-warning">
              连续失败 {source.consecutiveFailures} 次
              {source.lastError ? `：${source.lastError}` : ""}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}