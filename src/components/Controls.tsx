import type { Mode } from '../game/core.ts';

interface Props {
  mode: Mode;
  onNew: () => void;
  onRestart: () => void;
  onUndo: () => void;
  onHint: () => void;
  onReveal: () => void;
}

export default function Controls({ mode, onNew, onRestart, onUndo, onHint, onReveal }: Props) {
  return (
    <div className="controls">
      <button
        className="btn primary" id="newBtn" onClick={onNew}
        disabled={mode === 'daily'}
        title={mode === 'daily' ? 'There is one puzzle a day' : 'New puzzle'}
      >
        New
      </button>
      <button className="btn" id="restartBtn" onClick={onRestart}>Restart</button>
      <button className="btn" id="undoBtn" onClick={onUndo}>Undo</button>
      <button className="btn" id="hintBtn" onClick={onHint}>Hint</button>
      <button className="btn" id="revealBtn" onClick={onReveal}>Reveal</button>
    </div>
  );
}
