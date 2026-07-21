// 测试辅助：定位 CJK 字体文件路径。
// 优先查找 /tmp/font-test/NotoSansSC-Regular.otf（开发环境下载的测试字体），
// 然后查找 macOS 系统字体 Songti.ttc，
// 最后返回 null（触发 Helvetica fallback）。
import fs from "node:fs";

export function resolveTestFontPath(): string | null {
  const candidates = [
    "/tmp/font-test/NotoSansSC-Regular.otf",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
  ];
  for (const path of candidates) {
    try {
      if (fs.existsSync(path)) return path;
    } catch {
      // continue
    }
  }
  return null;
}