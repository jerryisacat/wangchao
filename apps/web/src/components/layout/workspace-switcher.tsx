"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { UserMembershipSummary } from "@wangchao/db";
import { setActiveWorkspaceAction } from "@/app/actions";

interface WorkspaceSwitcherProps {
  memberships: UserMembershipSummary[];
  activeOrganizationId: string;
  /** 无认证模式（self-hosted）下隐藏 switcher */
  authEnabled: boolean;
  className?: string;
}

export function WorkspaceSwitcher({
  memberships,
  activeOrganizationId,
  authEnabled,
  className,
}: WorkspaceSwitcherProps) {
  if (!authEnabled || memberships.length === 0) {
    return null;
  }

  const active = memberships.find(
    (m) => m.organizationId === activeOrganizationId,
  );
  const label = active?.organizationName ?? "选择工作区";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="切换工作区"
          className={cn("max-w-11 px-0 sm:max-w-[180px] sm:px-4", className)}
          size="sm"
          variant="secondary"
        >
          <span className="hidden min-w-0 truncate sm:block">{label}</span>
          <ChevronsUpDown aria-hidden="true" size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[min(320px,calc(100vw-32px))]"
      >
        <DropdownMenuLabel>切换工作区</DropdownMenuLabel>
        {memberships.map((membership) => {
              const isActive =
                membership.organizationId === activeOrganizationId;
              return (
                <form action={setActiveWorkspaceAction} key={membership.organizationId}>
                  <input
                    name="organizationId"
                    type="hidden"
                    value={membership.organizationId}
                  />
                  <DropdownMenuItem asChild>
                    <button
                      aria-current={isActive ? "true" : undefined}
                      className={cn("w-full min-w-0", isActive && "font-medium")}
                      type="submit"
                    >
                      <span className="min-w-0 flex-1 truncate text-left">
                        {membership.organizationName}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRole(membership.role)}
                      </span>
                      {isActive ? <Check aria-hidden="true" size={14} /> : null}
                    </button>
                  </DropdownMenuItem>
                </form>
              );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatRole(role: "OWNER" | "ADMIN" | "MEMBER"): string {
  if (role === "OWNER") return "所有者";
  if (role === "ADMIN") return "管理员";
  return "成员";
}
