import { Check, CircleAlert, Search } from "lucide-react";
import { updateDashboardEventStateAction } from "@/app/actions";
import { StatusBanner } from "@/components/common/status-banner";
import { PageHeader } from "@/components/common/page-header";
import { TopicFilter } from "@/components/intelligence/topic-filter";
import { IntelligenceFeed } from "@/components/intelligence/intelligence-feed";
import { getTopicSourceWorkspace } from "@/lib/topic-source-data";

export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const workspace = await getTopicSourceWorkspace();
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const query = readSearchParam(resolvedSearchParams.q);
  const topicFilter = readSearchParam(resolvedSearchParams.topic);
  const notice = readSearchParam(resolvedSearchParams.notice);
  const actionError = readSearchParam(resolvedSearchParams.error);

  const filteredEvents = workspace.events.filter((event) => {
    if (topicFilter && event.topicName !== topicFilter) {
      return false;
    }
    return matchesQuery(query, event.title, event.summary, event.sourceName, event.topicName, event.category);
  });

  const unreadCount = workspace.events.length;

  return (
    <>
      <PageHeader
        eyebrow="主题情报工作台"
        meta={
          <span>
            未读 {unreadCount} 条{workspace.topics.length > 0 ? ` · ${workspace.topics.length} 个主题` : ""}
          </span>
        }
        title="未读情报"
      >
        <form action="/" className="command-search">
          <Search aria-hidden="true" size={15} />
          <span className="sr-only">搜索情报</span>
          <input
            defaultValue={query}
            name="q"
            placeholder="搜索主题、来源、事件"
            type="search"
          />
        </form>
      </PageHeader>

      {notice ? (
        <StatusBanner
          icon={<Check aria-hidden="true" size={16} />}
          message={notice}
          tone="notice"
        />
      ) : null}
      {actionError ? (
        <StatusBanner
          icon={<CircleAlert aria-hidden="true" size={16} />}
          message={actionError}
          tone="error"
        />
      ) : null}

      <StatusBanner
        icon={<CircleAlert aria-hidden="true" size={16} />}
        message={workspace.message}
        tone={workspace.mode === "database" ? "info" : "warning"}
      />

      <TopicFilter
        activeTopicId={null}
        topics={workspace.topics}
      />

      <IntelligenceFeed
        eventStateAction={updateDashboardEventStateAction}
        events={filteredEvents}
        query={query}
      />
    </>
  );
}

function readSearchParam(value: string | string[] | undefined): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" ? rawValue.trim().slice(0, 80) : "";
}

function matchesQuery(query: string, ...values: Array<string | undefined>): boolean {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}
