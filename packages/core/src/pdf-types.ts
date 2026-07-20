// Minimal type shim for pdfkit.
// pdfkit 的 @types 用 namespace + default export，这里收敛为编译期需要的最小接口。
export interface PDFKitDocument {
  page: {
    width: number;
    margins: { top: number; bottom: number; left: number; right: number };
  };
  y: number;
  font(name: string): PDFKitDocument;
  font(path: string, size?: number): PDFKitDocument;
  fontSize(size: number): PDFKitDocument;
  fillColor(color: string): PDFKitDocument;
  lineGap(gap: number): PDFKitDocument;
  text(text: string, options?: PDFTextOptions): PDFKitDocument;
  text(text: string, x?: number, y?: number, options?: PDFTextOptions): PDFKitDocument;
  moveTo(x: number, y: number): PDFKitDocument;
  lineTo(x: number, y: number): PDFKitDocument;
  strokeColor(color: string): PDFKitDocument;
  lineWidth(width: number): PDFKitDocument;
  stroke(): PDFKitDocument;
  moveDown(lines?: number): PDFKitDocument;
  end(): PDFKitDocument;
  on(event: "data", listener: (chunk: Buffer) => void): PDFKitDocument;
  on(event: "end", listener: () => void): PDFKitDocument;
}

export interface PDFTextOptions {
  align?: "left" | "center" | "right" | "justify";
  link?: string;
  underline?: boolean;
  continued?: boolean;
  width?: number;
  height?: number;
}