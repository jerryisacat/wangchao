import { Sparkles } from "lucide-react";
import Link from "next/link";
import { createTopicAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";

export default function NewTopicPage() {
  return (
    <>
      <PageHeader eyebrow="TRACK WHAT MATTERS" title="新建观察主题">
        <Button asChild size="sm" variant="ghost">
          <Link href="/">← 返回情报流</Link>
        </Button>
      </PageHeader>

      <Card className="topic-lab" variant="kinetic">
        <div style={{ position: "relative", zIndex: 1, padding: "24px 20px 20px" }}>
          <form action={createTopicAction} className="topic-form">
            <label>
              <span>主题名称</span>
              <input
                className="topic-name-input"
                name="topicName"
                placeholder="我想关注 AI 基础设施"
                required
              />
            </label>
            <label>
              <span>主题描述</span>
              <textarea
                name="topicDescription"
                placeholder="关注 AI 基础设施、模型供应商、Agent 平台和部署生态。"
                rows={3}
              />
            </label>
            <div className="form-actions">
              <span>保存后会自动生成主题关键词，并尝试匹配可验证的候选信源。</span>
              <Button type="submit" variant="primary">
                <Sparkles aria-hidden="true" size={16} />
                创建主题
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </>
  );
}
