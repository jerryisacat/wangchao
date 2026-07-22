import {
  Archive,
  ArchiveRestore,
  Bookmark,
  Check,
  ExternalLink,
  Eye,
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
import {
  getHistoryEventsPage,
  parseHistoryStatus,
  type HistoryStatus,
} from "@/lib/topic-source-data";

export const dynamic = "force-dynamic";

interface HistoryPageProps {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

const HISTORY_TABS: Array<{ label: string; status: HistoryStatus; icon: typeof Eye }> = [
  { label: "已读", status: "READ", icon: Eye },
  { label: "忽略", status: "DISMISSED", icon: X },
  { label: "收藏", status: "SAVED", icon: Bookmark },
  { label: "归档", status: "ARCHIVED", icon: Archive },
];

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const status = parseHistoryStatus(resolvedSearchParams.status);
  const page = readPage(resolvedSearchParams.page);
  const historyPage = await getHistoryEventsPage(status, page);
  const events = historyPage.events;

  return (
    <>
      <PageHeader eyebrow="历史" title="阅读历史与归档">
        <Button asChild size="sm" variant="ghost">
          <Link href="/app">← 返回情报流</Link>
        </Button>
      </PageHeader>

      <div>
        <Card variant="work">
          <CardHeader className="pb-0">
            <nav
              aria-label="历史状态筛选"
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            >
              {HISTORY_TABS.map((tab) => {
                const Icon = tab.icon;
                const active = tab.status === status;
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-secondary px-3 text-sm font-medium text-secondary-foreground"
                        : "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/5 hover:text-foreground"
                    }
                    href={historyTabHref(tab.status)}
                    key={tab.status}
                  >
                    <Icon aria-hidden="true" size={16} />
                    <span>{tab.label}</span>
                    {active ? (
                      <span
                        aria-label={`当前筛选共 ${historyPage.total} 条`}
                        className="font-mono text-xs tabular-nums"
                      >
                        {historyPage.total}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <EmptyState
                description={emptyDescription(status)}
                icon={<EmptyIconFor status={status} />}
                title={emptyTitle(status)}
              />
            ) : (
              <div className="divide-y divide-border">
                {events.map((event) => (
                  <article
                    className="grid min-w-0 gap-4 py-5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
                    key={event.eventId}
                  >
                    <div className="grid min-w-0 gap-2.5">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge className="max-w-full truncate" variant="default">
                          {event.topicName}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {event.sourceName} · {formatDateTime(event.occurredAt)}
                        </span>
                      </div>
                      <h3 className="m-0 text-lg font-medium leading-snug">
                        <Link
                          className="inline-flex min-h-11 min-w-0 items-center [overflow-wrap:anywhere] transition-colors hover:text-primary"
                          href={`/events/${event.eventId}`}
                        >
                          {event.title}
                        </Link>
                      </h3>
                      <p className="m-0 text-base leading-relaxed [overflow-wrap:anywhere]">
                        {event.summary}
                      </p>
                      {event.explanation ? (
                        <div className="flex items-start gap-2 rounded-[16px] bg-muted p-3 text-sm leading-relaxed text-muted-foreground">
                          <Sparkles aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
                          <span className="min-w-0 break-words">{event.explanation}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2 md:max-w-64 md:justify-end">
                      <Badge variant="accent">{statusLabel(status)}</Badge>
                      {status === "ARCHIVED" ? (
                        <form action={updateDashboardEventStateAction}>
                          <input name="eventId" type="hidden" value={event.eventId} />
                          <input name="returnTo" type="hidden" value={historyTabHref("ARCHIVED", page)} />
                          <Button
                            aria-label="恢复到已读"
                            name="action"
                            size="sm"
                            title="恢复到已读"
                            type="submit"
                            value="restore"
                            variant="secondary"
                          >
                            <ArchiveRestore aria-hidden="true" size={14} />
                            <span>恢复</span>
                          </Button>
                        </form>
                      ) : null}
                      {status !== "ARCHIVED" ? (
                        <form action={updateDashboardEventStateAction}>
                          <input name="eventId" type="hidden" value={event.eventId} />
                          <input name="returnTo" type="hidden" value={historyTabHref(status, page)} />
                          <Button
                            aria-label="归档"
                            name="action"
                            size="sm"
                            title="归档"
                            type="submit"
                            value="archive"
                            variant="ghost"
                          >
                            <Archive aria-hidden="true" size={14} />
                            <span>归档</span>
                          </Button>
                        </form>
                      ) : null}
                      {status === "SAVED" ? (
                        <form action={updateDashboardEventStateAction}>
                          <input name="eventId" type="hidden" value={event.eventId} />
                          <input name="returnTo" type="hidden" value={historyTabHref("SAVED", page)} />
                          <Button
                            aria-label="取消收藏"
                            name="action"
                            size="sm"
                            title="取消收藏"
                            type="submit"
                            value="unsave"
                            variant="ghost"
                          >
                            <X aria-hidden="true" size={14} />
                            <span>取消收藏</span>
                          </Button>
                        </form>
                      ) : null}
                      {status !== "SAVED" ? (
                        <form action={updateDashboardEventStateAction}>
                          <input name="eventId" type="hidden" value={event.eventId} />
                          <input name="returnTo" type="hidden" value={historyTabHref(status, page)} />
                          <Button
                            aria-label="收藏"
                            name="action"
                            size="sm"
                            title="收藏"
                            type="submit"
                            value="save"
                            variant="ghost"
                          >
                            <Bookmark aria-hidden="true" size={14} />
                            <span>收藏</span>
                          </Button>
                        </form>
                      ) : null}
                      {status === "DISMISSED" ? (
                        <form action={updateDashboardEventStateAction}>
                          <input name="eventId" type="hidden" value={event.eventId} />
                          <input name="returnTo" type="hidden" value={historyTabHref("DISMISSED", page)} />
                          <Button
                            aria-label="标记已读"
                            name="action"
                            size="sm"
                            title="标记已读"
                            type="submit"
                            value="read"
                            variant="secondary"
                          >
                            <Check aria-hidden="true" size={14} />
                            <span>已读</span>
                          </Button>
                        </form>
                      ) : null}
                      {event.primaryItemUrl ? (
                        <Button asChild size="sm" variant="ghost">
                          <a
                            aria-label="查看原文"
                            href={event.primaryItemUrl}
                            rel="noreferrer"
                            target="_blank"
                            title="查看原文"
                          >
                            <ExternalLink aria-hidden="true" size={14} />
                            <span>原文</span>
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
            {historyPage.total > 0 ? (
              <nav
                aria-label="历史分页"
                className="mt-4 flex min-h-11 flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm text-muted-foreground"
              >
                <span className="font-medium tabular-nums">
                  第 {historyPage.page} / {historyPage.pageCount} 页 · 共 {historyPage.total}
                </span>
                <div className="flex flex-wrap justify-end gap-2">
                  {historyPage.page > 1 ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={historyTabHref(status, historyPage.page - 1)}>上一页</Link>
                    </Button>
                  ) : null}
                  {historyPage.page < historyPage.pageCount ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={historyTabHref(status, historyPage.page + 1)}>下一页</Link>
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

function historyTabHref(status: HistoryStatus, page?: number): string {
  const params = new URLSearchParams({ status });
  if (typeof page === "number" && page > 1) {
    params.set("page", String(page));
  }
  return `/history?${params.toString()}`;
}

function statusLabel(status: HistoryStatus): string {
  switch (status) {
    case "READ":
      return "已读";
    case "DISMISSED":
      return "已忽略";
    case "SAVED":
      return "已收藏";
    case "ARCHIVED":
      return "已归档";
  }
}

function emptyTitle(status: HistoryStatus): string {
  switch (status) {
    case "READ":
      return "暂无已读记录";
    case "DISMISSED":
      return "暂无忽略记录";
    case "SAVED":
      return "暂无收藏";
    case "ARCHIVED":
      return "暂无归档";
  }
}

function emptyDescription(status: HistoryStatus): string {
  switch (status) {
    case "READ":
      return "在情报流中点击「已读」后，事件会出现在这里。";
    case "DISMISSED":
      return "在情报流中点击「忽略」后，事件会出现在这里。";
    case "SAVED":
      return "在情报流或本页点击「收藏」后，事件会出现在这里。";
    case "ARCHIVED":
      return "在情报流或本页点击「归档」后，事件会出现在这里，可随时恢复。";
  }
}

function EmptyIconFor({ status }: { status: HistoryStatus }) {
  switch (status) {
    case "READ":
      return <Eye aria-hidden="true" size={18} />;
    case "DISMISSED":
      return <X aria-hidden="true" size={18} />;
    case "SAVED":
      return <Bookmark aria-hidden="true" size={18} />;
    case "ARCHIVED":
      return <Archive aria-hidden="true" size={18} />;
  }
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}
