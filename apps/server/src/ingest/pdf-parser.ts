import { getDocumentProxy, extractText } from "unpdf";

/** Extract all text content from a PDF file. */
export async function parsePdf(filePath: string): Promise<string> {
  const buffer = await Bun.file(filePath).arrayBuffer();
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });

  if (!text.trim()) {
    throw new Error(`PDF contains no extractable text: ${filePath}`);
  }

  return text;
}
