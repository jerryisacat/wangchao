"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
  const [open, setOpen] = useState(false);

  if (!authEnabled || memberships.length === 0) {
    return null;
  }

  const active = memberships.find(
    (m) => m.organizationId === activeOrganizationId,
  );
  const label = active?.organizationName ?? "选择工作区";

  return (
    <div className={cn("workspace-switcher", className)}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="切换工作区"
        className="workspace-switcher-trigger"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <span className="workspace-switcher-label hidden sm:inline">{label}</span>
        <ChevronsUpDown aria-hidden="true" size={14} />
      </button>

      {open ? (
        <>
          <button
            aria-label="关闭工作区选择"
            className="workspace-switcher-overlay"
            onClick={() => setOpen(false)}
            type="button"
          />
          <ul className="workspace-switcher-menu" role="listbox" aria-label="工作区列表">
            {memberships.map((membership) => {
              const isActive =
                membership.organizationId === activeOrganizationId;
              return (
                <li key={membership.organizationId} role="option" aria-selected={isActive}>
                  <form action={setActiveWorkspaceAction}>
                    <input
                      name="organizationId"
                      type="hidden"
                      value={membership.organizationId}
                    />
                    <button
                      className={cn(
                        "workspace-switcher-item",
                        isActive && "workspace-switcher-item-active",
                      )}
                      onClick={() => setOpen(false)}
                      type="submit"
                    >
                      <span className="workspace-switcher-item-name">
                        {membership.organizationName}
                      </span>
                      <span className="workspace-switcher-item-role">
                        {formatRole(membership.role)}
                      </span>
                      {isActive ? (
                        <Check aria-hidden="true" size={14} />
                      ) : null}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function formatRole(role: "OWNER" | "ADMIN" | "MEMBER"): string {
  if (role === "OWNER") return "所有者";
  if (role === "ADMIN") return "管理员";
  return "成员";
}
