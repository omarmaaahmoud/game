import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * TecorbiIntro Component - Hybrid Frame-Based Animation Engine
 *
 * 1. Mobile (Portrait / Width <= 768px):
 *    - True edge-to-edge fullscreen canvas ("تاخد الشاشة كلها حقيقي").
 *    - 9:16 vertical WebP frames from /intro-frames/ (540x960, centered).
 * 2. Desktop (Landscape / Width > 768px):
 *    - Cinematic 16:9 widescreen stage ("زي ما كانت في الأول") with 1344/768 aspect ratio,
 *      20px rounded corners, and glowing radial ambient background.
 *    - 16:9 widescreen WebP frames from /intro-frames-desktop/ (960x548).
 * 3. 100% Zero Autoplay Restrictions on all platforms (pure Canvas + WebP images).
 * 4. Fast & energetic: 18 FPS (~6.1s total duration) with synchronized audio.
 * 5. Smooth fade-out transition into the Tecorbi Kids Arena homepage.
 */

const TOTAL_FRAMES = 110;
const FPS = 18; // 18 fps (~6.1s total)
const FRAME_DURATION = 1000 / FPS; // ~55.5ms

export default function TecorbiIntro({ onComplete }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const animFrameIdRef = useRef(null);
  const imagesMapRef = useRef(new Map());
  const completedRef = useRef(false);

  const [isClosing, setIsClosing] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [progress, setProgress] = useState(0);

  // Desktop vs Mobile detection
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth > 768 && window.innerWidth > window.innerHeight;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth > 768 && window.innerWidth > window.innerHeight);
    };
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  // Smooth exit transition into the homepage
  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setIsClosing(true);

    if (audioRef.current) {
      try { audioRef.current.pause(); } catch (e) {}
    }

    if (containerRef.current) {
      containerRef.current.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
      containerRef.current.style.opacity = '0';
      containerRef.current.style.pointerEvents = 'none';
    }

    setTimeout(() => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      try { document.body.style.overflow = ''; } catch (e) {}
      if (typeof onComplete === 'function') {
        onComplete();
      }
    }, 400);
  }, [onComplete]);

  // Audio unmute & sync on interaction
  const handleInteraction = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.muted) {
      audio.muted = false;
      setIsMuted(false);
      audio.play().catch(() => {});
    }
  }, []);

  const toggleSound = useCallback((e) => {
    if (e) e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;

    audio.muted = !audio.muted;
    setIsMuted(audio.muted);
    if (!audio.muted) {
      audio.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    try { document.body.style.overflow = 'hidden'; } catch (e) {}

    const folder = isDesktop ? 'intro-frames-desktop' : 'intro-frames';

    // 1. Audio setup
    const audio = new Audio(`/${folder}/audio.mp3`);
    audio.preload = 'auto';
    audio.muted = true;
    audio.playbackRate = FPS / 12; // Synchronize audio with 18fps playback
    audio.preservesPitch = true;
    audioRef.current = audio;

    // 2. Canvas setup & responsive resizing
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    let lastDrawnImg = null;

    const drawCover = (img) => {
      if (!ctx || !canvas || !img) return;

      const cw = canvas.width;
      const ch = canvas.height;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;

      // Smart responsive cover scaling
      const scale = Math.max(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;

      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;

      ctx.fillStyle = '#02030c';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, dx, dy, dw, dh);
    };

    const resizeCanvas = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round((rect.width || window.innerWidth) * dpr);
      canvas.height = Math.round((rect.height || window.innerHeight) * dpr);

      if (lastDrawnImg) {
        drawCover(lastDrawnImg);
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // 3. Preload frames
    const getFrameUrl = (idx) => {
      const padded = String(idx).padStart(3, '0');
      return `/${folder}/frame_${padded}.webp`;
    };

    // Load first frame immediately and render
    const firstImg = new Image();
    firstImg.src = getFrameUrl(1);
    firstImg.onload = () => {
      imagesMapRef.current.set(1, firstImg);
      lastDrawnImg = firstImg;
      drawCover(firstImg);
    };

    // Background preload of all remaining frames
    for (let i = 2; i <= TOTAL_FRAMES; i++) {
      const img = new Image();
      img.src = getFrameUrl(i);
      img.onload = () => {
        imagesMapRef.current.set(i, img);
      };
    }

    // 4. Animation loop with delta-timing
    let startTime = null;

    const animate = (timestamp) => {
      if (completedRef.current) return;
      if (!startTime) {
        startTime = timestamp;
        audio.play().catch(() => {});
      }

      const elapsed = timestamp - startTime;
      const frameIndex = Math.min(TOTAL_FRAMES, Math.floor(elapsed / FRAME_DURATION) + 1);

      setProgress((frameIndex / TOTAL_FRAMES) * 100);

      const frameImg = imagesMapRef.current.get(frameIndex) || lastDrawnImg;
      if (frameImg) {
        lastDrawnImg = frameImg;
        drawCover(frameImg);
      }

      if (frameIndex >= TOTAL_FRAMES) {
        setTimeout(() => finishIntro(), 200);
        return;
      }

      animFrameIdRef.current = requestAnimationFrame(animate);
    };

    animFrameIdRef.current = requestAnimationFrame(animate);

    // Safety fallback timeout: guaranteed transition after 8s
    const safetyTimer = setTimeout(() => finishIntro(), 8000);

    return () => {
      clearTimeout(safetyTimer);
      window.removeEventListener('resize', resizeCanvas);
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      if (audio) {
        try { audio.pause(); } catch (e) {}
      }
      try { document.body.style.overflow = ''; } catch (e) {}
    };
  }, [finishIntro, isDesktop]);

  return (
    <div
      ref={containerRef}
      onClick={handleInteraction}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        zIndex: 99999,
        background: 'radial-gradient(ellipse at 50% 30%, #0b1240 0%, #02030c 70%)',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif',
        overflow: 'hidden',
        direction: 'rtl',
        opacity: isClosing ? 0 : 1,
        transition: 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 'max(14px, env(safe-area-inset-top, 14px)) max(14px, env(safe-area-inset-right, 14px)) max(14px, env(safe-area-inset-bottom, 14px)) max(14px, env(safe-area-inset-left, 14px))',
      }}
      aria-label="TecOrbi Kids Arena Intro"
    >
      {/* ── Top Header Row ── */}
      <div
        style={{
          width: '100%',
          maxWidth: isDesktop ? '1100px' : '900px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 20,
        }}
      >
        {/* Brand Tag */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(8, 16, 43, 0.78)',
            border: '1px solid rgba(155, 226, 43, 0.45)',
            padding: '6px 14px',
            borderRadius: '999px',
            fontSize: '13px',
            fontWeight: 800,
            color: '#9be22b',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#9be22b',
              display: 'inline-block',
              boxShadow: '0 0 8px #9be22b',
            }}
          />
          <span>TECORBI KIDS ARENA 🎮</span>
        </div>

        {/* Sound Toggle */}
        <button
          type="button"
          onClick={toggleSound}
          style={{
            font: 'inherit',
            fontSize: '13px',
            color: '#fff',
            background: 'rgba(255, 255, 255, 0.14)',
            border: '1px solid rgba(255, 255, 255, 0.28)',
            borderRadius: '999px',
            padding: '7px 16px',
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            transition: 'all 0.2s ease',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            userSelect: 'none',
          }}
          aria-label={isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}
        >
          {isMuted ? '🔇 تشغيل الصوت' : '🔊 الصوت شغال'}
        </button>
      </div>

      {/* ── Center Stage ── */}
      {isDesktop ? (
        /* Desktop: Cinematic 16:9 widescreen stage (as it was originally in tecorbi-intro.html) */
        <div
          style={{
            width: '100%',
            maxWidth: '1100px',
            maxHeight: 'calc(100vh - 130px)',
            aspectRatio: '1344 / 768',
            borderRadius: '20px',
            overflow: 'hidden',
            background: '#000',
            boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.14), 0 30px 90px rgba(42, 60, 255, 0.55)',
            position: 'relative',
            margin: 'auto',
            zIndex: 10,
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              objectFit: 'cover',
            }}
          />
        </div>
      ) : (
        /* Mobile: True Edge-to-Edge Fullscreen Canvas */
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: 'cover',
            zIndex: 5,
          }}
        />
      )}

      {/* ── Bottom Controls Row ── */}
      <div
        style={{
          width: '100%',
          maxWidth: isDesktop ? '1100px' : '900px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          zIndex: 20,
        }}
      >
        {/* Neon Progress Bar */}
        <div
          style={{
            width: '100%',
            maxWidth: '380px',
            height: '4px',
            background: 'rgba(255, 255, 255, 0.18)',
            borderRadius: '999px',
            overflow: 'hidden',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #4a5cff, #9be22b)',
              transition: 'width 0.08s linear',
              boxShadow: '0 0 10px rgba(155, 226, 43, 0.6)',
            }}
          />
        </div>

        {/* Fast Launch / Skip Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            finishIntro();
          }}
          style={{
            background: '#9be22b',
            color: '#02030c',
            border: '1px solid #9be22b',
            fontWeight: 850,
            fontSize: '14px',
            padding: '10px 26px',
            borderRadius: '999px',
            boxShadow: '0 6px 24px rgba(155, 226, 43, 0.45)',
            cursor: 'pointer',
            transition: 'transform 0.2s, background 0.2s',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.04)';
            e.currentTarget.style.background = '#b5f547';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.background = '#9be22b';
          }}
        >
          <span>انطلق إلى المسابقة 🚀</span>
        </button>
      </div>
    </div>
  );
}
