// Issue #182 (Plan Task 4.6) - 浏览器简报详情 Markdown 安全渲染。
//
// 设计决策：不引入 react-markdown / remark / rehype / DOMPurify 等第三方依赖。
// 原因：(1) schema 不变约束；(2) bundle 体积；(3) 简报 Markdown 是系统生成的
// 结构化内容（renderDailyBriefingMarkdown 产出），语法子集有限且已知；
// (4) 自写白名单渲染器完全可控、可单测、无供应链风险。
//
// 安全模型：
//   1. 所有用户/LLM 文本内容先经 HTML escape（& < > " '）。
//   2. 只处理已知 Markdown 子集：#/## 标题、有序/无序列表、**bold**、[text](url)、段落、--- 分隔。
//   3. 链接 URL 必须通过 isHttpUrl 校验（http/https only），否则不生成 <a>。
//   4. 不渲染 <img>、<script>、<iframe> 等任何 HTML 标签（源文本中的标签已被 escape）。
//   5. 链接强制 rel="noopener noreferrer" target="_blank"。
//   6. sanitizeBriefingBody 作为 content fallback 的额外兜底（中和残留危险 URL/标签）。
//
// 这是防御性渲染器：即使输入包含恶意 HTML，产出也是纯文本或白名单 HTML。

import { isHttpUrl } from "@wangchao/core";

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);
}

// 危险 URL scheme 中和（用于 sanitizeBriefingBody 兜底）。
const DANGEROUS_URL_SCHEME = /\b(javascript|data|vbscript|file):/gi;

// 危险 HTML 标签（自闭合或配对）- 在 sanitize 阶段中和为纯文本。
const DANGEROUS_TAG_PATTERN = /<\/?(script|iframe|object|embed|link|style|meta|img|svg|form|input|button)\b[^>]*>/gi;

// 行内事件处理器（onerror=、onclick= 等）。
const EVENT_HANDLER_PATTERN = /\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/**
 * 兜底 sanitize：用于非 Markdown 的 content fallback 或任何需要纯文本安全输出的场景。
 * 中和危险标签、事件处理器和危险 URL scheme，保留普通文本。
 */
export function sanitizeBriefingBody(text: string): string {
  if (!text) return "";
  return text
    .replace(DANGEROUS_TAG_PATTERN, "")
    .replace(EVENT_HANDLER_PATTERN, "")
    .replace(DANGEROUS_URL_SCHEME, "blocked:")
    .trim();
}

// [text](url) 链接匹配。url 部分允许 () 内的任意非空白字符。
const LINK_PATTERN = /\[([^\]]*)\]\(([^)\s]+)\)/g;

// **bold** 匹配。
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g;

/**
 * 行内格式处理：先 escape 所有文本，再处理 bold 和 link。
 * 顺序很重要：先 escape 保证 < > & 等变成实体，后续的 ** 和 [] 匹配的是已 escape 后的文本
 * （markdown 语法符号 * [ ] ( ) 本身不是 HTML 特殊字符，escape 不影响它们）。
 */
function renderInline(text: string): string {
  const escaped = escapeHtml(text);

  // bold: **text** -> <strong>text</strong>
  let result = escaped.replace(BOLD_PATTERN, (_match, inner: string) => {
    return `<strong>${inner}</strong>`;
  });

  // link: [text](url) -> <a href="url" ...>text</a>（仅 http/https）
  result = result.replace(LINK_PATTERN, (_match, linkText: string, url: string) => {
    const trimmedUrl = url.trim();
    if (!isHttpUrl(trimmedUrl)) {
      // 不安全的 URL：只保留显示文本，不生成 <a>。
      return linkText;
    }
    return `<a href="${escapeHtml(trimmedUrl)}" rel="noopener noreferrer" target="_blank">${linkText}</a>`;
  });

  return result;
}

// YAML frontmatter（--- ... ---）整体移除，不渲染到正文。
function stripFrontmatter(markdown: string): string {
  const frontmatterPattern = /^---\n[\s\S]*?\n---\n?/;
  return markdown.replace(frontmatterPattern, "");
}

/**
 * 将简报 Markdown 渲染为安全的 HTML 片段。
 *
 * 支持的语法子集（对齐 renderDailyBriefingMarkdown 产出）：
 *   - # / ## 标题 -> <h1> / <h2>
 *   - 有序列表 `1. ` -> <ol><li>
 *   - 无序列表 `- ` -> <ul><li>
 *   - 缩进子项 `   - ` -> 嵌套 <ul><li>（简化：并入父 li）
 *   - **bold** -> <strong>
 *   - [text](url) -> <a>（仅 http/https）
 *   - --- 分隔线 -> <hr>
 *   - 段落 -> <p>
 *   - YAML frontmatter 移除
 *
 * 所有文本经 HTML escape；不支持的 HTML 标签在源文本中被 escape 成纯文本显示。
 */
export function renderBriefingMarkdown(markdown: string): string {
  if (!markdown || !markdown.trim()) return "";

  const source = stripFrontmatter(markdown);
  const lines = source.split("\n");

  const html: string[] = [];
  let i = 0;
  let inOl = false;
  let inUl = false;

  const closeLists = () => {
    if (inOl) {
      html.push("</ol>");
      inOl = false;
    }
    if (inUl) {
      html.push("</ul>");
      inUl = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // 空行：关闭列表，跳过。
    if (line.trim() === "") {
      closeLists();
      i++;
      continue;
    }

    // --- 分隔线（独立行，3+ 个 -）。
    if (/^---+\s*$/.test(line)) {
      closeLists();
      html.push("<hr>");
      i++;
      continue;
    }

    // ## 标题（先匹配 ## 再匹配 #，避免 # 被 ## 误匹配）。
    if (line.startsWith("## ")) {
      closeLists();
      html.push(`<h2>${renderInline(line.slice(3))}</h2>`);
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      closeLists();
      html.push(`<h1>${renderInline(line.slice(2))}</h1>`);
      i++;
      continue;
    }

    // 有序列表项：`1. ` / `2. ` 等。
    const olMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      if (!inOl) {
        closeLists();
        html.push("<ol>");
        inOl = true;
      }
      // 收集缩进子项（以 3+ 空格开头的 - 或文本）。
      const subItems: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const sub = lines[j] ?? "";
        if (/^\s{2,}-\s+/.test(sub) || /^\s{3,}\S/.test(sub)) {
          subItems.push(sub);
          j++;
        } else {
          break;
        }
      }
      const mainContent = renderInline(olMatch[2] ?? "");
      if (subItems.length > 0) {
        const subHtml = subItems
          .map((s) => {
            const cleaned = s.replace(/^\s+/, "").replace(/^-\s+/, "");
            return `<li>${renderInline(cleaned)}</li>`;
          })
          .join("");
        html.push(`<li>${mainContent}<ul>${subHtml}</ul></li>`);
        i = j;
      } else {
        html.push(`<li>${mainContent}</li>`);
        i++;
      }
      continue;
    }

    // 无序列表项：`- `（行首，非缩进）。
    const ulMatch = line.match(/^-\s+(.*)$/);
    if (ulMatch) {
      if (!inUl) {
        closeLists();
        html.push("<ul>");
        inUl = true;
      }
      html.push(`<li>${renderInline(ulMatch[1] ?? "")}</li>`);
      i++;
      continue;
    }

    // 段落：非空、非列表、非标题、非分隔线的行。
    closeLists();
    // 收集连续段落行。
    const paraLines: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j] ?? "";
      if (
        next.trim() === "" ||
        next.startsWith("# ") ||
        next.startsWith("## ") ||
        /^---+\s*$/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        /^-\s+/.test(next)
      ) {
        break;
      }
      paraLines.push(next);
      j++;
    }
    html.push(`<p>${renderInline(paraLines.join(" "))}</p>`);
    i = j;
  }

  closeLists();
  return html.join("\n");
}
