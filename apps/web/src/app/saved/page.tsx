import {
  Bookmark,
  Check,
  ExternalLink,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { updateDashboardEventStateAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { getSavedEventsPage } from "@/lib/topic-source-data";

export const dynamic = "force-dynamic";

interface SavedPageProps {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function SavedPage({ searchParams }: SavedPageProps) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const savedPage = await getSavedEventsPage(readPage(resolvedSearchParams.page));
  const savedEvents = savedPage.events;

  return (
    <>
      <PageHeader eyebrow="已收藏" title="已保存情报">
        <Button asChild size="sm" variant="ghost">
          <Link href="/">← 返回情报流</Link>
        </Button>
      </PageHeader>

      <div>
        <Card variant="work">
          <CardHeader>
            <CardTitle>收藏列表 · {savedPage.total}</CardTitle>
          </CardHeader>
          <CardContent>
            {savedEvents.length === 0 ? (
              <EmptyState
                description="在情报流中收藏的信息会出现在这里。"
                icon={<Bookmark aria-hidden="true" size={18} />}
                title="暂无收藏"
              />
            ) : (
              <div className="event-list">
                {savedEvents.map((event) => (
                  <article className="event-row saved-event-row" key={event.eventId}>
                    <div className="event-copy">
                      <div className="event-copy-header">
                        <Badge className="event-topic-badge" variant="default">
                          {event.topicName}
                        </Badge>
                        <span className="event-copy-meta">
                          {event.sourceName} · {formatDateTime(event.occurredAt)}
                        </span>
                      </div>
                      <h3>
                        <Link href={`/events/${event.eventId}`}>{event.title}</Link>
                      </h3>
                      <div className="event-summary">{event.summary}</div>
                      {event.explanation ? (
                        <div className="event-reason">
                          <Sparkles aria-hidden="true" size={13} />
                          {event.explanation}
                        </div>
                      ) : null}
                    </div>
                    <div className="event-actions">
                      <Badge variant="accent">已收藏</Badge>
                      <form action={updateDashboardEventStateAction}>
                        <input name="eventId" type="hidden" value={event.eventId} />
                        <input name="returnTo" type="hidden" value="/saved" />
                        <button
                          aria-label="标记已读"
                          className="icon-action"
                          name="action"
                          title="标记已读"
                          type="submit"
                          value="read"
                        >
                          <Check aria-hidden="true" size={14} />
                          <span>已读</span>
                        </button>
                      </form>
                      <form action={updateDashboardEventStateAction}>
                        <input name="eventId" type="hidden" value={event.eventId} />
                        <input name="returnTo" type="hidden" value="/saved" />
                        <button
                          aria-label="取消收藏"
                          className="icon-action"
                          name="action"
                          title="取消收藏"
                          type="submit"
                          value="unsave"
                        >
                          <X aria-hidden="true" size={14} />
                          <span>取消收藏</span>
                        </button>
                      </form>
                      {event.primaryItemUrl ? (
                        <a
                          aria-label="查看原文"
                          className="icon-action"
                          href={event.primaryItemUrl}
                          rel="noreferrer"
                          target="_blank"
                          title="查看原文"
                        >
                          <ExternalLink aria-hidden="true" size={14} />
                          <span>原文</span>
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
            {savedPage.total > 0 ? (
              <nav aria-label="收藏分页" className="saved-pagination">
                <span>
                  第 {savedPage.page} / {savedPage.pageCount} 页
                </span>
                <div className="saved-pagination-actions">
                  {savedPage.page > 1 ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={savedPageHref(savedPage.page - 1)}>上一页</Link>
                    </Button>
                  ) : null}
                  {savedPage.page < savedPage.pageCount ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={savedPageHref(savedPage.page + 1)}>下一页</Link>
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

function savedPageHref(page: number): string {
  return page <= 1 ? "/saved" : `/saved?page=${page}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}
