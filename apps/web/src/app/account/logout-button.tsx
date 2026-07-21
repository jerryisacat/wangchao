"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    try {
      await authClient.signOut();
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <Button
      className="w-full sm:w-auto"
      disabled={loading}
      onClick={() => void logout()}
      variant="outline"
    >
      <LogOut aria-hidden="true" size={16} />
      {loading ? "正在登出…" : "退出当前账户"}
    </Button>
  );
}
