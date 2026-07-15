import { lookup } from "node:dns/promises";

export const BLOCKED_HOSTS: string[] = [
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",
  "[::]",
  "[fc00:fe::]",
  "0.0.0.0",
  "[::1]",
];

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_REGEX = /^[0-9a-fA-F:]+$/;

function parseIPv4(ip: string): number | null {
  const match = ip.match(IPV4_REGEX);
  if (!match) return null;
  const octets = [match[1], match[2], match[3], match[4]].map((o) => Number.parseInt(o!, 10));
  if (octets.some((o) => o > 255)) return null;
  return (octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!;
}

function isIPv4Private(ip: string): boolean {
  const num = parseIPv4(ip);
  if (num === null) return false;
  if ((num >>> 24) === 127) return true;
  if ((num >>> 24) === 10) return true;
  if ((num >>> 20) === 0xac10) return true;
  if ((num >>> 16) === 0xc0a8) return true;
  if ((num >>> 16) === 0xa9fe) return true;
  if ((num >>> 16) === 0x0a00) return true;
  if ((num >>> 12) === 0x1000) return true;
  return false;
}

function normalizeIPv6(ip: string): string | null {
  if (!IPV6_REGEX.test(ip)) return null;
  let expanded = ip;
  if (expanded.includes("::")) {
    const [left, right] = expanded.split("::");
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];
    const missing = 8 - leftParts.length - rightParts.length;
    const middle = new Array(missing).fill("0");
    expanded = [...leftParts, ...middle, ...rightParts].join(":");
  }
  const parts = expanded.split(":");
  if (parts.length !== 8) return null;
  return parts
    .map((p) => p.padStart(4, "0").toLowerCase())
    .join(":");
}

function isIPv6Private(ip: string): boolean {
  const normalized = normalizeIPv6(ip);
  if (!normalized) return false;
  if (normalized === "0000:0000:0000:0000:0000:0000:0000:0001") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fec0:")) return true;
  return false;
}

export function isPrivateIP(ip: string): boolean {
  if (ip.includes(".")) return isIPv4Private(ip);
  if (ip.includes(":")) return isIPv6Private(ip);
  return false;
}

export async function resolveAndCheckUrl(
  url: string,
): Promise<{ blocked: boolean; reason?: string; ip?: string }> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { blocked: true, reason: "Invalid URL" };
  }

  const lowerHost = hostname.toLowerCase();
  if (BLOCKED_HOSTS.some((h) => h.toLowerCase() === lowerHost)) {
    return { blocked: true, reason: `Blocked hostname: ${hostname}` };
  }

  if (lowerHost.startsWith("[") && lowerHost.endsWith("]")) {
    const inner = lowerHost.slice(1, -1);
    if (isPrivateIP(inner)) {
      return { blocked: true, reason: `Blocked IP: ${inner}`, ip: inner };
    }
  }

  const ipv4Match = lowerHost.match(IPV4_REGEX);
  if (ipv4Match) {
    if (isIPv4Private(lowerHost)) {
      return { blocked: true, reason: `Blocked IP: ${lowerHost}`, ip: lowerHost };
    }
    return { blocked: false, ip: lowerHost };
  }

  try {
    const addresses = await lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateIP(address)) {
        return { blocked: true, reason: `Resolved to blocked IP: ${address}`, ip: address };
      }
    }
    return { blocked: false, ip: addresses[0]?.address };
  } catch {
    return { blocked: true, reason: `DNS resolution failed for: ${hostname}` };
  }
}

export async function assertSafeUrl(url: string): Promise<void> {
  const result = await resolveAndCheckUrl(url);
  if (result.blocked) {
    throw new Error(`URL blocked by SSRF protection: ${result.reason}`);
  }
}
