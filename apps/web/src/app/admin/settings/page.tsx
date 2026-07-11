import {
  Activity,
  Check,
  CircleAlert,
  Coins,
  KeyRound,
  MessageCircle,
  Search,
  Server,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import {
  deleteAiCredentialAction,
  deleteByokCredentialAction,
  deleteCcpaymentCredentialAction,
  deleteSearchCredentialAction,
  deleteTelegramCredentialAction,
  listAiModelsAction,
  testAiCredentialAction,
  testByokCredentialAction,
  testCcpaymentCredentialAction,
  testSearchCredentialAction,
  testTelegramCredentialAction,
  toggleSelfHostedModeAction,
  upsertAiCredentialAction,
  upsertByokCredentialAction,
  upsertCcpaymentCredentialAction,
  upsertSearchCredentialAction,
  upsertTelegramCredentialAction,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ByokCredentialForm } from "./byok-form";
import { CcpaymentCredentialForm } from "./ccpayment-form";
import { CredentialForm } from "./credential-form";
import { SelfHostedToggleForm } from "./self-hosted-form";
import { TelegramCredentialForm } from "./telegram-form";

export const dynamic = "force-dynamic";

interface AdminSettingsPageProps {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function AdminSettingsPage({
  searchParams,
}: AdminSettingsPageProps) {
  const { getSessionWorkspace } = await import("@/lib/session");
  const {
    assertMembershipRole,
    getPrismaClient,
    getSubscriptionCredentialView,
  } = await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();
  await assertMembershipRole(
    prisma,
    {
      organizationId: workspace.organizationId,
      userId: workspace.userId,
    },
    ["OWNER", "ADMIN"],
  );
  const credential = await getSubscriptionCredentialView(prisma, {
    organizationId: workspace.organizationId,
  });

  const { getTelegramCredentialView } = await import("@wangchao/db");
  const telegramCredential = await getTelegramCredentialView(prisma, {
    organizationId: workspace.organizationId,
  });

  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: workspace.organizationId },
    select: {
      plan: true,
      isSelfHosted: true,
      byokKeyHint: true,
      byokBaseUrl: true,
      byokProvider: true,
      byokModel: true,
      ccpaymentAppId: true,
      ccpaymentSecretHint: true,
      updatedAt: true,
    },
  });

  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const notice = readParam(resolvedSearchParams.notice);
  const actionError = readParam(resolvedSearchParams.error);

  return (
    <>
      <PageHeader eyebrow="管理后台" title="API Key 配置">
        <Button asChild size="sm" variant="secondary">
          <Link href="/admin/usage">
            <Activity aria-hidden="true" size={14} />
            成员与用量
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href="/">← 返回情报流</Link>
        </Button>
      </PageHeader>

      {notice ? (
        <StatusBanner
          icon={<Check aria-hidden="true" size={16} />}
          message={notice}
          tone="notice"
        />
      ) : null}
      {actionError ? (
        <StatusBanner
          icon={<CircleAlert aria-hidden="true" size={16} />}
          message={actionError}
          tone="error"
        />
      ) : null}

      <p className="mb-4 text-sm text-muted-foreground">
        AI 凭证与搜索凭证相互独立，可分别保存与清除。配置其中一项不会影响另一项。
      </p>

      <Tabs defaultValue="ai">
        <TabsList>
          <TabsTrigger value="ai">
            <KeyRound aria-hidden="true" size={14} />
            AI 凭证
          </TabsTrigger>
          <TabsTrigger value="search">
            <Search aria-hidden="true" size={14} />
            搜索凭证
          </TabsTrigger>
          <TabsTrigger value="telegram">
            <MessageCircle aria-hidden="true" size={14} />
            Telegram 投递
          </TabsTrigger>
          <TabsTrigger value="byok">
            <KeyRound aria-hidden="true" size={14} />
            BYOK
          </TabsTrigger>
          <TabsTrigger value="ccpayment">
            <Coins aria-hidden="true" size={14} />
            CCPayment
          </TabsTrigger>
          <TabsTrigger value="advanced">
            <Server aria-hidden="true" size={14} />
            高级
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai">
          <Card variant="work">
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <KeyRound aria-hidden="true" size={16} />
                  AI 凭证
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded-md border border-border bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Badge variant={credential?.ai.hasKey ? "success" : "muted"}>
                    {credential?.ai.hasKey ? "已配置" : "未配置"}
                  </Badge>
                  {credential?.ai.hasKey ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      更新于 {formatDate(credential.updatedAt)}
                    </span>
                  ) : null}
                </div>
                {credential?.ai.hasKey ? (
                  <dl className="grid gap-1.5 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">Key</dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {credential.ai.keyHint}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        端点
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {credential.ai.baseUrl ?? "未设置"}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        模型
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {credential.ai.model ?? "未设置"}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>

              <CredentialForm
                currentBaseUrl={credential?.ai.baseUrl ?? null}
                currentProvider={credential?.ai.provider ?? null}
                formAction={upsertAiCredentialAction}
                listModelsAction={listAiModelsAction}
                mode="ai"
                testAction={testAiCredentialAction}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <form action={deleteAiCredentialAction}>
                  <Button size="sm" type="submit" variant="danger">
                    <Trash2 aria-hidden="true" size={14} />
                    清除凭证
                  </Button>
                </form>
              </div>

              <p className="credential-note">
                保存后系统将使用此 Key 进行 AI 分析和信源推荐。当前 Key
                不会显示，仅显示脱敏提示。
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search">
          <Card variant="work">
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <Search aria-hidden="true" size={16} />
                  搜索凭证
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded-md border border-border bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Badge
                    variant={credential?.search.hasKey ? "success" : "muted"}
                  >
                    {credential?.search.hasKey ? "已配置" : "未配置"}
                  </Badge>
                  {credential?.search.hasKey ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      更新于 {formatDate(credential.updatedAt)}
                    </span>
                  ) : null}
                </div>
                {credential?.search.hasKey ? (
                  <dl className="grid gap-1.5 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        Key
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {credential.search.keyHint}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        Provider
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {credential.search.provider ?? "未设置"}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>

              <CredentialForm
                currentProvider={credential?.search.provider ?? null}
                formAction={upsertSearchCredentialAction}
                mode="search"
                testAction={testSearchCredentialAction}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <form action={deleteSearchCredentialAction}>
                  <Button size="sm" type="submit" variant="danger">
                    <Trash2 aria-hidden="true" size={14} />
                    清除凭证
                  </Button>
                </form>
              </div>

              <p className="credential-note">
                保存后系统将使用此 Key 进行信源发现。当前 Key
                不会显示，仅显示脱敏提示。
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="telegram">
          <Card variant="work">
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <MessageCircle aria-hidden="true" size={16} />
                  Telegram 投递
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded-md border border-border bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Badge
                    variant={telegramCredential.hasBotToken ? "success" : "muted"}
                  >
                    {telegramCredential.hasBotToken ? "已配置" : "未配置"}
                  </Badge>
                  {telegramCredential.hasBotToken ? (
                    <Badge variant={telegramCredential.enabled ? "success" : "muted"}>
                      {telegramCredential.enabled ? "已启用" : "已禁用"}
                    </Badge>
                  ) : null}
                </div>
                {telegramCredential.hasBotToken ? (
                  <dl className="grid gap-1.5 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        Token
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {telegramCredential.botTokenHint}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        Chat ID
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {telegramCredential.chatId}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>

              <TelegramCredentialForm
                currentChatId={telegramCredential.chatId}
                formAction={upsertTelegramCredentialAction}
                testAction={testTelegramCredentialAction}
              />

              {telegramCredential.hasBotToken ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={deleteTelegramCredentialAction}>
                    <Button size="sm" type="submit" variant="danger">
                      <Trash2 aria-hidden="true" size={14} />
                      清除凭证
                    </Button>
                  </form>
                </div>
              ) : null}

              <p className="credential-note">
                配置后，系统每日简报生成完成后会自动发送到指定 Telegram Chat。
                Bot Token 加密存储，不会明文显示。未配置或禁用时不影响 Web/Markdown 简报。
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="byok">
          <Card variant="work">
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <KeyRound aria-hidden="true" size={16} />
                  BYOK 凭证
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded-md border border-border bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Badge
                    variant={subscription?.byokKeyHint ? "success" : "muted"}
                  >
                    {subscription?.byokKeyHint ? "已配置" : "未配置"}
                  </Badge>
                  <Badge variant="muted">
                    {subscription?.plan ?? "FREE"}
                  </Badge>
                </div>
                {subscription?.byokKeyHint ? (
                  <dl className="grid gap-1.5 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        Key
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {subscription.byokKeyHint}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        端点
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {subscription.byokBaseUrl ?? "未设置"}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        模型
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {subscription.byokModel ?? "未设置"}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>

              <p className="credential-note">
                {subscription?.plan === "PLUS"
                  ? "Plus 计划要求必填 BYOK，AI 调用使用你自己的 Key（不限量）。"
                  : subscription?.plan === "PRO"
                    ? "Pro 计划可选 BYOK。配置后用量 ≥80% 时优先使用 BYOK，失败再 fallback 官方 AI。"
                    : "BYOK 在 Plus 计划为必填，Pro 计划为可选。升级后可在此配置。"}
              </p>

              <div className="mt-3">
                <ByokCredentialForm
                  currentBaseUrl={subscription?.byokBaseUrl ?? null}
                  currentModel={subscription?.byokModel ?? null}
                  currentProvider={subscription?.byokProvider ?? null}
                  formAction={upsertByokCredentialAction}
                  testAction={testByokCredentialAction}
                />
              </div>

              {subscription?.byokKeyHint ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={deleteByokCredentialAction}>
                    <Button size="sm" type="submit" variant="danger">
                      <Trash2 aria-hidden="true" size={14} />
                      清除 BYOK 凭证
                    </Button>
                  </form>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ccpayment">
          <Card variant="work">
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <Coins aria-hidden="true" size={16} />
                  CCPayment 凭证
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded-md border border-border bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Badge
                    variant={
                      subscription?.ccpaymentAppId ? "success" : "muted"
                    }
                  >
                    {subscription?.ccpaymentAppId ? "已配置" : "未配置"}
                  </Badge>
                </div>
                {subscription?.ccpaymentAppId ? (
                  <dl className="grid gap-1.5 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        App ID
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {subscription.ccpaymentAppId}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        Secret
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {subscription.ccpaymentSecretHint}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>

              <CcpaymentCredentialForm
                currentAppId={subscription?.ccpaymentAppId ?? null}
                formAction={upsertCcpaymentCredentialAction}
                testAction={testCcpaymentCredentialAction}
              />

              {subscription?.ccpaymentAppId ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={deleteCcpaymentCredentialAction}>
                    <Button size="sm" type="submit" variant="danger">
                      <Trash2 aria-hidden="true" size={14} />
                      清除凭证
                    </Button>
                  </form>
                </div>
              ) : null}

              <p className="credential-note">
                配置后用户可通过加密货币支付升级订阅计划。App Secret 加密存储，不会明文显示。
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="advanced">
          <Card variant="work">
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <Server aria-hidden="true" size={16} />
                  自用模式
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded-md border border-border bg-surface p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {subscription?.isSelfHosted
                      ? "自用模式已开启"
                      : "自用模式未开启"}
                  </span>
                  <Badge
                    variant={subscription?.isSelfHosted ? "success" : "muted"}
                  >
                    {subscription?.isSelfHosted ? "已开启" : "未开启"}
                  </Badge>
                </div>
              </div>

              <SelfHostedToggleForm
                currentEnabled={subscription?.isSelfHosted ?? false}
                formAction={toggleSelfHostedModeAction}
              />

              <p className="credential-note">
                仅 OWNER 或 ADMIN 可操作。开启后跳过所有配额检查，隐藏定价页与支付入口。
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function readParam(value: string | string[] | undefined): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" ? rawValue.trim().slice(0, 80) : "";
}

function formatDate(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hours}:${minutes}`;
}
