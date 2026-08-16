/**
 * Types + fetchers for the llama-server REST endpoints we consume:
 * /metrics (via prometheus parser), /models, /slots, /health.
 */

export interface ModelDetails {
  parent_model: string;
  format: string;
  family: string;
  families: string[];
  parameter_size: string;
  quantization_level: string;
}

export interface ModelInfo {
  name: string;
  model: string;
  modified_at: string;
  size: string;
  digest: string;
  type: string;
  description: string;
  tags: string[];
  capabilities: string[];
  parameters: string;
  details: ModelDetails;
}

export interface ModelDatum {
  id: string;
  aliases: string[];
  tags: string[];
  object: string;
  created: number;
  owned_by: string;
  meta: {
    vocab_type: number;
    n_vocab: number;
    n_ctx: number;
    n_ctx_train: number;
    n_embd: number;
    n_params: number;
    size: number;
    ftype: string;
  };
}

export interface ModelsResponse {
  models: ModelInfo[];
  object: string;
  data: ModelDatum[];
}

export interface SlotParams {
  seed: number;
  temperature: number;
  dynatemp_range: number;
  dynatemp_exponent: number;
  top_k: number;
  top_p: number;
  min_p: number;
  top_n_sigma: number;
  xtc_probability: number;
  xtc_threshold: number;
  typical_p: number;
  repeat_last_n: number;
  repeat_penalty: number;
  presence_penalty: number;
  frequency_penalty: number;
  dry_multiplier: number;
  dry_base: number;
  dry_allowed_length: number;
  dry_penalty_last_n: number;
  mirostat: number;
  mirostat_tau: number;
  mirostat_eta: number;
  adaptive_target: number;
  adaptive_decay: number;
  max_tokens: number;
  n_predict: number;
  n_keep: number;
  n_discard: number;
  ignore_eos: boolean;
  stream: boolean;
  n_probs: number;
  [key: string]: number | boolean | string;
}

export interface SlotInfo {
  id: number;
  n_ctx: number;
  speculative: boolean;
  is_processing: boolean;
  id_task: number;
  n_prompt_tokens: number;
  n_prompt_tokens_processed: number;
  n_prompt_tokens_cache: number;
  params: SlotParams;
  [key: string]: unknown;
}

export interface HealthResponse {
  status: string;
}

/**
 * Merge /models' `models[]` (names/tags) with `data[]` (numeric details).
 * The numeric detail block only exists in `data[]`, so prefer it.
 */
export interface ModelCardData {
  name: string;
  aliases: string[];
  tags: string[];
  capabilities: string[];
  format: string;
  ftype: string | null;
  sizeBytes: number | null;
  nParams: number | null;
  nCtx: number | null;
  nCtxTrain: number | null;
  nVocab: number | null;
  nEmbD: number | null;
  created: number | null;
}

export function buildModelCards(resp: ModelsResponse): ModelCardData[] {
  const dataById = new Map<string, ModelDatum>(resp.data.map((d) => [d.id, d]));
  return resp.models.map((m) => {
    const d = dataById.get(m.model) ?? dataById.get(m.name) ?? resp.data[0];
    return {
      name: m.name,
      aliases: d?.aliases ?? [],
      tags: [...new Set([...m.tags, ...(d?.tags ?? [])])],
      capabilities: m.capabilities,
      format: m.details.format,
      ftype: d?.meta.ftype || null,
      sizeBytes: d ? d.meta.size : null,
      nParams: d ? d.meta.n_params : null,
      nCtx: d ? d.meta.n_ctx : null,
      nCtxTrain: d ? d.meta.n_ctx_train : null,
      nVocab: d ? d.meta.n_vocab : null,
      nEmbD: d ? d.meta.n_embd : null,
      created: d?.created ?? null,
    };
  });
}

export class ServerError extends Error {
  constructor(
    message: string,
    public readonly kind: 'network' | 'http' | 'parse',
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

async function fetchJson<T>(url: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, { cache: 'no-store' });
  } catch (e) {
    throw new ServerError(`Network error reaching ${url}${path}: ${(e as Error).message}`, 'network');
  }
  if (!res.ok) {
    throw new ServerError(`${path} returned HTTP ${res.status}`, 'http');
  }
  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new ServerError(`${path} returned invalid JSON: ${(e as Error).message}`, 'parse');
  }
}

export function fetchModels(baseUrl: string): Promise<ModelsResponse> {
  return fetchJson<ModelsResponse>(baseUrl, '/models');
}

export function fetchSlots(baseUrl: string): Promise<SlotInfo[]> {
  return fetchJson<SlotInfo[]>(baseUrl, '/slots');
}

export function fetchHealth(baseUrl: string): Promise<HealthResponse> {
  return fetchJson<HealthResponse>(baseUrl, '/health');
}

export async function fetchMetricsText(baseUrl: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/metrics`, { cache: 'no-store' });
  } catch (e) {
    throw new ServerError(
      `Network error reaching ${baseUrl}/metrics — the server is unreachable or blocked the browser (CORS). For llama.cpp, start the server with --cors-origins * (or a value covering this page's origin).`,
      'network',
    );
  }
  if (!res.ok) {
    throw new ServerError(`/metrics returned HTTP ${res.status}`, 'http');
  }
  return res.text();
}

/** Strip trailing slash so callers can concatenate paths safely. */
export function normalizeBaseUrl(raw: string): string {
  let u = raw.trim();
  if (u === '') return u;
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  while (u.endsWith('/')) u = u.slice(0, -1);
  return u;
}
