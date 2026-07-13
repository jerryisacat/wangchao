"use client";

import { Home, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section aria-labelledby="error-title" className="error-panel">
      <div className="eyebrow">运行状态</div>
      <h1 id="error-title">页面加载失败</h1>
      <p className="muted">
        请稍后重试，或返回未读情报继续阅读。如果问题持续存在，请联系管理员。
      </p>
      <div className="event-detail-actions">
        <Button onClick={reset} variant="primary">
          <RotateCcw aria-hidden="true" size={16} />
          重试
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">
            <Home aria-hidden="true" size={16} />
            返回未读情报
          </Link>
        </Button>
      </div>
    </section>
  );
}
