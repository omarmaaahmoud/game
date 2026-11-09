import React, { useEffect, useRef, useState, useCallback } from 'react';
import gsap from 'gsap';

const FRAME_COUNT = 48;
const DURATION_SECONDS = 8.0;

const getFrameUrl = (index) => {
  const num = String(index).padStart(3, '0');
  return `/intro-frames/frame_${num}.webp`;
};

export default function PlayStationIntro({ onComplete, onPlaySound }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const completedRef = useRef(false);
  const audioRef = useRef(null);
  const tweenRef = useRef(null);

  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (tweenRef.current) {
      tweenRef.current.kill();
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch (e) {}
    }
    try {
      document.body.style.overflow = '';
    } catch (e) {}
    setIsDone(true);
    if (onComplete) onComplete();
  }, [onComplete]);

  const handleSkip = (e) => {
    if (e) e.stopPropagation();
    if (containerRef.current) {
      gsap.to(containerRef.current, {
        opacity: 0,
        duration: 0.25,
        ease: 'power2.out',
        onComplete: finishIntro,
      });
    } else {
      finishIntro();
    }
  };

  useEffect(() => {
    let isCancelled = false;

    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    // Initialize audio from the cinematic video
    const audio = new Audio('/intro-frames/intro-sound.mp3');
    audio.preload = 'auto';
    audioRef.current = audio;

    const playAudio = () => {
      audio.play().catch(() => {
        if (onPlaySound) onPlaySound();
      });
    };

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    // Handle canvas sizing - DPR capped at 1.25 to prevent 4K GPU texture thrashing
    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    // Fast aspect-ratio cover drawing
    const drawImageCover = (img) => {
      if (!img || !img.complete || img.naturalWidth === 0) return;
      const cw = canvas.width;
      const ch = canvas.height;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const scale = Math.max(cw / iw, ch / ih);
      const nw = iw * scale;
      const nh = ih * scale;
      const nx = (cw - nw) / 2;
      const ny = (ch - nh) / 2;
      ctx.drawImage(img, nx, ny, nw, nh);
    };

    const images = new Array(FRAME_COUNT);
    let loadedCount = 0;
    let started = false;

    const startAnimation = () => {
      if (started || isCancelled) return;
      started = true;
      setIsLoaded(true);

      // Render initial frame instantly
      if (images[0]) {
        drawImageCover(images[0]);
      }

      const playhead = { frame: 0 };

      // GSAP Timeline animation - 100% butter-smooth because all frames are pre-decoded in RAM
      const tl = gsap.timeline({
        delay: 0.08,
        onStart: () => {
          playAudio();
        },
        onComplete: () => {
          gsap.to(containerRef.current, {
            opacity: 0,
            duration: 0.45,
            ease: 'power2.out',
            onComplete: finishIntro,
          });
        },
      });

      tl.to(playhead, {
        frame: FRAME_COUNT - 1,
        snap: 'frame',
        ease: 'none',
        duration: DURATION_SECONDS,
        onUpdate: () => {
          const idx = Math.floor(playhead.frame);
          const img = images[idx];
          if (img) {
            drawImageCover(img);
          }
        },
      });

      // Smooth fade out at the end
      tl.to(
        containerRef.current,
        {
          opacity: 0,
          duration: 0.8,
          ease: 'power2.inOut',
        },
        `-=${0.8}`
      );

      tweenRef.current = tl;
    };

    // Preload & Pre-decode all frames into GPU memory before playback
    const checkDone = () => {
      const progress = Math.min(100, Math.round((loadedCount / FRAME_COUNT) * 100));
      setLoadProgress(progress);
      if (loadedCount >= FRAME_COUNT) {
        startAnimation();
      }
    };

    // Safety timeout: if after 2s at least 20 frames are loaded, start playback
    const safetyTimeout = setTimeout(() => {
      if (!started && loadedCount >= 20) {
        startAnimation();
      }
    }, 2000);

    // Preload all frames
    for (let i = 1; i <= FRAME_COUNT; i++) {
      const img = new Image();
      img.src = getFrameUrl(i);

      const onReady = async () => {
        try {
          if ('decode' in img) {
            await img.decode();
          }
        } catch (e) {}
        images[i - 1] = img;
        loadedCount++;
        checkDone();
      };

      img.onload = onReady;
      img.onerror = () => {
        loadedCount++;
        checkDone();
      };
    }

    return () => {
      isCancelled = true;
      clearTimeout(safetyTimeout);
      window.removeEventListener('resize', handleResize);
      if (tweenRef.current) tweenRef.current.kill();
      if (audio) {
        audio.pause();
        audio.src = '';
      }
      try {
        document.body.style.overflow = '';
      } catch (e) {}
    };
  }, [finishIntro, onPlaySound]);

  if (isDone) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        backgroundColor: '#000000',
        overflow: 'hidden',
        cursor: 'default',
        transition: 'opacity 140ms linear',
      }}
      aria-label="Cinematic Intro Animation (GSAP Canvas)"
    >
      {/* High-Performance Canvas for Butter-Smooth 60FPS Playback */}
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: '#000000',
          opacity: isLoaded ? 1 : 0,
          transition: 'opacity 0.25s ease',
        }}
      />

      {/* Cyberpunk PlayStation Loading Screen */}
      {!isLoaded && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#000000',
            color: '#ffffff',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            userSelect: 'none',
          }}
        >
          {/* Glowing Emblem */}
          <div
            style={{
              width: '68px',
              height: '68px',
              borderRadius: '20px',
              background: 'linear-gradient(135deg, rgba(37,99,235,0.85) 0%, rgba(147,51,234,0.85) 100%)',
              border: '1px solid rgba(147, 197, 253, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 35px rgba(37, 99, 235, 0.55)',
              marginBottom: '20px',
              animation: 'pulse 1.8s ease-in-out infinite',
            }}
          >
            <span style={{ fontSize: '30px' }}>🎮</span>
          </div>

          {/* Title */}
          <div
            style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#f8fafc',
              marginBottom: '6px',
              textShadow: '0 0 15px rgba(59, 130, 246, 0.75)',
            }}
          >
            Tecorbi Game
          </div>

          {/* Subtitle with percentage */}
          <div
            style={{
              fontSize: '0.85rem',
              color: '#93c5fd',
              marginBottom: '18px',
              letterSpacing: '0.04em',
              direction: 'rtl',
            }}
          >
            جاري تحضير التجربة السينمائية... {loadProgress}%
          </div>

          {/* Sleek Neon Progress Bar */}
          <div
            style={{
              width: '260px',
              height: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              borderRadius: '9999px',
              overflow: 'hidden',
              boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${loadProgress}%`,
                background: 'linear-gradient(90deg, #2563eb, #06b6d4, #a855f7)',
                borderRadius: '9999px',
                boxShadow: '0 0 12px #38bdf8',
                transition: 'width 0.1s linear',
              }}
            />
          </div>
        </div>
      )}

      {/* Skip Button - Always available immediately */}
      <button
        onClick={handleSkip}
        style={{
          position: 'fixed',
          bottom: '28px',
          right: '32px',
          zIndex: 100002,
          padding: '10px 22px',
          borderRadius: '9999px',
          border: '1px solid rgba(96, 165, 250, 0.45)',
          background: 'rgba(8, 14, 34, 0.75)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          color: '#e2e8f0',
          fontSize: '0.88rem',
          fontWeight: 600,
          letterSpacing: '0.03em',
          cursor: 'pointer',
          boxShadow: '0 0 20px rgba(37, 99, 235, 0.35)',
          fontFamily: 'system-ui, sans-serif',
          transition: 'all 0.2s ease',
        }}
      >
        تخطي الإنترو ✦ Skip
      </button>
    </div>
  );
}
