import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * GameIntroOverlay Component
 *
 * Production-ready zero-click video intro overlay for Tecorbi Kids Arena.
 * Features:
 *  - 100% Zero-click autoplay (muted + playsInline programmatic enforcement)
 *  - Fullscreen fixed viewport overlay (z-[9999])
 *  - Smooth 700ms fade-out transition on ended or skip
 *  - Glassmorphic modern gaming "Skip" button in bottom-right corner
 *  - Optional unmute toggle for audio immersion
 *  - sessionStorage caching so users only see it once per session
 */
export default function GameIntroOverlay({ onFinish, videoSrc = '/intro.mp4' }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hasFinishedRef = useRef(false);

  const [isVisible, setIsVisible] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        return !sessionStorage.getItem('hasSeenIntro');
      } catch (e) {
        return true;
      }
    }
    return true;
  });

  const [isFading, setIsFading] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  // Smooth exit handler (fade out 700ms -> unmount & notify parent)
  const handleExit = useCallback(() => {
    if (hasFinishedRef.current) return;
    hasFinishedRef.current = true;

    // Cache to sessionStorage so it doesn't replay on refresh
    try {
      sessionStorage.setItem('hasSeenIntro', 'true');
    } catch (e) {
      console.warn('sessionStorage access error:', e);
    }

    // Trigger smooth fade-out (opacity 0 over 700ms)
    setIsFading(true);

    setTimeout(() => {
      // Pause video and free memory
      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch (e) {}
      }

      // Restore body scrolling
      try {
        document.body.style.overflow = '';
      } catch (e) {}

      setIsVisible(false);
      if (typeof onFinish === 'function') {
        onFinish();
      }
    }, 700);
  }, [onFinish]);

  // Toggle video audio on user interaction
  const handleToggleSound = useCallback((e) => {
    if (e) e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;

    if (video.muted) {
      video.muted = false;
      video.volume = 1.0;
      setIsMuted(false);
    } else {
      video.muted = true;
      setIsMuted(true);
    }
  }, []);

  // Check sessionStorage on mount and enforce zero-click autoplay
  useEffect(() => {
    // 1. Session Storage Caching check
    try {
      if (sessionStorage.getItem('hasSeenIntro')) {
        if (typeof onFinish === 'function') {
          onFinish();
        }
        setIsVisible(false);
        return;
      }
    } catch (e) {
      console.warn('sessionStorage access error:', e);
    }

    // Lock background scroll during overlay display
    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    // 2. Programmatic Autoplay Enforcement (Zero user interaction required)
    const video = videoRef.current;
    if (video) {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;

      // Attempt immediate play
      video.play().catch((err) => {
        console.log('Autoplay handled:', err);
      });
    }

    return () => {
      try {
        document.body.style.overflow = '';
      } catch (e) {}
    };
  }, [onFinish]);

  // If already seen and unmounted, render nothing
  if (!isVisible) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-[9999] bg-[#070b19] flex items-center justify-center overflow-hidden transition-opacity duration-700 ease-out select-none ${
        isFading ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
      }`}
      aria-label="Tecorbi Kids Arena Intro Overlay"
      role="dialog"
      aria-modal="true"
    >
      {/* Background Ambience Glow */}
      <div className="absolute inset-0 bg-radial-vignette pointer-events-none opacity-40" />

      {/* Intro Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={handleExit}
      >
        <source src="/intro.webm" type="video/webm" />
        <source src={videoSrc} type="video/mp4" />
        Your browser does not support the video tag.
      </video>

      {/* Audio Toggle Pill (Bottom-Left) */}
      <button
        type="button"
        onClick={handleToggleSound}
        className="absolute bottom-6 left-6 z-10 flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold backdrop-blur-md bg-black/40 border border-white/15 text-white/80 hover:text-white hover:bg-black/60 hover:border-cyan-400/50 transition-all duration-300 shadow-lg cursor-pointer group"
        aria-label={isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}
      >
        {isMuted ? (
          <>
            <svg
              className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
            <span className="tracking-wide">تشغيل الصوت 🔊</span>
          </>
        ) : (
          <>
            <svg
              className="w-4 h-4 text-emerald-400 animate-pulse"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
            <span className="tracking-wide text-emerald-300">الصوت مفعل 🎶</span>
          </>
        )}
      </button>

      {/* Sleek Modern Gaming-Styled "Skip" Button (Bottom-Right) */}
      <button
        type="button"
        onClick={handleExit}
        className="absolute bottom-6 right-6 z-10 flex items-center gap-2.5 px-5 py-2.5 rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 hover:border-cyan-400/60 text-white/90 hover:text-white shadow-xl shadow-black/50 hover:shadow-cyan-500/20 active:scale-95 transition-all duration-300 cursor-pointer group"
        aria-label="تخطي الفيديو (Skip Intro)"
      >
        <span className="font-mono text-xs uppercase tracking-wider text-white/80 group-hover:text-cyan-300 transition-colors">
          تخطي · Skip
        </span>
        <svg
          className="w-4 h-4 text-white/70 group-hover:text-cyan-300 group-hover:translate-x-0.5 transition-all duration-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
