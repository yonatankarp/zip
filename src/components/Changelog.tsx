import { useEffect, useRef } from 'react';
import { RELEASES, type ChangeKind } from '../changelog.ts';

interface Props {
  onClose: () => void;
}

const LABEL: Record<ChangeKind, string> = {
  added: 'New',
  changed: 'Changed',
  fixed: 'Fixed'
};

/*
 * Opened by the #changelog fragment, so it is linkable and the back button
 * closes it, without needing a router or a second HTML file on a static host.
 */
export default function Changelog({ onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<Element | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // The board sits behind this and should not scroll under it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      (restoreTo.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="sheet" id="changelog" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelogTitle"
        tabIndex={-1}
        ref={panel}
      >
        <header className="sheet-head">
          <h2 id="changelogTitle">What’s changed</h2>
          <button className="icon-btn" id="changelogClose" onClick={onClose} aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="sheet-body">
          {RELEASES.map(release => (
            <section key={release.version} className="release">
              <h3>
                <span className="release-version">{release.version}</span>
                <time dateTime={release.date} className="muted">{release.date}</time>
              </h3>
              <p className="muted release-summary">{release.summary}</p>
              <ul>
                {release.changes.map((change, i) => (
                  <li key={i}>
                    <span className={`tag tag-${change.kind}`}>{LABEL[change.kind]}</span>
                    {change.text}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
