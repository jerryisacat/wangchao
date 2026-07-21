import type { TopicSummary } from "@/lib/topic-source-data";
import { cn } from "@/lib/utils";

interface TopicFilterProps {
  activeTopicId: string | null;
  className?: string;
  query?: string;
  topics: TopicSummary[];
  view?: "all" | "high" | "saved";
}

const pillBase =
  "inline-flex items-center justify-center rounded-full px-3 min-h-11 text-sm font-medium decoration-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const pillActive = "bg-secondary text-secondary-foreground";
const pillInactive = "text-muted-foreground hover:bg-primary/5";

export function TopicFilter({
  activeTopicId,
  className,
  query = "",
  topics,
  view = "all",
}: TopicFilterProps) {
  return (
    <nav
      aria-label="主题筛选"
      className={cn("flex flex-wrap gap-1.5 pt-1", className)}
    >
      <a
        aria-current={activeTopicId === null ? "page" : undefined}
        className={cn(
          pillBase,
          activeTopicId === null ? pillActive : pillInactive,
        )}
        href={buildTopicHref({ query, topicId: "", view })}
      >
        全部主题
      </a>
      {topics.map((topic) => (
        <a
          aria-current={activeTopicId === topic.id ? "page" : undefined}
          className={cn(
            pillBase,
            activeTopicId === topic.id ? pillActive : pillInactive,
          )}
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
