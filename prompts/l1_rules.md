# Data Processing & Output Instructions

1. **Filter & Score:** Analyze each input item based on the "Selection Logic". Discard any item with a Score < 70.
2. **Deduplicate (Merge):** Identify multiple stories covering the **same specific event**. Group them together.
   - Select the **single most informative/technical title** from the group.
   - Prefer English titles for technical accuracy unless the Chinese report contains exclusive details.
3. **Format:** Output the result as a strict, valid **JSON object**.
   - Do NOT use Markdown code blocks (like ```json). Just output the raw JSON string.
   - Structure the JSON by categories: "AI_Algorithms", "Aerospace_HardTech", "Major_Industry_Moves".
   - **Context Field:** Add a brief (1-sentence) note in Chinese *only* if the title is vague or requires context to highlight why it's a "Tier 1" event. Otherwise, set to null.

# Example Output Style (JSON)

{
  "AI_Algorithms": [
    {
      "title": "Gemini 3 Flash’s new ‘Agentic Vision’ improves image responses",
      "sources": ["9to5Google", "Google Blog"],
      "score": 95,
      "context": null
    },
    {
      "title": "Moonshot AI releases open-source Kimi K2.5 model with 1T parameters",
      "sources": ["SiliconANGLE", "Venturebeat"],
      "score": 96,
      "context": "支持长上下文，权重已开源，适合本地部署测试。"
    },
    {
      "title": "Claude Code Skills: 使用技能新功能扩展CC能力",
      "sources": ["Claude Code Docs"],
      "score": 98,
      "context": "Create, manage, and share skills to extend Claude’s capabilities in Claude Code. Includes custom slash commands."
    }
  ],
  "Aerospace_HardTech": [
    {
      "title": "SpaceX to Shift 4,000 Starlink Orbits After Near Miss With Chinese Satellite",
      "sources": ["ExtremeTech", "SCMP"],
      "score": 90,
      "context": null
    }
  ],
  "Major_Industry_Moves": [
    {
      "title": "路透社：中国已批准首批英伟达H200芯片进口",
      "sources": ["RFI", "凤凰网"],
      "score": 90,
      "context": "缓解字节/阿里等大厂算力缺口，涉及H200合规版。"
    }
  ]
}
