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

/**
 * Per-model lifecycle state, reported only by the multi-model router
 * (server-models.h `server_model_status_to_string`). A single-model
 * server omits the field entirely.
 */
export type ModelStatus =
  | 'downloading'
  | 'downloaded'
  | 'unloaded'
  | 'loading'
  | 'loaded'
  | 'sleeping'
  | 'unknown';

const MODEL_STATUSES: readonly string[] = [
  'downloading',
  'downloaded',
  'unloaded',
  'loading',
  'loaded',
  'sleeping',
  'unknown',
];

export interface ModelDatum {
  id: string;
  aliases: string[];
  tags: string[];
  object: string;
  /** router mode only; absent on a single-model server */
  status?: string;
  /**
   * OpenAI-compat only: llama.cpp fills this with `std::time(0)` at
   * REQUEST time (server-context.cpp `get_res_model_info`), so it is the
   * moment of the scrape — NOT when the model was loaded. Never display
   * it as a timestamp of anything.
   */
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

export interface SlotNextToken {
  has_next_token: boolean;
  has_new_line: boolean;
  n_remain: number;
  /** live generated-token count (server_slot_stats.n_gen), +1 per decoded token */
  n_decoded: number;
}

/**
 * One entry of /slots.
 *
 * Everything below `is_processing` is emitted by upstream inside
 * `if (ptask)` where `ptask = task ? task : task_prev`
 * (server-context.cpp `server_slot::to_json`). Two consequences:
 *  - a slot that has never run a task omits these fields entirely, so
 *    they are optional — a fresh server really does return
 *    `{id, n_ctx, speculative, is_processing}` and nothing else;
 *  - an IDLE slot reports the PREVIOUS task's values. They are history,
 *    not current state, and must never be presented as live.
 */
export interface SlotInfo {
  id: number;
  n_ctx: number;
  speculative: boolean;
  is_processing: boolean;
  id_task?: number;
  n_prompt_tokens?: number;
  /** processed (uncached) prompt tokens of the current or last task */
  n_prompt_tokens_processed?: number;
  n_prompt_tokens_cache?: number;
  params?: SlotParams;
  /** object or single-element array depending on llama.cpp version */
  next_token?: SlotNextToken | SlotNextToken[];
  [key: string]: unknown;
}

/** Normalize the version-dependent next_token shape. */
export function slotNextToken(slot: SlotInfo): SlotNextToken | null {
  const nt = slot.next_token;
  if (nt === undefined) return null;
  return Array.isArray(nt) ? nt[0] ?? null : nt;
}

/**
 * What llama-server actually tells us about its readiness.
 *
 * `/health` has exactly two success shapes upstream:
 *  - HTTP 200 `{"status":"ok"}` once the model is up
 *    (server-context.cpp `get_health`), and
 *  - HTTP 503 `{"error":{"message":"Loading model","type":
 *    "unavailable_error","code":503}}` from the readiness middleware
 *    (server-http.cpp `middleware_server_state`), which blocks EVERY
 *    endpoint until the model finishes loading — so a loading server also
 *    fails /metrics, and without reading /health the dashboard can only
 *    report a bare "HTTP 503".
 */
export type HealthState = 'ok' | 'loading' | 'error' | 'unreachable';

export interface HealthResult {
  state: HealthState;
  /** the server's own message, when it provided one */
  message: string | null;
  httpStatus: number | null;
}

export interface HealthResponse {
  status: string;
}

interface HealthErrorBody {
  error?: { message?: string; type?: string; code?: number };
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
  /** router-reported lifecycle state, null when the server doesn't say */
  status: ModelStatus | null;
}

export function buildModelCards(resp: ModelsResponse): ModelCardData[] {
  const dataById = new Map<string, ModelDatum>(resp.data.map((d) => [d.id, d]));
  return resp.models.map((m) => {
    // Match by id only. There used to be a `?? resp.data[0]` fallback here:
    // with a multi-model server that silently painted the FIRST model's
    // size/params/context onto an unrelated model's card. An unmatched
    // model shows '—' for its numbers instead of another model's.
    const d = dataById.get(m.model) ?? dataById.get(m.name);
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
      status:
        d?.status !== undefined && MODEL_STATUSES.includes(d.status)
          ? (d.status as ModelStatus)
          : null,
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

/**
 * Never throws: a non-200 /health is information, not a failure, so the
 * body is read and classified instead of being turned into an error the
 * way fetchJson would.
 */
export async function fetchHealth(baseUrl: string): Promise<HealthResult> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/health`, { cache: 'no-store' });
  } catch {
    return { state: 'unreachable', message: null, httpStatus: null };
  }
  if (res.ok) {
    const body = await res.json().catch(() => null) as HealthResponse | null;
    return body?.status === 'ok'
      ? { state: 'ok', message: null, httpStatus: res.status }
      : { state: 'error', message: body?.status ?? null, httpStatus: res.status };
  }
  const body = (await res.json().catch(() => null)) as HealthErrorBody | null;
  const message = body?.error?.message ?? null;
  // 503 is the readiness middleware's only status, and it is the right
  // reading for a 503 from anything else in front of the server too:
  // temporarily unavailable, keep retrying. Any other code is a real error.
  return {
    state: res.status === 503 ? 'loading' : 'error',
    message,
    httpStatus: res.status,
  };
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
