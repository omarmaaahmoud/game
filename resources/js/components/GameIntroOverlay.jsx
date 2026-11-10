import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * GameIntroOverlay Component
 *
 * Production-ready zero-click video intro overlay for Tecorbi Kids Arena.
 * Responsive mobile refactor:
 *  - Responsive video scaling: object-contain on mobile/portrait (no cropping of robot/logo), md:object-cover on desktop
 *  - 100dvh dynamic viewport unit to eliminate mobile address-bar jumping
 *  - Mobile safe-area insets (iOS notch & bottom home-bar padding)
 *  - Collision-free control buttons: Skip in TOP-RIGHT, Sound Toggle in TOP-LEFT
 *  - Minimum 44px touch targets for mobile accessibility
 *  - 100% Zero-click autoplay programmatically enforced via videoRef
 *  - 700ms smooth fade-out exit transition
 *  - sessionStorage caching ('hasSeenIntro')
 *  - document.body.style.overflow lock/cleanup
 */
export default function GameIntroOverlay({ onFinish, videoSrc = '/intro.mp4' }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hasFinishedRef = useRef(false);

  // 1. Session Storage Caching initial state check
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

  // Programmatic Zero-Click Autoplay Enforcement & Lifecycle
  useEffect(() => {
    // 1. Session Storage Caching check on mount
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

      // Programmatic play
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
      style={{
        paddingTop: 'env(safe-area-inset-top, 16px)',
        paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        paddingLeft: 'env(safe-area-inset-left, 16px)',
        paddingRight: 'env(safe-area-inset-right, 16px)',
      }}
      className={`fixed inset-0 z-[9999] w-full h-[100dvh] min-h-[100dvh] bg-[#070b19] flex items-center justify-center overflow-hidden transition-opacity duration-700 ease-out select-none ${
        isFading ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
      }`}
      aria-label="Tecorbi Kids Arena Intro Overlay"
      role="dialog"
      aria-modal="true"
    >
      {/* Background Ambience Glow */}
      <div className="absolute inset-0 bg-radial-vignette pointer-events-none opacity-40" />

      {/* Intro Video Element: object-contain on mobile portrait (no cropping of robot/logo), md:object-cover on desktop */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain md:object-cover pointer-events-none"
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

      {/* TOP-LEFT: Sound / Mute Toggle Button (Collision-Free, min 44px touch target) */}
      <button
        type="button"
        onClick={handleToggleSound}
        className="absolute top-4 left-4 sm:top-6 sm:left-6 z-20 flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 min-h-[44px] rounded-full text-[11px] sm:text-xs font-semibold backdrop-blur-md bg-black/45 border border-white/20 text-white/90 hover:text-white hover:bg-black/65 hover:border-cyan-400/60 shadow-lg shadow-black/50 active:scale-95 transition-all duration-300 cursor-pointer group"
        aria-label={isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}
      >
        {isMuted ? (
          <>
            <svg
              className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform shrink-0"
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
              className="w-4 h-4 text-emerald-400 animate-pulse shrink-0"
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

      {/* TOP-RIGHT: Modern Glassmorphic "Skip" Button (Collision-Free, min 44px touch target) */}
      <button
        type="button"
        onClick={handleExit}
        className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20 flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 min-h-[44px] rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 hover:border-cyan-400/60 text-white/90 hover:text-white shadow-xl shadow-black/50 hover:shadow-cyan-500/20 active:scale-95 transition-all duration-300 cursor-pointer group text-[11px] sm:text-xs font-semibold"
        aria-label="تخطي الفيديو (Skip Intro)"
      >
        <span className="font-mono uppercase tracking-wider text-white/80 group-hover:text-cyan-300 transition-colors">
          تخطي · Skip
        </span>
        <svg
          className="w-4 h-4 text-white/70 group-hover:text-cyan-300 group-hover:translate-x-0.5 transition-all duration-300 shrink-0"
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
