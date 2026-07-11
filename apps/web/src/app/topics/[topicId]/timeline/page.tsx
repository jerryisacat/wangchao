import { ArrowLeft, Clock3, FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { getTopicTimeline } from "@/lib/topic-source-data";

export const dynamic = "force-dynamic";

interface TimelinePageProps {
  params: Promise<{ topicId: string }> | { topicId: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function TopicTimelinePage({ params, searchParams }: TimelinePageProps) {
  const { topicId } = await Promise.resolve(params);
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const page = readPage(resolvedSearchParams.page);

  if (!process.env.DATABASE_URL) {
    return (
      <EmptyState
        description="DATABASE_URL is not configured."
        icon={<Clock3 aria-hidden="true" size={18} />}
        title="无法加载"
      />
    );
  }

  const { getSessionWorkspace } = await import("@/lib/session");
  const { getPrismaClient, getTopicById } = await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();
  const topic = await getTopicById(prisma, {
    organizationId: workspace.organizationId,
    topicId,
  });

  if (!topic) {
    notFound();
  }

  const timeline = await getTopicTimeline(topicId, page);

  return (
    <>
      <PageHeader eyebrow="主题时间线" title={`${topic.name} · 时间线`}>
        <Button asChild size="sm" variant="ghost">
          <Link href={`/topics/${topic.id}`}>
            <ArrowLeft aria-hidden="true" size={14} />
            <span>主题详情</span>
          </Link>
        </Button>
      </PageHeader>

      <div>
        <Card variant="work">
          <CardHeader>
            <CardTitle>事件时间线 · {timeline.total}</CardTitle>
          </CardHeader>
          <CardContent>
            {timeline.events.length === 0 ? (
              <EmptyState
                description="该主题还没有已提取的情报事件，Worker 完成分析后会出现在这里。"
                icon={<FileText aria-hidden="true" size={18} />}
                title="暂无事件"
              />
            ) : (
              <div className="timeline-list">
                {timeline.events.map((event) => (
                  <article className="timeline-event-row" key={event.eventId}>
                    <div className="timeline-event-time">
                      <Clock3 aria-hidden="true" size={14} />
                      <time dateTime={event.occurredAt ?? undefined}>
                        {event.occurredAt
                          ? new Intl.DateTimeFormat("zh-CN", {
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              month: "2-digit",
                            }).format(new Date(event.occurredAt))
                          : "未知时间"}
                      </time>
                    </div>
                    <div className="timeline-event-body">
                      <div className="timeline-event-title-row">
                        <Link href={`/events/${event.eventId}`}>
                          <h3>{event.title}</h3>
                        </Link>
                        {event.category ? <Badge variant="outline">{event.category}</Badge> : null}
                      </div>
                      <p className="timeline-event-summary">{event.summary}</p>
                      <div className="timeline-event-meta">
                        <span>Score: {Math.round(event.score)}</span>
                        <span>来源: {event.sourceName ?? "Unknown"}</span>
                        {event.url ? (
                          <a href={event.url} target="_blank" rel="noopener noreferrer">
                            原文
                          </a>
                        ) : null}
                        {event.secondarySources.length > 0 ? (
                          <span className="timeline-event-merged">
                            联合报道: {event.secondarySources.map((s) => s.sourceName).join(", ")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {timeline.total > 0 ? (
              <nav aria-label="时间线分页" className="timeline-pagination">
                <span>
                  第 {timeline.page} / {timeline.pageCount} 页
                </span>
                <div className="timeline-pagination-actions">
                  {timeline.page > 1 ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={timelinePageHref(topic.id, timeline.page - 1)}>上一页</Link>
                    </Button>
                  ) : null}
                  {timeline.page < timeline.pageCount ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={timelinePageHref(topic.id, timeline.page + 1)}>下一页</Link>
                    </Button>
                  ) : null}
                </div>
              </nav>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function readPage(value: string | string[] | undefined): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const page = Number.parseInt(rawValue ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function timelinePageHref(topicId: string, page: number): string {
  return page <= 1
    ? `/topics/${topicId}/timeline`
    : `/topics/${topicId}/timeline?page=${page}`;
}
