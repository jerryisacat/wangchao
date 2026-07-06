"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="error-panel" aria-labelledby="error-title" style={{ margin: "48px auto" }}>
      <div className="eyebrow">运行状态</div>
      <h1 id="error-title">页面加载失败</h1>
      <p className="muted">
        请重试当前视图。如果问题持续存在，请检查数据库连接和 worker 状态。
      </p>
      <Button onClick={reset} variant="primary">
        <RotateCcw aria-hidden="true" size={16} />
        重试
      </Button>
    </section>
  );
}
