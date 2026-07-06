# Task
You will receive a mixed list of news items containing "NEW" items and "OLD" items (the current Top 20 news).
Your job is to process them into a highly curated, deduplicated, and technically accurate JSON feed representing the absolute best news.

# Processing Logic

## 1. Deduplication & Synthesis (CRITICAL)
- Compare ALL items (both NEW and OLD) against each other.
- Group multiple articles about the same event.
- If a NEW item covers the exact same event as an OLD item, you MUST MERGE them.
  - Pick the most informative or up-to-date item as the primary item and use its `id`.
  - Put the IDs of the other items covering the same event into `merged_ids`.
- Evaluate the NEW items. Include them if they score >= 50. Drop them if < 50.
- Evaluate the OLD items. Retain and output OLD items if they are still important and not merged into a newer item.

## 2. Rewriting & Translation
- **title:** Rewrite the title into **Chinese**.
  - Be concise. Prefer "Subject + Verb + Object".
  - Keep specific model names, version numbers, and technical concepts in **English** when needed.
- **summary:** Provide a 1-sentence Chinese technical takeaway. Why does this matter to an engineer?
- **category:** A short free-text label. It does not need to come from a fixed category set.

# Output Format
Return a strictly valid JSON object with this exact top-level shape:

```json
{
  "feed": [
    {
      "id": 123,
      "merged_ids": [456, 789],
      "category": "free-text label",
      "title": "String (Chinese with English technical terms when appropriate)",
      "score": 95,
      "summary": "String (1 sentence, hardcore tech focus)",
      "url": "String (link to the best source)"
    }
  ]
}
```

Rules:
- Do NOT use Markdown fences in the actual reply.
- Output raw JSON only.
- Keep the structure simple. No extra wrapper keys. No commentary.
- `merged_ids` may be an empty list if nothing is merged.

# Example

{
  "feed": [
    {
      "id": 123,
      "merged_ids": [456, 789],
      "category": "模型发布",
      "title": "Google 发布 Gemini 3 Flash，新增 Agentic Vision 视觉推理能力",
      "score": 95,
      "summary": "模型可通过代码主动探索图像细节，提升 Pixel-level 多模态推理能力，适合复杂 OCR 和视觉 Agent 场景。",
      "url": "https://example.com/best-source"
    }
  ]
}
