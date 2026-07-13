"use client";

import {
  Bookmark,
  Check,
  ExternalLink,
  Sparkles,
  ThumbsDown,
} from "lucide-react";
import Link from "next/link";
import type { DashboardEventSummary } from "@/lib/topic-source-data";
import { Badge } from "@/components/ui/badge";

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

interface IntelligenceCardProps {
  event: DashboardEventSummary;
  eventStateAction: (formData: FormData) => void;
}

export function IntelligenceCard({
  event,
  eventStateAction,
}: IntelligenceCardProps) {
  const sourceUrl = isHttpUrl(event.sourceUrl) ? event.sourceUrl : null;
  const itemUrl = isHttpUrl(event.primaryItemUrl) ? event.primaryItemUrl : null;
  const sourceLinkUrl = sourceUrl ?? itemUrl;

  return (
    <article className="intelligence-card">
      <div className="intelligence-card-header">
        <Badge className="intelligence-card-topic" variant="default">
          {event.topicName}
        </Badge>
        {event.entities && event.entities.length > 0
          ? event.entities.slice(0, 3).map((entity) => (
              <Badge key={entity} variant="outline">
                {entity}
              </Badge>
            ))
          : null}
        <span className="intelligence-card-source">
          {sourceLinkUrl ? (
            <a href={sourceLinkUrl} rel="noreferrer" target="_blank">
              {event.sourceName}
            </a>
          ) : (
            event.sourceName
          )}
          {event.mergedSourceCount > 1 ? (
            <span>
              · 另有 {event.mergedSourceCount - 1} 个来源报道
            </span>
          ) : null}
          <span className="intelligence-card-time">
            {" "}
            · {formatDateTime(event.occurredAt)}
          </span>
        </span>
        {event.userSaved ? <Badge variant="accent">已收藏</Badge> : null}
      </div>

      <h3 className="intelligence-card-title">
        <Link href={`/events/${event.eventId}`}>{event.title}</Link>
      </h3>

      <p className="intelligence-card-summary">{event.summary}</p>

      {event.explanation ? (
        <div className="intelligence-card-reason">
          <Sparkles aria-hidden="true" size={13} />
          <span>{event.explanation}</span>
        </div>
      ) : null}

      <div className="intelligence-card-actions">
        <form action={eventStateAction}>
          <input name="eventId" type="hidden" value={event.eventId} />
          <input name="returnTo" type="hidden" value="/" />
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
        <form action={eventStateAction}>
          <input name="eventId" type="hidden" value={event.eventId} />
          <input name="returnTo" type="hidden" value="/" />
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
        <form action={eventStateAction}>
          <input name="eventId" type="hidden" value={event.eventId} />
          <input name="returnTo" type="hidden" value="/" />
          <button
            aria-label="忽略此条"
            className="icon-action"
            name="action"
            title="忽略此条"
            type="submit"
            value="dismiss"
          >
            <ThumbsDown aria-hidden="true" size={14} />
            <span>忽略</span>
          </button>
        </form>
        {itemUrl ? (
          <a
            aria-label="查看原文"
            className="icon-action"
            href={itemUrl}
            rel="noreferrer"
            target="_blank"
            title="查看原文"
          >
            <ExternalLink aria-hidden="true" size={14} />
            <span>原文</span>
          </a>
        ) : sourceUrl ? (
          <a
            aria-label="查看来源"
            className="icon-action"
            href={sourceUrl}
            rel="noreferrer"
            target="_blank"
            title="查看来源"
          >
            <ExternalLink aria-hidden="true" size={14} />
            <span>来源</span>
          </a>
        ) : null}
      </div>
    </article>
  );
}
