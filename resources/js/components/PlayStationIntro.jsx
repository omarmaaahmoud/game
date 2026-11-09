import React, { useEffect, useRef, useState, useCallback } from 'react';
import gsap from 'gsap';

const FRAME_COUNT = 192;
const DURATION_SECONDS = 8.0;

const getFrameUrl = (index) => {
  const num = String(index).padStart(3, '0');
  return `/intro-frames/frame_${num}.jpg`;
};

export default function PlayStationIntro({ onComplete, onPlaySound }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
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
    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    // Initialize audio from the cinematic video
    const audio = new Audio('/intro-frames/intro-sound.mp3');
    audio.preload = 'auto';
    audioRef.current = audio;

    const playAudio = () => {
      audio.play().catch(() => {
        // Fallback to web audio synth if audio tag is gesture-blocked
        if (onPlaySound) onPlaySound();
      });
    };

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    // Handle canvas sizing for sharp rendering
    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    // Draw frame to canvas with aspect-ratio cover
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

    // Preload frames
    const images = [];

    // First frame render
    const firstImg = new Image();
    firstImg.src = getFrameUrl(1);
    firstImg.onload = () => {
      drawImageCover(firstImg);
    };
    images[0] = firstImg;

    for (let i = 2; i <= FRAME_COUNT; i++) {
      const img = new Image();
      img.src = getFrameUrl(i);
      images[i - 1] = img;
    }

    // Playhead state for GSAP
    const playhead = { frame: 0 };

    // GSAP Timeline animation
    const tl = gsap.timeline({
      delay: 0.05,
      onStart: () => {
        playAudio();
      },
      onComplete: () => {
        gsap.to(containerRef.current, {
          opacity: 0,
          duration: 0.5,
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
        if (img && img.complete) {
          drawImageCover(img);
        }
      },
    });

    // Smooth fade out at the end
    tl.to(
      containerRef.current,
      {
        opacity: 0,
        duration: 0.85,
        ease: 'power2.inOut',
      },
      `-=${0.85}`
    );

    tweenRef.current = tl;

    return () => {
      window.removeEventListener('resize', handleResize);
      if (tl) tl.kill();
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
        }}
      />

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
