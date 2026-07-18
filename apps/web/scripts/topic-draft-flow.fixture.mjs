import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseTopicProfileDraftResponse } from "@wangchao/ai";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── RED guard: the topic-creation flow must be split into generate + confirm ──
//
// Before this change, /topics/new posted straight to createTopicAction which
// wrote Topic + Source rows. The new flow must:
//   1. generateTopicDraftAction: produce a draft and hand it to the preview
//      page WITHOUT touching Topic/Source tables.
//   2. confirmCreateTopicAction: the ONLY action allowed to call createTopic.
//
// These static assertions make a regression to "submit creates directly"
// fail the suite.

const topicsPath = join(
  __dirname,
  "..",
  "src",
  "app",
  "actions",
  "topics.ts",
);
const topicsContent = readFileSync(topicsPath, "utf8");

assert.ok(
  topicsContent.includes("export async function generateTopicDraftAction"),
  "topics.ts must export generateTopicDraftAction (step 1: draft only).",
);

assert.ok(
  topicsContent.includes("export async function confirmCreateTopicAction"),
  "topics.ts must export confirmCreateTopicAction (step 2: persist).",
);

// generateTopicDraftAction must NOT call createTopic — it only writes a cookie.
const generateStart = topicsContent.indexOf(
  "export async function generateTopicDraftAction",
);
const generateEnd = topicsContent.indexOf(
  "export async function confirmCreateTopicAction",
);
const generateBlock = topicsContent.slice(generateStart, generateEnd);
assert.ok(
  !generateBlock.includes("createTopic("),
  "generateTopicDraftAction must not call createTopic — confirm is the only persist step.",
);
assert.ok(
  !generateBlock.includes("createCandidateRssSource"),
  "generateTopicDraftAction must not write candidate sources.",
);
assert.ok(
  generateBlock.includes("fallbackTopicProfileDraft"),
  "generateTopicDraftAction must provide a rules fallback when AI is unavailable.",
);

// confirmCreateTopicAction (and its helper createTopicFromConfirmedDraft) must
// re-validate the submitted draft through the parser so a hand-edited or
// tampered payload cannot bypass the schema.
const confirmStart = topicsContent.indexOf(
  "export async function confirmCreateTopicAction",
);
const confirmBlock = topicsContent.slice(confirmStart);
assert.ok(
  confirmBlock.includes("parseTopicProfileDraftResponse"),
  "confirmCreateTopicAction path must re-validate the draft via parseTopicProfileDraftResponse.",
);

// The persisted profile must carry the generator source marker so downstream
// observability can tell a draft-generated profile from a manual edit.
assert.ok(
  topicsContent.includes('source: "topic-profile-generator" as const'),
  "confirmed profile must tag source as topic-profile-generator.",
);

// The draft handoff must be a short-lived httpOnly cookie scoped to /topics/new.
assert.ok(
  topicsContent.includes('const TOPIC_DRAFT_COOKIE = "wc_topic_draft"'),
  "draft handoff must use the wc_topic_draft cookie.",
);
assert.ok(
  /maxAge:\s*(\d|\w)/.test(generateBlock),
  "draft cookie must have a bounded maxAge so it cannot outlive the session.",
);
// The bound itself must be a literal, not unbounded.
assert.ok(
  topicsContent.includes("TOPIC_DRAFT_COOKIE_MAX_AGE_SECONDS = ") &&
    /\d\s*\*\s*\d/.test(
      topicsContent.match(/TOPIC_DRAFT_COOKIE_MAX_AGE_SECONDS\s*=\s*[^\n]+/)?.[0] ?? "",
    ),
  "draft cookie maxAge must be a bounded numeric expression.",
);
assert.ok(
  generateBlock.includes("httpOnly: true"),
  "draft cookie must be httpOnly to keep it out of client JS.",
);

// The preview page must exist and read the cookie (not assume a draft is in
// the URL or a DB row).
const previewPath = join(
  __dirname,
  "..",
  "src",
  "app",
  "topics",
  "new",
  "preview",
  "page.tsx",
);
const previewContent = readFileSync(previewPath, "utf8");
assert.ok(
  previewContent.includes('from "next/headers"') &&
    previewContent.includes("wc_topic_draft"),
  "preview page must read the draft from the server cookie, not from the URL.",
);
assert.ok(
  previewContent.includes("TopicDraftPreviewForm"),
  "preview page must render the editable draft form.",
);

// The new-topic page must no longer post directly to createTopicAction.
const newPath = join(
  __dirname,
  "..",
  "src",
  "app",
  "topics",
  "new",
  "page.tsx",
);
const newContent = readFileSync(newPath, "utf8");
assert.ok(
  newContent.includes("generateTopicDraftAction"),
  "/topics/new must submit to generateTopicDraftAction.",
);
assert.ok(
  !newContent.includes("createTopicAction"),
  "/topics/new must NOT submit to createTopicAction directly.",
);

// ── Re-validation behaviour: confirm rejects malformed drafts ──

// A draft missing required fields must throw so confirmCreateTopicAction
// surfaces "草案格式不正确".
assert.throws(
  () =>
    parseTopicProfileDraftResponse(
      JSON.stringify({ schemaVersion: 1, name: "x" }),
    ),
  /Invalid topic profile draft JSON|keywords/,
  "Parser must reject a draft missing required fields.",
);

// A draft with an unsupported schemaVersion must throw — workers read the
// stored profile through buildTopicProfileContext (shape-tolerant), but the
// draft generator pins the version so a future breaking change is explicit.
assert.throws(
  () =>
    parseTopicProfileDraftResponse(
      JSON.stringify({
        schemaVersion: 2,
        name: "x",
        keywords: ["a"],
        entities: [],
        includeScope: [],
        excludeScope: [],
        importanceRules: [],
        languagePreferences: { outputLanguage: "zh-CN", terminologyRules: [] },
        digestStyle: {
          structure: "standard",
          detailLevel: "standard",
          maxEvents: 10,
        },
      }),
    ),
  /schemaVersion/,
  "Parser must reject an unsupported schemaVersion.",
);

// A well-formed AI draft must round-trip with generationMode "ai".
const goodDraft = parseTopicProfileDraftResponse(
  JSON.stringify({
    schemaVersion: 1,
    name: "中国商业航空进展",
    keywords: ["C919", "适航认证"],
    entities: ["COMAC"],
    includeScope: ["C919 商业运营"],
    excludeScope: ["航旅营销"],
    importanceRules: ["官方公告优先"],
    languagePreferences: {
      outputLanguage: "zh-CN",
      terminologyRules: ["COMAC 保留英文"],
    },
    digestStyle: {
      structure: "standard",
      detailLevel: "standard",
      maxEvents: 12,
    },
  }),
);
assert.equal(
  goodDraft.generationMode,
  "ai",
  "Parsed AI draft must be tagged generationMode=ai.",
);
assert.equal(
  goodDraft.digestStyle.maxEvents,
  12,
  "Parsed draft must preserve AI-chosen maxEvents.",
);

process.stdout.write("Topic draft flow fixture passed.\n");