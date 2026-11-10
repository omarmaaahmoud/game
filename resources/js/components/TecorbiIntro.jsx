import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * TecorbiIntro Component
 *
 * Automatic website intro using tecorbi-intro2.html as the original source:
 * - Uses /videos/tecorbi-intro.mp4 (extracted from tecorbi-intro2.html Base64)
 * - Autoplay, muted, playsInline, preload="auto"
 * - Starts automatically without requiring any button or user interaction
 * - Preserves original 9:16 aspect ratio, colors, sharpness, and animation
 * - Smooth transition into Tecorbi Kids Arena homepage when finished or skipped
 * - Tap anywhere to unmute/play audio (matching tecorbi-intro2.html)
 * - Autoplay fallback if playback is blocked by browser policies
 * - Mobile responsive with zero black screens (matching radial gradient & poster)
 */
export default function TecorbiIntro({ onComplete }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isAutoplayBlocked, setIsAutoplayBlocked] = useState(false);
  const [progress, setProgress] = useState(0);
  const completedRef = useRef(false);

  // Smooth exit transition into the homepage
  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setIsClosing(true);

    if (containerRef.current) {
      containerRef.current.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
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
    }, 400);
  }, [onComplete]);

  // Robust callback ref for zero-click autoplay on Mobile Safari & Android
  const setVideoRef = useCallback((node) => {
    if (!node) return;
    videoRef.current = node;

    // Strict DOM property & attribute enforcement
    node.muted = true;
    node.defaultMuted = true;
    node.playsInline = true;
    node.setAttribute('muted', '');
    node.setAttribute('playsinline', '');
    node.setAttribute('webkit-playsinline', '');
    node.setAttribute('x5-playsinline', '');
    node.setAttribute('autoplay', '');

    const attemptAutoplay = () => {
      node.muted = true;
      const playPromise = node.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
            setIsAutoplayBlocked(false);
          })
          .catch((err) => {
            // Autoplay blocked by browser policy: activate fallback UI
            console.warn('Autoplay blocked by browser:', err);
            setIsAutoplayBlocked(true);
          });
      }
    };

    attemptAutoplay();
    node.addEventListener('loadedmetadata', attemptAutoplay, { once: true });
    node.addEventListener('canplay', attemptAutoplay, { once: true });
  }, []);

  // Tap-to-unmute or tap-to-play fallback (matching tecorbi-intro2.html onclick behavior)
  const handleInteraction = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;

    if (v.paused) {
      v.play()
        .then(() => {
          setIsPlaying(true);
          setIsAutoplayBlocked(false);
        })
        .catch(() => {});
    }

    if (v.muted) {
      v.muted = false;
      setIsMuted(false);
    }
  }, []);

  const toggleSound = useCallback((e) => {
    if (e) e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
    if (v.paused) v.play().catch(() => {});
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
      v.play()
        .then(() => {
          setIsPlaying(true);
          setIsAutoplayBlocked(false);
        })
        .catch(() => {
          setIsAutoplayBlocked(true);
        });
    }

    // Safety timeout: transition into game after 11.5s max even if playback fails
    const safetyTimer = setTimeout(() => finishIntro(), 11500);

    return () => {
      clearTimeout(safetyTimer);
      try { document.body.style.overflow = ''; } catch (e) {}
    };
  }, [finishIntro]);

  return (
    <div
      ref={containerRef}
      onClick={handleInteraction}
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
        transition: 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        cursor: 'pointer',
      }}
      aria-label="TecOrbi Kids Arena Intro"
    >
      <style>{`
        /* Hide native iOS Safari media play overlays to guarantee clean auto-playback */
        video::-webkit-media-controls { display: none !important; }
        video::-webkit-media-controls-start-playback-button { display: none !important; opacity: 0 !important; }
        video::-webkit-media-controls-play-button { display: none !important; }

        .tecorbi-intro-top-row {
          width: 100%;
          max-width: 900px;
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
          background: rgba(8, 16, 43, 0.78);
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

        /* Exact 9:16 aspect ratio stage from tecorbi-intro2.html (Responsive on mobile & desktop) */
        .tecorbi-stage-box {
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
          background: #000;
        }

        /* Autoplay fallback button when browser strictly blocks autoplay */
        .tecorbi-fallback-overlay {
          position: absolute;
          inset: 0;
          background: rgba(2, 3, 12, 0.65);
          backdrop-filter: blur(4px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          z-index: 5;
          animation: fadeInFallback 0.3s ease;
        }

        @keyframes fadeInFallback {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }

        .tecorbi-fallback-btn {
          background: linear-gradient(135deg, #4a5cff, #9be22b);
          color: #fff;
          font-weight: 800;
          font-size: 15px;
          padding: 12px 28px;
          border-radius: 999px;
          border: none;
          box-shadow: 0 8px 30px rgba(74, 92, 255, 0.5);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .tecorbi-intro-bottom-row {
          width: 100%;
          max-width: 900px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          z-index: 10;
        }

        .tecorbi-intro-progress-bar {
          width: 100%;
          max-width: 360px;
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
          .tecorbi-stage-box {
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

      {/* Center Stage: Exact 9:16 vertical stage from tecorbi-intro2.html */}
      <div className="tecorbi-stage-center">
        <div className="tecorbi-stage-box">
          <video
            ref={setVideoRef}
            autoPlay
            muted
            playsInline
            preload="auto"
            webkit-playsinline="true"
            x5-playsinline="true"
            controls={false}
            poster="/videos/tecorbi-intro-poster.jpg"
            onTimeUpdate={handleTimeUpdate}
            onEnded={finishIntro}
            aria-label="TecOrbi Kids Arena intro"
            className="tecorbi-video-elem"
          >
            <source src="/videos/tecorbi-intro.webm" type="video/webm" />
            <source src="/videos/tecorbi-intro.mp4" type="video/mp4" />
          </video>

          {/* Autoplay fallback overlay (only shown if browser blocks autoplay) */}
          {isAutoplayBlocked && (
            <div className="tecorbi-fallback-overlay" onClick={handleInteraction}>
              <button type="button" className="tecorbi-fallback-btn">
                <span>▶ اضغط للمشاهدة</span>
              </button>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.75)' }}>
                انقر في أي مكان لتشغيل الإنترو
              </span>
            </div>
          )}
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
