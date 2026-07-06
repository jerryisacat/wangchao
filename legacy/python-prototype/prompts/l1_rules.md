# Data Processing & Output Instructions

1. **Filter & Score:** Analyze each input item based on the selection logic. Discard any item with a score < 70.
2. **Deduplicate (Merge):** Identify multiple stories covering the **same specific event**. Keep only the single most informative/technical item from each event cluster.
   - Prefer the most informative title.
   - Prefer English titles for technical accuracy unless the Chinese report contains exclusive details.
3. **Format:** Output the result as a strict, valid **JSON object**.
   - Do NOT use Markdown code blocks. Output raw JSON only.
   - Use this top-level shape exactly:

```json
{
  "items": [
    {
      "id": 1,
      "category": "free-text label",
      "score": 95,
      "context": null
    }
  ]
}
```

4. **Field Rules:**
   - **Each selected item MUST include the input `id` field exactly as provided.**
   - `category` is a short free-text label. It does **not** need to come from a fixed category set.
   - `context` should be a brief 1-sentence Chinese note **only if** the title is vague or needs extra context to explain why it matters. Otherwise use `null`.
   - Do **not** include unselected items.
   - Keep the structure as simple as possible. No extra keys.

# Example Output

{
  "items": [
    {
      "id": 1,
      "category": "模型发布",
      "score": 95,
      "context": null
    },
    {
      "id": 4,
      "category": "开源模型",
      "score": 96,
      "context": "支持长上下文，权重已开源，适合本地部署测试。"
    },
    {
      "id": 12,
      "category": "产业动态",
      "score": 90,
      "context": "缓解字节/阿里等大厂算力缺口，涉及 H200 合规版。"
    }
  ]
}
