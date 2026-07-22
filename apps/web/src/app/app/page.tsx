import { Check, CircleAlert, Search } from "lucide-react";
import Link from "next/link";
import { updateDashboardEventStateAction } from "@/app/actions";
import { StatusBanner } from "@/components/common/status-banner";
import { PageHeader } from "@/components/common/page-header";
import { TopicFilter } from "@/components/intelligence/topic-filter";
import { IntelligenceFeed } from "@/components/intelligence/intelligence-feed";
import { FetchRefreshButton } from "@/components/intelligence/fetch-refresh-button";
import { getTopicSourceWorkspace } from "@/lib/topic-source-data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const pillBase =
  "inline-flex items-center justify-center rounded-full px-3 min-h-11 text-sm font-medium decoration-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const pillActive = "bg-secondary text-secondary-foreground";
const pillInactive = "text-muted-foreground hover:bg-primary/5";

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
  const returnTo = buildHomeHref({
    query,
    topicId: activeTopic?.id ?? "",
    view,
  });

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
  const latestUpdate = workspace.events.reduce(
    (latest, event) => (event.updatedAt > latest ? event.updatedAt : latest),
    workspace.events[0]?.updatedAt ?? "",
  );

  return (
    <>
      <PageHeader
        eyebrow="主题情报工作台"
        meta={
          <span>
            未读 <span className="font-medium tabular-nums">{unreadCount}</span>{" "}
            条
            {workspace.topics.length > 0 ? ` · ${workspace.topics.length} 个主题` : ""}
            {latestUpdate ? ` · 更新于 ${formatDateTime(latestUpdate)}` : ""}
          </span>
        }
        title="未读情报"
      >
        <form
          action="/app"
          className="flex min-h-11 min-w-0 w-full items-center gap-2 rounded-full bg-muted px-4 text-muted-foreground transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background sm:w-auto sm:max-w-[360px]"
        >
          <Search aria-hidden="true" className="shrink-0" size={16} />
          <span className="sr-only">搜索情报</span>
          {topicFilter ? (
            <input name="topic" type="hidden" value={topicFilter} />
          ) : null}
          {view !== "all" ? (
            <input name="view" type="hidden" value={view} />
          ) : null}
          <input
            aria-label="搜索情报"
            className="min-h-11 min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            defaultValue={query}
            name="q"
            placeholder="搜索主题、来源、事件"
            type="search"
          />
        </form>
        <FetchRefreshButton returnTo={returnTo} />
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

      <nav aria-label="情报视图" className="flex flex-wrap gap-1.5">
        <Link
          aria-current={view === "all" ? "page" : undefined}
          className={cn(
            pillBase,
            view === "all" ? pillActive : pillInactive,
          )}
          href={buildHomeHref({ query, topicId: activeTopic?.id ?? "", view: "all" })}
        >
          全部
        </Link>
        <Link
          aria-current={view === "high" ? "page" : undefined}
          className={cn(
            pillBase,
            view === "high" ? pillActive : pillInactive,
          )}
          href={buildHomeHref({ query, topicId: activeTopic?.id ?? "", view: "high" })}
        >
          高价值
        </Link>
        <Link
          aria-current={view === "saved" ? "page" : undefined}
          className={cn(
            pillBase,
            view === "saved" ? pillActive : pillInactive,
          )}
          href={buildHomeHref({ query, topicId: activeTopic?.id ?? "", view: "saved" })}
        >
          已收藏
        </Link>
      </nav>

      <IntelligenceFeed
        eventStateAction={updateDashboardEventStateAction}
        events={filteredEvents}
        query={query}
        returnTo={returnTo}
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
  return query ? `/app?${query}` : "/app";
}

function matchesQuery(query: string, ...values: Array<string | undefined>): boolean {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}
