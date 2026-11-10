import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * TecorbiIntro Component
 *
 * - Mobile / Portrait: Uses dedicated 9:16 vertical video & styling from tecorbi-intro2.html
 *   (720x1280 resolution, exact 9/16 aspect ratio, zero side cropping, zero distortion).
 * - Desktop / Landscape: Uses cinematic 16:9 widescreen video (1344x768).
 * - 100% Zero-Click Autoplay on Mobile Safari & Android (no play button required).
 * - Tap anywhere to unmute/play audio (matching tecorbi-intro2.html behavior).
 * - Clean interface without pause, restart, or fullscreen clutter.
 * - Smooth fade-out exit on video completion or on "انطلق إلى المسابقة 🚀".
 */
export default function TecorbiIntro({ onComplete }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [progress, setProgress] = useState(0);
  const completedRef = useRef(false);

  // Responsive mobile/portrait detection
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 768 || (window.matchMedia && window.matchMedia('(orientation: portrait)').matches);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 768px), (orientation: portrait)');
    const updateMatch = (e) => setIsMobile(e.matches);
    setIsMobile(mql.matches);

    if (mql.addEventListener) {
      mql.addEventListener('change', updateMatch);
      return () => mql.removeEventListener('change', updateMatch);
    } else if (mql.addListener) {
      mql.addListener(updateMatch);
      return () => mql.removeListener(updateMatch);
    }
  }, []);

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

  // Robust Callback Ref for instant Mobile Safari / iOS Autoplay (Prevents play button overlay)
  const setVideoRef = useCallback((node) => {
    if (!node) return;
    videoRef.current = node;

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

  // Matching tecorbi-intro2.html tap behavior: unmuting audio and making sure video is playing
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

    const safetyTimer = setTimeout(() => finishIntro(), 11000);

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
        padding: 'max(12px, env(safe-area-inset-top, 12px)) max(12px, env(safe-area-inset-right, 12px)) max(12px, env(safe-area-inset-bottom, 12px)) max(12px, env(safe-area-inset-left, 12px))',
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
          max-width: 1050px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 10;
          gap: 8px;
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
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 1;
          padding: 6px 0;
          min-height: 0;
        }

        /* Desktop Landscape Stage (1344/768 Cinematic) */
        .tecorbi-stage-box-desktop {
          position: relative;
          width: min(100%, 1050px);
          aspect-ratio: 1344 / 768;
          border-radius: 20px;
          overflow: hidden;
          background: #000;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.14), 0 24px 70px rgba(42, 60, 255, 0.45);
        }

        /* Mobile Portrait Stage (tecorbi-intro2.html exact 9:16 vertical styling) */
        .tecorbi-stage-box-mobile {
          position: relative;
          width: min(calc(100vw - 24px), calc((100vh - 120px) * 9 / 16));
          height: min(calc(100vh - 120px), calc((100vw - 24px) * 16 / 9));
          aspect-ratio: 9 / 16;
          border-radius: 18px;
          overflow: hidden;
          background: #000;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.14), 0 30px 90px rgba(42, 60, 255, 0.55);
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
          max-width: 1050px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          z-index: 10;
        }

        .tecorbi-intro-progress-bar {
          width: 100%;
          max-width: 420px;
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
          padding: 9px 24px;
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

        @media (max-width: 560px) {
          .tecorbi-stage-box-mobile {
            border-radius: 14px;
            width: min(calc(100vw - 20px), calc((100vh - 110px) * 9 / 16));
            height: min(calc(100vh - 110px), calc((100vw - 20px) * 16 / 9));
          }
          .tecorbi-intro-brand-tag {
            font-size: 11px;
            padding: 5px 12px;
          }
          .tecorbi-intro-btn {
            font-size: 11px;
            padding: 5px 12px;
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
          {isMuted ? '🔇 تشغيل الصوت' : '🔊 الصوت شغال'}
        </button>
      </div>

      {/* Center Stage: Portrait (9:16) for mobile, Landscape (1344/768) for desktop */}
      <div className="tecorbi-stage-center">
        <div className={isMobile ? "tecorbi-stage-box-mobile" : "tecorbi-stage-box-desktop"}>
          <video
            ref={setVideoRef}
            key={isMobile ? 'mobile-v' : 'desktop-v'}
            autoPlay
            muted
            playsInline
            preload="auto"
            webkit-playsinline="true"
            x5-playsinline="true"
            controls={false}
            poster={isMobile ? "/intro-mobile-poster.jpg" : "/images/intro-poster.jpg"}
            onTimeUpdate={handleTimeUpdate}
            aria-label="TecOrbi Kids Arena intro"
            className="tecorbi-video-elem"
          >
            {isMobile ? (
              <>
                <source src="/intro-mobile.webm" type="video/webm" />
                <source src="/intro-mobile.mp4" type="video/mp4" />
              </>
            ) : (
              <>
                <source src="/intro.webm" type="video/webm" />
                <source src="/intro.mp4" type="video/mp4" />
              </>
            )}
          </video>
        </div>
      </div>

      {/* Bottom Row: Neon Progress Bar + Launch Button */}
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
