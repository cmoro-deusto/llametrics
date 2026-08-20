/** Model cards from /models (name + merged numeric details). */
import type { ModelCardData } from '../lib/api';
import { formatBytes, formatCount, type NumberFormat } from '../lib/format';

export function ModelsCard({
  models,
  fmt,
}: {
  models: ModelCardData[] | null;
  fmt: NumberFormat;
}) {
  if (!models) {
    return <span className="muted">waiting for /models…</span>;
  }
  if (models.length === 0) {
    return <span className="muted">no models reported by the server</span>;
  }
  return (
    <div className="model-grid">
      {models.map((m) => (
        <div className="model-card" key={m.name}>
          <div className="model-name">{m.name}</div>
          {m.aliases.length > 0 && (
            <div className="model-aliases">aliases: {m.aliases.join(', ')}</div>
          )}
          <div className="chip-row">
            {m.ftype && <span className="chip">{m.ftype}</span>}
            {m.format && <span className="chip neutral">{m.format}</span>}
            {m.capabilities.map((c) => (
              <span className="chip neutral" key={c}>
                {c}
              </span>
            ))}
            {m.tags.map((t) => (
              <span className="chip neutral" key={t}>
                {t}
              </span>
            ))}
          </div>
          <div className="model-stats">
            <ModelStat k="size" v={formatBytes(m.sizeBytes, fmt)} />
            <ModelStat k="params" v={formatCount(m.nParams, fmt)} />
            <ModelStat k="context" v={formatCount(m.nCtx, fmt)} />
            <ModelStat k="ctx train" v={formatCount(m.nCtxTrain, fmt)} />
            <ModelStat k="vocab" v={formatCount(m.nVocab, fmt)} />
            <ModelStat k="embedding" v={m.nEmbD != null ? String(m.nEmbD) : '—'} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ModelStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="model-stat">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}
