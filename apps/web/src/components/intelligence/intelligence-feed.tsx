"use client";

import { Inbox } from "lucide-react";
import type { DashboardEventSummary } from "@/lib/topic-source-data";
import { EmptyState } from "@/components/common/empty-state";
import { IntelligenceCard } from "@/components/intelligence/intelligence-card";

interface IntelligenceFeedProps {
  events: DashboardEventSummary[];
  eventStateAction: (formData: FormData) => void;
  query: string;
}

export function IntelligenceFeed({
  eventStateAction,
  events,
  query,
}: IntelligenceFeedProps) {
  if (events.length === 0) {
    return (
      <EmptyState
        description={
          query
            ? "没有匹配当前搜索条件的情报。"
            : "完成一次信息抓取和分析后会出现在这里。"
        }
        icon={<Inbox aria-hidden="true" size={18} />}
        title="暂无未读情报"
      />
    );
  }

  return (
    <div className="grid gap-4">
      {events.map((event) => (
        <IntelligenceCard
          event={event}
          eventStateAction={eventStateAction}
          key={event.eventId}
        />
      ))}
    </div>
  );
}
