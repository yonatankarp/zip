import { useEffect, useRef, useState } from 'react';
import { GameCore, type Snapshot } from './game/core.ts';
import Header from './components/Header.tsx';
import Tiers from './components/Tiers.tsx';
import Board from './components/Board.tsx';
import Controls from './components/Controls.tsx';
import Status from './components/Status.tsx';

declare global {
  interface Window { __zip?: ReturnType<GameCore['testHooks']> }
}

export default function App() {
  const coreRef = useRef<GameCore | null>(null);
  coreRef.current ??= new GameCore();
  const core = coreRef.current;

  const boardRef = useRef<SVGSVGElement>(null);
  const fxRef = useRef<SVGSVGElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<Snapshot>(() => core.snapshot());

  useEffect(() => {
    core.bindClock(clockRef.current);
    const unsubscribe = core.subscribe(setSnap);
    core.attach(boardRef.current!, fxRef.current!);
    if (location.search.includes('test')) window.__zip = core.testHooks();
    return () => {
      unsubscribe();
      core.destroy();
    };
  }, [core]);

  return (
    <>
      <svg className="fx" ref={fxRef} aria-hidden="true" />
      <div className="wrap">
        <Header
          clockRef={clockRef}
          soundMode={snap.soundMode}
          onCycleSound={() => core.cycleSound()}
          onCycleTheme={() => core.cycleTheme()}
        />
        <Tiers current={snap.difficulty} onPick={name => core.setDifficulty(name)} />
        <Board ref={boardRef} snap={snap} />
        <Controls
          onNew={() => core.newPuzzle()}
          onRestart={() => core.restart()}
          onUndo={() => core.undo()}
          onHint={() => core.hint()}
          onReveal={() => core.reveal()}
        />
        <Status
          snap={snap}
          onToggleAutoNext={() => core.toggleAutoNext()}
        />
        <div className="hint">
          drag from <b>1</b> · <kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> move ·{' '}
          <kbd>U</kbd> undo · <kbd>H</kbd> hint · <kbd>R</kbd> restart · <kbd>N</kbd> new
        </div>
      </div>
    </>
  );
}
