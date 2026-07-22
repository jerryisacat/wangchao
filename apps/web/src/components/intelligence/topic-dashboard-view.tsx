"use client";

// Issue #185 (Plan Task 4.7) — 主题 Dashboard 客户端组件。
// SPEC §5.8 Dashboard：每主题一个页面，整合未读 Top、已读/收藏、趋势、信源健康、最近简报。
// 7/30 天趋势切换 tabs（移动端自然换行，≥44px touch target）。

import { FileText, Inbox, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { IntelligenceCard } from "@/components/intelligence/intelligence-card";
import {
  DailyTrendChart,
  SourceHealthList,
  TrendBarChart,
} from "@/components/intelligence/trend-chart";
import type {
  DashboardEventSummary,
  TopicDashboardData,
} from "@/lib/topic-source-data";

interface TopicDashboardViewProps {
  dashboard: TopicDashboardData;
  eventStateAction: (formData: FormData) => void;
}

type TrendRange = "7" | "30";

export function TopicDashboardView({
  dashboard,
  eventStateAction,
}: TopicDashboardViewProps) {
  const [trendRange, setTrendRange] = useState<TrendRange>("7");
  const trend = dashboard.trends[trendRange];

  return (
    <div className="grid gap-4">
      {/* 未读 Top */}
      <section className="grid gap-3" aria-labelledby="topic-unread-heading">
        <h2 id="topic-unread-heading" className="flex items-center gap-2 px-1 text-lg font-medium">
          <Inbox aria-hidden="true" size={18} />
          <span>未读 Top · {dashboard.unreadTop.length}</span>
        </h2>
        {dashboard.unreadTop.length === 0 ? (
          <EmptyState
            description="所有未读情报已处理完毕。"
            icon={<Inbox aria-hidden="true" size={18} />}
            title="暂无未读情报"
          />
        ) : (
          <div className="grid gap-3">
            {dashboard.unreadTop.map((event) => (
              <IntelligenceCard
                event={event}
                eventStateAction={eventStateAction}
                key={event.eventId}
                returnTo={`/topics/${dashboard.topic.id}`}
              />
            ))}
          </div>
        )}
      </section>

      {/* 收藏事件 */}
      <section className="grid gap-3" aria-labelledby="topic-saved-heading">
        <h2 id="topic-saved-heading" className="px-1 text-lg font-medium">
          收藏 · {dashboard.savedTotal}
        </h2>
        {dashboard.savedEvents.length === 0 ? (
          <EmptyState
            description="收藏的情报会出现在这里。"
            icon={<Inbox aria-hidden="true" size={18} />}
            title="暂无收藏"
          />
        ) : (
          <div className="grid gap-3">
            {dashboard.savedEvents.map((event) => (
              <IntelligenceCard
                event={event}
                eventStateAction={eventStateAction}
                key={event.eventId}
                returnTo={`/topics/${dashboard.topic.id}`}
              />
            ))}
          </div>
        )}
        {dashboard.savedTotal > dashboard.savedEvents.length ? (
          <p className="px-1 text-sm leading-relaxed text-muted-foreground">
            共 {dashboard.savedTotal} 条收藏，当前显示前 {dashboard.savedEvents.length} 条。
          </p>
        ) : null}
      </section>

      {/* 趋势 */}
      <section aria-labelledby="topic-trend-heading">
        <Card variant="work">
          <CardHeader className="gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:grid-rows-1 sm:items-center">
            <CardTitle>
              <h2 className="flex items-center gap-2" id="topic-trend-heading">
                <TrendingUp aria-hidden="true" size={16} />
                <span>趋势分析</span>
              </h2>
            </CardTitle>
            <div className="flex flex-wrap gap-1 sm:justify-end" role="tablist" aria-label="趋势时间范围">
              <Button
                role="tab"
                aria-selected={trendRange === "7"}
                data-active={trendRange === "7"}
                onClick={() => setTrendRange("7")}
                size="sm"
                type="button"
                variant={trendRange === "7" ? "secondary" : "ghost"}
              >
                7 天
              </Button>
              <Button
                role="tab"
                aria-selected={trendRange === "30"}
                data-active={trendRange === "30"}
                onClick={() => setTrendRange("30")}
                size="sm"
                type="button"
                variant={trendRange === "30" ? "secondary" : "ghost"}
              >
                30 天
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="rounded-[16px] bg-muted px-4 py-3 text-sm text-muted-foreground">
              总事件数：<strong className="font-medium tabular-nums text-foreground">{trend.totalEvents}</strong>
            </div>

            <div className="grid gap-3">
              <h3 className="text-sm font-medium">每日事件趋势</h3>
              <DailyTrendChart
                buckets={trend.dailyBuckets}
                ariaLabel={`${trendRange} 天每日事件趋势`}
              />
            </div>

            <div className="grid gap-3">
              <h3 className="text-sm font-medium">类别分布</h3>
              <TrendBarChart
                buckets={trend.categoryBuckets.map((b) => ({
                  label: b.category,
                  value: b.count,
                }))}
                emptyMessage="该时间窗口内暂无类别数据。"
                ariaLabel={`${trendRange} 天类别分布`}
              />
            </div>

            <div className="grid gap-3">
              <h3 className="text-sm font-medium">实体热度</h3>
              <TrendBarChart
                buckets={trend.entityBuckets.map((b) => ({
                  label: b.entity,
                  value: b.count,
                }))}
                emptyMessage="该时间窗口内暂无实体数据。"
                ariaLabel={`${trendRange} 天实体热度`}
              />
            </div>

            {trend.sourceQuality.length > 0 ? (
              <div className="grid gap-3">
                <h3 className="text-sm font-medium">来源质量趋势</h3>
                <TrendBarChart
                  buckets={trend.sourceQuality.map((s) => ({
                    label: s.sourceName,
                    value: s.eventCount,
                  }))}
                  emptyMessage="该时间窗口内暂无来源质量数据。"
                  ariaLabel={`${trendRange} 天来源质量`}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {/* 信源健康 */}
      <section aria-labelledby="topic-source-health-heading">
        <Card variant="work">
          <CardHeader>
            <CardTitle>
              <h2 id="topic-source-health-heading">信源健康</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SourceHealthList sources={dashboard.sourceHealth} />
          </CardContent>
        </Card>
      </section>

      {/* 最近简报 */}
      <section aria-labelledby="topic-briefings-heading">
        <Card variant="work">
          <CardHeader>
            <CardTitle>
              <h2 className="flex items-center gap-2" id="topic-briefings-heading">
                <FileText aria-hidden="true" size={16} />
                <span>最近简报 · {dashboard.recentBriefings.length}</span>
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.recentBriefings.length === 0 ? (
              <EmptyState
                description="系统生成简报后会出现在这里。"
                icon={<FileText aria-hidden="true" size={18} />}
                title="暂无简报"
              />
            ) : (
              <div className="grid gap-2">
                {dashboard.recentBriefings.map((briefing) => (
                  <div className="grid min-w-0 gap-2 rounded-[16px] bg-muted p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={briefing.briefingId}>
                    <div className="min-w-0">
                      <Link
                        className="flex min-h-11 min-w-0 items-center rounded-[12px] px-2 font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        href={`/briefings/${briefing.briefingId}`}
                      >
                        <span className="min-w-0 [overflow-wrap:anywhere]">{briefing.title}</span>
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2 px-2 text-xs text-muted-foreground">
                        <Badge variant="outline">
                          {briefing.period === "DAILY"
                            ? "日报"
                            : briefing.period === "WEEKLY"
                              ? "周报"
                              : "月报"}
                        </Badge>
                        <time dateTime={briefing.generatedAt}>
                          {new Intl.DateTimeFormat("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(briefing.generatedAt))}
                        </time>
                      </div>
                    </div>
                    <Button asChild className="w-full sm:w-auto" size="sm" variant="ghost">
                      <Link href={`/briefings/${briefing.briefingId}`}>
                        查看
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
