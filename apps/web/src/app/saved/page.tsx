import {
  ArrowLeft,
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
import { decodeHtmlEntities, normalizeKnownExplanation } from "@/lib/display-text";

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
          <Link href="/">
            <ArrowLeft aria-hidden="true" size={14} />
            返回情报流
          </Link>
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
              <div className="divide-y divide-border">
                {savedEvents.map((event) => (
                  <article
                    className="grid items-start gap-3 py-4 transition-colors hover:bg-primary/5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]"
                    key={event.eventId}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge
                          className="max-w-full min-w-0 truncate"
                          variant="default"
                        >
                          {decodeHtmlEntities(event.topicName)}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {decodeHtmlEntities(event.sourceName)} · {formatDateTime(event.occurredAt)}
                        </span>
                      </div>
                      <h3 className="m-0 mt-1.5 break-words text-base font-medium leading-snug line-clamp-2">
                        <Link
                          className="flex min-h-11 min-w-0 items-center rounded-[10px] text-foreground [overflow-wrap:anywhere] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          href={`/events/${event.eventId}`}
                        >
                          {decodeHtmlEntities(event.title)}
                        </Link>
                      </h3>
                      <div className="mt-1.5 text-sm leading-relaxed line-clamp-3">
                        {decodeHtmlEntities(event.summary)}
                      </div>
                      {event.explanation ? (
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-[16px] bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
                          <Sparkles aria-hidden="true" size={13} />
                          <span className="min-w-0 [overflow-wrap:anywhere]">
                            {normalizeKnownExplanation(decodeHtmlEntities(event.explanation))}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
                      <form action={updateDashboardEventStateAction} className="min-w-0">
                        <input name="eventId" type="hidden" value={event.eventId} />
                        <input name="returnTo" type="hidden" value="/saved" />
                        <Button
                          aria-label="标记已读"
                          className="w-full"
                          name="action"
                          size="sm"
                          title="标记已读"
                          type="submit"
                          value="read"
                          variant="ghost"
                        >
                          <Check aria-hidden="true" size={14} />
                          已读
                        </Button>
                      </form>
                      <form action={updateDashboardEventStateAction} className="min-w-0">
                        <input name="eventId" type="hidden" value={event.eventId} />
                        <input name="returnTo" type="hidden" value="/saved" />
                        <Button
                          aria-label="取消收藏"
                          className="w-full"
                          name="action"
                          size="sm"
                          title="取消收藏"
                          type="submit"
                          value="unsave"
                          variant="ghost"
                        >
                          <X aria-hidden="true" size={14} />
                          取消收藏
                        </Button>
                      </form>
                      {event.primaryItemUrl ? (
                        <Button asChild className="col-span-2 w-full sm:w-auto" size="sm" variant="ghost">
                          <a
                            aria-label="查看原文"
                            href={event.primaryItemUrl}
                            rel="noreferrer"
                            target="_blank"
                            title="查看原文"
                          >
                            <ExternalLink aria-hidden="true" size={14} />
                            原文
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
            {savedPage.total > 0 ? (
              <nav
                aria-label="收藏分页"
                className="mt-4 flex min-h-11 items-center justify-between gap-3 border-t border-border pt-3 text-sm text-muted-foreground"
              >
                <span className="font-medium tabular-nums">
                  第 {savedPage.page} / {savedPage.pageCount} 页
                </span>
                <div className="flex flex-wrap justify-end gap-2">
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
