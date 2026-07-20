// SPEC §5.7 知识库导出 — PDF 渲染器。
// 使用 pdfkit 生成 PDF，支持中文字体、分页、链接。
// 字体资产策略（固定 fallback 链，不引入运行时网络字体依赖）：
//   1. WANGCHAO_PDF_FONT_PATH 环境变量指定的字体路径
//   2. packages/core/assets/fonts/NotoSansSC-Regular.otf（仓库内置资产，OFL-1.1）
//   3. Linux 部署环境系统字体 /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
//   4. macOS 开发环境 /System/Library/Fonts/Supplemental/Songti.ttc
// 测试通过 fixture 注入 fontResolver，不依赖真实字体文件存在。

import type { PDFKitDocument } from "./pdf-types.js";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const nodeRequire = createRequire(import.meta.url);

const FALLBACK_FONT_PATHS: ReadonlyArray<string> = [
  // Linux Railway/Docker 常见 CJK 字体路径
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  // macOS 开发环境
  "/System/Library/Fonts/Supplemental/Songti.ttc",
];

const ASSET_FONT_RELATIVE = "assets/fonts/NotoSansSC-Regular.otf";

export type FontResolver = () => string | null;

let cachedFontPath: string | null | undefined;

export function getDefaultFontResolver(): FontResolver {
  return () => {
    if (cachedFontPath !== undefined) return cachedFontPath;

    // 1. 环境变量
    const envPath = process.env.WANGCHAO_PDF_FONT_PATH;
    if (envPath) {
      cachedFontPath = envPath;
      return envPath;
    }

    // 2. 仓库内置资产（通过 require.resolve 定位包根，再拼接 assets 路径）
    const assetPath = resolveAssetFont();
    if (assetPath) {
      cachedFontPath = assetPath;
      return assetPath;
    }

    // 3-4. 系统字体 fallback
    for (const sysPath of FALLBACK_FONT_PATHS) {
      try {
        if (fs.existsSync(sysPath)) {
          cachedFontPath = sysPath;
          return sysPath;
        }
      } catch {
        // fs 不可用或路径无效，继续尝试下一个
      }
    }

    cachedFontPath = null;
    return null;
  };
}

function resolveAssetFont(): string | null {
  try {
    // __dirname 在 ESM 编译后指向 dist/，向上一级找 assets/
    const moduleDir = path.dirname(__filename);
    const assetPath = path.join(moduleDir, "..", ASSET_FONT_RELATIVE);
    if (fs.existsSync(assetPath)) return assetPath;
  } catch {
    // 路径不可用，跳过
  }
  return null;
}

/** @internal 仅供测试清除缓存 */
export function resetFontCache(): void {
  cachedFontPath = undefined;
}

export interface RenderPdfOptions {
  fontResolver?: FontResolver;
  /** 页边距 pt，默认 72 (1 inch) */
  margin?: number;
  /** 正文字号 pt，默认 11 */
  fontSize?: number;
  /** 行高倍数，默认 1.5 */
  lineHeight?: number;
}

export interface EventPdfInput {
  title: string;
  summary: string;
  category: string | null;
  score: number;
  explanation: string | null;
  followUpSuggestion: string | null;
  occurredAt: string | null;
  entities: string[];
  sourceName: string | null;
  sourceUrl: string | null;
  url: string | null;
  generatedAt: string;
  topicName: string;
}

export interface BriefingPdfInput {
  title: string;
  period: "DAILY" | "WEEKLY" | "MONTHLY";
  rangeStart: string;
  rangeEnd: string;
  generatedAt: string;
  markdown: string | null;
  events: Array<{
    title: string;
    url: string | null;
    occurredAt: string | null;
  }>;
  topicName: string;
}

export interface TopicPdfInput {
  topicName: string;
  generatedAt: string;
  events: Array<EventPdfInput>;
}

// Issue #187 - Timeline PDF 输入。结构与 TopicPdf 一致，语义不同（全量时间线）。
export interface TimelinePdfInput {
  topicName: string;
  generatedAt: string;
  events: Array<EventPdfInput>;
}

// Issue #187 - Saved collection PDF 输入。
export interface SavedPdfInput {
  generatedAt: string;
  events: Array<EventPdfInput>;
}

export function renderEventPdf(
  event: EventPdfInput,
  options: RenderPdfOptions = {},
): Promise<Buffer> {
  const { doc, getBufferPromise } = createPdfDocument(options);
  const fontPath = (options.fontResolver ?? getDefaultFontResolver())();
  registerFont(doc, fontPath);

  const margin = options.margin ?? 72;
  const fontSize = options.fontSize ?? 11;
  const lineHeight = options.lineHeight ?? 1.5;

  doc
    .fontSize(fontSize)
    .lineGap(fontSize * (lineHeight - 1));

  // 标题
  doc
    .fontSize(20)
    .text(event.title, { align: "left" });

  // 元信息
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor("#666666");
  doc.text(`主题：${event.topicName}`);
  doc.text(`生成时间：${event.generatedAt}`);
  if (event.occurredAt) {
    doc.text(`发生时间：${event.occurredAt}`);
  }
  doc.fillColor("#000000");

  // 分隔线
  doc.moveDown(0.5);
  drawDivider(doc, margin);

  // 摘要
  doc.moveDown(0.5);
  doc.fontSize(13).text("摘要", { continued: false });
  doc.moveDown(0.3);
  doc.fontSize(fontSize).text(event.summary);

  // 为什么重要
  if (event.explanation) {
    doc.moveDown(1);
    doc.fontSize(13).text("为什么重要");
    doc.moveDown(0.3);
    doc.fontSize(fontSize).text(event.explanation);
  }

  // 元数据
  doc.moveDown(1);
  doc.fontSize(13).text("元数据");
  doc.moveDown(0.3);
  doc.fontSize(fontSize);
  doc.text(`评分：${Math.round(event.score)}`);
  doc.text(`分类：${event.category ?? "通用"}`);
  doc.text(`来源：${event.sourceName ?? "未知来源"}`);
  if (event.entities.length > 0) {
    doc.text(`相关实体：${event.entities.join("、")}`);
  }

  // 后续跟踪
  if (event.followUpSuggestion) {
    doc.moveDown(1);
    doc.fontSize(13).text("后续跟踪");
    doc.moveDown(0.3);
    doc.fontSize(fontSize).text(event.followUpSuggestion);
  }

  // 原文链接
  if (event.url) {
    doc.moveDown(1);
    doc.fontSize(13).text("原文链接");
    doc.moveDown(0.3);
    doc
      .fontSize(fontSize)
      .fillColor("#0066cc")
      .text(event.url, { link: event.url, underline: true })
      .fillColor("#000000");
  }

  return finalizePdf(doc, getBufferPromise);
}

export function renderBriefingPdf(
  briefing: BriefingPdfInput,
  options: RenderPdfOptions = {},
): Promise<Buffer> {
  const { doc, getBufferPromise } = createPdfDocument(options);
  const fontPath = (options.fontResolver ?? getDefaultFontResolver())();
  registerFont(doc, fontPath);

  const fontSize = options.fontSize ?? 11;

  doc.fontSize(20).text(briefing.title);

  doc.moveDown(0.5);
  doc.fontSize(9).fillColor("#666666");
  doc.text(`主题：${briefing.topicName}`);
  doc.text(`周期：${briefing.period}`);
  doc.text(`时间范围：${briefing.rangeStart} ~ ${briefing.rangeEnd}`);
  doc.text(`生成时间：${briefing.generatedAt}`);
  doc.fillColor("#000000");

  const margin = options.margin ?? 72;
  doc.moveDown(0.5);
  drawDivider(doc, margin);

  if (briefing.markdown) {
    doc.moveDown(0.5);
    renderMarkdownToPdf(doc, briefing.markdown, fontSize);
  }

  if (briefing.events.length > 0) {
    doc.moveDown(1);
    doc.fontSize(13).text("关联情报");
    doc.moveDown(0.3);
    doc.fontSize(fontSize);
    for (const event of briefing.events) {
      const line = event.occurredAt
        ? `${event.occurredAt}  ${event.title}`
        : event.title;
      if (event.url) {
        doc
          .fillColor("#0066cc")
          .text(line, { link: event.url, underline: true })
          .fillColor("#000000");
      } else {
        doc.text(line);
      }
    }
  }

  return finalizePdf(doc, getBufferPromise);
}

export function renderTopicPdf(
  topic: TopicPdfInput,
  options: RenderPdfOptions = {},
): Promise<Buffer> {
  const { doc, getBufferPromise } = createPdfDocument(options);
  const fontPath = (options.fontResolver ?? getDefaultFontResolver())();
  registerFont(doc, fontPath);

  const fontSize = options.fontSize ?? 11;

  doc.fontSize(20).text(`${topic.topicName} — 批量导出`);

  doc.moveDown(0.5);
  doc.fontSize(9).fillColor("#666666");
  doc.text(`生成时间：${topic.generatedAt}`);
  doc.text(`情报数量：${topic.events.length}`);
  doc.fillColor("#000000");

  const margin = options.margin ?? 72;
  doc.moveDown(0.5);
  drawDivider(doc, margin);

  for (let i = 0; i < topic.events.length; i++) {
    const event = topic.events[i]!;
    doc.moveDown(1);
    doc.fontSize(14).text(`${i + 1}. ${event.title}`);
    doc.moveDown(0.3);
    doc.fontSize(fontSize).text(event.summary);
    doc.text(`评分：${Math.round(event.score)}`);
    if (event.url) {
      doc
        .fillColor("#0066cc")
        .text(event.url, { link: event.url, underline: true })
        .fillColor("#000000");
    }
  }

  return finalizePdf(doc, getBufferPromise);
}

// Issue #187 - Timeline PDF 渲染。
// 复用 TopicPdf 的分页事件列表布局，标题区分语义。
export function renderTimelinePdf(
  timeline: TimelinePdfInput,
  options: RenderPdfOptions = {},
): Promise<Buffer> {
  const { doc, getBufferPromise } = createPdfDocument(options);
  const fontPath = (options.fontResolver ?? getDefaultFontResolver())();
  registerFont(doc, fontPath);

  const fontSize = options.fontSize ?? 11;

  doc.fontSize(20).text(`${timeline.topicName} — 时间线导出`);

  doc.moveDown(0.5);
  doc.fontSize(9).fillColor("#666666");
  doc.text(`生成时间：${timeline.generatedAt}`);
  doc.text(`情报数量：${timeline.events.length}`);
  doc.fillColor("#000000");

  const margin = options.margin ?? 72;
  doc.moveDown(0.5);
  drawDivider(doc, margin);

  for (let i = 0; i < timeline.events.length; i++) {
    const event = timeline.events[i]!;
    doc.moveDown(1);
    doc.fontSize(14).text(`${i + 1}. ${event.title}`);
    doc.moveDown(0.3);
    doc.fontSize(fontSize).text(event.summary);
    doc.text(`评分：${Math.round(event.score)}`);
    if (event.occurredAt) {
      doc.text(`发生时间：${event.occurredAt}`);
    }
    if (event.url) {
      doc
        .fillColor("#0066cc")
        .text(event.url, { link: event.url, underline: true })
        .fillColor("#000000");
    }
  }

  return finalizePdf(doc, getBufferPromise);
}

// Issue #187 - Saved collection PDF 渲染。
// 当前用户收藏集合，跨主题。
export function renderSavedPdf(
  saved: SavedPdfInput,
  options: RenderPdfOptions = {},
): Promise<Buffer> {
  const { doc, getBufferPromise } = createPdfDocument(options);
  const fontPath = (options.fontResolver ?? getDefaultFontResolver())();
  registerFont(doc, fontPath);

  const fontSize = options.fontSize ?? 11;

  doc.fontSize(20).text("收藏集合导出");

  doc.moveDown(0.5);
  doc.fontSize(9).fillColor("#666666");
  doc.text(`生成时间：${saved.generatedAt}`);
  doc.text(`情报数量：${saved.events.length}`);
  doc.fillColor("#000000");

  const margin = options.margin ?? 72;
  doc.moveDown(0.5);
  drawDivider(doc, margin);

  for (let i = 0; i < saved.events.length; i++) {
    const event = saved.events[i]!;
    doc.moveDown(1);
    doc.fontSize(14).text(`${i + 1}. ${event.title}`);
    doc.moveDown(0.3);
    doc.fontSize(fontSize).text(event.summary);
    doc.text(`评分：${Math.round(event.score)}`);
    if (event.topicName) {
      doc.text(`主题：${event.topicName}`);
    }
    if (event.occurredAt) {
      doc.text(`发生时间：${event.occurredAt}`);
    }
    if (event.url) {
      doc
        .fillColor("#0066cc")
        .text(event.url, { link: event.url, underline: true })
        .fillColor("#000000");
    }
  }

  return finalizePdf(doc, getBufferPromise);
}

function createPdfDocument(options: RenderPdfOptions): { doc: PDFKitDocument; getBufferPromise: () => Promise<Buffer> } {
  // 动态 require 避免 pdfkit 在纯 typecheck 环境拉入 stream 类型
  const PDFDocument = nodeRequire("pdfkit") as {
    new (opts: Record<string, unknown>): unknown;
  };
  const margin = options.margin ?? 72;
  const doc = new PDFDocument({
    margins: {
      top: margin,
      bottom: margin,
      left: margin,
      right: margin,
    },
    bufferPages: true,
  }) as unknown as PDFKitDocument;

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  return {
    doc,
    getBufferPromise: () =>
      new Promise<Buffer>((resolve) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        if (chunks.length > 0) {
          // stream already ended
          resolve(Buffer.concat(chunks));
        }
      }),
  };
}

function registerFont(doc: PDFKitDocument, fontPath: string | null): void {
  if (fontPath) {
    try {
      doc.font(fontPath);
      return;
    } catch {
      // 字体加载失败，fallback 到 Helvetica（中文会渲染失败但 PDF 能生成）
    }
  }
  doc.font("Helvetica");
}

function drawDivider(doc: PDFKitDocument, margin: number): void {
  const width = doc.page.width - margin * 2;
  const y = doc.y;
  doc
    .moveTo(margin, y)
    .lineTo(margin + width, y)
    .strokeColor("#cccccc")
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.5);
}

/**
 * 将 Markdown 摘要文本渲染到 PDF。
 * 仅处理 heading (#)、分隔线 (---) 和普通段落，不做完整 Markdown 渲染。
 */
function renderMarkdownToPdf(
  doc: PDFKitDocument,
  markdown: string,
  fontSize: number,
): void {
  const lines = markdown.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      doc.moveDown(0.5);
      continue;
    }
    if (trimmed === "---") {
      doc.moveDown(0.3);
      const margin = doc.page.margins.left;
      drawDivider(doc, margin);
      continue;
    }
    if (trimmed.startsWith("# ")) {
      doc.fontSize(15).text(trimmed.slice(2));
      doc.moveDown(0.3);
      doc.fontSize(fontSize);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      doc.fontSize(13).text(trimmed.slice(3));
      doc.moveDown(0.3);
      doc.fontSize(fontSize);
      continue;
    }
    doc.fontSize(fontSize).text(trimmed);
  }
}

function finalizePdf(
  doc: PDFKitDocument,
  getBufferPromise: () => Promise<Buffer>,
): Promise<Buffer> {
  doc.end();
  return getBufferPromise();
}