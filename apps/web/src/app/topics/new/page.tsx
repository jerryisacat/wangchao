import { Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { createTopicWithSourceAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";

export default function NewTopicPage() {
  return (
    <>
      <PageHeader eyebrow="TRACK WHAT MATTERS" title="新建观察主题">
        <Link className="ui-button ui-button-ghost ui-button-sm" href="/">
          ← 返回情报流
        </Link>
      </PageHeader>

      <Card className="topic-lab" variant="kinetic">
        <div style={{ position: "relative", zIndex: 1, padding: "24px 20px 20px" }}>
          <form action={createTopicWithSourceAction} className="topic-form">
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
            <label>
              <span>关键词</span>
              <input
                name="topicKeywords"
                placeholder="AI, 基础设施, Agent"
              />
            </label>
            <div className="form-row">
              <label>
                <span>RSS 名称</span>
                <input name="sourceName" placeholder="示例 RSS 源" required />
              </label>
              <label>
                <span>RSS URL</span>
                <input
                  name="sourceUrl"
                  placeholder="https://example.com/rss.xml"
                  required
                  type="url"
                />
              </label>
            </div>
            <label>
              <span>信源备注</span>
              <input
                name="sourceDescription"
                placeholder="用于捕捉高热度技术讨论。"
              />
            </label>
            <div className="form-actions">
              <span>保存后会进入后续抓取和分析流程。</span>
              <Button type="submit" variant="primary">
                <Plus aria-hidden="true" size={16} />
                创建并绑定
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </>
  );
}
