import React, { useEffect, useRef, useState, useCallback } from 'react';
import gsap from 'gsap';

export default function PlayStationIntro({ onComplete, onPlaySound }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [isDone, setIsDone] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const completedRef = useRef(false);

  // Complete & Clean up Intro
  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;

    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch (e) {}
    }

    if (containerRef.current) {
      gsap.to(containerRef.current, {
        opacity: 0,
        duration: 0.35,
        ease: 'power2.out',
        onComplete: () => {
          try {
            document.body.style.overflow = '';
          } catch (e) {}
          setIsDone(true);
          if (onComplete) onComplete();
        },
      });
    } else {
      try {
        document.body.style.overflow = '';
      } catch (e) {}
      setIsDone(true);
      if (onComplete) onComplete();
    }
  }, [onComplete]);

  // Handle Skip Button
  const handleSkip = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    finishIntro();
  };

  // Unmute audio on user interaction
  const unmuteAudio = useCallback(() => {
    const video = videoRef.current;
    if (video && video.muted) {
      video.muted = false;
      video.volume = 1.0;
      setIsMuted(false);
    }
  }, []);

  useEffect(() => {
    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    const video = videoRef.current;
    if (video) {
      // Force muted and playsInline for guaranteed mobile/desktop autoplay
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;

      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Retry playback on first user touch if browser still blocks
          const onFirstGesture = () => {
            video.play().catch(() => {});
            window.removeEventListener('touchstart', onFirstGesture);
            window.removeEventListener('click', onFirstGesture);
          };
          window.addEventListener('touchstart', onFirstGesture, { once: true, passive: true });
          window.addEventListener('click', onFirstGesture, { once: true });
        });
      }
    }

    // Auto-unmute on first user touch/tap anywhere on screen
    const handleFirstTouch = () => {
      unmuteAudio();
    };

    window.addEventListener('pointerdown', handleFirstTouch, { once: true });
    window.addEventListener('touchstart', handleFirstTouch, { once: true, passive: true });
    window.addEventListener('click', handleFirstTouch, { once: true });
    window.addEventListener('keydown', handleFirstTouch, { once: true });

    return () => {
      window.removeEventListener('pointerdown', handleFirstTouch);
      window.removeEventListener('touchstart', handleFirstTouch);
      window.removeEventListener('click', handleFirstTouch);
      window.removeEventListener('keydown', handleFirstTouch);
      if (video) {
        try {
          video.pause();
        } catch (e) {}
      }
      try {
        document.body.style.overflow = '';
      } catch (e) {}
    };
  }, [unmuteAudio]);

  // Time update for smooth ending transition
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !video.duration) return;

    // Start graceful fade out 0.45s before video ends
    if (video.duration - video.currentTime <= 0.45 && !completedRef.current) {
      finishIntro();
    }
  };

  if (isDone) return null;

  return (
    <div
      ref={containerRef}
      onClick={unmuteAudio}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        backgroundColor: '#000000',
        overflow: 'hidden',
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      aria-label="Cinematic Video Intro"
    >
      {/* ── Native High-Performance HTML5 Video Element ── */}
      <video
        ref={videoRef}
        src="/intro.mp4"
        autoPlay
        muted={isMuted}
        playsInline
        webkit-playsinline="true"
        x5-playsinline="true"
        preload="auto"
        onEnded={finishIntro}
        onTimeUpdate={handleTimeUpdate}
        style={{
          display: 'block',
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center',
          backgroundColor: '#000000',
        }}
      />

      {/* ── Unmute Sound Prompt Badge (shown when muted) ── */}
      {isMuted && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            unmuteAudio();
          }}
          style={{
            position: 'fixed',
            top: '24px',
            right: '24px',
            zIndex: 100002,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '9999px',
            background: 'rgba(8, 14, 34, 0.75)',
            border: '1px solid rgba(96, 165, 250, 0.45)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            color: '#e2e8f0',
            fontSize: '0.82rem',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 0 20px rgba(37, 99, 235, 0.35)',
            transition: 'all 0.25s ease',
            direction: 'rtl',
          }}
        >
          <span style={{ fontSize: '1rem' }}>🔊</span>
          <span>انقر لتشغيل الصوت</span>
        </div>
      )}

      {/* ── Skip Button ── */}
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
