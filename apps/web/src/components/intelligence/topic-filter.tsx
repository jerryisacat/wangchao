import type { TopicSummary } from "@/lib/topic-source-data";
import { cn } from "@/lib/utils";

interface TopicFilterProps {
  activeTopicId: string | null;
  className?: string;
  query?: string;
  topics: TopicSummary[];
  view?: "all" | "high" | "saved";
}

export function TopicFilter({
  activeTopicId,
  className,
  query = "",
  topics,
  view = "all",
}: TopicFilterProps) {
  return (
    <nav aria-label="主题筛选" className={cn("topic-filter", className)}>
      <a
        aria-current={activeTopicId === null ? "page" : undefined}
        className="topic-filter-item"
        href={buildTopicHref({ query, topicId: "", view })}
      >
        全部主题
      </a>
      {topics.map((topic) => (
        <a
          aria-current={activeTopicId === topic.id ? "page" : undefined}
          className="topic-filter-item"
          href={buildTopicHref({ query, topicId: topic.id, view })}
          key={topic.id}
        >
          {topic.name}
        </a>
      ))}
    </nav>
  );
}

function buildTopicHref(input: {
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
