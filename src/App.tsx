import { useEffect, useRef, useState } from 'react';
import { GameCore, type Snapshot } from './game/core.ts';
import Header from './components/Header.tsx';
import Tiers from './components/Tiers.tsx';
import Modes from './components/Modes.tsx';
import DailyBar from './components/DailyBar.tsx';
import History from './components/History.tsx';
import Changelog from './components/Changelog.tsx';
import { CURRENT_VERSION } from './changelog.ts';
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
  const regionRef = useRef<HTMLDivElement>(null);
  const announcerRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<Snapshot>(() => core.snapshot());
  const [showChangelog, setShowChangelog] = useState(() => location.hash === '#changelog');
  const [seenVersion, setSeenVersion] = useState(() => localStorage.getItem('zip.seenVersion'));

  // The fragment drives the panel, so the link is shareable and Back closes it.
  useEffect(() => {
    const sync = () => setShowChangelog(location.hash === '#changelog');
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const openChangelog = () => {
    localStorage.setItem('zip.seenVersion', CURRENT_VERSION);
    setSeenVersion(CURRENT_VERSION);
    history.pushState({ zip: 'changelog' }, '', '#changelog');
    setShowChangelog(true);
  };

  /*
   * Only step back if this panel is what put an entry on the stack. Someone
   * arriving on a shared #changelog link has no entry of ours behind them, and
   * going back would take them off the site altogether.
   */
  const closeChangelog = () => {
    if (history.state?.zip === 'changelog') {
      history.back();
    } else {
      history.replaceState(null, '', location.pathname + location.search);
      setShowChangelog(false);
    }
  };

  useEffect(() => {
    core.bindClock(clockRef.current);
    core.bindAnnouncer(announcerRef.current);
    core.bindRegion(regionRef.current);
    const unsubscribe = core.subscribe(setSnap);
    core.attach(boardRef.current!, fxRef.current!);
    /*
     * The hook exposes the solution, which is fine for a random practice board
     * and not fine for a shared daily -- anyone appending ?test could read the
     * answer. Vite strips this branch from a production build entirely; the
     * browser suite builds with `--mode test`, which differs by this flag alone.
     */
    if (import.meta.env.MODE !== 'production' && location.search.includes('test')) {
      window.__zip = core.testHooks();
    }
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
        <Modes mode={snap.mode} onPick={mode => core.setMode(mode)} />
        {snap.mode === 'practice'
          ? <Tiers current={snap.difficulty} onPick={name => core.setDifficulty(name)} />
          : <DailyBar snap={snap} onShare={() => core.share()} />}
        <Board ref={boardRef} regionRef={regionRef} announcerRef={announcerRef} snap={snap} />
        <Controls
          mode={snap.mode}
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
        {snap.mode === 'daily' && <History snap={snap} />}
        <div className="footer">
          <button className="version" id="versionBtn" onClick={openChangelog}>
            v{CURRENT_VERSION}
            {seenVersion !== CURRENT_VERSION && <span className="pip" id="versionPip" aria-hidden="true" />}
            <span className="sr-only"> — what’s changed</span>
          </button>
        </div>
        <div className="hint">
          drag from <b>1</b> · <kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> move ·{' '}
          <kbd>U</kbd> undo · <kbd>H</kbd> hint · <kbd>R</kbd> restart · <kbd>N</kbd> new
        </div>
      </div>
      {showChangelog && <Changelog onClose={closeChangelog} />}
    </>
  );
}
