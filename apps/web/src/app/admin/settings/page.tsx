import { Activity, Check, CircleAlert, KeyRound, MessageCircle, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  deleteAiCredentialAction,
  deleteSearchCredentialAction,
  deleteTelegramCredentialAction,
  listAiModelsAction,
  testAiCredentialAction,
  testSearchCredentialAction,
  testTelegramCredentialAction,
  upsertAiCredentialAction,
  upsertSearchCredentialAction,
  upsertTelegramCredentialAction,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CredentialForm } from "./credential-form";
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
  const {
    assertMembershipRole,
    ensureDefaultWorkspace,
    getPrismaClient,
    getSubscriptionCredentialView,
  } = await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);
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
