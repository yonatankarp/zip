import type { Ref } from 'react';
import type { Snapshot } from '../game/core.ts';
import ReadyGate from './ReadyGate.tsx';

interface Props {
  ref: Ref<SVGSVGElement>;
  regionRef: Ref<HTMLDivElement>;
  announcerRef: Ref<HTMLDivElement>;
  snap: Snapshot;
  onStart: () => void;
}

/*
 * React owns the frame around the board -- busy state, banner, progress bar --
 * but never the board's contents. Everything inside the <svg> is drawn
 * imperatively by BoardView, because it changes on every pointermove and every
 * animation frame: a mutation workload, not a reconciliation one.
 *
 * For assistive technology the <svg> is decorative. The accessible interface is
 * the focusable application region wrapping it, whose label carries the current
 * state, plus a live region that announces each move as it happens.
 */
export default function Board({ ref, regionRef, announcerRef, snap, onStart }: Props) {
  const progress = snap.total ? (snap.filled / snap.total) * 100 : 0;
  const label =
    `Zip board, ${snap.rows} by ${snap.cols}. ` +
    `${snap.filled} of ${snap.total} squares filled. ` +
    (snap.solved ? 'Solved.' : `Heading for number ${snap.nextNumber}.`);
  const hidden = snap.phase !== 'playing';

  return (
    <>
      <div className="boardwrap">
        <div
          className="board-region"
          role="application"
          tabIndex={0}
          aria-label={hidden ? 'Zip board, not yet revealed. Press Start to begin.' : label}
          aria-describedby="boardHelp"
          ref={regionRef}
        >
          <svg
            className={`board${snap.busy ? ' busy' : ''}${hidden ? ' covered' : ''}`}
            id="board" ref={ref} aria-hidden="true"
          />
        </div>
        <ReadyGate snap={snap} onStart={onStart} />
        <div className={`banner${snap.banner ? ' show' : ''}`} id="banner">
          <b id="bannerText" style={{ color: bannerColour(snap) }}>
            {snap.banner?.text}
            {snap.banner?.sub ? <small>{snap.banner.sub}</small> : null}
          </b>
        </div>
      </div>
      <p id="boardHelp" className="sr-only">
        Draw one line through every square, starting at number 1 and taking the
        numbers in order, without crossing a wall. Use the arrow keys to extend
        the line, U to undo a square, H for a hint, R to restart.
      </p>
      <div id="announcer" className="sr-only" aria-live="polite" aria-atomic="true" ref={announcerRef} />
      <div
        className="progress"
        role="progressbar"
        aria-label="Squares filled"
        aria-valuemin={0}
        aria-valuemax={snap.total}
        aria-valuenow={snap.filled}
      >
        <i id="progressFill" className={snap.solved ? 'done' : ''} style={{ width: `${progress}%` }} />
      </div>
    </>
  );
}

function bannerColour(snap: Snapshot): string {
  switch (snap.banner?.kind) {
    case 'bad': return 'var(--bad)';
    case 'wait': return 'var(--dim)';
    default: return 'var(--good)';
  }
}
