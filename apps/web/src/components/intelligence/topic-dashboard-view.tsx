"use client";

// Issue #185 (Plan Task 4.7) — 主题 Dashboard 客户端组件。
// SPEC §5.8 Dashboard：每主题一个页面，整合未读 Top、已读/收藏、趋势、信源健康、最近简报。
// 7/30 天趋势切换 tabs（移动端可横向滚动，≥44px touch target）。

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
    <div className="topic-dashboard">
      {/* 未读 Top */}
      <section className="topic-dashboard-section">
        <Card variant="work">
          <CardHeader>
            <CardTitle>
              <Inbox aria-hidden="true" size={16} />
              <span>未读 Top · {dashboard.unreadTop.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.unreadTop.length === 0 ? (
              <EmptyState
                description="所有未读情报已处理完毕。"
                icon={<Inbox aria-hidden="true" size={18} />}
                title="暂无未读情报"
              />
            ) : (
              <div className="intelligence-feed">
                {dashboard.unreadTop.map((event) => (
                  <IntelligenceCard
                    event={event}
                    eventStateAction={eventStateAction}
                    key={event.eventId}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* 收藏事件 */}
      <section className="topic-dashboard-section">
        <Card variant="work">
          <CardHeader>
            <CardTitle>
              <span>收藏 · {dashboard.savedTotal}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.savedEvents.length === 0 ? (
              <EmptyState
                description="收藏的情报会出现在这里。"
                icon={<Inbox aria-hidden="true" size={18} />}
                title="暂无收藏"
              />
            ) : (
              <div className="intelligence-feed">
                {dashboard.savedEvents.map((event) => (
                  <IntelligenceCard
                    event={event}
                    eventStateAction={eventStateAction}
                    key={event.eventId}
                  />
                ))}
              </div>
            )}
            {dashboard.savedTotal > dashboard.savedEvents.length ? (
              <p className="topic-dashboard-more">
                共 {dashboard.savedTotal} 条收藏，显示前 {dashboard.savedEvents.length} 条。
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {/* 趋势 */}
      <section className="topic-dashboard-section">
        <Card variant="work">
          <CardHeader>
            <CardTitle>
              <TrendingUp aria-hidden="true" size={16} />
              <span>趋势分析</span>
            </CardTitle>
            <div className="trend-range-tabs" role="tablist" aria-label="趋势时间范围">
              <button
                type="button"
                role="tab"
                aria-selected={trendRange === "7"}
                data-active={trendRange === "7"}
                className="trend-range-tab"
                onClick={() => setTrendRange("7")}
              >
                7 天
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={trendRange === "30"}
                data-active={trendRange === "30"}
                className="trend-range-tab"
                onClick={() => setTrendRange("30")}
              >
                30 天
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="trend-summary">
              <span>总事件数：{trend.totalEvents}</span>
            </div>

            <div className="trend-subsection">
              <h4 className="trend-subsection-title">每日事件趋势</h4>
              <DailyTrendChart
                buckets={trend.dailyBuckets}
                ariaLabel={`${trendRange} 天每日事件趋势`}
              />
            </div>

            <div className="trend-subsection">
              <h4 className="trend-subsection-title">类别分布</h4>
              <TrendBarChart
                buckets={trend.categoryBuckets.map((b) => ({
                  label: b.category,
                  value: b.count,
                }))}
                emptyMessage="该时间窗口内暂无类别数据。"
                ariaLabel={`${trendRange} 天类别分布`}
              />
            </div>

            <div className="trend-subsection">
              <h4 className="trend-subsection-title">实体热度</h4>
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
              <div className="trend-subsection">
                <h4 className="trend-subsection-title">来源质量趋势</h4>
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
      <section className="topic-dashboard-section">
        <Card variant="work">
          <CardHeader>
            <CardTitle>信源健康</CardTitle>
          </CardHeader>
          <CardContent>
            <SourceHealthList sources={dashboard.sourceHealth} />
          </CardContent>
        </Card>
      </section>

      {/* 最近简报 */}
      <section className="topic-dashboard-section">
        <Card variant="work">
          <CardHeader>
            <CardTitle>
              <FileText aria-hidden="true" size={16} />
              <span>最近简报 · {dashboard.recentBriefings.length}</span>
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
              <div className="topic-dashboard-briefings">
                {dashboard.recentBriefings.map((briefing) => (
                  <div className="topic-dashboard-briefing-row" key={briefing.briefingId}>
                    <div className="topic-dashboard-briefing-info">
                      <Link href={`/briefings/${briefing.briefingId}`}>
                        <span className="topic-dashboard-briefing-title">
                          {briefing.title}
                        </span>
                      </Link>
                      <div className="topic-dashboard-briefing-meta">
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
                    <Button asChild size="sm" variant="ghost">
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