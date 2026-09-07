import { useState } from 'react';
import { formatDuration } from '../game/daily.ts';
import type { ShareOutcome, Snapshot } from '../game/core.ts';

interface Props {
  snap: Snapshot;
  onShare: () => Promise<ShareOutcome>;
}

export default function DailyBar({ snap, onShare }: Props) {
  const [outcome, setOutcome] = useState<ShareOutcome | 'idle'>('idle');
  const result = snap.dailyResult;

  const share = async () => {
    const result = await onShare();
    setOutcome(result);
    window.setTimeout(() => setOutcome('idle'), 1600);
  };

  const label = () => {
    switch (outcome) {
      case 'shared': return 'Shared';
      case 'copied': return 'Copied';
      case 'failed': return 'Copy failed';
      default: return `Share ${formatDuration(result!.ms)}`;
    }
  };

  return (
    <div className="daily" id="dailyBar">
      <div>
        <b id="dayNumber">Daily #{snap.day}</b>
        <span className="muted"> · {snap.rows}×{snap.cols}</span>
      </div>
      <div className="daily-right">
        {snap.streak >= 2 && <span className="muted" id="streak">🔥 {snap.streak} day streak</span>}
        {result
          ? (
            <button className="chip" id="shareBtn" onClick={share}>
              {label()}
            </button>
          )
          : <span className="muted" id="dailyTodo">not solved yet</span>}
      </div>
    </div>
  );
}
