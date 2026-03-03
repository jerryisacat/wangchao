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
- Evaluate the OLD items. You MUST retain and output OLD items if they are still important and not merged into a newer item.

## 2. Rewriting & Translation (Crucial)
- **Title:** Rewrite the title into **Chinese**.
  - **Rule:** Be concise. Use "Subject + Verb + Object" structure.
  - **Exception:** Keep specific model names, version numbers, and technical concepts in **English**.
  - *Bad:* 谷歌发布了双子座3号代理视觉功能。
  - *Good:* Google 发布 Gemini 3 Flash，新增 Agentic Vision 视觉推理能力。
- **Context:** Provide a 1-sentence technical takeaway in Chinese. Why does this matter to an engineer? (e.g., "Supports 1M context", "Fixes OOM in K8s", "First orbit achievement").

# Output Format
Return a strictly valid JSON object. 

```json
{
  "feed": [
    {
      "id": 123,
      "merged_ids": [456, 789],
      "category": "AI_Algo" | "Dev_Infra" | "Aerospace" | "Hardware" | "Policy_Biz",
      "title_optimized": "String (Chinese with English terms)",
      "score": Number (0-100),
      "original_sources": ["Source A", "Source B"],
      "technical_summary": "String (1 sentence, hardcore tech focus)",
      "url": "String (Link to the best source)"
    }
  ]
}
```

# Example Processing

**Input:**

1. "Gemini 3 Flash’s new ‘Agentic Vision’ improves image responses" (9to5Google)
2. "Google Deepmind gives Gemini 3 Flash ability to explore images" (The Decoder)
3. "SpaceX Starship Flight 6 ready for launch next Tuesday"

**Output:** (You don't need to generate ```json)

```json
{
  "feed": [
    {
      "category": "AI_Algo",
      "title_optimized": "Google DeepMind 发布 Gemini 3 Flash：引入 Agentic Vision 主动视觉推理",
      "score": 95,
      "original_sources": ["9to5Google", "The Decoder"],
      "technical_summary": "模型可通过代码主动探索图像细节，提升了 Pixel-level 的多模态推理能力，适合复杂 OCR 和视觉 Agent 场景。",
      "url": "..."
    },
    {
      "category": "Aerospace",
      "title_optimized": "SpaceX 确认 Starship Flight 6 将于下周二发射",
      "score": 100,
      "original_sources": ["SpaceNews"],
      "technical_summary": "本次发射将重点测试一级助推器捕获及二级飞船的在轨热防护改进。",
      "url": "..."
    }
  ]
}
```
