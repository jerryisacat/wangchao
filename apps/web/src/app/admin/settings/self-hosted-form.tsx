"use client";

import { useState } from "react";
import { CircleAlert, Server } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SelfHostedToggleFormProps {
  currentEnabled: boolean;
  formAction: (formData: FormData) => void;
}

export function SelfHostedToggleForm({
  currentEnabled,
  formAction,
}: SelfHostedToggleFormProps) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form action={formAction} className="grid gap-3">
      <input
        name="enabled"
        type="hidden"
        value={currentEnabled ? "false" : "true"}
      />

      {!currentEnabled ? (
        <div className="rounded-[16px] border border-warning/40 bg-warning/10 p-4 text-xs text-foreground">
          <div className="mb-2 flex items-center gap-1.5 font-bold">
            <CircleAlert aria-hidden="true" size={14} />
            开启自用模式的后果
          </div>
          <ul className="grid gap-1 pl-5">
            <li>跳过所有配额检查（主题数、信源数、AI 调用数、导出数均不限）</li>
            <li>隐藏前端定价页和支付入口</li>
            <li>BYOK 变为可选配置</li>
            <li>仅影响当前工作区</li>
          </ul>
          <label className="mt-3 flex items-center gap-2 font-normal">
            <input
              checked={confirmed}
              className="h-4 w-4 rounded border-input"
              onChange={(e) => setConfirmed(e.target.checked)}
              type="checkbox"
            />
            我已了解后果，确认开启自用模式
          </label>
        </div>
      ) : (
        <div className="rounded-[16px] bg-muted p-4 text-xs text-muted-foreground">
          当前工作区已处于自用模式。关闭后将恢复正常的配额检查和支付流程。
        </div>
      )}

      <Button
        disabled={!currentEnabled && !confirmed}
        size="sm"
        type="submit"
        variant={currentEnabled ? "danger" : "primary"}
      >
        <Server aria-hidden="true" size={14} />
        {currentEnabled ? "关闭自用模式" : "开启自用模式"}
      </Button>
    </form>
  );
}
