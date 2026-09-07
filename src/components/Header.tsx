import type { RefObject } from 'react';
import { SOUND_LABEL, type SoundMode } from '../game/audio.ts';

interface Props {
  clockRef: RefObject<HTMLDivElement | null>;
  soundMode: SoundMode;
  onCycleSound: () => void;
  onCycleTheme: () => void;
}

export default function Header({ clockRef, soundMode, onCycleSound, onCycleTheme }: Props) {
  const audible = soundMode !== 'off';
  return (
    <header>
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="var(--accent)" />
          <path
            d="M9 9h14L9 23h14" stroke="var(--accent-ink)" strokeWidth="3.4" fill="none"
            strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
        Zip
      </div>
      <div className="spacer" />
      <button
        className="icon-btn" id="soundBtn" onClick={onCycleSound}
        aria-pressed={audible} title={SOUND_LABEL[soundMode]} aria-label="Sound"
      >
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M4 9v6h4l5 4V5L8 9H4z" />
          <path id="soundWave" d="M15.5 9.5a3.5 3.5 0 0 1 0 5" style={{ display: audible ? '' : 'none' }} />
          <path id="soundWaveFar" d="M18.5 7a7 7 0 0 1 0 10" style={{ display: soundMode === 'all' ? '' : 'none' }} />
          <path id="soundMute" d="M17 9.5l4 5m0-5l-4 5" style={{ display: audible ? 'none' : '' }} />
        </svg>
      </button>
      <button className="icon-btn" id="themeBtn" onClick={onCycleTheme} title="Theme" aria-label="Theme">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="clock" id="clock" ref={clockRef}>0:00.0</div>
    </header>
  );
}
