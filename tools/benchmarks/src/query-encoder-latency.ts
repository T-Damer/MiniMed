/**
 * Query-encoder latency on one CPU thread through onnxruntime-node and the app's transformers.js
 * tokenizer — a host proxy for the phone (a phone is several times slower). Compares ONNX exports
 * of candidate query models on the Q1 real-language queries (`retrieval-icd-queries.json`) and
 * writes the query vectors so their agreement with the PyTorch reference can be checked
 * (docs/research/embeddinggemma-2-2026-10-07.md).
 *
 *   bun tools/benchmarks/src/query-encoder-latency.ts --model-dir=<dir with <repo>/…> \
 *     --model=Xenova/multilingual-e5-small:onnx/model_quantized.onnx:query:\  \
 *     --model='onnx-community/embeddinggemma-2-ONNX:onnx/model_q4.onnx:task: search result | query: ' \
 *     --out=<scratch>/onnx-queries.json
 *
 * `--model` is `<repository>:<onnx file>:<query prefix>`. Nothing is fetched from the network.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AutoTokenizer, env } from '@huggingface/transformers';
import * as ort from 'onnxruntime-node';

const values = (name: string): string[] =>
  process.argv
    .filter((item) => item.startsWith(`--${name}=`))
    .map((item) => item.slice(name.length + 3));
const one = (name: string): string => {
  const value = values(name)[0];
  if (!value) throw new Error(`Missing --${name}=…`);
  return value;
};

const modelDirectory = resolve(one('model-dir'));
env.allowRemoteModels = false;
env.localModelPath = `${modelDirectory}/`;

const queries = (
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../retrieval-icd-queries.json'), 'utf8'),
  ) as {
    queries: { id: string; query: string }[];
  }
).queries;

const report: Record<string, unknown> = {};
for (const spec of values('model')) {
  const [repository, file, ...prefixParts] = spec.split(':');
  if (!repository || !file) throw new Error(`Bad --model=${spec}`);
  const prefix = prefixParts.join(':');
  const path = `${modelDirectory}/${repository}/${file}`;
  const bytes = [path, `${path}_data`].reduce((sum, item) => {
    try {
      return sum + statSync(item).size;
    } catch {
      return sum;
    }
  }, 0);
  const tokenizer = await AutoTokenizer.from_pretrained(repository);
  const session = await ort.InferenceSession.create(path, {
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all',
  });
  const emptyFeatures = new ort.Tensor('float32', new Float32Array(0), [0, 512]);
  const encode = async (text: string): Promise<Float32Array> => {
    const encoded = tokenizer(prefix + text, { truncation: true, max_length: 512 });
    const ids = encoded.input_ids.data as BigInt64Array;
    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor('int64', ids, [1, ids.length]),
      attention_mask: new ort.Tensor('int64', encoded.attention_mask.data as BigInt64Array, [
        1,
        ids.length,
      ]),
    };
    for (const name of session.inputNames) {
      if (name === 'token_type_ids') {
        feeds[name] = new ort.Tensor('int64', new BigInt64Array(ids.length), [1, ids.length]);
      } else if (name.endsWith('_features')) {
        feeds[name] = emptyFeatures;
      }
    }
    const output = await session.run(feeds);
    const pooled = output['sentence_embedding'];
    let vector: Float32Array;
    if (pooled) {
      vector = Float32Array.from(pooled.data as Float32Array);
    } else {
      // Mean pooling over the attention mask (e5).
      const hidden = output['last_hidden_state'];
      if (!hidden) throw new Error(`${repository}: no last_hidden_state`);
      const width = hidden.dims[2] ?? 0;
      const data = hidden.data as Float32Array;
      vector = new Float32Array(width);
      for (let token = 0; token < ids.length; token += 1) {
        for (let k = 0; k < width; k += 1) {
          vector[k] = (vector[k] ?? 0) + (data[token * width + k] ?? 0) / ids.length;
        }
      }
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((value) => value / norm);
  };
  for (const query of queries.slice(0, 5)) await encode(query.query);
  const timings: number[] = [];
  const vectors: Record<string, number[]> = {};
  for (const query of queries) {
    const started = performance.now();
    const vector = await encode(query.query);
    timings.push(performance.now() - started);
    vectors[query.id] = Array.from(vector);
  }
  timings.sort((a, b) => a - b);
  const at = (q: number) => Number((timings[Math.floor(q * (timings.length - 1))] ?? 0).toFixed(1));
  report[`${repository}:${file}`] = { bytes, p50Ms: at(0.5), p90Ms: at(0.9), vectors };
  console.log(
    `${repository} ${file}: ${(bytes / 1e6).toFixed(0)} MB, 1 thread p50 ${at(0.5)} ms, p90 ${at(0.9)} ms (n ${timings.length})`,
  );
  await session.release();
}
writeFileSync(resolve(one('out')), JSON.stringify(report));
