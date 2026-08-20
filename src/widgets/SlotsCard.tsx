/** Live /slots strip: compact rows, click to expand sampling params. */
import { useState } from 'react';
import type { SlotInfo } from '../lib/api';
import { formatCount, type NumberFormat } from '../lib/format';

const PARAM_KEYS = [
  'temperature',
  'dynatemp_range',
  'dynatemp_exponent',
  'top_k',
  'top_p',
  'min_p',
  'top_n_sigma',
  'typical_p',
  'repeat_last_n',
  'repeat_penalty',
  'presence_penalty',
  'frequency_penalty',
  'mirostat',
  'mirostat_tau',
  'mirostat_eta',
  'adaptive_target',
  'adaptive_decay',
  'max_tokens',
  'n_predict',
  'n_keep',
  'n_discard',
  'ignore_eos',
  'seed',
] as const;

export function SlotsCard({
  slots,
  fmt,
}: {
  slots: SlotInfo[] | null;
  fmt: NumberFormat;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (!slots) return <span className="muted">waiting for /slots…</span>;
  if (slots.length === 0) return <span className="muted">no slots</span>;

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {slots.map((s) => {
        const open = expanded.has(s.id);
        // Upstream serializes the task fields from `task ? task : task_prev`,
        // so an idle slot echoes the LAST task's prompt counters and a
        // never-used slot omits them. Only label them as current while the
        // slot is actually processing; otherwise mark them as history.
        const hasTask = s.n_prompt_tokens !== undefined;
        const cached =
          s.n_prompt_tokens_cache !== undefined && s.n_prompt_tokens_cache > 0
            ? ` · cached ${formatCount(s.n_prompt_tokens_cache, fmt)}`
            : '';
        return (
          <div key={s.id}>
            <div className="slot-row" onClick={() => toggle(s.id)} role="button" aria-expanded={open}>
              <span className={`status-dot ${s.is_processing ? 'stale' : 'ok'}`} />
              <span className="slot-id">slot {s.id}</span>
              <span className="slot-meta">{s.is_processing ? 'processing' : 'idle'}</span>
              {s.speculative && <span className="chip">spec decode</span>}
              {s.is_processing ? (
                <span className="slot-meta">
                  prompt {formatCount(s.n_prompt_tokens, fmt)} · processed{' '}
                  {formatCount(s.n_prompt_tokens_processed, fmt)}
                  {cached}
                </span>
              ) : hasTask ? (
                <span className="slot-meta muted">
                  last task: prompt {formatCount(s.n_prompt_tokens, fmt)}
                  {cached}
                </span>
              ) : (
                <span className="slot-meta muted">no task yet</span>
              )}
              <span className="slot-meta" style={{ marginLeft: 'auto' }}>
                {open ? '▾' : '▸'}
              </span>
            </div>
            {open && (
              <div className="slot-params">
                {s.params === undefined ? (
                  <span className="muted">no sampling params reported yet</span>
                ) : (
                  <>
                    {!s.is_processing && (
                      <div className="muted">params of the last task</div>
                    )}
                    {PARAM_KEYS.map((k) => {
                      const v = s.params?.[k];
                      if (v === undefined) return null;
                      return (
                        <div className="row" key={k}>
                          <span className="k">{k}</span>
                          <span className="v">{String(v)}</span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
