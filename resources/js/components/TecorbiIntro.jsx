import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * TecorbiIntro Component
 *
 * Implements the exact design, stage, and controls from tecorbi-intro.html:
 *  - Stage: aspect-ratio 1344/768, border-radius 20px, box-shadow: 0 30px 90px #2a3cff55
 *  - Radial background: ellipse at 50% 30%, #0b1240 0%, #02030c 70%
 *  - Controls bar: Play/Pause, Replay, Fullscreen, and Sound toggle
 *  - Seamless transition to game on ended or skip
 */
export default function TecorbiIntro({ onComplete }) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const videoRef = useRef(null);

  const [isMuted, setIsMuted] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [touchActive, setTouchActive] = useState(false);
  const completedRef = useRef(false);

  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;

    setIsClosing(true);

    if (containerRef.current) {
      containerRef.current.style.transition = 'opacity 0.3s ease-out';
      containerRef.current.style.opacity = '0';
      containerRef.current.style.pointerEvents = 'none';
    }

    setTimeout(() => {
      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch (e) {}
      }
      try {
        document.body.style.overflow = '';
      } catch (e) {}
      if (typeof onComplete === 'function') {
        onComplete();
      }
    }, 300);
  }, [onComplete]);

  // Sound toggle (same as $('snd').onclick in tecorbi-intro.html)
  const toggleSound = useCallback((e) => {
    if (e) e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;

    v.muted = !v.muted;
    setIsMuted(v.muted);
    if (v.paused) {
      v.play().catch(() => {});
      setIsPaused(false);
    }
  }, []);

  // Play/Pause toggle (same as $('pp').onclick in tecorbi-intro.html)
  const togglePlayPause = useCallback((e) => {
    if (e) e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;

    if (v.paused) {
      v.play().catch(() => {});
      setIsPaused(false);
    } else {
      v.pause();
      setIsPaused(true);
    }
  }, []);

  // Replay (same as $('rp').onclick in tecorbi-intro.html)
  const handleReplay = useCallback((e) => {
    if (e) e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;

    v.currentTime = 0;
    v.play().catch(() => {});
    setIsPaused(false);
  }, []);

  // Fullscreen (same as $('fs').onclick in tecorbi-intro.html)
  const toggleFullscreen = useCallback((e) => {
    if (e) e.stopPropagation();
    const st = stageRef.current;
    if (!st) return;

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (st.requestFullscreen) {
      st.requestFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    const v = videoRef.current;
    if (v) {
      v.muted = true;
      v.play().catch(() => {});
    }

    const handleEnded = () => {
      finishIntro();
    };

    if (v) {
      v.addEventListener('ended', handleEnded);
    }

    return () => {
      if (v) {
        v.removeEventListener('ended', handleEnded);
      }
      try {
        document.body.style.overflow = '';
      } catch (e) {}
    };
  }, [finishIntro]);

  return (
    <div
      ref={containerRef}
      className="tecorbi-intro-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'radial-gradient(ellipse at 50% 30%, #0b1240 0%, #02030c 70%)',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflow: 'hidden',
        direction: 'rtl',
        opacity: isClosing ? 0 : 1,
        transition: 'opacity 0.3s ease-out',
      }}
      onTouchStart={() => setTouchActive(true)}
    >
      <style>{`
        .tecorbi-intro-stage {
          position: relative;
          width: min(100%, 1100px);
          aspect-ratio: 1344 / 768;
          border-radius: 20px;
          overflow: hidden;
          background: #000;
          box-shadow: 0 0 0 1px #ffffff14, 0 30px 90px #2a3cff55;
        }
        .tecorbi-intro-video {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
          cursor: pointer;
        }
        .tecorbi-intro-bar {
          position: absolute;
          inset: auto 0 0 0;
          display: flex;
          gap: 10px;
          justify-content: center;
          padding: 14px;
          background: linear-gradient(transparent, #000a);
          opacity: 0;
          transition: opacity 0.25s;
          z-index: 10;
        }
        .tecorbi-intro-stage:hover .tecorbi-intro-bar,
        .tecorbi-intro-stage:focus-within .tecorbi-intro-bar,
        .tecorbi-intro-stage.touch .tecorbi-intro-bar {
          opacity: 1;
        }
        .tecorbi-intro-btn {
          font: inherit;
          font-size: 14px;
          color: #fff;
          background: #ffffff1f;
          border: 1px solid #ffffff33;
          border-radius: 999px;
          padding: 8px 16px;
          cursor: pointer;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          transition: background 0.2s, border-color 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          user-select: none;
        }
        .tecorbi-intro-btn:hover {
          background: #4a5cff;
          border-color: #4a5cff;
        }
        .tecorbi-intro-btn:focus-visible {
          outline: 2px solid #9be22b;
          outline-offset: 2px;
        }
        .tecorbi-intro-hint {
          position: absolute;
          top: 14px;
          inset-inline-end: 14px;
          z-index: 10;
        }
        .tecorbi-intro-skip {
          position: absolute;
          top: 14px;
          inset-inline-start: 14px;
          z-index: 10;
          background: rgba(155, 226, 43, 0.2);
          border-color: rgba(155, 226, 43, 0.5);
          color: #9be22b;
          font-weight: 700;
        }
        .tecorbi-intro-skip:hover {
          background: #9be22b;
          border-color: #9be22b;
          color: #02030c;
        }
        @media (max-width: 560px) {
          .tecorbi-intro-stage {
            border-radius: 12px;
          }
          .tecorbi-intro-bar {
            opacity: 1;
            padding: 10px;
            gap: 6px;
          }
          .tecorbi-intro-btn {
            font-size: 12px;
            padding: 6px 12px;
          }
        }
      `}</style>

      {/* Main Stage (aspect-ratio 1344/768) */}
      <main
        ref={stageRef}
        className={`tecorbi-intro-stage ${touchActive ? 'touch' : ''}`}
        id="stage"
      >
        <video
          ref={videoRef}
          id="v"
          playsInline
          muted
          autoPlay
          preload="auto"
          poster="/images/intro-poster.jpg"
          aria-label="TecOrbi Kids Arena intro"
          className="tecorbi-intro-video"
          onClick={togglePlayPause}
        >
          <source src="/intro.webm" type="video/webm" />
          <source src="/intro.mp4" type="video/mp4" />
        </video>

        {/* Top Sound Toggle Button (from tecorbi-intro.html) */}
        <button
          className="tecorbi-intro-btn tecorbi-intro-hint"
          id="snd"
          type="button"
          onClick={toggleSound}
        >
          {isMuted ? '🔇 تشغيل الصوت' : '🔊 كتم الصوت'}
        </button>

        {/* Top Skip / Enter Game Button */}
        <button
          className="tecorbi-intro-btn tecorbi-intro-skip"
          type="button"
          onClick={finishIntro}
          title="تخطي والبدء فوراً"
        >
          <span>تخطي الإنترو 🚀</span>
        </button>

        {/* Bottom Control Bar (from tecorbi-intro.html) */}
        <div className="tecorbi-intro-bar">
          <button
            id="pp"
            type="button"
            className="tecorbi-intro-btn"
            onClick={togglePlayPause}
          >
            {isPaused ? '▶ تشغيل' : '⏸ إيقاف'}
          </button>
          <button
            id="rp"
            type="button"
            className="tecorbi-intro-btn"
            onClick={handleReplay}
          >
            ↻ إعادة
          </button>
          <button
            id="fs"
            type="button"
            className="tecorbi-intro-btn"
            onClick={toggleFullscreen}
          >
            ⛶ ملء الشاشة
          </button>
        </div>
      </main>
    </div>
  );
}
