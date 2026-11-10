import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * TecorbiIntro Component (Full-Screen Cinematic Edition)
 *
 *  - 100% Fullscreen viewport (fills entire screen on mobile, tablet & desktop)
 *  - Pure, uncluttered presentation (removed pause, replay & fullscreen buttons)
 *  - Sleek top sound toggle (🔇 تشغيل الصوت / 🔊 كتم الصوت)
 *  - Sleek top skip button (تخطي الإنترو 🚀)
 *  - Tap anywhere to unmute/play
 *  - Smooth fade-out exit on video end or skip
 */
export default function TecorbiIntro({ onComplete }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);

  const [isMuted, setIsMuted] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const completedRef = useRef(false);

  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;

    setIsClosing(true);

    if (containerRef.current) {
      containerRef.current.style.transition = 'opacity 0.4s ease-out';
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
    }, 400);
  }, [onComplete]);

  // Sound toggle button
  const toggleSound = useCallback((e) => {
    if (e) e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;

    v.muted = !v.muted;
    setIsMuted(v.muted);
    if (v.paused) {
      v.play().catch(() => {});
    }
  }, []);

  // Screen tap handler: unmute on tap anywhere
  const handleScreenTap = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;

    if (v.paused) {
      v.play().catch(() => {});
    }
    if (v.muted) {
      v.muted = false;
      setIsMuted(false);
    }
  }, []);

  useEffect(() => {
    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    const v = videoRef.current;
    if (v) {
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
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
      onClick={handleScreenTap}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        zIndex: 99999,
        background: 'radial-gradient(ellipse at 50% 50%, #0b1240 0%, #02030c 80%)',
        overflow: 'hidden',
        cursor: 'pointer',
        direction: 'rtl',
        opacity: isClosing ? 0 : 1,
        transition: 'opacity 0.4s ease-out',
      }}
      aria-label="TecOrbi Kids Arena Fullscreen Intro"
    >
      <style>{`
        /* Hide native iOS Safari media play overlays */
        video::-webkit-media-controls {
          display: none !important;
        }
        video::-webkit-media-controls-start-playback-button {
          display: none !important;
          -webkit-appearance: none;
          opacity: 0 !important;
        }
        video::-webkit-media-controls-play-button {
          display: none !important;
        }
        .tecorbi-fs-video {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          object-fit: contain;
          pointer-events: none;
        }
        @media (min-aspect-ratio: 16/9) {
          .tecorbi-fs-video {
            object-fit: cover;
          }
        }
        .tecorbi-intro-btn {
          font-family: system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif;
          font-size: 14px;
          color: #fff;
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.25);
          border-radius: 999px;
          padding: 8px 18px;
          cursor: pointer;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          user-select: none;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        }
        .tecorbi-intro-btn:hover {
          background: #4a5cff;
          border-color: #4a5cff;
          transform: scale(1.03);
        }
        .tecorbi-btn-sound {
          position: fixed;
          top: max(16px, env(safe-area-inset-top, 16px));
          inset-inline-end: max(16px, env(safe-area-inset-right, 16px));
          z-index: 100001;
        }
        .tecorbi-btn-skip {
          position: fixed;
          top: max(16px, env(safe-area-inset-top, 16px));
          inset-inline-start: max(16px, env(safe-area-inset-left, 16px));
          z-index: 100001;
          background: rgba(155, 226, 43, 0.2);
          border-color: rgba(155, 226, 43, 0.45);
          color: #9be22b;
          font-weight: 700;
        }
        .tecorbi-btn-skip:hover {
          background: #9be22b;
          border-color: #9be22b;
          color: #02030c;
        }
        @media (max-width: 560px) {
          .tecorbi-intro-btn {
            font-size: 12px;
            padding: 6px 14px;
          }
        }
      `}</style>

      {/* Ambient Neon Atmosphere Glow Behind Video */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: '90vw',
            maxWidth: '1000px',
            aspectRatio: '16/9',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(57, 37, 222, 0.35) 0%, rgba(155, 226, 43, 0.15) 50%, transparent 75%)',
            filter: 'blur(50px)',
          }}
        />
      </div>

      {/* 100% Fullscreen Responsive Video */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        preload="auto"
        poster="/images/intro-poster.jpg"
        aria-label="TecOrbi Kids Arena intro"
        className="tecorbi-fs-video"
      >
        <source src="/intro.webm" type="video/webm" />
        <source src="/intro.mp4" type="video/mp4" />
      </video>

      {/* Top Sound Toggle Button */}
      <button
        className="tecorbi-intro-btn tecorbi-btn-sound"
        type="button"
        onClick={toggleSound}
        aria-label={isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}
      >
        {isMuted ? '🔇 تشغيل الصوت' : '🔊 كتم الصوت'}
      </button>

      {/* Top Skip / Enter Game Button */}
      <button
        className="tecorbi-intro-btn tecorbi-btn-skip"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          finishIntro();
        }}
        title="تخطي والبدء فوراً"
        aria-label="تخطي الإنترو"
      >
        <span>تخطي الإنترو 🚀</span>
      </button>
    </div>
  );
}
