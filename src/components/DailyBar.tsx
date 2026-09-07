import { useState } from 'react';
import { formatDuration } from '../game/daily.ts';
import type { Snapshot } from '../game/core.ts';

interface Props {
  snap: Snapshot;
  onShare: () => Promise<boolean>;
}

export default function DailyBar({ snap, onShare }: Props) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const result = snap.dailyResult;

  const share = async () => {
    const ok = await onShare();
    setCopied(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopied('idle'), 1600);
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
              {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : `Share ${formatDuration(result.ms)}`}
            </button>
          )
          : <span className="muted" id="dailyTodo">not solved yet</span>}
      </div>
    </div>
  );
}
