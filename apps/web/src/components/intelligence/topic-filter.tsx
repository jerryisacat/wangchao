import type { TopicSummary } from "@/lib/topic-source-data";
import { cn } from "@/lib/utils";

interface TopicFilterProps {
  activeTopicId: string | null;
  className?: string;
  topics: TopicSummary[];
}

export function TopicFilter({
  activeTopicId,
  className,
  topics,
}: TopicFilterProps) {
  return (
    <div className={cn("topic-filter", className)}>
      <a
        aria-selected={activeTopicId === null}
        className="topic-filter-item"
        href="/"
      >
        全部主题
      </a>
      {topics.map((topic) => (
        <a
          aria-selected={activeTopicId === topic.id}
          className="topic-filter-item"
          href={`/?topic=${topic.id}`}
          key={topic.id}
        >
          {topic.name}
        </a>
      ))}
    </div>
  );
}
