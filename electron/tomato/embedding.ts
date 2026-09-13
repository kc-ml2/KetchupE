import { mkdir } from "node:fs/promises";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
export const EMBEDDING_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
export const EMBEDDING_DIMENSIONS = 384;
export const EMBEDDING_PROFILE = `${EMBEDDING_MODEL}@${EMBEDDING_REVISION}:q8:mean:l2:e5-prefix-v1`;

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

export async function embedTexts(
  texts: string[],
  kind: "query" | "passage",
  cacheDirectory: string,
): Promise<Float32Array[]> {
  if (!texts.length) return [];
  await mkdir(cacheDirectory, { recursive: true });
  if (!extractorPromise) {
    extractorPromise = import("@huggingface/transformers")
      .then(({ pipeline }) => pipeline("feature-extraction", EMBEDDING_MODEL, {
        revision: EMBEDDING_REVISION,
        dtype: "q8",
        cache_dir: cacheDirectory,
      }))
      .catch((error) => {
        extractorPromise = undefined;
        throw error;
      });
  }
  const extractor = await extractorPromise;
  const output = await extractor(texts.map((text) => `${kind}: ${text}`), { pooling: "mean", normalize: true });
  const rows = output.tolist() as number[][];
  if (rows.length !== texts.length || rows.some((row) => row.length !== EMBEDDING_DIMENSIONS)) {
    throw new Error(`잘못된 embedding shape: ${JSON.stringify(output.dims)}`);
  }
  return rows.map((row) => Float32Array.from(row));
}

export function vectorToBlob(vector: Float32Array): Buffer {
  const blob = Buffer.allocUnsafe(vector.length * 4);
  for (let index = 0; index < vector.length; index += 1) blob.writeFloatLE(vector[index], index * 4);
  return blob;
}

export function blobToVector(blob: Uint8Array): Float32Array {
  if (blob.byteLength % 4 !== 0) throw new Error(`잘못된 vector byte length: ${blob.byteLength}`);
  const view = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const vector = new Float32Array(blob.byteLength / 4);
  for (let index = 0; index < vector.length; index += 1) vector[index] = view.readFloatLE(index * 4);
  return vector;
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) throw new Error(`vector 차원이 다릅니다: ${left.length} != ${right.length}`);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}
