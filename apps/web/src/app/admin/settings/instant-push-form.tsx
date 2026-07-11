"use client";

import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InstantPushToggleForm({
  allowed,
  currentEnabled,
  hasTelegramCredential,
  formAction,
}: {
  allowed: boolean;
  currentEnabled: boolean;
  hasTelegramCredential: boolean;
  formAction: (formData: FormData) => void;
}) {
  const canEnable = allowed && hasTelegramCredential;
  return (
    <form action={formAction} className="grid gap-3 rounded-md border border-border bg-surface p-4">
      <input name="enabled" type="hidden" value={currentEnabled ? "false" : "true"} />
      <div>
        <p className="text-sm font-bold">高优先级情报即时推送</p>
        <p className="mt-1 text-xs text-muted-foreground">
          对评分不低于 90 的新情报，在事件入库后由 15 分钟 Cron 发起 Telegram 投递。
        </p>
      </div>
      {!allowed ? <p className="text-xs text-warning">升级 Plus 或 Pro 后可开启；自用模式不受限制。</p> : null}
      {!hasTelegramCredential ? <p className="text-xs text-warning">请先配置并启用 Telegram Bot Token 与 Chat ID。</p> : null}
      <Button
        disabled={!currentEnabled && !canEnable}
        size="sm"
        type="submit"
        variant={currentEnabled ? "danger" : "primary"}
      >
        <BellRing aria-hidden="true" size={14} />
        {currentEnabled ? "关闭即时推送" : "开启即时推送"}
      </Button>
    </form>
  );
}
