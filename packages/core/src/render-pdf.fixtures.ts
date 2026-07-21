// Issue #186 — PDF renderer fixtures (RED → GREEN)
// 测试 PDF 渲染：中文字体加载、分页（长内容）、链接、有效 PDF 输出。
// 字体通过 fixture 注入，不依赖系统字体存在。
import {
  renderEventPdf,
  renderBriefingPdf,
  renderTopicPdf,
  renderTimelinePdf,
  renderSavedPdf,
  type EventPdfInput,
  type BriefingPdfInput,
  type TopicPdfInput,
  type TimelinePdfInput,
  type SavedPdfInput,
} from "./render-pdf.js";
import { resolveTestFontPath } from "./export-test-helpers.js";

export async function runRenderPdfFixtures(): Promise<void> {
  await testEventPdfProducesValidPdf();
  await testEventPdfWithChineseContent();
  await testEventPdfWithLongContentPaginates();
  await testEventPdfIncludesLink();
  await testBriefingPdfProducesValidPdf();
  await testTopicPdfProducesValidPdf();
  await testTopicPdfWithMultipleEvents();
  await testPdfFallbackWhenNoFont();
  await testTimelinePdfProducesValidPdf();
  await testSavedPdfProducesValidPdf();
}

async function testEventPdfProducesValidPdf(): Promise<void> {
  const input: EventPdfInput = {
    title: "Test Event",
    summary: "This is a test summary.",
    category: "test",
    score: 75,
    explanation: "Why it matters.",
    followUpSuggestion: "Follow up on this.",
    occurredAt: "2026-07-19T00:00:00.000Z",
    entities: ["Entity1", "Entity2"],
    sourceName: "Test Source",
    sourceUrl: "https://source.example.com",
    url: "https://example.com/event",
    generatedAt: "2026-07-20T00:00:00.000Z",
    topicName: "Test Topic",
  };

  const pdf = await renderEventPdf(input, { fontResolver: resolveTestFontPath });
  assert(pdf.length > 1000, `PDF must be >1000 bytes, got ${pdf.length}`);
  assert(isValidPdfHeader(pdf), "PDF must start with %PDF header");
  assert(isValidPdfFooter(pdf), "PDF must end with %%EOF");
}

async function testEventPdfWithChineseContent(): Promise<void> {
  const input: EventPdfInput = {
    title: "C919 商业运营进展",
    summary: "中国商飞 C919 完成首次商业飞行，标志着中国大飞机项目进入新阶段。",
    category: "商业运营",
    score: 88,
    explanation: "中国商飞交付里程碑，影响整个商业航空产业链。",
    followUpSuggestion: "跟踪后续航线开通和交付计划。",
    occurredAt: "2026-07-19T00:00:00.000Z",
    entities: ["中国商飞", "东航", "C919"],
    sourceName: "中国商飞",
    sourceUrl: null,
    url: "https://example.com/c919",
    generatedAt: "2026-07-20T00:00:00.000Z",
    topicName: "中国商业航空进展",
  };

  const pdf = await renderEventPdf(input, { fontResolver: resolveTestFontPath });
  assert(pdf.length > 1000, `Chinese PDF must be >1000 bytes, got ${pdf.length}`);
  assert(isValidPdfHeader(pdf), "Chinese PDF must be valid");
}

async function testEventPdfWithLongContentPaginates(): Promise<void> {
  const longSummary = "这是一段很长的摘要内容，用于测试 PDF 分页功能是否正常工作。".repeat(100);
  const input: EventPdfInput = {
    title: "长内容测试",
    summary: longSummary,
    category: null,
    score: 50,
    explanation: longSummary,
    followUpSuggestion: null,
    occurredAt: null,
    entities: [],
    sourceName: null,
    sourceUrl: null,
    url: null,
    generatedAt: "2026-07-20T00:00:00.000Z",
    topicName: "长内容主题",
  };

  const fontPath = resolveTestFontPath();
  const pdf = await renderEventPdf(input, { fontResolver: () => fontPath });
  if (fontPath) {
    assert(pdf.length > 5000, `Long content PDF must be >5000 bytes, got ${pdf.length}`);
    const pdfText = pdf.toString("latin1");
    const pageCountMatch = pdfText.match(/\/Type\s*\/Pages\s*[^]*?\/Count\s+(\d+)/);
    if (pageCountMatch) {
      const count = parseInt(pageCountMatch[1]!, 10);
      assert(count > 1, `Long content must produce >1 page, got ${count}`);
    }
  } else {
    // CI without CJK font: Helvetica fallback produces smaller output.
    // Just verify a valid non-empty PDF was produced.
    assert(pdf.length > 100, `PDF must be non-empty, got ${pdf.length}`);
  }
}

async function testEventPdfIncludesLink(): Promise<void> {
  const input: EventPdfInput = {
    title: "链接测试",
    summary: "测试 PDF 链接功能。",
    category: null,
    score: 50,
    explanation: null,
    followUpSuggestion: null,
    occurredAt: null,
    entities: [],
    sourceName: null,
    sourceUrl: null,
    url: "https://example.com/link-test",
    generatedAt: "2026-07-20T00:00:00.000Z",
    topicName: "链接主题",
  };

  const pdf = await renderEventPdf(input, { fontResolver: resolveTestFontPath });
  const pdfText = pdf.toString("latin1");
  assert(
    pdfText.includes("/URI") && pdfText.includes("https://example.com/link-test"),
    "PDF must contain link annotation",
  );
}

async function testBriefingPdfProducesValidPdf(): Promise<void> {
  const input: BriefingPdfInput = {
    title: "每日简报",
    period: "DAILY",
    rangeStart: "2026-07-19T00:00:00.000Z",
    rangeEnd: "2026-07-20T00:00:00.000Z",
    generatedAt: "2026-07-20T00:00:00.000Z",
    markdown: "# 简报标题\n\n简报正文内容。",
    events: [
      { title: "事件一", url: "https://example.com/1", occurredAt: "2026-07-19T00:00:00.000Z" },
    ],
    topicName: "测试主题",
  };

  const pdf = await renderBriefingPdf(input, { fontResolver: resolveTestFontPath });
  assert(pdf.length > 1000, `Briefing PDF must be >1000 bytes, got ${pdf.length}`);
  assert(isValidPdfHeader(pdf), "Briefing PDF must be valid");
}

async function testTopicPdfProducesValidPdf(): Promise<void> {
  const input: TopicPdfInput = {
    topicName: "批量导出主题",
    generatedAt: "2026-07-20T00:00:00.000Z",
    events: [
      {
        title: "事件一",
        summary: "摘要一",
        category: "分类A",
        score: 80,
        explanation: null,
        followUpSuggestion: null,
        occurredAt: null,
        entities: [],
        sourceName: null,
        sourceUrl: null,
        url: "https://example.com/1",
        generatedAt: "2026-07-20T00:00:00.000Z",
        topicName: "批量导出主题",
      },
    ],
  };

  const pdf = await renderTopicPdf(input, { fontResolver: resolveTestFontPath });
  assert(pdf.length > 1000, `Topic PDF must be >1000 bytes, got ${pdf.length}`);
  assert(isValidPdfHeader(pdf), "Topic PDF must be valid");
}

async function testTopicPdfWithMultipleEvents(): Promise<void> {
  const events: EventPdfInput[] = [];
  for (let i = 0; i < 10; i++) {
    events.push({
      title: `事件 ${i + 1}`,
      summary: `这是事件 ${i + 1} 的摘要，包含足够的内容来测试多事件渲染。`.repeat(5),
      category: "分类",
      score: 70 + i,
      explanation: null,
      followUpSuggestion: null,
      occurredAt: null,
      entities: [],
      sourceName: "来源",
      sourceUrl: null,
      url: i % 2 === 0 ? `https://example.com/${i}` : null,
      generatedAt: "2026-07-20T00:00:00.000Z",
      topicName: "多事件主题",
    });
  }

  const fontPath = resolveTestFontPath();
  const pdf = await renderTopicPdf(
    { topicName: "多事件主题", generatedAt: "2026-07-20T00:00:00.000Z", events },
    { fontResolver: () => fontPath },
  );
  if (fontPath) {
    assert(pdf.length > 5000, `Multi-event PDF must be >5000 bytes, got ${pdf.length}`);
  } else {
    assert(pdf.length > 100, `PDF must be non-empty, got ${pdf.length}`);
  }
}

async function testPdfFallbackWhenNoFont(): Promise<void> {
  const input: EventPdfInput = {
    title: "Fallback Test",
    summary: "Testing fallback when no CJK font is available.",
    category: null,
    score: 50,
    explanation: null,
    followUpSuggestion: null,
    occurredAt: null,
    entities: [],
    sourceName: null,
    sourceUrl: null,
    url: null,
    generatedAt: "2026-07-20T00:00:00.000Z",
    topicName: "Fallback",
  };

  // fontResolver 返回 null，renderer 必须仍能生成 PDF（用 Helvetica fallback）
  const pdf = await renderEventPdf(input, { fontResolver: () => null });
  assert(pdf.length > 500, `Fallback PDF must be >500 bytes, got ${pdf.length}`);
  assert(isValidPdfHeader(pdf), "Fallback PDF must be valid");
}

// Issue #187 — Timeline PDF
async function testTimelinePdfProducesValidPdf(): Promise<void> {
  const events: EventPdfInput[] = [
    {
      title: "C919 商业运营进展",
      summary: "C919 完成首次商业飞行。",
      category: "商业运营",
      score: 88,
      explanation: "里程碑事件。",
      followUpSuggestion: null,
      occurredAt: "2026-07-19T00:00:00.000Z",
      entities: ["中国商飞"],
      sourceName: "民航局",
      sourceUrl: null,
      url: "https://example.com/c919",
      generatedAt: "2026-07-20T00:00:00.000Z",
      topicName: "中国商业航空进展",
    },
    {
      title: "ARJ21 交付",
      summary: "ARJ21 交付给成都航空。",
      category: "交付",
      score: 75,
      explanation: null,
      followUpSuggestion: null,
      occurredAt: null,
      entities: [],
      sourceName: null,
      sourceUrl: null,
      url: null,
      generatedAt: "2026-07-20T00:00:00.000Z",
      topicName: "中国商业航空进展",
    },
  ];

  const input: TimelinePdfInput = {
    topicName: "中国商业航空进展",
    generatedAt: "2026-07-20T00:00:00.000Z",
    events,
  };

  const pdf = await renderTimelinePdf(input, { fontResolver: resolveTestFontPath });
  assert(pdf.length > 1000, `Timeline PDF must be >1000 bytes, got ${pdf.length}`);
  assert(isValidPdfHeader(pdf), "Timeline PDF must start with %PDF header");
  assert(isValidPdfFooter(pdf), "Timeline PDF must end with %%EOF");
}

// Issue #187 — Saved collection PDF
async function testSavedPdfProducesValidPdf(): Promise<void> {
  const events: EventPdfInput[] = [
    {
      title: "收藏事件 1",
      summary: "用户收藏的第一个事件。",
      category: "重要",
      score: 85,
      explanation: "用户标记为重要。",
      followUpSuggestion: null,
      occurredAt: "2026-07-19T00:00:00.000Z",
      entities: ["实体A"],
      sourceName: "来源A",
      sourceUrl: null,
      url: "https://example.com/saved-1",
      generatedAt: "2026-07-20T00:00:00.000Z",
      topicName: "主题A",
    },
    {
      title: "收藏事件 2",
      summary: "用户收藏的第二个事件。",
      category: null,
      score: 60,
      explanation: null,
      followUpSuggestion: null,
      occurredAt: null,
      entities: [],
      sourceName: null,
      sourceUrl: null,
      url: null,
      generatedAt: "2026-07-20T00:00:00.000Z",
      topicName: "主题B",
    },
  ];

  const input: SavedPdfInput = {
    generatedAt: "2026-07-20T00:00:00.000Z",
    events,
  };

  const pdf = await renderSavedPdf(input, { fontResolver: resolveTestFontPath });
  assert(pdf.length > 1000, `Saved PDF must be >1000 bytes, got ${pdf.length}`);
  assert(isValidPdfHeader(pdf), "Saved PDF must start with %PDF header");
  assert(isValidPdfFooter(pdf), "Saved PDF must end with %%EOF");
}

function isValidPdfHeader(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-";
}

function isValidPdfFooter(buf: Buffer): boolean {
  // %%EOF 可能在文件末尾附近（可能有 trailing whitespace）
  const tail = buf.subarray(-1024).toString("latin1");
  return tail.includes("%%EOF");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`PDF fixture failed: ${message}`);
}