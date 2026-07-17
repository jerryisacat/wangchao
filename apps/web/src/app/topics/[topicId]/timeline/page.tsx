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
              <div className="divide-y divide-border">
                {timeline.events.map((event) => (
                  <article className="grid grid-cols-1 items-start gap-2 py-3.5 transition-colors hover:bg-primary/5 md:grid-cols-[minmax(0,0.3fr)_minmax(0,1fr)] md:gap-4" key={event.eventId}>
                    <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                      <Clock3 aria-hidden="true" size={14} />
                      <time dateTime={event.occurredAt ?? undefined}>
                        {event.occurredAt
                          ? new Intl.DateTimeFormat("zh-CN", {
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            }).format(new Date(event.occurredAt))
                          : "未知时间"}
                      </time>
                    </div>
                    <div className="grid min-w-0 gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/events/${event.eventId}`} className="text-foreground transition-colors hover:text-accent">
                          <h3 className="m-0 text-[15px] font-bold leading-[1.35] [overflow-wrap:anywhere]">{event.title}</h3>
                        </Link>
                        {event.category ? <Badge variant="outline">{event.category}</Badge> : null}
                      </div>
                      <p className="m-0 line-clamp-3 text-sm leading-[1.5] text-muted-foreground [overflow-wrap:anywhere]">{event.summary}</p>
                      <div className="flex flex-wrap gap-3 font-mono text-[11px] text-muted-foreground">
                        <span>来源: {event.sourceName ?? "Unknown"}</span>
                        {event.url ? (
                          <a href={event.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                            原文
                          </a>
                        ) : null}
                        {event.secondarySources.length > 0 ? (
                          <span className="[overflow-wrap:anywhere]">
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
              <nav aria-label="时间线分页" className="mt-4 flex min-h-11 items-center justify-between gap-3 border-t border-border pt-3 text-sm text-muted-foreground">
                <span>
                  第 {timeline.page} / {timeline.pageCount} 页
                </span>
                <div className="flex gap-2">
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
