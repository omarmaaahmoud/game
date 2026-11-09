import React, { useEffect, useRef, useState, useCallback } from 'react';

export default function PlayStationIntro({ onComplete, onPlaySound }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [isDone, setIsDone] = useState(false);
  const [hasSound, setHasSound] = useState(false);
  const completedRef = useRef(false);
  const fadingRef = useRef(false);

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
      containerRef.current.style.transition = 'opacity 0.2s ease-out';
      containerRef.current.style.opacity = '0';
      containerRef.current.style.pointerEvents = 'none';
      setTimeout(finishIntro, 200);
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

  const handleContainerClick = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      // If paused for any reason, force play
      if (video.paused) {
        video.play().catch(() => {});
      }
      // Un-mute on first touch/click
      if (video.muted) {
        video.muted = false;
        video.volume = 1.0;
        setHasSound(true);
        if (onPlaySound) onPlaySound();
      }
    }
  }, [onPlaySound]);

  // Robust Callback Ref: Sets autoplay and muted DOM properties immediately on mount
  const setVideoNode = useCallback((node) => {
    if (!node) return;
    videoRef.current = node;

    // Direct DOM property enforcement required by iOS Safari & Android
    node.muted = true;
    node.defaultMuted = true;
    node.playsInline = true;
    node.setAttribute('muted', '');
    node.setAttribute('playsinline', '');
    node.setAttribute('webkit-playsinline', '');
    node.setAttribute('autoplay', '');

    const startPlay = () => {
      node.muted = true;
      const p = node.play();
      if (p !== undefined) {
        p.catch(() => {
          node.muted = true;
          node.play().catch(() => {});
        });
      }
    };

    startPlay();
    node.addEventListener('loadedmetadata', startPlay, { once: true });
    node.addEventListener('canplay', startPlay, { once: true });
  }, []);

  useEffect(() => {
    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    const video = videoRef.current;
    if (!video) return;

    // Try starting playback in effect as well
    video.muted = true;
    video.defaultMuted = true;
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
    });

    // Seamless dive-in transition: only dissolve at the very end of the controller dive
    const handleTimeUpdate = () => {
      if (!video || fadingRef.current) return;
      const duration = video.duration || 4.0;
      const remaining = duration - video.currentTime;

      // Start quick dissolve only in the last 0.25s of the video (after full controller dive)
      if (remaining <= 0.25 && containerRef.current) {
        fadingRef.current = true;
        containerRef.current.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';
        containerRef.current.style.opacity = '0';
        containerRef.current.style.transform = 'scale(1.03)';
        containerRef.current.style.pointerEvents = 'none';
      }
    };

    const handleEnded = () => {
      finishIntro();
    };

    const handleError = () => {
      // Gracefully advance if video file fails
      finishIntro();
    };

    // Safety timeout: 4.0s video, timeout at 4.6s guarantees it never blocks
    const safetyTimer = setTimeout(() => {
      finishIntro();
    }, 4600);

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
  }, [finishIntro]);

  if (isDone) return null;

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      onTouchStart={handleContainerClick}
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
      {/* 1080p 24FPS Cinematic Video (MP4 first for 100% universal iOS/Android autoplay, WebM second) */}
      <video
        ref={setVideoNode}
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
        <source src="/intro.mp4" type="video/mp4" />
        <source src="/intro.webm" type="video/webm" />
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
