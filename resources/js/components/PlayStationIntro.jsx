import React, { useEffect, useRef, useState, useCallback } from 'react';
import gsap from 'gsap';

export default function PlayStationIntro({ onComplete, onPlaySound }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [isDone, setIsDone] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
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

  // Unmute audio and ensure playing on user interaction
  const handleInteraction = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      if (video.paused) {
        video.play().catch(() => {});
      }
      video.muted = false;
      video.volume = 1.0;
      setIsMuted(false);
      setIsBlocked(false);
      setIsPlaying(true);
    }
  }, []);

  useEffect(() => {
    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    const video = videoRef.current;
    if (video) {
      // Force DOM properties for guaranteed mobile/desktop autoplay
      video.defaultMuted = true;
      video.muted = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.setAttribute('x5-playsinline', '');

      const tryPlay = () => {
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              setIsPlaying(true);
              setIsBlocked(false);
            })
            .catch(() => {
              // Browser blocked muted autoplay (e.g. power saving mode)
              setIsBlocked(true);
            });
        }
      };

      if (video.readyState >= 2) {
        tryPlay();
      } else {
        video.addEventListener('canplay', tryPlay, { once: true });
        video.addEventListener('loadeddata', tryPlay, { once: true });
      }
    }

    // Auto-unmute and play on first user tap/touch anywhere on screen
    const onUserGesture = () => {
      handleInteraction();
    };

    window.addEventListener('pointerdown', onUserGesture, { once: true });
    window.addEventListener('touchstart', onUserGesture, { once: true, passive: true });
    window.addEventListener('click', onUserGesture, { once: true });
    window.addEventListener('keydown', onUserGesture, { once: true });

    return () => {
      window.removeEventListener('pointerdown', onUserGesture);
      window.removeEventListener('touchstart', onUserGesture);
      window.removeEventListener('click', onUserGesture);
      window.removeEventListener('keydown', onUserGesture);
      if (video) {
        try {
          video.pause();
        } catch (e) {}
      }
      try {
        document.body.style.overflow = '';
      } catch (e) {}
    };
  }, [handleInteraction]);

  // Smooth ending transition near end of video
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !video.duration) return;

    // Gracefully fade out 0.4s before video finishes (only after 3s have elapsed)
    if (video.currentTime > 3 && video.duration - video.currentTime <= 0.4 && !completedRef.current) {
      finishIntro();
    }
  };

  // Video error handler to prevent stuck black screen
  const handleError = () => {
    console.error('Intro video failed to load, falling back to app');
    finishIntro();
  };

  if (isDone) return null;

  return (
    <div
      ref={containerRef}
      onClick={handleInteraction}
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
        autoPlay
        muted
        playsInline
        webkit-playsinline="true"
        x5-playsinline="true"
        preload="auto"
        onPlaying={() => {
          setIsPlaying(true);
          setIsBlocked(false);
        }}
        onEnded={finishIntro}
        onTimeUpdate={handleTimeUpdate}
        onError={handleError}
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
      >
        <source src="/intro.mp4" type="video/mp4" />
      </video>

      {/* ── Fallback Play Button Overlay (shown if browser blocked autoplay) ── */}
      {isBlocked && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            handleInteraction();
          }}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 100001,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              width: '84px',
              height: '84px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
              border: '2px solid rgba(255, 255, 255, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 45px rgba(37, 99, 235, 0.75)',
              marginBottom: '18px',
              transition: 'transform 0.2s ease',
            }}
          >
            <span style={{ fontSize: '36px', color: '#ffffff', marginLeft: '6px' }}>▶</span>
          </div>

          <div
            style={{
              fontSize: '1.2rem',
              fontWeight: 800,
              color: '#ffffff',
              letterSpacing: '0.05em',
              textShadow: '0 0 15px rgba(59, 130, 246, 0.8)',
              direction: 'rtl',
            }}
          >
            اضغط لتشغيل الإنترو ✦ Play
          </div>
        </div>
      )}

      {/* ── Unmute Sound Prompt Badge (shown when playing but muted) ── */}
      {!isBlocked && isMuted && isPlaying && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            handleInteraction();
          }}
          style={{
            position: 'fixed',
            top: '24px',
            right: '24px',
            zIndex: 100002,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 18px',
            borderRadius: '9999px',
            background: 'rgba(8, 14, 34, 0.8)',
            border: '1px solid rgba(96, 165, 250, 0.45)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            color: '#e2e8f0',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 0 25px rgba(37, 99, 235, 0.4)',
            transition: 'all 0.25s ease',
            direction: 'rtl',
            animation: 'pulse 2s ease-in-out infinite',
          }}
        >
          <span style={{ fontSize: '1.1rem' }}>🔊</span>
          <span>انقر في أي مكان لتشغيل الصوت</span>
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
