import type { Mode } from '../game/core.ts';

interface Props {
  mode: Mode;
  onPick: (mode: Mode) => void;
}

export default function Modes({ mode, onPick }: Props) {
  return (
    <div className="modes" id="modes">
      <button className="tier" aria-pressed={mode === 'daily'} onClick={() => onPick('daily')}>
        Daily
      </button>
      <button className="tier" aria-pressed={mode === 'practice'} onClick={() => onPick('practice')}>
        Practice
      </button>
    </div>
  );
}
