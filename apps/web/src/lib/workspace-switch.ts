/**
 * Issue #155 — Active workspace cookie 常量与读写 helper。
 *
 * active workspace ID 通过 HTTP cookie 存储，不修改 schema。
 * Cookie 只存 organizationId（cuid），由后端验证 Membership 归属。
 */
export const ACTIVE_WORKSPACE_COOKIE = "wc-active-org";
export const ACTIVE_WORKSPACE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * 从 cookie header 值中安全读取 active workspace ID。
 * 只接受非空字符串，不做格式校验（后端 resolveActiveWorkspace 会验证 Membership 归属）。
 */
export function readActiveWorkspaceCookie(
  cookieValue: string | undefined | null,
): string | null {
  if (!cookieValue || cookieValue.trim().length === 0) {
    return null;
  }
  return cookieValue.trim();
}
