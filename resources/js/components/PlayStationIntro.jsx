import React, { useEffect, useRef, useState, useCallback } from 'react';
const FRAME_COUNT = 48;
const DURATION_SECONDS = 8.04; // Exact duration matching the 8.04s native soundtrack
const FADE_OUT_DURATION = 0.44; // Smooth dissolve window at the end (7.60s to 8.04s)

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
  const startedRef = useRef(false);
  const audioRef = useRef(null);
  const rafIdRef = useRef(null);
  const safetyTimeoutRef = useRef(null);

  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;

    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
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

  const handleSkip = useCallback((e) => {
    if (e) e.stopPropagation();
    if (containerRef.current) {
      containerRef.current.style.transition = 'opacity 0.2s ease-out';
      containerRef.current.style.opacity = '0';
      containerRef.current.style.pointerEvents = 'none';
      setTimeout(finishIntro, 200);
    } else {
      finishIntro();
    }
  }, [finishIntro]);

  const handleContainerTap = useCallback(() => {
    if (audioRef.current && audioRef.current.paused) {
      audioRef.current.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;

    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    // Initialize audio
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

    // Handle canvas sizing with DPR capped at 1.5 for crisp mobile rendering
    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
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

    // Aspect-ratio cover rendering
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

    // requestAnimationFrame animation loop driven by wall-clock elapsed time
    const startAnimation = () => {
      if (startedRef.current || isCancelled) return;
      startedRef.current = true;
      setIsLoaded(true);

      // Cancel safety timeout immediately: animation has officially started
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }

      // Backfill any potentially missing frames to guarantee no blank frames
      let lastValid = null;
      for (let k = 0; k < FRAME_COUNT; k++) {
        if (images[k]) {
          lastValid = images[k];
        } else if (lastValid) {
          images[k] = lastValid;
        }
      }

      // Render first frame immediately
      if (images[0]) {
        drawImageCover(images[0]);
      }

      // Play audio
      playAudio();

      let startTime = null;
      let lastDrawnIndex = 0;
      const fadeStartTime = DURATION_SECONDS - FADE_OUT_DURATION;

      // Expose diagnostic metrics to window for browser test verification
      if (typeof window !== 'undefined') {
        window.__INTRO_DIAGNOSTICS__ = {
          startTime: 0,
          endTime: 0,
          totalDuration: 0,
          framesRendered: new Set([0]),
          frameCount: FRAME_COUNT,
          completed: false,
        };
      }

      const tick = (timestamp) => {
        if (isCancelled || completedRef.current) return;

        if (startTime === null) {
          startTime = timestamp;
          if (window.__INTRO_DIAGNOSTICS__) {
            window.__INTRO_DIAGNOSTICS__.startTime = startTime;
          }
        }

        const elapsed = (timestamp - startTime) / 1000;

        if (elapsed < DURATION_SECONDS) {
          // Precise elapsed-time frame index calculation
          const progress = Math.min(Math.max(elapsed / DURATION_SECONDS, 0), 1);
          const frameIdx = Math.min(Math.floor(progress * FRAME_COUNT), FRAME_COUNT - 1);

          // Only draw to canvas when the frame changes
          if (frameIdx !== lastDrawnIndex) {
            const frameImg = images[frameIdx] || images[lastDrawnIndex];
            if (frameImg) {
              drawImageCover(frameImg);
              lastDrawnIndex = frameIdx;
              if (window.__INTRO_DIAGNOSTICS__) {
                window.__INTRO_DIAGNOSTICS__.framesRendered.add(frameIdx);
              }
            }
          }

          // Smooth dissolve into the homepage in the final 0.44s
          if (elapsed >= fadeStartTime) {
            const fadeProgress = (elapsed - fadeStartTime) / FADE_OUT_DURATION;
            const opacity = Math.max(0, 1 - fadeProgress);
            if (containerRef.current) {
              containerRef.current.style.opacity = opacity.toFixed(4);
              containerRef.current.style.pointerEvents = 'none';
            }
          }

          rafIdRef.current = requestAnimationFrame(tick);
        } else {
          // Exact duration reached: draw final frame 47, set opacity 0, finish intro
          const finalImg = images[FRAME_COUNT - 1] || images[lastDrawnIndex];
          if (finalImg) {
            drawImageCover(finalImg);
            if (window.__INTRO_DIAGNOSTICS__) {
              window.__INTRO_DIAGNOSTICS__.framesRendered.add(FRAME_COUNT - 1);
            }
          }

          if (containerRef.current) {
            containerRef.current.style.opacity = '0';
            containerRef.current.style.pointerEvents = 'none';
          }

          if (window.__INTRO_DIAGNOSTICS__) {
            window.__INTRO_DIAGNOSTICS__.endTime = timestamp;
            window.__INTRO_DIAGNOSTICS__.totalDuration = (timestamp - startTime) / 1000;
            window.__INTRO_DIAGNOSTICS__.completed = true;
          }

          finishIntro();
        }
      };

      rafIdRef.current = requestAnimationFrame(tick);
    };

    // Preload tracking
    const checkDone = () => {
      const progress = Math.min(100, Math.round((loadedCount / FRAME_COUNT) * 100));
      setLoadProgress(progress);
      if (loadedCount >= FRAME_COUNT) {
        startAnimation();
      }
    };

    // Safety timeout: only starts if network stalled after 3.5s and animation hasn't started yet
    // Never interrupts an ongoing animation
    safetyTimeoutRef.current = setTimeout(() => {
      if (!startedRef.current && loadedCount >= 10) {
        startAnimation();
      }
    }, 3500);

    // Preload all 48 frames with GPU decoding
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
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      window.removeEventListener('resize', handleResize);
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
      onPointerDown={handleContainerTap}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        backgroundColor: '#000000',
        overflow: 'hidden',
        cursor: 'default',
        willChange: 'opacity',
      }}
      aria-label="Cinematic Intro Animation (RAF Canvas)"
    >
      {/* High-Performance Canvas for 60FPS Elapsed-Time Playback */}
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
          transition: 'opacity 0.2s ease',
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
