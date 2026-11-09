import React, { useEffect, useRef, useState, useCallback } from 'react';

export default function PlayStationIntro({ onComplete, onPlaySound }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasSound, setHasSound] = useState(false);
  const [isDone, setIsDone] = useState(false);
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
    const video = videoRef.current;
    if (video) {
      if (video.paused) {
        video.play().catch(() => {});
      }
      video.muted = false;
      video.volume = 1.0;
      setHasSound(true);
      if (onPlaySound) onPlaySound();
    }
  }, [onPlaySound]);

  // Screen tap handler: plays video if paused and enables sound
  const handleScreenTap = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      if (video.paused) {
        video.play().then(() => setIsPlaying(true)).catch(() => {});
      }
      if (video.muted) {
        video.muted = false;
        video.volume = 1.0;
        setHasSound(true);
        if (onPlaySound) onPlaySound();
      }
    }
  }, [onPlaySound]);

  // Robust Callback Ref for instant Mobile Safari / Android Autoplay
  const setVideoRef = useCallback((node) => {
    if (!node) return;
    videoRef.current = node;

    // Direct property and attribute enforcement for iOS WebKit
    node.muted = true;
    node.defaultMuted = true;
    node.playsInline = true;
    node.setAttribute('muted', '');
    node.setAttribute('playsinline', '');
    node.setAttribute('webkit-playsinline', '');
    node.setAttribute('autoplay', '');

    const attemptPlay = () => {
      node.muted = true;
      const promise = node.play();
      if (promise !== undefined) {
        promise.then(() => {
          setIsPlaying(true);
        }).catch((err) => {
          // iOS Low Power Mode blocks autoplay; tap anywhere will start it
          console.warn('Autoplay waiting for user gesture (e.g. Low Power Mode):', err);
          setIsPlaying(false);
        });
      }
    };

    attemptPlay();
    node.addEventListener('loadedmetadata', attemptPlay, { once: true });
    node.addEventListener('canplay', attemptPlay, { once: true });
  }, []);

  useEffect(() => {
    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    const video = videoRef.current;
    if (!video) return;

    // Retry play in effect
    video.muted = true;
    video.defaultMuted = true;
    video.play().then(() => setIsPlaying(true)).catch(() => {});

    // Transition ONLY at the very end when the camera dives through into the webpage
    const handleEnded = () => {
      if (containerRef.current) {
        containerRef.current.style.transition = 'opacity 0.2s ease-out';
        containerRef.current.style.opacity = '0';
        containerRef.current.style.pointerEvents = 'none';
        setTimeout(finishIntro, 200);
      } else {
        finishIntro();
      }
    };

    const handleError = () => {
      finishIntro();
    };

    // Safety timeout: 4.0s video, finishes at 4.6s if not already ended
    const safetyTimer = setTimeout(() => {
      finishIntro();
    }, 4600);

    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      clearTimeout(safetyTimer);
      if (video) {
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
      onClick={handleScreenTap}
      onTouchStart={handleScreenTap}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        backgroundColor: '#000000',
        overflow: 'hidden',
        cursor: 'pointer',
        willChange: 'opacity',
      }}
      aria-label="Cinematic PlayStation Intro"
    >
      <style>{`
        /* Hide iOS Safari native grey circular play button */
        video::-webkit-media-controls {
          display: none !important;
        }
        video::-webkit-media-controls-start-playback-button {
          display: none !important;
          -webkit-appearance: none;
          opacity: 0 !important;
        }
        video::-webkit-media-controls-play-button {
          display: none !important;
        }
      `}</style>

      {/* 1080p 24FPS Cinematic Video (Native FastStart MP4 directly on src for iOS Safari) */}
      <video
        ref={setVideoRef}
        src="/intro.mp4"
        autoPlay
        muted
        playsInline
        preload="auto"
        webkit-playsinline="true"
        x5-playsinline="true"
        controls={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          backgroundColor: '#000000',
          pointerEvents: 'none',
        }}
      />

      {/* Official Tecorbi Company Logo & Emblem Watermark (Top Left) */}
      <div
        style={{
          position: 'fixed',
          top: 'max(20px, env(safe-area-inset-top, 20px))',
          left: 'max(20px, env(safe-area-inset-left, 20px))',
          zIndex: 100001,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 16px',
          borderRadius: '9999px',
          background: 'rgba(8, 14, 34, 0.72)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(147, 197, 253, 0.35)',
          boxShadow: '0 0 25px rgba(0, 0, 0, 0.6)',
          pointerEvents: 'none',
          userSelect: 'none',
          direction: 'ltr',
        }}
      >
        <img
          src="/images/tecorbi-icon.png"
          alt="Tecorbi Icon"
          style={{
            width: '26px',
            height: '26px',
            objectFit: 'contain',
            filter: 'drop-shadow(0 0 8px rgba(96, 165, 250, 0.8))',
          }}
        />
        <img
          src="/images/tecorbi-logo-white.png"
          alt="Tecorbi Logo"
          style={{
            height: '21px',
            objectFit: 'contain',
            filter: 'drop-shadow(0 0 10px rgba(59, 130, 246, 0.6))',
          }}
        />
      </div>

      {/* Un-mute Prompt Button (Top Right) */}
      {!hasSound && (
        <button
          onClick={toggleSound}
          style={{
            position: 'fixed',
            top: 'max(20px, env(safe-area-inset-top, 20px))',
            right: 'max(20px, env(safe-area-inset-right, 20px))',
            zIndex: 100003,
            padding: '9px 18px',
            borderRadius: '9999px',
            border: '1px solid rgba(147, 197, 253, 0.45)',
            background: 'rgba(15, 23, 42, 0.88)',
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
          <span style={{ fontSize: '1.05rem' }}>🔊</span>
          <span>انقر لتشغيل الصوت</span>
        </button>
      )}

      {/* If iOS Low Power Mode blocks autoplay before user touch, show stylish neon tap prompt instead of ugly grey iOS play circle */}
      {!isPlaying && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'transparent',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              padding: '12px 26px',
              borderRadius: '9999px',
              background: 'rgba(15, 23, 42, 0.82)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              border: '1px solid rgba(96, 165, 250, 0.5)',
              boxShadow: '0 0 35px rgba(37, 99, 235, 0.5)',
              color: '#ffffff',
              fontSize: '0.98rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              animation: 'pulse 1.8s ease-in-out infinite',
            }}
          >
            <span style={{ fontSize: '1.25rem' }}>🎮</span>
            <span>المس الشاشة للبدء</span>
          </div>
        </div>
      )}

      {/* Skip Button (Bottom Right) */}
      <button
        onClick={handleSkip}
        style={{
          position: 'fixed',
          bottom: 'max(24px, calc(env(safe-area-inset-bottom, 24px) + 8px))',
          right: 'max(24px, env(safe-area-inset-right, 24px))',
          zIndex: 100002,
          padding: '9px 20px',
          borderRadius: '9999px',
          border: '1px solid rgba(96, 165, 250, 0.45)',
          background: 'rgba(8, 14, 34, 0.8)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          color: '#e2e8f0',
          fontSize: '0.86rem',
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
