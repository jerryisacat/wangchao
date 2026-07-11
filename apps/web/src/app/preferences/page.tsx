import { Brain, Minus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  deletePreferenceAction,
  updatePreferenceWeightAction,
} from "@/app/actions";
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
                  <article className="preference-row" key={`${preference.topicName}-${preference.key}`}>
                    <div>
                      <h3>{preference.key}</h3>
                      <p>{preference.explanation}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        主题：{preference.topicName}
                      </p>
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
                    <div className="flex items-center gap-1">
                      <form action={updatePreferenceWeightAction}>
                        <input type="hidden" name="preferenceKey" value={preference.key} />
                        <input
                          type="hidden"
                          name="topicId"
                          value={getTopicId(workspace, preference.topicName)}
                        />
                        <input
                          type="hidden"
                          name="weight"
                          value={Math.max(-4, preference.weight - 0.5).toFixed(2)}
                        />
                        <Button
                          aria-label="降低权重"
                          size="icon-xs"
                          type="submit"
                          variant="ghost"
                        >
                          <Minus aria-hidden="true" size={12} />
                        </Button>
                      </form>
                      <form action={updatePreferenceWeightAction}>
                        <input type="hidden" name="preferenceKey" value={preference.key} />
                        <input
                          type="hidden"
                          name="topicId"
                          value={getTopicId(workspace, preference.topicName)}
                        />
                        <input
                          type="hidden"
                          name="weight"
                          value={Math.min(4, preference.weight + 0.5).toFixed(2)}
                        />
                        <Button
                          aria-label="提升权重"
                          size="icon-xs"
                          type="submit"
                          variant="ghost"
                        >
                          <Plus aria-hidden="true" size={12} />
                        </Button>
                      </form>
                      <form action={deletePreferenceAction}>
                        <input type="hidden" name="preferenceKey" value={preference.key} />
                        <input
                          type="hidden"
                          name="topicId"
                          value={getTopicId(workspace, preference.topicName)}
                        />
                        <Button
                          aria-label="删除偏好"
                          size="icon-xs"
                          type="submit"
                          variant="danger"
                        >
                          <Trash2 aria-hidden="true" size={12} />
                        </Button>
                      </form>
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

function getTopicId(
  workspace: { topics: Array<{ id: string; name: string }> },
  topicName: string,
): string {
  return workspace.topics.find((t) => t.name === topicName)?.id ?? "";
}
