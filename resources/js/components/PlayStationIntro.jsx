import React, { useEffect, useRef, useState, useCallback } from 'react';

export default function PlayStationIntro({ onComplete, onPlaySound }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [isFading, setIsFading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [hasSound, setHasSound] = useState(false);
  const completedRef = useRef(false);

  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;

    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.src = '';
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
      containerRef.current.style.transition = 'opacity 0.25s ease-out';
      containerRef.current.style.opacity = '0';
      containerRef.current.style.pointerEvents = 'none';
      setTimeout(finishIntro, 250);
    } else {
      finishIntro();
    }
  }, [finishIntro]);

  const toggleSound = useCallback((e) => {
    if (e) e.stopPropagation();
    if (videoRef.current) {
      videoRef.current.muted = false;
      videoRef.current.volume = 1.0;
      setHasSound(true);
      if (onPlaySound) onPlaySound();
    }
  }, [onPlaySound]);

  useEffect(() => {
    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    const video = videoRef.current;
    if (!video) return;

    // Ensure DOM properties are set before autoplay check
    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;

    const playVideo = () => {
      const promise = video.play();
      if (promise !== undefined) {
        promise.catch(() => {
          // Retry with muted guaranteed
          video.muted = true;
          video.play().catch(() => {});
        });
      }
    };

    playVideo();

    // Smooth transition into homepage as video nears completion
    const handleTimeUpdate = () => {
      if (!video) return;
      const duration = video.duration || 3.65;
      const remaining = duration - video.currentTime;

      // Start smooth dissolve 0.4s before video ends
      if (remaining <= 0.4 && !isFading && containerRef.current) {
        setIsFading(true);
        containerRef.current.style.transition = 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), transform 0.4s ease-in';
        containerRef.current.style.opacity = '0';
        containerRef.current.style.transform = 'scale(1.04)';
        containerRef.current.style.pointerEvents = 'none';
      }
    };

    const handleEnded = () => {
      finishIntro();
    };

    const handleError = () => {
      // If video fails, gracefully proceed to site without blocking
      finishIntro();
    };

    // Safety timeout: video is 3.65s, after 4.2s ensure transition completes
    const safetyTimer = setTimeout(() => {
      finishIntro();
    }, 4200);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      clearTimeout(safetyTimer);
      if (video) {
        video.removeEventListener('timeupdate', handleTimeUpdate);
        video.removeEventListener('ended', handleEnded);
        video.removeEventListener('error', handleError);
        video.pause();
      }
      try {
        document.body.style.overflow = '';
      } catch (e) {}
    };
  }, [finishIntro, isFading]);

  if (isDone) return null;

  return (
    <div
      ref={containerRef}
      onClick={toggleSound}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        backgroundColor: '#000000',
        overflow: 'hidden',
        cursor: 'pointer',
        willChange: 'opacity, transform',
      }}
      aria-label="Cinematic PlayStation Intro"
    >
      {/* Hardware-Accelerated 1080p 24FPS Cinematic Video */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        preload="auto"
        webkit-playsinline="true"
        x5-playsinline="true"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          backgroundColor: '#000000',
        }}
      >
        <source src="/intro.webm" type="video/webm" />
        <source src="/intro.mp4" type="video/mp4" />
      </video>

      {/* Official Tecorbi Company Logo & Emblem Watermark (Top Left) */}
      <div
        style={{
          position: 'fixed',
          top: '24px',
          left: '28px',
          zIndex: 100001,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 16px',
          borderRadius: '9999px',
          background: 'rgba(8, 14, 34, 0.65)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid rgba(147, 197, 253, 0.25)',
          boxShadow: '0 0 25px rgba(0, 0, 0, 0.6)',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <img
          src="/images/tecorbi-icon.png"
          alt="Tecorbi Icon"
          style={{
            width: '26px',
            height: '26px',
            objectFit: 'contain',
            filter: 'drop-shadow(0 0 6px rgba(147, 197, 253, 0.7))',
          }}
        />
        <img
          src="/images/tecorbi-logo-white.png"
          alt="Tecorbi Logo"
          style={{
            height: '22px',
            objectFit: 'contain',
            filter: 'drop-shadow(0 0 10px rgba(59, 130, 246, 0.5))',
          }}
        />
      </div>

      {/* Un-mute Prompt Button (Top Right as requested) */}
      {!hasSound && (
        <button
          onClick={toggleSound}
          style={{
            position: 'fixed',
            top: '24px',
            right: '28px',
            zIndex: 100003,
            padding: '9px 20px',
            borderRadius: '9999px',
            border: '1px solid rgba(147, 197, 253, 0.45)',
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            color: '#93c5fd',
            fontSize: '0.86rem',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 0 25px rgba(59, 130, 246, 0.4)',
            fontFamily: 'system-ui, sans-serif',
            direction: 'rtl',
            transition: 'all 0.25s ease',
          }}
        >
          <span style={{ fontSize: '1.1rem' }}>🔊</span>
          <span>انقر لتشغيل الصوت</span>
        </button>
      )}

      {/* Skip Button (Bottom Right) */}
      <button
        onClick={handleSkip}
        style={{
          position: 'fixed',
          bottom: '28px',
          right: '28px',
          zIndex: 100002,
          padding: '10px 22px',
          borderRadius: '9999px',
          border: '1px solid rgba(96, 165, 250, 0.45)',
          background: 'rgba(8, 14, 34, 0.8)',
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
