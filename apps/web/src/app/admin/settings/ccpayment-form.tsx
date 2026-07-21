"use client";

import { startTransition, useRef, useState } from "react";
import { Check, Eye, EyeOff, Loader2, Coins, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CcpaymentCredentialFormProps {
  currentAppId: string | null;
  formAction: (formData: FormData) => void;
  testAction?: (formData: FormData) => Promise<{ message: string; ok: boolean }>;
}

export function CcpaymentCredentialForm({
  currentAppId,
  formAction,
  testAction,
}: CcpaymentCredentialFormProps) {
  const [showSecret, setShowSecret] = useState(false);
  const [appId, setAppId] = useState(currentAppId ?? "");
  const [appSecret, setAppSecret] = useState("");
  const [validationError, setValidationError] = useState("");
  const [testResult, setTestResult] = useState<{
    message: string;
    ok: boolean;
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);

  function handleAppIdChange(value: string) {
    setAppId(value);
    setTestResult(null);
  }

  function handleSecretChange(value: string) {
    setAppSecret(value);
    setTestResult(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!appId.trim()) {
      event.preventDefault();
      setValidationError("App ID 为必填项。");
      return;
    }
    if (!appSecret.trim()) {
      event.preventDefault();
      setValidationError("App Secret 为必填项。");
      secretRef.current?.focus();
      return;
    }
    setValidationError("");
  }

  function handleTest() {
    const form = formRef.current;
    if (!form || !testAction) {
      return;
    }
    if (!appId.trim()) {
      setValidationError("请输入 App ID 后再测试。");
      return;
    }
    if (!appSecret.trim()) {
      setValidationError("请输入 App Secret 后再测试。");
      secretRef.current?.focus();
      return;
    }

    setValidationError("");
    setIsTesting(true);
    setTestResult(null);
    startTransition(async () => {
      try {
        setTestResult(await testAction(new FormData(form)));
      } catch {
        setTestResult({ message: "测试未完成，请稍后重试。", ok: false });
      } finally {
        setIsTesting(false);
      }
    });
  }

  return (
    <form
      action={formAction}
      className="grid gap-3 rounded-[16px] bg-muted p-4"
      ref={formRef}
      onSubmit={handleSubmit}
    >
      <div className="grid gap-2 text-xs font-bold text-muted-foreground">
        <Label htmlFor="ccpaymentAppId">
          App ID{" "}
          <span className="font-normal text-muted-foreground">(必填)</span>
        </Label>
        <Input
          id="ccpaymentAppId"
          name="ccpaymentAppId"
          onChange={(event) => handleAppIdChange(event.target.value)}
          placeholder="CCPayment App ID"
          type="text"
          value={appId}
        />
      </div>

      <div className="grid gap-2 text-xs font-bold text-muted-foreground">
        <Label htmlFor="ccpaymentAppSecret">
          App Secret{" "}
          <span className="font-normal text-muted-foreground">(必填)</span>
        </Label>
        <div className="relative">
          <Input
            ref={secretRef}
            autoComplete="off"
            className="pr-11"
            id="ccpaymentAppSecret"
            name="ccpaymentAppSecret"
            onChange={(event) => handleSecretChange(event.target.value)}
            placeholder="输入 CCPayment App Secret"
            type={showSecret ? "text" : "password"}
            value={appSecret}
          />
          <button
            aria-label={showSecret ? "隐藏 Secret" : "显示 Secret"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowSecret((prev) => !prev)}
            type="button"
          >
            {showSecret ? (
              <EyeOff aria-hidden="true" size={16} />
            ) : (
              <Eye aria-hidden="true" size={16} />
            )}
          </button>
        </div>
      </div>

      {validationError ? (
        <p className="text-xs font-normal text-destructive">{validationError}</p>
      ) : null}

      {testResult ? (
        <p
          aria-live="polite"
          className={
            testResult.ok
              ? "flex items-center gap-1.5 text-xs font-normal text-success"
              : "text-xs font-normal text-destructive"
          }
        >
          {testResult.ok ? <Check aria-hidden="true" size={14} /> : null}
          {testResult.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {testAction ? (
          <Button
            disabled={isTesting}
            onClick={handleTest}
            size="sm"
            type="button"
            variant="secondary"
          >
            {isTesting ? (
              <Loader2 aria-hidden="true" className="animate-spin" size={14} />
            ) : (
              <Zap aria-hidden="true" size={14} />
            )}
            {isTesting ? "测试中..." : "测试当前配置"}
          </Button>
        ) : null}
        {testResult?.ok ? (
          <span className="flex min-h-11 items-center text-xs text-success">
            测试通过
          </span>
        ) : null}
      </div>

      <Button size="sm" type="submit" variant="primary">
        <Coins aria-hidden="true" size={14} />
        保存 CCPayment 凭证
      </Button>
    </form>
  );
}
