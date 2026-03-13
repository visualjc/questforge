const CHARS_PER_TOKEN = 4;
const DEFAULT_CHUNK_SIZE = 512; // tokens
const DEFAULT_OVERLAP = 50; // tokens

/** Split text into overlapping chunks of approximately `chunkSize` tokens. */
export function chunkText(
  text: string,
  chunkSizeTokens: number = DEFAULT_CHUNK_SIZE,
  overlapTokens: number = DEFAULT_OVERLAP,
): string[] {
  const chunkSizeChars = chunkSizeTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;
  const stepSize = chunkSizeChars - overlapChars;

  if (stepSize <= 0) {
    throw new Error("Chunk size must be greater than overlap");
  }

  const chunks: string[] = [];

  for (let start = 0; start < text.length; start += stepSize) {
    const chunk = text.slice(start, start + chunkSizeChars).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
  }

  return chunks;
}
