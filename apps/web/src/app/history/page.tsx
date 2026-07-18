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
          <Link href="/">← 返回情报流</Link>
        </Button>
      </PageHeader>

      <div>
        <Card variant="work">
          <CardHeader>
            <div className="history-tabs">
              {HISTORY_TABS.map((tab) => {
                const Icon = tab.icon;
                const active = tab.status === status;
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={active ? "history-tab history-tab-active" : "history-tab"}
                    href={historyTabHref(tab.status)}
                    key={tab.status}
                  >
                    <Icon aria-hidden="true" size={14} />
                    <span>{tab.label}</span>
                    {active ? (
                      <span aria-label="当前筛选" className="history-tab-count">
                        · {historyPage.total}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <EmptyState
                description={emptyDescription(status)}
                icon={<EmptyIconFor status={status} />}
                title={emptyTitle(status)}
              />
            ) : (
              <div className="event-list">
                {events.map((event) => (
                  <article className="event-row history-event-row" key={event.eventId}>
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
                      <Badge variant="accent">{statusLabel(status)}</Badge>
                      {status === "ARCHIVED" ? (
                        <form action={updateDashboardEventStateAction}>
                          <input name="eventId" type="hidden" value={event.eventId} />
                          <input name="returnTo" type="hidden" value={historyTabHref("ARCHIVED", page)} />
                          <button
                            aria-label="恢复到已读"
                            className="icon-action"
                            name="action"
                            title="恢复到已读"
                            type="submit"
                            value="restore"
                          >
                            <ArchiveRestore aria-hidden="true" size={14} />
                            <span>恢复</span>
                          </button>
                        </form>
                      ) : null}
                      {status !== "ARCHIVED" ? (
                        <form action={updateDashboardEventStateAction}>
                          <input name="eventId" type="hidden" value={event.eventId} />
                          <input name="returnTo" type="hidden" value={historyTabHref(status, page)} />
                          <button
                            aria-label="归档"
                            className="icon-action"
                            name="action"
                            title="归档"
                            type="submit"
                            value="archive"
                          >
                            <Archive aria-hidden="true" size={14} />
                            <span>归档</span>
                          </button>
                        </form>
                      ) : null}
                      {status === "SAVED" ? (
                        <form action={updateDashboardEventStateAction}>
                          <input name="eventId" type="hidden" value={event.eventId} />
                          <input name="returnTo" type="hidden" value={historyTabHref("SAVED", page)} />
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
                      ) : null}
                      {status !== "SAVED" ? (
                        <form action={updateDashboardEventStateAction}>
                          <input name="eventId" type="hidden" value={event.eventId} />
                          <input name="returnTo" type="hidden" value={historyTabHref(status, page)} />
                          <button
                            aria-label="收藏"
                            className="icon-action"
                            name="action"
                            title="收藏"
                            type="submit"
                            value="save"
                          >
                            <Bookmark aria-hidden="true" size={14} />
                            <span>收藏</span>
                          </button>
                        </form>
                      ) : null}
                      {status === "DISMISSED" ? (
                        <form action={updateDashboardEventStateAction}>
                          <input name="eventId" type="hidden" value={event.eventId} />
                          <input name="returnTo" type="hidden" value={historyTabHref("DISMISSED", page)} />
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
                      ) : null}
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
            {historyPage.total > 0 ? (
              <nav aria-label="历史分页" className="history-pagination">
                <span>
                  第 {historyPage.page} / {historyPage.pageCount} 页 · 共 {historyPage.total}
                </span>
                <div className="history-pagination-actions">
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