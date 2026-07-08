import { Download, FileText } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { getTopicSourceWorkspace } from "@/lib/topic-source-data";

export const dynamic = "force-dynamic";

export default async function BriefingsPage() {
  const workspace = await getTopicSourceWorkspace();

  return (
    <>
      <PageHeader eyebrow="简报中心" title="今日简报">
        <Button asChild size="sm" variant="ghost">
          <Link href="/">← 返回情报流</Link>
        </Button>
      </PageHeader>

      <div>
        <Card variant="work">
          <CardHeader>
            <CardTitle>最新简报</CardTitle>
          </CardHeader>
          <CardContent>
            {workspace.briefings.length === 0 ? (
              <EmptyState
                description="生成每日简报后会出现在这里。"
                icon={<FileText aria-hidden="true" size={18} />}
                title="暂无简报"
              />
            ) : (
              <div className="briefing-list">
                {workspace.briefings.map((briefing) => (
                  <article className="briefing-row" key={briefing.briefingId}>
                    <div>
                      <h3>{briefing.title}</h3>
                      <p>
                        {briefing.topicName} · {formatDateTime(briefing.generatedAt)}
                      </p>
                    </div>
                    <a href={`/exports/briefings/${briefing.briefingId}`}>
                      <Download aria-hidden="true" size={14} />
                      Markdown
                    </a>
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
