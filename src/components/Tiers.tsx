import { DIFFICULTIES, DIFFICULTY_ORDER, type DifficultyName } from '../engine/zip.ts';

interface Props {
  current: DifficultyName;
  onPick: (name: DifficultyName) => void;
}

export default function Tiers({ current, onPick }: Props) {
  return (
    <div className="tiers" id="tiers">
      {DIFFICULTY_ORDER.map(name => (
        <button
          key={name}
          className="tier"
          aria-pressed={name === current}
          onClick={() => onPick(name)}
        >
          {DIFFICULTIES[name].label}
        </button>
      ))}
    </div>
  );
}
