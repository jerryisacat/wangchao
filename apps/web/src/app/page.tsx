import { Check, CircleAlert, Search } from "lucide-react";
import Link from "next/link";
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
  const view = readViewParam(resolvedSearchParams.view);
  const notice = readSearchParam(resolvedSearchParams.notice);
  const actionError = readSearchParam(resolvedSearchParams.error);
  const activeTopic = workspace.topics.find((topic) => topic.id === topicFilter);

  const filteredEvents = workspace.events.filter((event) => {
    if (topicFilter && event.topicId !== topicFilter) {
      return false;
    }
    if (view === "high" && event.score < 70) {
      return false;
    }
    if (view === "saved" && !event.userSaved && event.status !== "SAVED") {
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
          {topicFilter ? <input name="topic" type="hidden" value={topicFilter} /> : null}
          {view !== "all" ? <input name="view" type="hidden" value={view} /> : null}
          <input
            aria-label="搜索情报"
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
        activeTopicId={activeTopic?.id ?? null}
        query={query}
        view={view}
        topics={workspace.topics}
      />

      <nav aria-label="情报视图" className="view-filter">
        <Link
          aria-current={view === "all" ? "page" : undefined}
          href={buildHomeHref({ query, topicId: activeTopic?.id ?? "", view: "all" })}
        >
          全部
        </Link>
        <Link
          aria-current={view === "high" ? "page" : undefined}
          href={buildHomeHref({ query, topicId: activeTopic?.id ?? "", view: "high" })}
        >
          高价值
        </Link>
        <Link
          aria-current={view === "saved" ? "page" : undefined}
          href={buildHomeHref({ query, topicId: activeTopic?.id ?? "", view: "saved" })}
        >
          已收藏
        </Link>
      </nav>

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

function readViewParam(value: string | string[] | undefined): "all" | "high" | "saved" {
  const rawValue = readSearchParam(value);
  return rawValue === "high" || rawValue === "saved" ? rawValue : "all";
}

function buildHomeHref(input: {
  query: string;
  topicId: string;
  view: "all" | "high" | "saved";
}): string {
  const params = new URLSearchParams();

  if (input.topicId) {
    params.set("topic", input.topicId);
  }
  if (input.query) {
    params.set("q", input.query);
  }
  if (input.view !== "all") {
    params.set("view", input.view);
  }

  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function matchesQuery(query: string, ...values: Array<string | undefined>): boolean {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}
