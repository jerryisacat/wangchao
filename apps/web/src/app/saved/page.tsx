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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { getTopicSourceWorkspace } from "@/lib/topic-source-data";

export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const workspace = await getTopicSourceWorkspace();
  const savedEvents = workspace.events.filter(
    (event) => event.userSaved || event.status === "SAVED",
  );

  return (
    <>
      <PageHeader eyebrow="已收藏" title="已保存情报">
        <Link className="ui-button ui-button-ghost ui-button-sm" href="/">
          ← 返回情报流
        </Link>
      </PageHeader>

      <div>
        <Card variant="work">
          <CardHeader>
            <CardTitle>收藏列表</CardTitle>
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
                  <article className="event-row" key={event.eventId}>
                    <div className="event-copy">
                      <div className="event-copy-header">
                        <Badge tone="default">{event.topicName}</Badge>
                        <span style={{ marginLeft: 8, fontSize: 12, color: "var(--muted-foreground)" }}>
                          {event.sourceName} · {formatDateTime(event.occurredAt)}
                        </span>
                      </div>
                      <h3>{event.title}</h3>
                      <div className="event-summary">{event.summary}</div>
                      {event.explanation ? (
                        <div className="event-reason">
                          <Sparkles aria-hidden="true" size={13} />
                          {event.explanation}
                        </div>
                      ) : null}
                    </div>
                    <div className="event-actions">
                      <Badge tone="accent">已收藏</Badge>
                      <form action={updateDashboardEventStateAction}>
                        <input name="eventId" type="hidden" value={event.eventId} />
                        <button
                          aria-label="标记已读"
                          className="icon-action"
                          name="action"
                          title="标记已读"
                          type="submit"
                          value="read"
                        >
                          <Check aria-hidden="true" size={14} />
                        </button>
                      </form>
                      <form action={updateDashboardEventStateAction}>
                        <input name="eventId" type="hidden" value={event.eventId} />
                        <button
                          aria-label="取消收藏"
                          className="icon-action"
                          name="action"
                          title="取消收藏"
                          type="submit"
                          value="dismiss"
                        >
                          <X aria-hidden="true" size={14} />
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
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}
