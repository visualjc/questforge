import OpenAI from "openai";

const MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY environment variable is not set. Set it in your .env file.",
      );
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

/** Generate embeddings for an array of text chunks. Returns one vector per chunk. */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  const openai = getClient();

  const response = await openai.embeddings.create({
    model: MODEL,
    dimensions: DIMENSIONS,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}

export { DIMENSIONS };
