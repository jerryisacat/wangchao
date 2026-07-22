"use client";

import {
  Archive,
  Bookmark,
  Check,
  ExternalLink,
  Sparkles,
  ThumbsDown,
} from "lucide-react";
import Link from "next/link";
import type { DashboardEventSummary } from "@/lib/topic-source-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isHttpUrl } from "@wangchao/core";
import { decodeHtmlEntities, normalizeKnownExplanation } from "@/lib/display-text";

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

interface IntelligenceCardProps {
  event: DashboardEventSummary;
  eventStateAction: (formData: FormData) => void;
  returnTo: string;
}

export function IntelligenceCard({
  event,
  eventStateAction,
  returnTo,
}: IntelligenceCardProps) {
  const sourceUrl = isHttpUrl(event.sourceUrl) ? event.sourceUrl : null;
  const itemUrl = isHttpUrl(event.primaryItemUrl) ? event.primaryItemUrl : null;
  const sourceLinkUrl = sourceUrl ?? itemUrl;

  return (
    <Card
      className="min-w-0 gap-4 px-4 py-5 sm:gap-5 sm:px-6 sm:py-6"
      variant="default"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="max-w-full min-w-0 truncate" variant="default">
          {decodeHtmlEntities(event.topicName)}
        </Badge>
        {event.entities && event.entities.length > 0
          ? event.entities.slice(0, 3).map((entity) => (
              <Badge key={entity} variant="outline">
                {decodeHtmlEntities(entity)}
              </Badge>
            ))
          : null}
        <span className="min-w-0 flex-1 text-sm text-muted-foreground break-words">
          {sourceLinkUrl ? (
            <a
              className="inline-flex min-h-11 items-center text-primary hover:underline"
              href={sourceLinkUrl}
              rel="noreferrer"
              target="_blank"
            >
              {decodeHtmlEntities(event.sourceName)}
            </a>
          ) : (
            decodeHtmlEntities(event.sourceName)
          )}
          {event.mergedSourceCount > 1 ? (
            <span>
              {" "}
              · 另有{" "}
              <span className="font-medium tabular-nums">
                {event.mergedSourceCount - 1}
              </span>{" "}
              个来源报道
            </span>
          ) : null}
        </span>
        <Badge variant="muted">{formatDateTime(event.occurredAt)}</Badge>
        {event.userSaved ? <Badge variant="accent">已收藏</Badge> : null}
      </div>

      <h3 className="text-lg font-medium leading-snug break-words">
        <Link
          className="inline-flex min-h-11 min-w-0 items-center text-foreground decoration-none [overflow-wrap:anywhere] transition-colors hover:text-primary"
          href={`/events/${event.eventId}`}
        >
          {decodeHtmlEntities(event.title)}
        </Link>
      </h3>

      <p
        className="text-base leading-relaxed text-foreground line-clamp-4 break-words"
        data-summary-status={event.summaryStatus}
      >
        {decodeHtmlEntities(event.summary)}
      </p>

      {event.explanation ? (
        <div className="flex items-start gap-1.5 rounded-[16px] bg-muted p-3 text-sm text-muted-foreground">
          <Sparkles aria-hidden="true" className="mt-0.5 shrink-0" size={13} />
          <span className="min-w-0 break-words">
            {normalizeKnownExplanation(decodeHtmlEntities(event.explanation))}
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <form action={eventStateAction} className="min-w-0">
          <input name="eventId" type="hidden" value={event.eventId} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <Button
            aria-label="标记已读"
            className="w-full justify-center"
            name="action"
            size="sm"
            title="标记已读"
            type="submit"
            value="read"
            variant="ghost"
          >
            <Check aria-hidden="true" size={14} />
            <span>已读</span>
          </Button>
        </form>
        <form action={eventStateAction} className="min-w-0">
          <input name="eventId" type="hidden" value={event.eventId} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <Button
            aria-label="收藏"
            className="w-full justify-center"
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
        <form action={eventStateAction} className="min-w-0">
          <input name="eventId" type="hidden" value={event.eventId} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <Button
            aria-label="忽略此条"
            className="w-full justify-center"
            name="action"
            size="sm"
            title="忽略此条"
            type="submit"
            value="dismiss"
            variant="ghost"
          >
            <ThumbsDown aria-hidden="true" size={14} />
            <span>忽略</span>
          </Button>
        </form>
        <form action={eventStateAction} className="min-w-0">
          <input name="eventId" type="hidden" value={event.eventId} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <Button
            aria-label="归档此条"
            className="w-full justify-center"
            name="action"
            size="sm"
            title="归档此条（可从历史页恢复）"
            type="submit"
            value="archive"
            variant="ghost"
          >
            <Archive aria-hidden="true" size={14} />
            <span>归档</span>
          </Button>
        </form>
        {itemUrl ? (
          <Button
            aria-label="查看原文"
            asChild
            className="col-span-2 w-full justify-center sm:col-span-1"
            size="sm"
            title="查看原文"
            variant="ghost"
          >
            <a href={itemUrl} rel="noreferrer" target="_blank">
              <ExternalLink aria-hidden="true" size={14} />
              <span>原文</span>
            </a>
          </Button>
        ) : sourceUrl ? (
          <Button
            aria-label="查看来源"
            asChild
            className="col-span-2 w-full justify-center sm:col-span-1"
            size="sm"
            title="查看来源"
            variant="ghost"
          >
            <a href={sourceUrl} rel="noreferrer" target="_blank">
              <ExternalLink aria-hidden="true" size={14} />
              <span>来源</span>
            </a>
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
