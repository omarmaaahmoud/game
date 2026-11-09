import React, { useState } from 'react';
import PlayStationIntro from './components/PlayStationIntro';

export default function App() {
  const [introDone, setIntroDone] = useState(false);
  const [replayKey, setReplayKey] = useState(0);

  const handleReplay = () => {
    setIntroDone(false);
    setReplayKey((prev) => prev + 1);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#050714',
        backgroundImage:
          'radial-gradient(circle at 78% 52%, rgba(109, 40, 217, 0.28) 0%, rgba(29, 78, 216, 0.14) 38%, rgba(5, 7, 20, 1) 75%)',
        color: '#ffffff',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        overflowX: 'hidden',
      }}
    >
      <PlayStationIntro key={replayKey} onComplete={() => setIntroDone(true)} />

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '24px 6vw',
          maxWidth: '1360px',
          margin: '0 auto',
          opacity: introDone ? 1 : 0.85,
          transform: introDone ? 'translateY(0)' : 'translateY(-8px)',
          transition: 'opacity 0.6s ease, transform 0.6s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #6366f1, #a855f7)',
              fontWeight: 800,
              fontSize: '0.95rem',
            }}
          >
            ⌘
          </span>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Tecorbi
          </span>
        </div>

        <nav style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <a href="#home" style={{ color: '#e2e8f0', textDecoration: 'none', fontSize: '0.95rem' }}>
            Home
          </a>
          <a href="#about" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '0.95rem' }}>
            About
          </a>
          <a href="#games" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '0.95rem' }}>
            Games
          </a>
          <button
            onClick={handleReplay}
            style={{
              background: 'rgba(99, 102, 241, 0.15)',
              color: '#a5b4fc',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              padding: '9px 18px',
              borderRadius: '9999px',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            Replay Intro ↻
          </button>
          <button
            style={{
              background: 'linear-gradient(90deg, #7c3aed, #6366f1)',
              color: '#fff',
              border: 'none',
              padding: '10px 22px',
              borderRadius: '9999px',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(124, 58, 237, 0.45)',
            }}
          >
            Join Now
          </button>
        </nav>
      </header>

      <main
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          alignItems: 'center',
          gap: '48px',
          maxWidth: '1360px',
          margin: '0 auto',
          padding: '8vh 6vw',
          minHeight: 'calc(100vh - 96px)',
          opacity: introDone ? 1 : 0,
          transform: introDone ? 'translateY(0)' : 'translateY(24px)',
          transition:
            'opacity 0.75s cubic-bezier(0.16, 1, 0.3, 1), transform 0.75s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 'clamp(2.75rem, 5.5vw, 4.5rem)',
              fontWeight: 800,
              lineHeight: 1.08,
              margin: '0 0 20px 0',
              letterSpacing: '-0.03em',
            }}
          >
            Tecorbi
            <br />
            <span>Kids </span>
            <span
              style={{
                background: 'linear-gradient(90deg, #818cf8, #c084fc)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Arena
            </span>
          </h1>

          <p
            style={{
              fontSize: '1.15rem',
              color: '#cbd5e1',
              letterSpacing: '0.04em',
              marginBottom: '36px',
              fontWeight: 500,
            }}
          >
            Play &bull; Learn &bull; Win
          </p>

          <button
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '12px',
              background: 'linear-gradient(90deg, #6366f1, #9333ea)',
              color: '#ffffff',
              border: 'none',
              padding: '15px 32px',
              borderRadius: '9999px',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 0 30px rgba(139, 92, 246, 0.55)',
            }}
          >
            <span>Start Playing</span>
            <span aria-hidden="true">&rarr;</span>
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            position: 'relative',
          }}
        >
          <svg
            viewBox="0 0 500 360"
            style={{
              width: '100%',
              maxWidth: '520px',
              filter: 'drop-shadow(0 0 24px rgba(139, 92, 246, 0.65))',
            }}
          >
            <defs>
              <linearGradient id="neonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="50%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#c084fc" />
              </linearGradient>
            </defs>
            <path
              d="M155,75 L345,75 C390,75 425,115 435,175 L452,265 C458,305 420,330 390,305 L335,240 C318,225 295,220 250,220 C205,220 182,225 165,240 L110,305 C80,330 42,305 48,265 L65,175 C75,115 110,75 155,75 Z"
              fill="rgba(30, 27, 75, 0.35)"
              stroke="url(#neonGrad)"
              strokeWidth="4.5"
            />
            <path
              d="M190,82 L310,82 L298,148 L202,148 Z"
              fill="none"
              stroke="#60a5fa"
              strokeWidth="3"
            />
            <circle cx="195" cy="185" r="26" fill="none" stroke="url(#neonGrad)" strokeWidth="3.5" />
            <circle cx="305" cy="185" r="26" fill="none" stroke="url(#neonGrad)" strokeWidth="3.5" />
            <path
              d="M125,120 h20 v20 h20 v20 h-20 v20 h-20 v-20 h-20 v-20 h20 z"
              fill="none"
              stroke="#818cf8"
              strokeWidth="3"
            />
            <circle cx="365" cy="122" r="9" fill="none" stroke="#c084fc" strokeWidth="3" />
            <circle cx="392" cy="148" r="9" fill="none" stroke="#c084fc" strokeWidth="3" />
            <circle cx="365" cy="174" r="9" fill="none" stroke="#c084fc" strokeWidth="3" />
            <circle cx="338" cy="148" r="9" fill="none" stroke="#c084fc" strokeWidth="3" />
            <ellipse
              cx="250"
              cy="335"
              rx="170"
              ry="12"
              fill="none"
              stroke="url(#neonGrad)"
              strokeWidth="2.5"
              opacity="0.7"
            />
          </svg>
        </div>
      </main>
    </div>
  );
}
