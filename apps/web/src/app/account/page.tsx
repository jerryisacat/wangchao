import { Building2, CircleUserRound, KeyRound, ShieldCheck } from "lucide-react";
import { AuthModeNotice } from "@/components/auth/auth-mode-notice";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isAuthEnabled } from "@/lib/auth";
import { getSessionWorkspace } from "@/lib/session";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const authEnabled = isAuthEnabled();
  const workspace = await getSessionWorkspace();
  const { getPrismaClient, getUserLifecycleStatus } = await import("@wangchao/db");
  const account = await getUserLifecycleStatus(getPrismaClient(), workspace.userId);

  return (
    <>
      <PageHeader
        eyebrow="账户"
        meta="查看当前身份、认证模式和工作区访问范围。"
        title="账户与访问"
      />

      <StatusBanner
        icon={
          authEnabled ? (
            <ShieldCheck aria-hidden="true" size={16} />
          ) : (
            <KeyRound aria-hidden="true" size={16} />
          )
        }
        message={
          authEnabled
            ? "正式认证已启用：受保护页面需要有效的数据库会话。"
            : "当前为免登录自托管模式：所有访问使用默认用户和工作区。"
        }
        tone={authEnabled ? "notice" : "warning"}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card variant="work">
          <CardHeader>
            <CardTitle>
              <h2 className="flex items-center gap-2 text-base font-medium">
                <CircleUserRound aria-hidden="true" className="text-accent" size={18} />
                当前身份
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              <AccountRow label="显示名称" value={account?.name ?? "个人用户"} />
              <AccountRow label="邮箱" value={workspace.userEmail} />
              <AccountRow
                label="账户状态"
                value={
                  <Badge
                    variant={
                      account?.accountStatus === "ACTIVE" ? "success" : "warning"
                    }
                  >
                    {formatAccountStatus(account?.accountStatus)}
                  </Badge>
                }
              />
              <AccountRow
                label="登录方式"
                value={authEnabled ? "邮箱与密码" : "免登录默认身份"}
              />
            </dl>
          </CardContent>
        </Card>

        <Card variant="work">
          <CardHeader>
            <CardTitle>
              <h2 className="flex items-center gap-2 text-base font-medium">
                <Building2 aria-hidden="true" className="text-accent" size={18} />
                当前工作区
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              <AccountRow label="名称" value={workspace.organizationName} />
              <AccountRow label="标识" value={workspace.organizationSlug} mono />
              <AccountRow
                label="角色"
                value={<Badge variant={roleTone(workspace.role)}>{formatRole(workspace.role)}</Badge>}
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card variant="work">
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-medium">访问与安全</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {authEnabled ? (
            <>
              <div className="rounded-[16px] bg-muted p-4 text-sm leading-relaxed text-muted-foreground">
                当前登录由数据库 Session 验证。退出后，这台设备需要重新登录才能访问工作台。
              </div>
              <LogoutButton />
            </>
          ) : (
            <AuthModeNotice enabled={false} />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function AccountRow({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? "min-w-0 break-all text-right font-mono text-xs text-foreground"
            : "min-w-0 break-words text-right text-sm font-medium text-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function formatRole(role: "OWNER" | "ADMIN" | "MEMBER"): string {
  if (role === "OWNER") return "所有者";
  if (role === "ADMIN") return "管理员";
  return "成员";
}

function roleTone(role: "OWNER" | "ADMIN" | "MEMBER") {
  if (role === "OWNER") return "success" as const;
  if (role === "ADMIN") return "warning" as const;
  return "muted" as const;
}

function formatAccountStatus(status: string | undefined): string {
  if (status === "ACTIVE") return "正常";
  if (status === "SUSPENDED") return "已暂停";
  if (status === "DELETION_PENDING") return "待删除";
  if (status === "DELETED") return "已删除";
  return "未知";
}
