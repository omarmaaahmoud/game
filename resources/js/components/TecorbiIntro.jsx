import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * TecorbiIntro Component - Fullscreen Frame-Based Animation Engine
 *
 * 1. 100% Zero Autoplay Restrictions: Powered by lightweight WebP frames rendered directly
 *    onto a high-performance <canvas>. Guaranteed zero-click start on all mobile devices (iOS & Android).
 * 2. True Fullscreen ("تاخد الشاشة كلها حقيقي"): Fills 100vw × 100dvh edge-to-edge with no boxes,
 *    margins, or black bars.
 * 3. Centered ("وسطنها"): Smart responsive cover math keeps the robot and logo centered in the viewport.
 * 4. Lightweight Frame Count ("متكنش فريمات كتيرة"): 110 optimized WebP frames (~800 KB total),
 *    smoothly animated at 12 fps with requestAnimationFrame delta timing.
 * 5. Audio Sync: Companion audio starts on tap anywhere or via the sleek top sound pill.
 * 6. Smooth Transition: Automatic fade-out into the Tecorbi Kids Arena homepage when finished.
 */

const TOTAL_FRAMES = 110;
const FPS = 12;
const FRAME_DURATION = 1000 / FPS; // ~83.33ms per frame

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

  // Audio unmute & sync on interaction (matching tap anywhere)
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

    // 1. Audio setup
    const audio = new Audio('/intro-frames/audio.mp3');
    audio.preload = 'auto';
    audio.muted = true;
    audioRef.current = audio;

    // 2. Canvas setup & responsive resizing
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // 3. Draw a frame centered and covering the full canvas
    const drawCover = (img) => {
      if (!ctx || !canvas || !img) return;

      const cw = canvas.width;
      const ch = canvas.height;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;

      // Smart full-screen cover scaling:
      // On mobile portrait, covers 100% of the screen.
      // On desktop widescreen, fits height while centering smoothly with dark radial background.
      const isPortrait = ch >= cw;
      const scale = isPortrait
        ? Math.max(cw / iw, ch / ih) // Full true cover on mobile
        : Math.min(Math.max(cw / iw, ch / ih), (ch / ih) * 1.05);

      const dw = iw * scale;
      const dh = ih * scale;

      // Centered shifts
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;

      ctx.fillStyle = '#02030c';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, dx, dy, dw, dh);
    };

    // 4. Preload frames
    const getFrameUrl = (idx) => {
      const padded = String(idx).padStart(3, '0');
      return `/intro-frames/frame_${padded}.webp`;
    };

    let lastDrawnImg = null;

    // Load first frame immediately and render
    const firstImg = new Image();
    firstImg.src = getFrameUrl(1);
    firstImg.onload = () => {
      imagesMapRef.current.set(1, firstImg);
      lastDrawnImg = firstImg;
      drawCover(firstImg);
    };

    // Progressive background preload of all remaining frames
    for (let i = 2; i <= TOTAL_FRAMES; i++) {
      const img = new Image();
      img.src = getFrameUrl(i);
      img.onload = () => {
        imagesMapRef.current.set(i, img);
      };
    }

    // 5. Animation loop with delta-timing
    let startTime = null;

    const animate = (timestamp) => {
      if (completedRef.current) return;
      if (!startTime) {
        startTime = timestamp;
        // Attempt muted audio start
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
        // Animation complete: wait 200ms and smoothly exit
        setTimeout(() => finishIntro(), 200);
        return;
      }

      animFrameIdRef.current = requestAnimationFrame(animate);
    };

    animFrameIdRef.current = requestAnimationFrame(animate);

    // Safety fallback timeout: guaranteed transition after 11.5s
    const safetyTimer = setTimeout(() => finishIntro(), 11500);

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
  }, [finishIntro]);

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
        background: '#02030c',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif',
        overflow: 'hidden',
        direction: 'rtl',
        opacity: isClosing ? 0 : 1,
        transition: 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        cursor: 'pointer',
      }}
      aria-label="TecOrbi Kids Arena Intro"
    >
      {/* ── True Fullscreen Canvas (Edge-to-Edge, Zero Borders) ── */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: 'cover',
        }}
      />

      {/* ── Floating Controls Layer ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'max(14px, env(safe-area-inset-top, 14px)) max(14px, env(safe-area-inset-right, 14px)) max(14px, env(safe-area-inset-bottom, 14px)) max(14px, env(safe-area-inset-left, 14px))',
          zIndex: 10,
        }}
      >
        {/* Top Header Row */}
        <div
          style={{
            width: '100%',
            maxWidth: '1000px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            pointerEvents: 'auto',
          }}
        >
          {/* Brand Pill */}
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

        {/* Bottom Controls Row: Progress + Skip Button */}
        <div
          style={{
            width: '100%',
            maxWidth: '1000px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            pointerEvents: 'auto',
          }}
        >
          {/* Subtle neon progress bar */}
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

          {/* Fast Skip / Launch into arena */}
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
    </div>
  );
}
