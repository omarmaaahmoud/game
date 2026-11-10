import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * TecorbiIntro Component (Vertical Mobile-First Layout & Zero-Click Autoplay)
 *
 *  - Vertical layout on mobile (بالطول): Top Brand Header, Center 16:9 Cinematic Stage, Bottom Progress & Launch Button
 *  - 100% Zero-Click Autoplay on Mobile Safari & Android via direct WebKit attribute enforcement (no play button required)
 *  - Zero Cropping (مش متأكلة): Robot on right and Tecorbi logo on left are 100% visible on every phone
 *  - Sound on demand: Tap anywhere on screen or click the top sound toggle
 *  - Launch button: "انطلق إلى المسابقة 🚀" for instant entry
 *  - Smooth fade-out exit on video end or click
 */
export default function TecorbiIntro({ onComplete }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [progress, setProgress] = useState(0);
  const completedRef = useRef(false);

  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setIsClosing(true);

    if (containerRef.current) {
      containerRef.current.style.transition = 'opacity 0.35s ease-out';
      containerRef.current.style.opacity = '0';
      containerRef.current.style.pointerEvents = 'none';
    }

    setTimeout(() => {
      if (videoRef.current) {
        try { videoRef.current.pause(); } catch (e) {}
      }
      try { document.body.style.overflow = ''; } catch (e) {}
      if (typeof onComplete === 'function') {
        onComplete();
      }
    }, 350);
  }, [onComplete]);

  // Robust Callback Ref for instant Mobile Safari / iOS Autoplay (Prevents play button from appearing)
  const setVideoRef = useCallback((node) => {
    if (!node) return;
    videoRef.current = node;

    // Direct property and attribute enforcement for iOS WebKit
    node.muted = true;
    node.defaultMuted = true;
    node.playsInline = true;
    node.setAttribute('muted', '');
    node.setAttribute('playsinline', '');
    node.setAttribute('webkit-playsinline', '');
    node.setAttribute('autoplay', '');

    const attemptPlay = () => {
      node.muted = true;
      const p = node.play();
      if (p !== undefined) {
        p.catch(() => {});
      }
    };

    attemptPlay();
    node.addEventListener('loadedmetadata', attemptPlay, { once: true });
    node.addEventListener('canplay', attemptPlay, { once: true });
  }, []);

  const toggleSound = useCallback((e) => {
    if (e) e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
    if (v.paused) v.play().catch(() => {});
  }, []);

  const handleScreenTap = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    if (v.muted) {
      v.muted = false;
      setIsMuted(false);
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (v && v.duration) {
      setProgress((v.currentTime / v.duration) * 100);
    }
  }, []);

  useEffect(() => {
    try { document.body.style.overflow = 'hidden'; } catch (e) {}

    const v = videoRef.current;
    if (v) {
      v.muted = true;
      v.defaultMuted = true;
      v.play().catch(() => {});
    }

    const handleEnded = () => finishIntro();
    if (v) v.addEventListener('ended', handleEnded);

    const safetyTimer = setTimeout(() => finishIntro(), 10500);

    return () => {
      clearTimeout(safetyTimer);
      if (v) v.removeEventListener('ended', handleEnded);
      try { document.body.style.overflow = ''; } catch (e) {}
    };
  }, [finishIntro]);

  return (
    <div
      ref={containerRef}
      onClick={handleScreenTap}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'radial-gradient(ellipse at 50% 30%, #0b1240 0%, #02030c 70%)',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 'max(16px, env(safe-area-inset-top, 16px)) max(16px, env(safe-area-inset-right, 16px)) max(16px, env(safe-area-inset-bottom, 16px)) max(16px, env(safe-area-inset-left, 16px))',
        overflow: 'hidden',
        direction: 'rtl',
        opacity: isClosing ? 0 : 1,
        transition: 'opacity 0.35s ease-out',
        cursor: 'pointer',
      }}
      aria-label="TecOrbi Kids Arena Intro"
    >
      <style>{`
        /* Hide native iOS Safari media play overlays */
        video::-webkit-media-controls { display: none !important; }
        video::-webkit-media-controls-start-playback-button { display: none !important; opacity: 0 !important; }
        video::-webkit-media-controls-play-button { display: none !important; }

        .tecorbi-intro-top-row {
          width: 100%;
          max-width: 1000px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 10;
        }

        .tecorbi-intro-brand-tag {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(8, 16, 43, 0.75);
          border: 1px solid rgba(155, 226, 43, 0.4);
          padding: 6px 14px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 800;
          color: #9be22b;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }

        .tecorbi-intro-btn {
          font: inherit;
          font-size: 13px;
          color: #fff;
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.25);
          border-radius: 999px;
          padding: 7px 16px;
          cursor: pointer;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          user-select: none;
        }
        .tecorbi-intro-btn:hover {
          background: #4a5cff;
          border-color: #4a5cff;
        }

        .tecorbi-stage-center {
          width: 100%;
          max-width: 1000px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 1;
          padding: 12px 0;
        }

        .tecorbi-stage-box {
          position: relative;
          width: 100%;
          aspect-ratio: 1344 / 768;
          border-radius: 20px;
          overflow: hidden;
          background: #000;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.14), 0 24px 70px rgba(42, 60, 255, 0.45);
        }

        .tecorbi-video-elem {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
          pointer-events: none;
        }

        .tecorbi-intro-bottom-row {
          width: 100%;
          max-width: 1000px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          z-index: 10;
        }

        .tecorbi-intro-progress-bar {
          width: 100%;
          max-width: 440px;
          height: 4px;
          background: rgba(255, 255, 255, 0.16);
          border-radius: 999px;
          overflow: hidden;
        }

        .tecorbi-intro-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #4a5cff, #9be22b);
          transition: width 0.15s linear;
        }

        .btn-launch-game-intro {
          background: #9be22b;
          color: #02030c;
          border: 1px solid #9be22b;
          font-weight: 850;
          font-size: 14px;
          padding: 10px 24px;
          border-radius: 999px;
          box-shadow: 0 4px 20px rgba(155, 226, 43, 0.4);
          cursor: pointer;
          transition: transform 0.2s, background 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .btn-launch-game-intro:hover {
          transform: scale(1.04);
          background: #b5f547;
        }

        @media (max-width: 640px) {
          .tecorbi-stage-box {
            border-radius: 14px;
            box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15), 0 16px 45px rgba(42, 60, 255, 0.38);
          }
          .tecorbi-intro-brand-tag {
            font-size: 11px;
            padding: 5px 12px;
          }
          .tecorbi-intro-btn {
            font-size: 11px;
            padding: 6px 12px;
          }
          .btn-launch-game-intro {
            font-size: 13px;
            padding: 8px 20px;
          }
        }
      `}</style>

      {/* Top Header: Brand Tag + Sound Toggle */}
      <div className="tecorbi-intro-top-row">
        <div className="tecorbi-intro-brand-tag">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9be22b', display: 'inline-block' }} />
          <span>TECORBI KIDS ARENA 🎮</span>
        </div>

        <button
          type="button"
          onClick={toggleSound}
          className="tecorbi-intro-btn"
          aria-label={isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}
        >
          {isMuted ? '🔇 تشغيل الصوت' : '🔊 الصوت مفعل'}
        </button>
      </div>

      {/* Center Stage: Exact 1344/768 ratio (Zero cropping, robot & logo 100% visible on all phones) */}
      <div className="tecorbi-stage-center">
        <div className="tecorbi-stage-box">
          <video
            ref={setVideoRef}
            src="/intro.mp4"
            autoPlay
            muted
            playsInline
            preload="auto"
            webkit-playsinline="true"
            x5-playsinline="true"
            controls={false}
            poster="/images/intro-poster.jpg"
            onTimeUpdate={handleTimeUpdate}
            aria-label="TecOrbi Kids Arena intro"
            className="tecorbi-video-elem"
          />
        </div>
      </div>

      {/* Bottom Row: Neon Progress Bar + Fast Launch Button */}
      <div className="tecorbi-intro-bottom-row">
        <div className="tecorbi-intro-progress-bar">
          <div
            className="tecorbi-intro-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>

        <button
          type="button"
          className="btn-launch-game-intro"
          onClick={(e) => {
            e.stopPropagation();
            finishIntro();
          }}
        >
          <span>انطلق إلى المسابقة 🚀</span>
        </button>
      </div>
    </div>
  );
}
