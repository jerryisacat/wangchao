"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { AuthModeNotice } from "@/components/auth/auth-mode-notice";
import { PasswordField } from "@/components/auth/password-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

interface RegisterFormProps {
  authEnabled: boolean;
  returnPath: string;
}

export function RegisterForm({ authEnabled, returnPath }: RegisterFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const errorId = error ? "register-form-error" : undefined;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await authClient.signUp.email({ email, name, password });

      if (result.error) {
        setError("注册失败，该邮箱可能已被使用，请检查后重试。");
        setLoading(false);
        return;
      }

      router.push(returnPath);
      router.refresh();
    } catch {
      setError("暂时无法连接认证服务，请稍后重试。");
      setLoading(false);
    }
  }

  return (
    <AuthCard
      description="创建账号后，系统会为你准备一个独立的个人工作区。"
      footer={
        authEnabled ? (
          <Button asChild className="w-full" variant="ghost">
            <Link href={`/login?next=${encodeURIComponent(returnPath)}`}>
              已有账号？立即登录
            </Link>
          </Button>
        ) : (
          <p className="text-center text-sm leading-relaxed text-muted-foreground">
            当前工作区无需注册即可使用。
          </p>
        )
      }
      title="注册望潮"
    >
      {authEnabled ? (
        <>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="name">显示名称</Label>
              <Input
                aria-describedby={errorId}
                aria-invalid={Boolean(error)}
                autoComplete="name"
                disabled={loading}
                id="name"
                name="name"
                onChange={(event) => setName(event.target.value)}
                required
                type="text"
                value={name}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                aria-describedby={errorId}
                aria-invalid={Boolean(error)}
                autoComplete="email"
                disabled={loading}
                id="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </div>
            <PasswordField
              autoComplete="new-password"
              disabled={loading}
              errorId={errorId}
              hint="使用 8–128 个字符。"
              onChange={setPassword}
              value={password}
            />
            <p
              aria-live="polite"
              className={`min-h-5 text-sm leading-relaxed ${
                error ? "text-destructive" : "text-transparent"
              }`}
              id="register-form-error"
              role={error ? "alert" : undefined}
            >
              {error ?? "\u00A0"}
            </p>
            <Button className="w-full" disabled={loading} type="submit" variant="primary">
              {loading ? "正在创建账号…" : "创建账号"}
            </Button>
          </form>
          <AuthModeNotice enabled />
        </>
      ) : (
        <AuthModeNotice enabled={false} />
      )}
    </AuthCard>
  );
}
