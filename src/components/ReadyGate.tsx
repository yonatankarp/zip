import type { Snapshot } from '../game/core.ts';

interface Props {
  snap: Snapshot;
  onStart: () => void;
}

/*
 * The board is covered until you say you are ready, and the clock starts the
 * moment it is uncovered. Studying a board for free beforehand made every
 * recorded time a fiction.
 *
 * The cover is a blur rather than an empty box so the shape of the grid is
 * still legible — you can see what size you are about to get, without being
 * able to read it.
 */
export default function ReadyGate({ snap, onStart }: Props) {
  if (snap.phase === 'playing' || !snap.ready) return null;

  const counting = snap.phase === 'counting';
  return (
    <div className={`gate${counting ? ' counting' : ''}`} id="readyGate">
      {counting
        ? (
          <div className="count" id="countdown" aria-live="assertive" aria-atomic="true">
            <span key={snap.countdown}>{snap.countdown}</span>
          </div>
        )
        : (
          <button className="btn primary start" id="startBtn" onClick={onStart}>
            Start
            <small>
              {snap.mode === 'daily' ? `Daily #${snap.day}` : snap.difficultyLabel}
              {' · '}{snap.rows}×{snap.cols} · the clock starts on reveal
            </small>
          </button>
        )}
    </div>
  );
}
