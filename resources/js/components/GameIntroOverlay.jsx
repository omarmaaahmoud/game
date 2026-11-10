import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * GameIntroOverlay Component
 *
 * مكوّن إنترو الألعاب التفاعلي:
 * - تشغيل تلقائي فوري 100% بدون أي نقرة (Zero-Click Autoplay)
 * - متجاوب بالكامل مع كافة الشاشات (object-contain للموبايل لمنع قص اللوجو والروبوت، و md:object-cover للشاشات العريضة)
 * - حل جذري لمشاكل هواتف الآيفون والأندرويد (Safe Area Insets + 100dvh)
 * - شريط أزرار علوي منفصل بـ Flexbox لمنع تداخل الأزرار نهائياً
 * - انتقال ناعم (Fade-out) لمدة 700ms عند الانتهاء أو التخطي
 * - حفظ الجلسة في sessionStorage لمنع التكرار المزعج
 */
export default function GameIntroOverlay({ onFinish, videoSrc = '/intro.mp4' }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hasFinishedRef = useRef(false);

  // 1. التحقق المبدئي من الجلسة لمنع الوميض قبل الرندر
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

  // الخروج السلس والتلاشي التدريجي
  const handleExit = useCallback(() => {
    if (hasFinishedRef.current) return;
    hasFinishedRef.current = true;

    try {
      sessionStorage.setItem('hasSeenIntro', 'true');
    } catch (e) {
      console.warn('sessionStorage access error:', e);
    }

    setIsFading(true);

    setTimeout(() => {
      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch (e) {}
      }

      try {
        document.body.style.overflow = '';
      } catch (e) {}

      setIsVisible(false);

      if (typeof onFinish === 'function') {
        onFinish();
      }
    }, 700);
  }, [onFinish]);

  // التحكم في الصوت
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

  // فرض التشغيل التلقائي برمجياً وقفل التمرير
  useEffect(() => {
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

    try {
      document.body.style.overflow = 'hidden';
    } catch (e) {}

    const video = videoRef.current;
    if (video) {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
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

  if (!isVisible) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-[9999] w-screen h-[100dvh] bg-[#070b19] flex items-center justify-center overflow-hidden transition-opacity duration-700 ease-out select-none ${
        isFading ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
      }`}
      aria-label="Tecorbi Kids Arena Intro Overlay"
      role="dialog"
      aria-modal="true"
    >
      {/* 1. حاوية الفيديو: تحافظ على نسبة العرض وتمنع تشوه أبعاد الروبوت واللوجو */}
      <div className="relative w-full h-full flex items-center justify-center pointer-events-none">
        <video
          ref={videoRef}
          className="w-full h-full max-w-full max-h-full object-contain md:object-cover pointer-events-none"
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
      </div>

      {/* 2. شريط الأزرار العلوي: يحسب حواف الشاشات والنوتش (Safe Area) بدون التأثير على حجم الفيديو */}
      <div
        className="absolute top-0 inset-x-0 z-30 flex items-center justify-between pointer-events-none px-4 sm:px-8"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)',
        }}
      >
        {/* زر تفعيل / كتم الصوت (أعلى اليسار) */}
        <button
          type="button"
          onClick={handleToggleSound}
          className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 min-h-[42px] rounded-full text-[11px] sm:text-xs font-semibold backdrop-blur-md bg-black/60 border border-white/20 text-white/90 hover:text-white hover:border-cyan-400/50 shadow-lg active:scale-95 transition-all cursor-pointer group"
          aria-label={isMuted ? 'تشغيل الصوت' : 'كتم الصوت'}
        >
          {isMuted ? (
            <>
              <svg
                className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400 group-hover:scale-110 transition-transform shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                />
              </svg>
              <span className="tracking-wide">تشغيل الصوت 🔊</span>
            </>
          ) : (
            <>
              <svg
                className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400 animate-pulse shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                />
              </svg>
              <span className="tracking-wide text-emerald-300">الصوت مفعل 🎶</span>
            </>
          )}
        </button>

        {/* زر التخطي الزجاجي (أعلى اليمين) */}
        <button
          type="button"
          onClick={handleExit}
          className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 px-4 py-1.5 sm:px-5 sm:py-2 min-h-[42px] rounded-full backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20 hover:border-cyan-400/60 text-white shadow-xl active:scale-95 transition-all cursor-pointer group"
          aria-label="تخطي الفيديو (Skip Intro)"
        >
          <span className="font-mono text-[11px] sm:text-xs uppercase tracking-wider text-white/90 group-hover:text-cyan-300 transition-colors">
            تخطي · Skip
          </span>
          <svg
            className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400 group-hover:translate-x-0.5 transition-transform shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.2}
              d="M13 5l7 7-7 7M5 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}