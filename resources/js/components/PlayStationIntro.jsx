import React, { useEffect, useRef, useState, useCallback } from 'react';

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

export default function PlayStationIntro({ onComplete, onPlaySound }) {
  const videoRef = useRef(null);
  const [overlayOpacity, setOverlayOpacity] = useState(1);
  const [isDone, setIsDone] = useState(false);
  const completedRef = useRef(false);
  const soundTriggeredRef = useRef(false);

  const triggerSound = useCallback(() => {
    if (soundTriggeredRef.current) return;
    soundTriggeredRef.current = true;
    try {
      if (onPlaySound) onPlaySound();
    } catch (e) {}
  }, [onPlaySound]);

  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    try {
      document.body.style.overflow = '';
    } catch (e) {}
    setIsDone(true);
    if (onComplete) onComplete();
  }, [onComplete]);

  useEffect(() => {
    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    const v = videoRef.current;
    if (!v) return;

    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');

    const playVideo = () => {
      if (!v) return;
      const promise = v.play();
      if (promise !== undefined) {
        promise
          .then(() => {
            triggerSound();
          })
          .catch((err) => {
            // Autoplay waiting for interaction or buffer
            console.log('Video autoplay deferred:', err);
          });
      }
    };

    if (v.readyState >= 2) {
      playVideo();
    } else {
      v.addEventListener('canplay', playVideo, { once: true });
      v.addEventListener('loadeddata', playVideo, { once: true });
    }

    return () => {
      try {
        document.body.style.overflow = '';
      } catch (e) {}
    };
  }, [triggerSound]);

  const handleVideoTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const remaining = v.duration - v.currentTime;
    if (remaining <= 0.85) {
      const fade = clamp(remaining / 0.85, 0, 1);
      setOverlayOpacity(fade);
    }
  };

  const handleContainerClick = () => {
    const v = videoRef.current;
    if (v && v.paused) {
      v.play().then(triggerSound).catch(() => {});
    }
  };

  if (isDone) return null;

  return (
    <div
      onClick={handleContainerClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        pointerEvents: overlayOpacity < 0.25 ? 'none' : 'auto',
        opacity: overlayOpacity,
        transition: 'opacity 140ms linear',
        backgroundColor: '#030511',
        overflow: 'hidden',
        cursor: 'default',
      }}
      aria-label="PlayStation 5 DualSense Intro"
    >
      <video
        ref={videoRef}
        src="/models/ps5-intro.mp4"
        autoPlay
        muted
        playsInline
        preload="auto"
        onTimeUpdate={handleVideoTimeUpdate}
        onEnded={finishIntro}
        onPlaying={triggerSound}
        style={{
          width: '100vw',
          height: '100vh',
          objectFit: 'cover',
          objectPosition: 'center center',
          backgroundColor: '#030511',
          display: 'block',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        <source src="/models/ps5-intro.mp4" type="video/mp4" />
        <source src="/models/ps5-intro.webm" type="video/webm" />
      </video>

      <button
        onClick={(e) => {
          e.stopPropagation();
          finishIntro();
        }}
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
