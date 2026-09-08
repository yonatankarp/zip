import { formatDuration, history } from '../game/daily.ts';
import type { Snapshot } from '../game/core.ts';

interface Props {
  snap: Snapshot;
}

/*
 * Recomputed from localStorage on each render rather than held in the snapshot:
 * it only changes when a day is completed, which is exactly when the snapshot
 * changes anyway.
 */
export default function History({ snap }: Props) {
  const { entries, solved, best, median } = history(snap.day);
  if (!solved) return null;

  return (
    <div className="history" id="history">
      <div className="history-days" aria-hidden="true">
        {entries.map(({ day, result }) => (
          <i
            key={day}
            className={result ? (result.hinted ? 'hinted' : 'done') : 'missed'}
            title={result ? `Day ${day}: ${formatDuration(result.ms)}` : `Day ${day}: not solved`}
          />
        ))}
      </div>
      <div className="history-summary">
        <span className="muted">last 30 days</span>
        <span>
          <b id="historySolved">{solved}</b> solved
          {best !== null && <> · best <b>{formatDuration(best)}</b></>}
          {median !== null && <> · median <b>{formatDuration(median)}</b></>}
        </span>
      </div>
    </div>
  );
}
