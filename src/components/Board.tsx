import type { Ref } from 'react';
import type { Snapshot } from '../game/core.ts';

interface Props {
  ref: Ref<SVGSVGElement>;
  snap: Snapshot;
}

/*
 * React owns the frame around the board -- the busy state, the banner, the
 * progress bar -- but never the board's contents. Everything inside the <svg>
 * is drawn imperatively by BoardView, because it changes on every pointermove
 * and every animation frame. That is a mutation workload, not a reconciliation
 * one, so the element is handed over by ref and React does not touch it again.
 */
export default function Board({ ref, snap }: Props) {
  const progress = snap.total ? (snap.filled / snap.total) * 100 : 0;
  return (
    <>
      <div className="boardwrap">
        <svg className={`board${snap.busy ? ' busy' : ''}`} id="board" ref={ref} />
        <div className={`banner${snap.banner ? ' show' : ''}`} id="banner">
          <b id="bannerText" style={{ color: bannerColour(snap) }}>
            {snap.banner?.text}
            {snap.banner?.sub ? <small>{snap.banner.sub}</small> : null}
          </b>
        </div>
      </div>
      <div className="progress">
        <i
          id="progressFill"
          className={snap.solved ? 'done' : ''}
          style={{ width: `${progress}%` }}
        />
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
