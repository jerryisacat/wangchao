// Issue #182 (Plan Task 4.6) — 浏览器简报详情 Markdown 安全渲染。
// 这些断言锁定 briefing-markdown renderer 的 XSS 防御契约：
//   - 所有用户/LLM 内容经 HTML escape，<script>/<iframe>/onerror 等不得存活。
//   - 链接只允许 http/https，javascript:/data: 必须被中和。
//   - 白名单 Markdown 子集（#/##、有序/无序列表、**bold**、[text](url)、段落）正确渲染。
//   - 裸 URL 在列表项里保留为文本（不自动 <a>），跳转由页面 Event 链接承载。
// 不引入 react-markdown/remark/rehype 等第三方依赖（schema 不变约束 + bundle 体积）。
import assert from "node:assert/strict";
import {
  normalizeBriefingDisplayText,
  renderBriefingMarkdown,
  sanitizeBriefingBody,
} from "../src/lib/briefing-markdown.ts";

// 1. 基本 Markdown 子集渲染
{
  const md = "# 标题\n\n## 子标题\n\n1. 第一条\n   - 摘要：内容\n   - 原文链接：https://example.com/a\n2. **第二条**\n";
  const html = renderBriefingMarkdown(md);
  assert.ok(html.includes("<h1>标题</h1>"), `h1 must render, got: ${html}`);
  assert.ok(html.includes("<h2>子标题</h2>"), `h2 must render, got: ${html}`);
  assert.ok(html.includes("<ol>"), `ordered list must render, got: ${html}`);
  assert.ok(html.includes("<li>第一条"), `list item must render, got: ${html}`);
  assert.ok(html.includes("<strong>第二条</strong>"), `bold must render, got: ${html}`);
  assert.ok(!html.includes("**"), `bold markers must be consumed, got: ${html}`);
}

// 2. XSS: <script> 标签不得存活
{
  const malicious = "# 标题\n\n<script>alert('xss')</script>\n\n正文\n";
  const html = renderBriefingMarkdown(malicious);
  assert.ok(!html.includes("<script"), `script tag must not survive as HTML, got: ${html}`);
  assert.ok(!html.includes("</script>"), `closing script tag must not survive, got: ${html}`);
  // 'alert' may appear as escaped text content inside <p>, which is safe.
  assert.ok(html.includes("正文"), `safe content must remain, got: ${html}`);
}

// 3. XSS: <img> 标签不得作为 HTML 元素存活（onerror 不会成为属性）
{
  const malicious = '<img src=x onerror=alert(1)>\n\n正文';
  const html = renderBriefingMarkdown(malicious);
  // <img must not appear as a live HTML tag; it should be escaped to &lt;img.
  assert.ok(!html.includes("<img "), `<img tag must not survive as HTML element, got: ${html}`);
  assert.ok(html.includes("&lt;img"), `img tag must be escaped to text, got: ${html}`);
  assert.ok(html.includes("正文"), `safe content must remain, got: ${html}`);
}

// 4. XSS: javascript: URL 不得成为 href
{
  const malicious = "[点击](javascript:alert(1))\n\n正文";
  const html = renderBriefingMarkdown(malicious);
  assert.ok(!html.includes("javascript:"), `javascript: URL must not survive, got: ${html}`);
  assert.ok(!html.includes('href='), `no safe href should be emitted for javascript: URL, got: ${html}`);
}

// 5. XSS: 合法 http/https 链接正确渲染为 <a>
{
  const md = "[example](https://example.com)\n";
  const html = renderBriefingMarkdown(md);
  assert.ok(
    html.includes('<a href="https://example.com"'),
    `http link must render as <a>, got: ${html}`,
  );
  assert.ok(
    html.includes('rel="noopener noreferrer"'),
    `links must carry rel=noopener, got: ${html}`,
  );
}

// 6. sanitizeBriefingBody: 原始 HTML 标签被 escape（不渲染）
{
  const raw = "<iframe src='evil'></iframe>正常文本";
  const cleaned = sanitizeBriefingBody(raw);
  assert.ok(!cleaned.includes("<iframe"), `iframe must be escaped, got: ${cleaned}`);
  assert.ok(cleaned.includes("正常文本"), `safe text must remain, got: ${cleaned}`);
}

// 7. sanitizeBriefingBody: data: URL 中和
{
  const raw = '<a href="data:text/html,<script>alert(1)</script>">x</a>';
  const cleaned = sanitizeBriefingBody(raw);
  assert.ok(!cleaned.includes("data:text/html"), `data: URL must be neutralized, got: ${cleaned}`);
}

// 8. 空/空白输入安全处理
{
  assert.equal(renderBriefingMarkdown(""), "");
  assert.equal(renderBriefingMarkdown("   \n\n  "), "");
  assert.equal(sanitizeBriefingBody(""), "");
}

// 9. 工程化相关性解释转换为读者可理解的简体中文
{
  const raw = "Matched topic keywords: AI. Matched include scope: infrastructure.";
  const normalized = normalizeBriefingDisplayText(raw);
  assert.equal(normalized, "命中主题关键词：AI。 命中覆盖范围：infrastructure。");
  const html = renderBriefingMarkdown(raw);
  assert.ok(!html.includes("Matched topic"), `internal wording must not render, got: ${html}`);
  assert.ok(html.includes("命中主题关键词：AI。"), `localized explanation must render, got: ${html}`);
}

process.stdout.write("Briefing markdown renderer fixture passed.\n");
