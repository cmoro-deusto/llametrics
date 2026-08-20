/** Cumulative counters (since server start) + lifetime averages. */
import { computeSinceStart, COUNTERS, type CounterMap } from '../lib/metrics';
import {
  formatCount,
  formatDuration,
  formatPercent,
  formatRate,
  type NumberFormat,
} from '../lib/format';

export function CountersCard({
  counters,
  specPerPos,
  fmt,
}: {
  counters: CounterMap | null;
  specPerPos: { position: string; value: number }[] | null;
  fmt: NumberFormat;
}) {
  if (!counters) return <span className="muted">waiting for /metrics…</span>;

  const since = computeSinceStart(counters);
  const c = counters;

  return (
    <div>
      <div className="counters-table">
        <Row k="prompt tokens (uncached)" v={formatCount(c[COUNTERS.promptTokens], fmt)} />
        <Row k="prompt tokens (cached)" v={formatCount(c[COUNTERS.promptTokensCached], fmt)} />
        <Row k="prompt time" v={formatDuration(c[COUNTERS.promptSeconds])} />
        <Row k="generated tokens" v={formatCount(c[COUNTERS.tokensPredicted], fmt)} />
        <Row k="generation time" v={formatDuration(c[COUNTERS.tokensPredictedSeconds])} />
        <Row k="llama_decode() calls" v={formatCount(c[COUNTERS.nDecode], fmt)} />
        <Row k="max sequence length" v={formatCount(c[COUNTERS.nTokensMax], fmt)} />
        <Row
          k="spec draft tokens"
          v={c[COUNTERS.specDraftTokens] != null ? formatCount(c[COUNTERS.specDraftTokens], fmt) : 'n/a'}
        />
        <Row
          k="spec accepted tokens"
          v={c[COUNTERS.specAcceptedTokens] != null ? formatCount(c[COUNTERS.specAcceptedTokens], fmt) : 'n/a'}
        />
        <Row
          k="spec verification steps"
          v={c[COUNTERS.specDrafts] != null ? formatCount(c[COUNTERS.specDrafts], fmt) : 'n/a'}
        />
      </div>

      <div className="counters-table" style={{ marginTop: 12 }}>
        <Row
          k="avg generation (since start)"
          v={since.genTokS != null ? `${formatRate(since.genTokS, fmt)} tok/s` : '—'}
        />
        <Row
          k="avg prompt (since start)"
          v={since.promptTokS != null ? `${formatRate(since.promptTokS, fmt)} tok/s` : '—'}
        />
        <Row k="cache hit rate (since start)" v={formatPercent(since.cacheHitRate, fmt)} />
        <Row
          k="spec tok/verif (since start)"
          v={
            since.specTokensPerVerif != null
              ? since.specTokensPerVerif.toFixed(2)
              : '—'
          }
        />
      </div>

      {specPerPos && specPerPos.length > 0 && (
        <>
          <div className="muted" style={{ marginTop: 10 }}>
            accepted tokens per draft position
          </div>
          <div className="pos-bars" aria-hidden>
            {specPerPos.map((p) => {
              const max = Math.max(...specPerPos.map((x) => x.value), 1);
              return (
                <div
                  key={p.position}
                  className="bar"
                  style={{ height: `${Math.max(3, (p.value / max) * 100)}%` }}
                  title={`position ${p.position}: ${formatCount(p.value, fmt)}`}
                >
                  <span>{p.position}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}
