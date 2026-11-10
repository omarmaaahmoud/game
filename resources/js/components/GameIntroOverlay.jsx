import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * GameIntroOverlay Component (Premium Mobile-First Edition)
 *
 * Designed specifically for Tecorbi Kids Arena:
 *  - 100% Zero-Click Autoplay (NO play button required, zero user interaction needed)
 *  - Mobile-First Holographic Frame: 16:9 video is centered with zero cropping (both 3D logo & robot 100% visible)
 *  - Seamless Desktop Scaling: expands edge-to-edge on desktop/landscape viewports
 *  - High-Tech HUD Atmosphere: subtle glowing aura, top HUD tag, and bottom neon progress line
 *  - Natural Screen Audio: tap anywhere to unmute seamlessly (no ugly sound button overlay)
 *  - Unobtrusive "Skip" Pill in top-right corner
 *  - Dynamic 100dvh & iOS safe area insets to eliminate mobile address-bar jumping
 *  - 700ms smooth fade-out exit transition & sessionStorage caching
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
  const [progress, setProgress] = useState(0);

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

  // Tap anywhere on the screen seamlessly unmutes the audio
  const handleScreenTap = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => {});
    }

    if (video.muted) {
      video.muted = false;
      video.volume = 1.0;
      setIsMuted(false);
    }
  }, []);

  // Track progress line smoothly
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video && video.duration) {
      const p = (video.currentTime / video.duration) * 100;
      setProgress(Math.min(100, Math.max(0, p)));
    }
  }, []);

  // Programmatic Zero-Click Autoplay Enforcement & Lifecycle
  useEffect(() => {
    // 1. Check if user already saw the intro in this session
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

    // Lock background scroll during overlay
    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    // 2. Programmatic Autoplay Enforcement (Muted + PlaysInline guarantees zero interaction needed)
    const video = videoRef.current;
    if (video) {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;

      video.play().catch((err) => {
        console.log('Autoplay handled:', err);
      });
    }

    // Safety watchdog: automatically transition into game after 11.5s maximum (video is ~10.1s)
    const safetyTimer = setTimeout(() => {
      handleExit();
    }, 11500);

    return () => {
      clearTimeout(safetyTimer);
      try {
        document.body.style.overflow = '';
      } catch (e) {}
    };
  }, [onFinish, handleExit]);

  // If already seen and unmounted, render nothing
  if (!isVisible) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      onClick={handleScreenTap}
      style={{
        paddingTop: 'env(safe-area-inset-top, 16px)',
        paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        paddingLeft: 'env(safe-area-inset-left, 16px)',
        paddingRight: 'env(safe-area-inset-right, 16px)',
      }}
      className={`fixed inset-0 z-[9999] w-full h-[100dvh] min-h-[100dvh] bg-[#070b19] flex flex-col items-center justify-between overflow-hidden transition-opacity duration-700 ease-out select-none cursor-pointer ${
        isFading ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
      }`}
      aria-label="Tecorbi Kids Arena Intro Overlay"
      role="dialog"
      aria-modal="true"
    >
      {/* Background Deep Cosmic Atmosphere */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#11183c] via-[#070b19] to-[#04060e] pointer-events-none opacity-90" />
      <div className="absolute -top-20 -left-20 w-80 h-80 bg-[#3925DE]/25 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute -bottom-20 -right-20 w-80 h-80 bg-[#C3F53C]/15 rounded-full blur-3xl pointer-events-none animate-pulse" />

      {/* TOP HEADER: High-Tech Arena Badge (Mobile Viewports) */}
      <div className="relative z-20 w-full flex items-center justify-between px-6 pt-3 md:hidden">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#C3F53C] animate-ping" />
          <span className="text-[11px] font-black tracking-widest text-cyan-300 uppercase font-mono">
            TECORBI ARENA
          </span>
        </div>
        <div className="text-[10px] text-white/60 font-mono tracking-wider transition-opacity duration-300">
          {isMuted ? '🔇 انقر للشاشة لتشغيل الصوت' : '🔊 الصوت مفعل'}
        </div>
      </div>

      {/* CENTER: The Main 16:9 Video Presentation (No cropping, perfectly centered) */}
      <div className="relative z-20 w-full flex-1 flex items-center justify-center p-3 sm:p-6 md:p-0">
        <div className="relative w-full max-w-5xl aspect-video md:aspect-auto md:w-full md:h-full flex items-center justify-center rounded-2xl md:rounded-none overflow-hidden shadow-[0_0_50px_rgba(57,37,222,0.25)] md:shadow-none border border-white/10 md:border-none">
          <video
            ref={videoRef}
            className="w-full h-full object-contain md:object-cover pointer-events-none"
            autoPlay
            muted
            playsInline
            preload="auto"
            onEnded={handleExit}
            onTimeUpdate={handleTimeUpdate}
          >
            <source src="/intro.webm" type="video/webm" />
            <source src={videoSrc} type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>
      </div>

      {/* BOTTOM FOOTER: High-Tech Progress Line & Info */}
      <div className="relative z-20 w-full max-w-lg px-6 pb-4 sm:pb-6 flex flex-col items-center gap-2">
        {/* Neon Progress Bar */}
        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#3925DE] via-[#818cf8] to-[#C3F53C] transition-all duration-150 ease-linear shadow-[0_0_8px_rgba(195,245,60,0.8)]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="w-full flex items-center justify-between text-[10px] text-white/50 font-mono tracking-wider">
          <span>INTRO CINEMATIC</span>
          <span className="text-[#C3F53C] font-bold">TECORBI 🎮 KIDS ARENA</span>
        </div>
      </div>

      {/* Modern Glassmorphic "Skip" Button (Top-Right, Zero Play Button) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleExit();
        }}
        className="absolute top-4 right-4 sm:top-6 sm:right-6 z-30 flex items-center gap-1.5 sm:gap-2 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs font-semibold backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 hover:border-cyan-400 text-white/90 hover:text-white shadow-xl shadow-black/50 active:scale-95 transition-all duration-300 cursor-pointer group"
        aria-label="تخطي الإنترو (Skip)"
      >
        <span className="font-mono text-[11px] uppercase tracking-wider text-white/80 group-hover:text-cyan-300">
          تخطي · Skip
        </span>
        <span className="text-cyan-300 group-hover:translate-x-0.5 transition-transform text-xs">⏩</span>
      </button>
    </div>
  );
}
