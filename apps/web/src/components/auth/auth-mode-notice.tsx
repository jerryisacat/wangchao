import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { StatusBanner } from "@/components/common/status-banner";
import { Button } from "@/components/ui/button";

interface AuthModeNoticeProps {
  enabled: boolean;
}

export function AuthModeNotice({ enabled }: AuthModeNoticeProps) {
  if (enabled) {
    return (
      <div className="flex items-start gap-2 rounded-[16px] bg-muted p-3 text-sm leading-relaxed text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-accent" size={16} />
        <span>登录状态由数据库会话验证；登出后需要重新输入凭证。</span>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <StatusBanner
        icon={<ShieldCheck aria-hidden="true" size={16} />}
        message="当前部署未启用账户认证，正在使用免登录的自托管工作区。"
        tone="warning"
      />
      <Button asChild className="w-full" variant="primary">
        <Link href="/">
          进入工作台
          <ArrowRight aria-hidden="true" size={16} />
        </Link>
      </Button>
    </div>
  );
}
