/**
 * 解码浏览器展示中常见的命名、零填充十进制和十六进制 HTML 实体。
 * 调用方仍应交给 React 文本节点或安全 renderer 输出，不把结果当作 HTML 注入。
 */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(?:0*38|x0*26);/gi, "&")
    .replace(/&#(?:0*39|x0*27);/gi, "'")
    .replace(/&#(?:0*34|x0*22);/gi, '"')
    .replace(/&#(?:0*60|x0*3c);/gi, "<")
    .replace(/&#(?:0*62|x0*3e);/gi, ">")
    .replace(/&#(?:0*160|x0*a0);/gi, " ");
}

/** 将事件分类内部值转换为面向用户的中文标签。 */
export function formatCategoryLabel(category: string): string {
  const [rawKind = "", ...rawValueParts] = category.split(":");
  const value = decodeHtmlEntities(rawValueParts.join(":").trim());
  if (!value) {
    return decodeHtmlEntities(category);
  }

  const kindLabel: Record<string, string> = {
    entity: "实体",
    keyword: "关键词",
    scope: "覆盖范围",
    source: "来源",
  };
  return `${kindLabel[rawKind.toLowerCase()] ?? "内容方向"} · ${value}`;
}
