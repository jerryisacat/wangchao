"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PasswordFieldProps {
  autoComplete: "current-password" | "new-password";
  disabled?: boolean;
  errorId?: string;
  hint?: string;
  id?: string;
  label?: string;
  onChange: (value: string) => void;
  value: string;
}

export function PasswordField({
  autoComplete,
  disabled = false,
  errorId,
  hint,
  id = "password",
  label = "密码",
  onChange,
  value,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative min-w-0">
        <Input
          aria-describedby={describedBy}
          aria-invalid={Boolean(errorId)}
          autoComplete={autoComplete}
          className="pr-14"
          disabled={disabled}
          id={id}
          minLength={8}
          name={id}
          onChange={(event) => onChange(event.target.value)}
          required
          type={visible ? "text" : "password"}
          value={value}
        />
        <Button
          aria-label={visible ? "隐藏密码" : "显示密码"}
          aria-pressed={visible}
          className="absolute right-1.5 top-1.5"
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
          size="icon"
          type="button"
          variant="ghost"
        >
          {visible ? (
            <EyeOff aria-hidden="true" size={18} />
          ) : (
            <Eye aria-hidden="true" size={18} />
          )}
        </Button>
      </div>
      {hint ? (
        <p className="text-sm leading-relaxed text-muted-foreground" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
