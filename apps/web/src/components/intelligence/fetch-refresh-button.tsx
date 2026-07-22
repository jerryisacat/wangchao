"use client";

import { RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { runFetchCycleAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

interface FetchRefreshButtonProps {
  returnTo: string;
}

export function FetchRefreshButton({ returnTo }: FetchRefreshButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleRefresh() {
    startTransition(async () => {
      await runFetchCycleAction(returnTo);
    });
  }

  return (
    <Button
      aria-label="手动刷新抓取最新情报"
      disabled={isPending}
      onClick={handleRefresh}
      size="sm"
      variant="secondary"
    >
      <RefreshCw
        aria-hidden="true"
        className={isPending ? "animate-spin" : ""}
        size={14}
      />
      <span>{isPending ? "刷新中…" : "刷新"}</span>
    </Button>
  );
}
