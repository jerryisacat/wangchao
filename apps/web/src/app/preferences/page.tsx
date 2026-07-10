import { Brain } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { getTopicSourceWorkspace } from "@/lib/topic-source-data";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const workspace = await getTopicSourceWorkspace();

  return (
    <>
      <PageHeader eyebrow="学习记录" title="偏好记忆">
        <Button asChild size="sm" variant="ghost">
          <Link href="/">← 返回情报流</Link>
        </Button>
      </PageHeader>

      <div>
        <Card variant="work">
          <CardHeader>
            <CardTitle>已学习偏好</CardTitle>
          </CardHeader>
          <CardContent>
            {workspace.preferences.length === 0 ? (
              <EmptyState
                description="对情报进行收藏或忽略后，系统会生成可解释偏好。"
                icon={<Brain aria-hidden="true" size={18} />}
                title="暂无偏好记忆"
              />
            ) : (
              <div className="preference-list">
                {workspace.preferences.map((preference) => (
                  <article className="preference-row" key={preference.key}>
                    <div>
                      <h3>{preference.key}</h3>
                      <p>{preference.explanation}</p>
                    </div>
                    <div className="preference-meta">
                      <Badge variant={preference.weight >= 0 ? "success" : "danger"}>
                        {preference.weight >= 0 ? "+" : ""}
                        {preference.weight}
                      </Badge>
                      <span>{Math.round(preference.confidence * 100)}%</span>
                      <div
                        aria-label={`置信度 ${Math.round(preference.confidence * 100)}%`}
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={Math.round(preference.confidence * 100)}
                        className="confidence-meter"
                        role="progressbar"
                      >
                        <span
                          style={{
                            inlineSize: `${Math.round(preference.confidence * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
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
