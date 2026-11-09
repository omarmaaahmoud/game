import React, { useEffect, useRef, useState, useCallback } from 'react';
import gsap from 'gsap';

const FRAME_COUNT = 122;
const DURATION_SECONDS = 5.0;

const getFrameUrl = (index) => {
  const num = String(index).padStart(3, '0');
  return `/intro-frames/frame_${num}.jpg`;
};

export default function PlayStationIntro({ onComplete, onPlaySound }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isDone, setIsDone] = useState(false);
  const completedRef = useRef(false);
  const soundPlayedRef = useRef(false);
  const imagesRef = useRef([]);
  const tweenRef = useRef(null);

  const triggerSound = useCallback(() => {
    if (soundPlayedRef.current) return;
    soundPlayedRef.current = true;
    try {
      if (onPlaySound) onPlaySound();
    } catch (e) {}
  }, [onPlaySound]);

  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (tweenRef.current) {
      tweenRef.current.kill();
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

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    // Handle canvas sizing for sharp retina rendering
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

    // Draw single frame to canvas with aspect-ratio cover
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

    // Preload all frames
    const images = [];
    imagesRef.current = images;

    // Load first frame immediately
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

    // Playhead state object for GSAP
    const playhead = { frame: 0 };

    // GSAP Timeline animation
    const tl = gsap.timeline({
      delay: 0.1,
      onStart: () => {
        triggerSound();
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

    // Fade out overlay during the last 0.75s
    tl.to(
      containerRef.current,
      {
        opacity: 0,
        duration: 0.75,
        ease: 'power2.inOut',
      },
      `-=${0.75}`
    );

    tweenRef.current = tl;

    return () => {
      window.removeEventListener('resize', handleResize);
      if (tl) tl.kill();
      try {
        document.body.style.overflow = '';
      } catch (e) {}
    };
  }, [finishIntro, triggerSound]);

  if (isDone) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        backgroundColor: '#030511',
        overflow: 'hidden',
        cursor: 'default',
        transition: 'opacity 140ms linear',
      }}
      aria-label="PlayStation 5 Cinematic Intro (GSAP Canvas)"
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
          backgroundColor: '#030511',
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
