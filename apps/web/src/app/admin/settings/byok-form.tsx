"use client";

import { startTransition, useRef, useState } from "react";
import { Check, Eye, EyeOff, KeyRound, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AI_PROVIDERS, defaultAiBaseUrl } from "./providers";

interface ByokCredentialFormProps {
  currentBaseUrl: string | null;
  currentModel: string | null;
  currentProvider: string | null;
  formAction: (formData: FormData) => void;
  testAction: (formData: FormData) => Promise<{ message: string; ok: boolean }>;
}

export function ByokCredentialForm({
  currentBaseUrl,
  currentModel,
  currentProvider,
  formAction,
  testAction,
}: ByokCredentialFormProps) {
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(
    currentProvider ?? "openai",
  );
  const [baseUrl, setBaseUrl] = useState(
    currentBaseUrl ?? defaultAiBaseUrl(selectedProvider) ?? "",
  );
  const [model, setModel] = useState(currentModel ?? "");
  const [validationError, setValidationError] = useState("");
  const [testResult, setTestResult] = useState<{
    message: string;
    ok: boolean;
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  function handleProviderChange(value: string) {
    setSelectedProvider(value);
    const defaults = AI_PROVIDERS.find((p) => p.value === value);
    setBaseUrl(defaults?.defaultBaseUrl ?? "");
    setTestResult(null);
  }

  function handleKeyChange(value: string) {
    setApiKey(value);
    setTestResult(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!apiKey.trim()) {
      event.preventDefault();
      setValidationError("BYOK API Key 为必填项。");
      keyRef.current?.focus();
      return;
    }
    if (!baseUrl.trim()) {
      event.preventDefault();
      setValidationError("请填写 Base URL 后再保存。");
      return;
    }
    if (!testResult?.ok) {
      event.preventDefault();
      setValidationError("请先测试当前配置，测试通过后再保存。");
      return;
    }
    setValidationError("");
  }

  function handleTest() {
    const form = formRef.current;
    if (!form || !apiKey.trim()) {
      setValidationError("请输入 API Key 后再测试。");
      keyRef.current?.focus();
      return;
    }
    if (!baseUrl.trim()) {
      setValidationError("请填写 Base URL 后再测试。");
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
        <Label htmlFor="byokApiKey">
          API Key{" "}
          <span className="font-normal text-muted-foreground">(必填)</span>
        </Label>
        <div className="relative">
          <Input
            ref={keyRef}
            autoComplete="off"
            className="pr-11"
            id="byokApiKey"
            name="byokApiKey"
            onChange={(event) => handleKeyChange(event.target.value)}
            placeholder="输入 BYOK API Key"
            type={showKey ? "text" : "password"}
            value={apiKey}
          />
          <button
            aria-label={showKey ? "隐藏 Key" : "显示 Key"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowKey((prev) => !prev)}
            type="button"
          >
            {showKey ? (
              <EyeOff aria-hidden="true" size={16} />
            ) : (
              <Eye aria-hidden="true" size={16} />
            )}
          </button>
        </div>
      </div>

      <div className="grid gap-2 text-xs font-bold text-muted-foreground">
        <Label htmlFor="byokProvider">Provider</Label>
        <select
          aria-label="BYOK Provider"
          className="h-11 w-full min-w-0 rounded-[12px] border border-outline bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:bg-input/30"
          name="byokProvider"
          onChange={(e) => handleProviderChange(e.target.value)}
          value={selectedProvider}
        >
          {AI_PROVIDERS.map((p) => (
            <option
              className="bg-surface text-foreground"
              key={p.value}
              value={p.value}
            >
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2 text-xs font-bold text-muted-foreground">
        <Label htmlFor="byokBaseUrl">Base URL</Label>
        <Input
          id="byokBaseUrl"
          name="byokBaseUrl"
          onChange={(event) => {
            setBaseUrl(event.target.value);
            setTestResult(null);
          }}
          placeholder="https://api.openai.com/v1"
          type="url"
          value={baseUrl}
        />
      </div>

      <div className="grid gap-2 text-xs font-bold text-muted-foreground">
        <Label htmlFor="byokModel">模型</Label>
        <Input
          id="byokModel"
          name="byokModel"
          onChange={(event) => {
            setModel(event.target.value);
            setTestResult(null);
          }}
          placeholder="gpt-4o-mini"
          type="text"
          value={model}
        />
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
        {testResult?.ok ? (
          <span className="flex min-h-11 items-center text-xs text-success">
            测试通过，可以保存
          </span>
        ) : null}
      </div>

      <Button
        disabled={!testResult?.ok}
        size="sm"
        type="submit"
        variant="primary"
      >
        <KeyRound aria-hidden="true" size={14} />
        保存 BYOK 凭证
      </Button>
    </form>
  );
}
