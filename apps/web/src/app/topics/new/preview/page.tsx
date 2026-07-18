import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import {
  TopicDraftPreviewForm,
  type TopicDraftPreviewInitial,
} from "./topic-draft-preview-form";

export const dynamic = "force-dynamic";

const TOPIC_DRAFT_COOKIE = "wc_topic_draft";

export default async function TopicDraftPreviewPage() {
  const cookieStore = await cookies();
  const envelope = cookieStore.get(TOPIC_DRAFT_COOKIE)?.value;

  if (!envelope) {
    return (
      <>
        <PageHeader eyebrow="REVIEW DRAFT" title="确认主题画像">
          <Button asChild size="sm" variant="ghost">
            <Link href="/topics/new">
              <ArrowLeft aria-hidden="true" size={14} />
              <span>返回新建</span>
            </Link>
          </Button>
        </PageHeader>
        <Card className="topic-lab" variant="kinetic">
          <div
            style={{ position: "relative", zIndex: 1, padding: "24px 20px 20px" }}
          >
            <p className="text-muted-foreground">
              草案已过期或未生成，请返回重新填写主题目标。
            </p>
          </div>
        </Card>
      </>
    );
  }

  let parsed: { draft: TopicDraftPreviewInitial; description?: string };
  try {
    parsed = JSON.parse(envelope) as {
      draft: TopicDraftPreviewInitial;
      description?: string;
    };
  } catch {
    return (
      <>
        <PageHeader eyebrow="REVIEW DRAFT" title="确认主题画像">
          <Button asChild size="sm" variant="ghost">
            <Link href="/topics/new">
              <ArrowLeft aria-hidden="true" size={14} />
              <span>返回新建</span>
            </Link>
          </Button>
        </PageHeader>
        <Card className="topic-lab" variant="kinetic">
          <div
            style={{ position: "relative", zIndex: 1, padding: "24px 20px 20px" }}
          >
            <p className="text-muted-foreground">
              草案数据无法解析，请返回重新生成。
            </p>
          </div>
        </Card>
      </>
    );
  }

  if (!parsed.draft || typeof parsed.draft !== "object") {
    return (
      <>
        <PageHeader eyebrow="REVIEW DRAFT" title="确认主题画像">
          <Button asChild size="sm" variant="ghost">
            <Link href="/topics/new">
              <ArrowLeft aria-hidden="true" size={14} />
              <span>返回新建</span>
            </Link>
          </Button>
        </PageHeader>
        <Card className="topic-lab" variant="kinetic">
          <div
            style={{ position: "relative", zIndex: 1, padding: "24px 20px 20px" }}
          >
            <p className="text-muted-foreground">
              草案数据不完整，请返回重新生成。
            </p>
          </div>
        </Card>
      </>
    );
  }

  return (
    <TopicDraftPreviewForm
      initial={parsed.draft}
      description={parsed.description ?? ""}
    />
  );
}
