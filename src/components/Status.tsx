import { formatTime, type Snapshot } from '../game/core.ts';

interface Props {
  snap: Snapshot;
  onToggleAutoNext: () => void;
}

export default function Status({ snap, onToggleAutoNext }: Props) {
  const { session } = snap;
  const summary = session.solved
    ? `${session.solved} solved · avg ${formatTime(session.total / session.solved)}` +
      (session.streak >= 2 ? ` · streak ${session.streak}` : '')
    : 'no solves yet';

  return (
    <>
      <div className="status">
        <div>
          <b id="filled">{snap.filled}</b> / <span id="total">{snap.total}</span>
          {snap.backtracks > 0 && <span id="backtracks"> · ↩ {snap.backtracks}</span>}
        </div>
        <div id="tierStats">{snap.difficultyLabel} · {snap.rows}×{snap.cols}</div>
        <div>best <b id="best">{snap.best === null ? '—' : formatTime(snap.best)}</b></div>
      </div>
      <div className="status">
        {snap.mode === 'practice'
          ? (
            <button className="chip" id="autoBtn" aria-pressed={snap.autoNext} onClick={onToggleAutoNext}>
              <span className="dot" />Auto-next
            </button>
          )
          : <span />}
        <div id="session">{summary}</div>
      </div>
    </>
  );
}
