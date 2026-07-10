"use client";

import { startTransition, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Eye, EyeOff, KeyRound, Loader2, Search, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { AI_PROVIDERS, SEARCH_PROVIDERS, type ProviderOption } from "./providers";

function SubmitButton({
  disabled,
  icon,
  label,
  variant,
}: {
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  variant: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={disabled || pending} size="sm" type="submit" variant={variant}>
      {pending ? (
        <Loader2 aria-hidden="true" className="animate-spin" size={14} />
      ) : (
        icon
      )}
      {pending ? "保存中..." : label}
    </Button>
  );
}

interface CredentialFormProps {
  currentBaseUrl?: string | null;
  currentProvider?: string | null;
  formAction: (formData: FormData) => void;
  mode: "ai" | "search";
  testAction: (formData: FormData) => Promise<{ message: string; ok: boolean }>;
  listModelsAction?: (
    formData: FormData,
  ) => Promise<{ ok: boolean; message: string; models: Array<{ id: string; ownedBy?: string }> }>;
}

export function CredentialForm({
  currentBaseUrl,
  currentProvider,
  formAction,
  listModelsAction,
  mode,
  testAction,
}: CredentialFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(
    currentProvider ?? (mode === "ai" ? "openai" : "brave"),
  );
  const [baseUrl, setBaseUrl] = useState(
    currentBaseUrl ??
      (mode === "ai"
        ? (AI_PROVIDERS.find((item) => item.value === (currentProvider ?? "openai"))
            ?.defaultBaseUrl ?? "")
        : ""),
  );
  const [apiKey, setApiKey] = useState("");
  const [validationError, setValidationError] = useState("");
  const [testResult, setTestResult] = useState<{
    message: string;
    ok: boolean;
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; ownedBy?: string }>>([]);
  const [modelsMessage, setModelsMessage] = useState<string | null>(null);
  const [manualConfirm, setManualConfirm] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const apiKeyRef = useRef<HTMLInputElement>(null);

  const effectiveTestResult = (() => {
    if (manualConfirm && selectedProvider === "custom") {
      return { ok: true, message: "已手动确认（自定义 provider）" };
    }
    return testResult;
  })();

  const providers = mode === "ai" ? AI_PROVIDERS : SEARCH_PROVIDERS;
  const provider = providers.find((p) => p.value === selectedProvider);
  const providerFieldName = mode === "ai" ? "aiProvider" : "searchProvider";
  const apiKeyFieldId = mode === "ai" ? "aiApiKey" : "searchApiKey";

  function handleProviderChange(value: string) {
    setSelectedProvider(value);
    if (mode === "ai") {
      const selected = AI_PROVIDERS.find((p) => p.value === value);
      setBaseUrl(selected?.defaultBaseUrl ?? "");
    }
    setTestResult(null);
  }

  function handleInputChange() {
    setTestResult(null);
  }

  function handleApiKeyChange(value: string) {
    setApiKey(value);
    handleInputChange();
  }

  function handleRefreshModels() {
    const form = formRef.current;
    if (!form || !apiKey.trim()) {
      setValidationError("请先输入 API Key 后再获取模型列表。");
      apiKeyRef.current?.focus();
      return;
    }
    if (!listModelsAction) {
      return;
    }

    setValidationError("");
    setIsLoadingModels(true);
    setAvailableModels([]);
    setModelsMessage(null);
    startTransition(async () => {
      try {
        const result = await listModelsAction(new FormData(form));
        if (result.ok && result.models.length > 0) {
          setAvailableModels(result.models);
          setModelsMessage(result.message);
        } else {
          setModelsMessage(result.message);
        }
      } catch {
        setModelsMessage("获取模型列表失败，请稍后重试。");
      } finally {
        setIsLoadingModels(false);
      }
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!apiKey.trim()) {
      event.preventDefault();
      setValidationError("API Key 为必填项，请输入后再提交。");
      apiKeyRef.current?.focus();
      return;
    }
    if (!effectiveTestResult?.ok) {
      event.preventDefault();
      setValidationError("请先测试当前 API 配置，测试通过后再保存。");
      return;
    }
    setValidationError("");
  }

  function handleTest() {
    const form = formRef.current;
    if (!form || !apiKey.trim()) {
      setValidationError("API Key 为必填项，请输入后再测试。");
      apiKeyRef.current?.focus();
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
      className="grid gap-3 rounded-md border border-border bg-surface p-4"
      ref={formRef}
      onSubmit={handleSubmit}
    >
      <div className="grid gap-2 text-xs font-bold text-muted-foreground">
        <Label htmlFor={apiKeyFieldId}>
          API Key{" "}
          <span className="font-normal text-muted-foreground">(必填)</span>
        </Label>
        <div className="relative">
          <Input
            ref={apiKeyRef}
            autoComplete="off"
            className="pr-11"
            id={apiKeyFieldId}
            name={apiKeyFieldId}
            onChange={(event) => handleApiKeyChange(event.target.value)}
            placeholder={
              mode === "ai" ? "输入新的 API Key" : "输入新的搜索 API Key"
            }
            type={showPassword ? "text" : "password"}
            value={apiKey}
          />
          <button
            aria-label={showPassword ? "隐藏 Key" : "显示 Key"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowPassword((prev) => !prev)}
            type="button"
          >
            {showPassword ? (
              <EyeOff aria-hidden="true" size={16} />
            ) : (
              <Eye aria-hidden="true" size={16} />
            )}
          </button>
        </div>
        {validationError ? (
          <p className="text-xs font-normal text-destructive">
            {validationError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-2 text-xs font-bold text-muted-foreground">
        <Label htmlFor={providerFieldName}>
          Provider{" "}
          <span className="font-normal text-muted-foreground">(必填)</span>
        </Label>
        <select
          aria-label="Provider"
          className="h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          name={providerFieldName}
          onChange={(e) => handleProviderChange(e.target.value)}
          value={selectedProvider}
        >
          {providers.map((p) => (
            <option
              className="bg-[#121216] text-foreground"
              key={p.value}
              value={p.value}
            >
              {p.label}
            </option>
          ))}
        </select>
        {provider?.helpUrl ? (
          <a
            className="inline-flex min-h-11 w-fit items-center text-xs font-normal text-muted-foreground underline-offset-4 hover:underline"
            href={provider.helpUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            获取 API Key →
          </a>
        ) : null}
      </div>

      {mode === "ai" ? (
        <>
          <div className="grid gap-2 text-xs font-bold text-muted-foreground">
            <Label htmlFor="aiBaseUrl">
              Base URL{" "}
              <span className="font-normal text-muted-foreground">
                (可选)
              </span>
            </Label>
            <Input
              id="aiBaseUrl"
              name="aiBaseUrl"
              onChange={(event) => {
                setBaseUrl(event.target.value);
                handleInputChange();
              }}
              placeholder="https://api.openai.com/v1"
              type="url"
              value={baseUrl}
            />
          </div>
          <div className="grid gap-2 text-xs font-bold text-muted-foreground">
            <Label htmlFor="aiModel">
              模型{" "}
              <span className="font-normal text-muted-foreground">
                (可选)
              </span>
            </Label>
            {availableModels.length > 0 ? (
              <select
                aria-label="模型"
                className="h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                name="aiModel"
                onChange={(e) => {
                  setSelectedModel(e.target.value);
                  handleInputChange();
                }}
                value={selectedModel}
              >
                <option className="bg-[#121216] text-foreground" value="">
                  请选择模型
                </option>
                {availableModels.map((m) => (
                  <option
                    className="bg-[#121216] text-foreground"
                    key={m.id}
                    value={m.id}
                  >
                    {m.id}{m.ownedBy ? ` (${m.ownedBy})` : ""}
                  </option>
                ))}
                <option className="bg-[#121216] text-foreground" value="__custom__">
                  自定义...
                </option>
              </select>
            ) : null}
            {availableModels.length === 0 || selectedModel === "__custom__" ? (
              <Input
                id="aiModel"
                name="aiModel"
                onChange={() => handleInputChange()}
                placeholder="gpt-4o-mini"
                type="text"
              />
            ) : null}
            {mode === "ai" && listModelsAction ? (
              <Button
                disabled={isLoadingModels}
                onClick={handleRefreshModels}
                size="sm"
                type="button"
                variant="ghost"
              >
                {isLoadingModels ? (
                  <Loader2 aria-hidden="true" className="animate-spin" size={14} />
                ) : null}
                {isLoadingModels ? "获取中..." : "刷新模型列表"}
              </Button>
            ) : null}
            {modelsMessage ? (
              <p className="text-xs font-normal text-muted-foreground">
                {modelsMessage}
              </p>
            ) : null}
          </div>
        </>
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
      {testResult && !testResult.ok && selectedProvider === "custom" ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            checked={manualConfirm}
            className="h-4 w-4 rounded border-input"
            onChange={(e) => {
              setManualConfirm(e.target.checked);
              if (!e.target.checked) {
                setTestResult(null);
              }
            }}
            type="checkbox"
          />
          我已确认此 Key 有效，跳过自动测试
        </label>
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
        {effectiveTestResult?.ok ? (
          <span className="flex min-h-11 items-center text-xs text-success">
            测试通过，可以保存
          </span>
        ) : null}
      </div>
      {mode === "ai" ? (
        <p className="text-xs font-normal text-muted-foreground">
          测试将发送一次最小 API 请求，可能产生极少量费用。
        </p>
      ) : null}

      <SubmitButton
        disabled={!effectiveTestResult?.ok}
        icon={
          mode === "ai" ? (
            <KeyRound aria-hidden="true" size={14} />
          ) : (
            <Search aria-hidden="true" size={14} />
          )
        }
        label={mode === "ai" ? "保存 AI 凭证" : "保存搜索凭证"}
        variant={mode === "ai" ? "primary" : "secondary"}
      />
    </form>
  );
}
