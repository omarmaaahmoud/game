import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import '../css/app.css';
import { subscribeToSession } from './echo';
import TecorbiIntro from './components/TecorbiIntro';
import {
  Gamepad2, Trophy, GraduationCap, Users, Play, Pause, SkipForward, Square,
  Clock3, CheckCircle2, Star, Zap, ArrowRight, ArrowLeft, Crown, Copy,
  Sparkles, Target, Plus, X, Check, Volume2, Rocket, ShieldCheck, LogIn,
  UserPlus, CircleHelp, Radio, Medal, Flame, Award, Heart, CheckSquare,
  Smartphone, Lock, Eye, CheckCheck, RotateCcw, Home, ChevronDown, Shield, Share2
} from 'lucide-react';
import confetti from 'canvas-confetti';

/* ── Web Audio API Sound Synthesizer (Instant gamified sound effects) ── */
const sfx = {
  ctx: null,
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },
  play(type) {
    try {
      this.init();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      if (type === 'correct') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, t);
        osc.frequency.setValueAtTime(659.25, t + 0.1);
        osc.frequency.setValueAtTime(783.99, t + 0.2);
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc.start(t);
        osc.stop(t + 0.6);
      } else if (type === 'wrong') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(280, t);
        osc.frequency.linearRampToValueAtTime(140, t + 0.35);
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t);
        osc.stop(t + 0.4);
      } else if (type === 'click') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(450, t);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        osc.start(t);
        osc.stop(t + 0.08);
      } else if (type === 'join') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.setValueAtTime(880, t + 0.1);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.start(t);
        osc.stop(t + 0.35);
      } else if (type === 'win') {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.type = 'triangle';
          o.frequency.value = freq;
          o.connect(g);
          g.connect(this.ctx.destination);
          g.gain.setValueAtTime(0.15, t + i * 0.12);
          g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
          o.start(t + i * 0.12);
          o.stop(t + 1.2);
        });
      }
    } catch (e) {}
  }
};

/* ── Mobile Network URL Helper ── */
let currentWifiIp = '192.168.1.2';

const getMobileUrl = () => {
  const host = window.location.hostname;
  // If accessing from phone or external IP, use that host directly
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    const port = window.location.port ? `:${window.location.port}` : ':8000';
    return `http://${host}${port}`;
  }
  const port = window.location.port ? `:${window.location.port}` : ':8000';
  return `http://${currentWifiIp}${port}`;
};

/* ── Monotonic Clock Synchronization (NTP Filter) ── */
const MAX_CLOCK_SAMPLES = 8;
const SAMPLE_EXPIRY_MS = 60000; // 60 seconds
let clockSamples = [];
let currentServerBaseEpoch = null;

function getMonotonicNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function updateClockSync(serverNowMs, p0, p1) {
  if (!serverNowMs) return;
  const rtt = Math.max(0, p1 - p0);
  const midpointP = p0 + (rtt / 2);
  const baseEpoch = serverNowMs - midpointP;
  const nowMono = getMonotonicNow();

  // Filter out expired samples older than 60s
  clockSamples = clockSamples.filter(s => (nowMono - s.addedAt) < SAMPLE_EXPIRY_MS);

  // Add new sample
  clockSamples.push({
    baseEpoch,
    rtt,
    addedAt: nowMono,
  });

  // Keep at most MAX_CLOCK_SAMPLES
  if (clockSamples.length > MAX_CLOCK_SAMPLES) {
    clockSamples.shift();
  }

  // Selection strategy:
  // 1. Prefer high-confidence samples with RTT <= 2000ms.
  // 2. If all samples have RTT > 2000ms (slow network), use available samples.
  const validSamples = clockSamples.filter(s => s.rtt <= 2000);
  const candidates = validSamples.length > 0 ? validSamples : clockSamples;

  // Pick sample with lowest RTT among candidates
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].rtt < best.rtt) {
      best = candidates[i];
    }
  }

  if (best) {
    currentServerBaseEpoch = best.baseEpoch;
  }
}

function serverNow() {
  if (currentServerBaseEpoch !== null) {
    return Math.round(currentServerBaseEpoch + getMonotonicNow());
  }
  return Date.now();
}

/* ── Token Storage Helpers (PIN-keyed) ── */
function saveTeacherToken(pin, token) {
  if (!pin || !token) return;
  try {
    sessionStorage.setItem(`tecorbi_teacher_token_${pin}`, token);
    localStorage.setItem(`tecorbi_teacher_token_${pin}`, token);
  } catch {}
}

function getTeacherToken(pin) {
  if (!pin) return null;
  try {
    return sessionStorage.getItem(`tecorbi_teacher_token_${pin}`) ||
           localStorage.getItem(`tecorbi_teacher_token_${pin}`);
  } catch {
    return null;
  }
}

function clearTeacherToken(pin) {
  if (!pin) return;
  try {
    sessionStorage.removeItem(`tecorbi_teacher_token_${pin}`);
    localStorage.removeItem(`tecorbi_teacher_token_${pin}`);
  } catch {}
}

function savePlayerAuth(pin, player, token) {
  if (!pin || !player || !token) return;
  try {
    const data = JSON.stringify({ id: player.id, token, name: player.name });
    sessionStorage.setItem(`tecorbi_player_${pin}`, data);
    localStorage.setItem(`tecorbi_player_${pin}`, data);
  } catch {}
}

function getPlayerAuth(pin) {
  if (!pin) return null;
  try {
    const raw = sessionStorage.getItem(`tecorbi_player_${pin}`) ||
                localStorage.getItem(`tecorbi_player_${pin}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearPlayerAuth(pin) {
  if (!pin) return;
  try {
    sessionStorage.removeItem(`tecorbi_player_${pin}`);
    localStorage.removeItem(`tecorbi_player_${pin}`);
  } catch {}
}

/* ── API helpers ── */
const API = '/api';
const post = (url, body, customHeaders = {}) => {
  const p0 = getMonotonicNow();
  return fetch(API + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...customHeaders },
    body: JSON.stringify(body),
  }).then(async r => {
    if (!r.ok) {
      const err = new Error(r.status);
      err.status = r.status;
      try { err.data = await r.json(); } catch {}
      throw err;
    }
    return r.json();
  }).then(data => {
    const p1 = getMonotonicNow();
    if (data && data.server_now_ms) {
      updateClockSync(data.server_now_ms, p0, p1);
    }
    return data;
  });
};

const get = (url, customHeaders = {}) => {
  const p0 = getMonotonicNow();
  return fetch(API + url, {
    headers: { Accept: 'application/json', ...customHeaders }
  }).then(async r => {
    if (!r.ok) {
      const err = new Error(r.status);
      err.status = r.status;
      try { err.data = await r.json(); } catch {}
      throw err;
    }
    return r.json();
  }).then(data => {
    const p1 = getMonotonicNow();
    if (data && data.server_now_ms) {
      updateClockSync(data.server_now_ms, p0, p1);
    }
    return data;
  });
};

const teacherPost = (pin, url, body = {}) => {
  const token = getTeacherToken(pin) || (pin === '123456' ? 'tecorbi-demo-teacher-token-123456' : null);
  const headers = token ? { 'X-Teacher-Token': token } : {};
  return post(url, body, headers);
};

const playerPost = (pin, url, body = {}, explicitToken = null) => {
  const auth = getPlayerAuth(pin);
  const token = explicitToken || auth?.token;
  const headers = token ? { 'X-Player-Token': token } : {};
  return post(url, { ...body, ...(token ? { player_token: token } : {}) }, headers);
};

const playerGet = (pin, url, explicitToken = null) => {
  const auth = getPlayerAuth(pin);
  const token = explicitToken || auth?.token;
  const headers = token ? { 'X-Player-Token': token } : {};
  return get(url, headers);
};

const AVATARS = [
  { id: 'spongebob', name: 'سبونج بوب', role: 'بطل قاع الهامور 🌟', emoji: '🧽', image: '/images/avatars/spongebob.webp', color: '#eab308' },
  { id: 'patrick', name: 'بسيط', role: 'نجم البحر ⭐', emoji: '⭐', image: '/images/avatars/patrick.webp', color: '#f87171' },
  { id: 'squidward', name: 'شفيق', role: 'عازف الكلارينيت 🎵', emoji: '🐙', image: '/images/avatars/squidward.webp', color: '#2dd4bf' },
  { id: 'tom', name: 'توم', role: 'القط المشاغب 😼', emoji: '🐱', image: '/images/avatars/tom.webp', color: '#64748b' },
  { id: 'jerry', name: 'جيري', role: 'الفأر الذكي 🧀', emoji: '🐭', image: '/images/avatars/jerry.webp', color: '#d97706' },
  { id: 'smurf', name: 'سنفور', role: 'قرية السنافر 💙', emoji: '🔵', image: '/images/avatars/smurf.webp', color: '#38bdf8' },
  { id: 'papa-smurf', name: 'بابا سنفور', role: 'حكيم السنافر 🍄', emoji: '🎅', image: '/images/avatars/papa-smurf.webp', color: '#ef4444' },
  { id: 'batman', name: 'باتمان', role: 'فارس الظلام 🦇', emoji: '🦇', image: '/images/avatars/batman.webp', color: '#1e293b' },
  { id: 'gumball', name: 'غامبول', role: 'المغامر المدهش 😸', emoji: '😸', image: '/images/avatars/gumball.webp', color: '#06b6d4' },
  { id: 'leonardo', name: 'ليوناردو', role: 'سلاحف النينجا 🐢', emoji: '🐢', image: '/images/avatars/leonardo.webp', color: '#10b981' },
  { id: 'boy-skateboard', name: 'المتزلج', role: 'بطل السكيت بورد 🛹', emoji: '🛹', image: '/images/avatars/boy-skateboard.webp', color: '#f59e0b' },
  { id: 'astronaut', emoji: '🧑🏻‍🚀', name: 'رائد فضاء', role: 'Space Cadet', color: '#38bdf8' },
  { id: 'ninja', emoji: '🥷', name: 'النينجا السريع', role: 'Shadow Ninja', color: '#1e293b' },
  { id: 'robot', emoji: '🤖', name: 'الروبوت الذكي', role: 'Cyber Bot', color: '#a855f7' },
  { id: 'wizard', emoji: '🧙‍♂️', name: 'الساحر العبقري', role: 'Pixel Wizard', color: '#6366f1' },
  { id: 'superhero', emoji: '🦸‍♂️', name: 'البطل الخارق', role: 'Super Hero', color: '#ef4444' },
  { id: 'artist', emoji: '👩🏻‍🎨', name: 'الفنانة المبدعة', role: 'Color Master', color: '#ec4899' },
  { id: 'unicorn', emoji: '🦄', name: 'اليونيكورن', role: 'Star Unicorn', color: '#f472b6' },
  { id: 'dragon', emoji: '🐉', name: 'التنين القوي', role: 'Fire Dragon', color: '#10b981' },
  { id: 'cat', emoji: '🐱', name: 'القطة الأليفة', role: 'Clever Cat', color: '#f59e0b' },
  { id: 'pirate', emoji: '🏴‍☠️', name: 'كابتن القراصنة', role: 'Sea Captain', color: '#0ea5e9' },
  { id: 'alien', emoji: '👽', name: 'الفضائي الغامض', role: 'Galaxy Scout', color: '#84cc16' },
  { id: 'fairy', emoji: '🧚‍♀️', name: 'الجنية السحرية', role: 'Magic Fairy', color: '#d946ef' },
];

const getAvatar = (id) => AVATARS.find(a => a.id === id) || AVATARS[0];

function AvatarDisplay({ avatarId, className = '', style = {}, imgStyle = {} }) {
  const a = getAvatar(avatarId);

  if (a.image) {
    return (
      <span style={{ position: 'relative', display: 'inline-block', width: '1.35em', height: '1.35em' }}>
        <img
          src={a.image}
          alt={a.name}
          className={`avatar-img-inline ${className}`}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            verticalAlign: 'middle',
            display: 'inline-block',
            ...imgStyle,
          }}
        />
      </span>
    );
  }
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span className={className} style={style}>{a.emoji}</span>
    </span>
  );
}

const SHAPES = [
  { symbol: '▲', color: 'red', name: 'A' },
  { symbol: '◆', color: 'blue', name: 'B' },
  { symbol: '●', color: 'orange', name: 'C' },
  { symbol: '■', color: 'green', name: 'D' },
];

/* ══════════════════════ 3D SPACE & TECORBI BRAND ILLUSTRATIONS ══════════════════════ */

function SpacePlanet3D({ className = '', style = {} }) {
  return (
    <div className={`space-planet-3d ${className}`} style={style} aria-hidden="true">
      <svg viewBox="0 0 160 160" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="planetGlowGrad" cx="30%" cy="28%" r="72%">
            <stop offset="0%" stopColor="#d8b4fe" />
            <stop offset="28%" stopColor="#9333ea" />
            <stop offset="65%" stopColor="#581c87" />
            <stop offset="100%" stopColor="#1e0a3d" />
          </radialGradient>
          <filter id="planetHalo" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="8" />
            <feOffset dx="-2" dy="-2" result="offsetblur" />
            <feFlood floodColor="#a855f7" floodOpacity="0.75" />
            <feComposite in2="offsetblur" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="craterDeep" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#2e1065" />
            <stop offset="85%" stopColor="#1e0a3d" />
            <stop offset="100%" stopColor="#7e22ce" />
          </radialGradient>
        </defs>
        
        {/* Ambient atmospheric purple glow */}
        <circle cx="80" cy="80" r="74" fill="rgba(168, 85, 247, 0.25)" filter="url(#planetHalo)" />

        {/* Planet Sphere */}
        <circle cx="80" cy="80" r="70" fill="url(#planetGlowGrad)" />
        
        {/* Specular curved reflection */}
        <ellipse cx="62" cy="52" rx="36" ry="22" fill="#ffffff" fillOpacity="0.14" transform="rotate(-25 62 52)" />
        
        {/* Large Crater */}
        <g transform="translate(44, 58)">
          <ellipse cx="18" cy="20" rx="16" ry="18" fill="url(#craterDeep)" />
          <ellipse cx="18" cy="20" rx="16" ry="18" stroke="rgba(216, 180, 254, 0.45)" strokeWidth="2.5" fill="none" />
          <ellipse cx="15" cy="18" rx="10" ry="11" fill="#150529" opacity="0.8" />
          <ellipse cx="20" cy="22" rx="6" ry="7" fill="#7e22ce" opacity="0.4" />
        </g>
        
        {/* Top-Right Crater */}
        <g transform="translate(86, 28)">
          <ellipse cx="12" cy="14" rx="11" ry="13" fill="url(#craterDeep)" />
          <ellipse cx="12" cy="14" rx="11" ry="13" stroke="rgba(192, 132, 252, 0.5)" strokeWidth="2" fill="none" />
          <ellipse cx="10" cy="12" rx="6" ry="8" fill="#150529" opacity="0.75" />
        </g>
        
        {/* Bottom Crater */}
        <g transform="translate(78, 104)">
          <ellipse cx="14" cy="12" rx="14" ry="10" fill="url(#craterDeep)" />
          <ellipse cx="14" cy="12" rx="14" ry="10" stroke="rgba(168, 85, 247, 0.4)" strokeWidth="1.8" fill="none" />
          <ellipse cx="12" cy="11" rx="8" ry="6" fill="#150529" opacity="0.7" />
        </g>

        {/* Craters near rim */}
        <circle cx="42" cy="112" r="5" fill="#2e1065" stroke="rgba(192, 132, 252, 0.3)" strokeWidth="1" />
        <circle cx="124" cy="74" r="6" fill="#1e0a3d" stroke="rgba(168, 85, 247, 0.35)" strokeWidth="1" />
        <circle cx="112" cy="98" r="4" fill="#2e1065" />
      </svg>
    </div>
  );
}

function SpaceRocket3D({ className = '', style = {} }) {
  return (
    <div className={`space-rocket-3d ${className}`} style={style} aria-hidden="true">
      <svg viewBox="0 0 170 190" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="rocketBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="45%" stopColor="#f1f5f9" />
            <stop offset="80%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#94a3b8" />
          </linearGradient>
          <linearGradient id="rocketRedGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="50%" stopColor="#f43f5e" />
            <stop offset="100%" stopColor="#be123c" />
          </linearGradient>
          <linearGradient id="rocketGlassGrad" x1="15%" y1="15%" x2="90%" y2="90%">
            <stop offset="0%" stopColor="#a5f3fc" />
            <stop offset="45%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0369a1" />
          </linearGradient>
          <linearGradient id="thrusterFireGrad" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="25%" stopColor="#fef08a" />
            <stop offset="55%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
          </linearGradient>
          <filter id="rocketFireGlow" x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="6" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g transform="rotate(24 85 95)">
          {/* Cosmic smoke cloud puffs */}
          <ellipse cx="62" cy="148" rx="18" ry="12" fill="#c084fc" fillOpacity="0.35" filter="blur(6px)" />
          <ellipse cx="106" cy="150" rx="19" ry="13" fill="#e879f9" fillOpacity="0.3" filter="blur(6px)" />
          <ellipse cx="84" cy="158" rx="22" ry="14" fill="#ddd6fe" fillOpacity="0.25" filter="blur(7px)" />

          {/* Engine Exhaust Flame (Animated) */}
          <g className="engine-flame-pulsing">
            <path d="M72 126 C72 158, 84 182, 84 182 C84 182, 96 158, 96 126 Z" fill="url(#thrusterFireGrad)" filter="url(#rocketFireGlow)" />
            <path d="M77 126 C77 148, 84 165, 84 165 C84 165, 91 148, 91 126 Z" fill="#ffffff" />
          </g>

          {/* Left Wing / Fin */}
          <path d="M60 92 C46 106, 42 126, 44 130 C52 130, 68 120, 70 114 Z" fill="url(#rocketRedGrad)" />
          {/* Right Wing / Fin */}
          <path d="M108 92 C122 106, 126 126, 124 130 C116 130, 100 120, 98 114 Z" fill="url(#rocketRedGrad)" />

          {/* Engine Base / Nozzle */}
          <path d="M72 120 L96 120 L92 128 L76 128 Z" fill="#334155" />

          {/* Main Fuselage */}
          <path d="M84 18 C67 44, 61 78, 65 120 C73 122, 95 122, 103 120 C107 78, 101 44, 84 18 Z" fill="url(#rocketBodyGrad)" />

          {/* Red Nose Cone */}
          <path d="M84 18 C77 32, 72 46, 70 56 C78 58, 90 58, 98 56 C96 46, 91 32, 84 18 Z" fill="url(#rocketRedGrad)" />

          {/* Cockpit Window Rim */}
          <circle cx="84" cy="74" r="16" fill="#1e293b" />
          <circle cx="84" cy="74" r="13" fill="#e2e8f0" />
          {/* Cockpit Glass Visor */}
          <circle cx="84" cy="74" r="11" fill="url(#rocketGlassGrad)" />
          {/* Specular Visor Highlight */}
          <ellipse cx="81" cy="70" rx="4" ry="2.5" fill="#ffffff" fillOpacity="0.85" transform="rotate(-30 81 70)" />

          {/* Center Spine Fin */}
          <path d="M83 88 L85 88 L86 121 L82 121 Z" fill="url(#rocketRedGrad)" opacity="0.9" />
        </g>
      </svg>
    </div>
  );
}

/* Official Tecorbi Robot Mascot (From Workbook: Friendly, White/Indigo, Smiling Green Visor Eyes, Waving) */
function TecorbiRobot3D({ className = '', style = {} }) {
  return (
    <div className={`tecorbi-robot-container ${className}`} style={{ width: '100%', height: '100%', ...style }} aria-hidden="true">
      <svg viewBox="0 0 160 170" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="robotWhiteGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="60%" stopColor="#F1F4FD" />
            <stop offset="100%" stopColor="#DCE4FA" />
          </linearGradient>
          <linearGradient id="robotIndigoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4F3DF5" />
            <stop offset="100%" stopColor="#2E1CB8" />
          </linearGradient>
          <linearGradient id="robotLimeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D6FB68" />
            <stop offset="100%" stopColor="#A8D635" />
          </linearGradient>
          <filter id="robotGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#3925DE" floodOpacity="0.25" />
          </filter>
        </defs>

        <g filter="url(#robotGlow)">
          {/* Head Antennas */}
          <line x1="80" y1="28" x2="80" y2="14" stroke="#3925DE" strokeWidth="4" strokeLinecap="round" />
          <circle cx="80" cy="12" r="5" fill="url(#robotLimeGrad)" />
          <circle cx="48" cy="22" r="4" fill="#3925DE" />
          <line x1="56" y1="32" x2="48" y2="22" stroke="#3925DE" strokeWidth="3" strokeLinecap="round" />
          <circle cx="112" cy="22" r="4" fill="#3925DE" />
          <line x1="104" y1="32" x2="112" y2="22" stroke="#3925DE" strokeWidth="3" strokeLinecap="round" />

          {/* Robot Head Chassis */}
          <rect x="42" y="26" width="76" height="56" rx="24" fill="url(#robotWhiteGrad)" stroke="#3925DE" strokeWidth="3" />

          {/* Digital Black Screen Visor */}
          <rect x="49" y="33" width="62" height="38" rx="14" fill="#08102B" />

          {/* Smiling Green Visor Eyes (^ ^) */}
          <path d="M57 56 C57 48, 67 48, 67 56" stroke="#C3F53C" strokeWidth="3.5" strokeLinecap="round" fill="none" />
          <path d="M79 56 C79 48, 89 48, 89 56" stroke="#C3F53C" strokeWidth="3.5" strokeLinecap="round" fill="none" />
          {/* Cute Digital Mouth */}
          <path d="M70 63 Q73 66 76 63" stroke="#C3F53C" strokeWidth="2.5" strokeLinecap="round" fill="none" />

          {/* Left Arm (Resting) */}
          <g>
            <circle cx="34" cy="94" r="7" fill="#3925DE" />
            <path d="M34 94 Q24 108 26 124" stroke="url(#robotWhiteGrad)" strokeWidth="9" strokeLinecap="round" />
            <circle cx="26" cy="124" r="6" fill="#3925DE" />
          </g>

          {/* Body Torso */}
          <rect x="52" y="86" width="56" height="54" rx="18" fill="url(#robotWhiteGrad)" stroke="#3925DE" strokeWidth="3" />

          {/* Chest Plate with Tecorbi Emblem */}
          <rect x="60" y="94" width="40" height="28" rx="8" fill="#F1F4FD" stroke="rgba(57, 37, 222, 0.3)" strokeWidth="1.5" />
          {/* Curved Tecorbi Emblem Shape */}
          <path d="M70 102 C66 106, 66 114, 73 115 C80 115, 84 109, 88 104" stroke="#3925DE" strokeWidth="3.5" strokeLinecap="round" fill="none" />
          <circle cx="85" cy="103" r="3" fill="#C3F53C" />

          {/* Legs */}
          <rect x="58" y="138" width="16" height="20" rx="7" fill="url(#robotWhiteGrad)" stroke="#3925DE" strokeWidth="2.5" />
          <rect x="86" y="138" width="16" height="20" rx="7" fill="url(#robotWhiteGrad)" stroke="#3925DE" strokeWidth="2.5" />
          <ellipse cx="66" cy="158" rx="12" ry="6" fill="#08102B" />
          <ellipse cx="94" cy="158" rx="12" ry="6" fill="#08102B" />

          {/* Right Arm (Waving Cheerfully) */}
          <g className="robot-waving-arm">
            <circle cx="126" cy="94" r="7" fill="#3925DE" />
            <path d="M126 94 Q142 82 144 64" stroke="url(#robotWhiteGrad)" strokeWidth="9" strokeLinecap="round" />
            <circle cx="144" cy="64" r="7" fill="#3925DE" />
            {/* Waving Fingers */}
            <path d="M140 58 Q144 52 148 58" stroke="#C3F53C" strokeWidth="3" strokeLinecap="round" fill="none" />
          </g>
        </g>
      </svg>
    </div>
  );
}

/* ── Living Cyber Arena Background (Animated Laser Energy Highways & Floating Particles) ── */
function CosmicDecorations() {
  return (
    <div className="living-cyber-arena-bg" aria-hidden="true">
      {/* Soft Ambient Breathing Aura Light Pools */}
      <div className="cyber-aurora cyber-aurora-top-tr" />
      <div className="cyber-aurora cyber-aurora-bottom-bl" />
      <div className="cyber-aurora cyber-aurora-center" />

      {/* Full-canvas Moving Laser Highway Tracks */}
      <svg className="cyber-circuit-svg" viewBox="0 0 1440 900" preserveAspectRatio="none" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="laserGradIndigo" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3925DE" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="laserGradLime" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#C3F53C" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#a3e635" stopOpacity="0.7" />
          </linearGradient>
          <filter id="laserGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* ── Top-Right Dynamic Circuit Tracks ── */}
        <path d="M1440 90 L1240 90 L1150 180 L960 180" stroke="#3925DE" strokeWidth="2.5" strokeDasharray="6 6" opacity="0.25" />
        <path d="M1440 90 L1240 90 L1150 180 L960 180" stroke="url(#laserGradIndigo)" strokeWidth="3.5" strokeLinecap="round" className="laser-pulse-run-1" filter="url(#laserGlow)" />

        <path d="M1440 140 L1290 140 L1210 220 L1040 220" stroke="#C3F53C" strokeWidth="2" opacity="0.25" />
        <path d="M1440 140 L1290 140 L1210 220 L1040 220" stroke="url(#laserGradLime)" strokeWidth="3.5" strokeLinecap="round" className="laser-pulse-run-2" filter="url(#laserGlow)" />

        {/* ── Bottom-Left Dynamic Circuit Tracks (Moving & Flowing with Energy) ── */}
        <path d="M0 720 L260 720 L360 620 L480 620" stroke="#3925DE" strokeWidth="2.5" strokeDasharray="8 8" opacity="0.25" />
        <path d="M0 720 L260 720 L360 620 L480 620" stroke="url(#laserGradIndigo)" strokeWidth="3.5" strokeLinecap="round" className="laser-pulse-run-3" filter="url(#laserGlow)" />

        <path d="M0 800 L200 800 L300 700 L420 700" stroke="#C3F53C" strokeWidth="2" opacity="0.28" />
        <path d="M0 800 L200 800 L300 700 L420 700" stroke="url(#laserGradLime)" strokeWidth="3.5" strokeLinecap="round" className="laser-pulse-run-4" filter="url(#laserGlow)" />

        <path d="M0 870 L140 870 L220 790 L340 790" stroke="#3925DE" strokeWidth="1.8" opacity="0.2" />

        {/* ── Dynamic Radar Nodes ── */}
        <g>
          {/* Top-Right Nodes */}
          <circle cx="1240" cy="90" r="5" fill="#3925DE" />
          <circle cx="1240" cy="90" r="10" stroke="#3925DE" strokeWidth="1.5" className="radar-ring" />
          <circle cx="1150" cy="180" r="4.5" fill="#C3F53C" />
          <circle cx="1210" cy="220" r="5" fill="#C3F53C" />
          <circle cx="1210" cy="220" r="11" stroke="#C3F53C" strokeWidth="1.5" className="radar-ring-delay" />

          {/* Bottom-Left Nodes */}
          <circle cx="260" cy="720" r="5" fill="#3925DE" />
          <circle cx="260" cy="720" r="11" stroke="#3925DE" strokeWidth="1.5" className="radar-ring" />
          <circle cx="360" cy="620" r="5.5" fill="#C3F53C" />
          <circle cx="360" cy="620" r="12" stroke="#C3F53C" strokeWidth="1.5" className="radar-ring-delay" />
          <circle cx="300" cy="700" r="4.5" fill="#C3F53C" />
          <circle cx="200" cy="800" r="4" fill="#3925DE" />
        </g>
      </svg>

      {/* Floating Holographic Particles & Tech Sparkles */}
      <div className="floating-cyber-particles">
        <span className="cyber-sparkle cs-1">✦</span>
        <span className="cyber-sparkle cs-2">★</span>
        <span className="cyber-sparkle cs-3">✦</span>
        <span className="cyber-sparkle cs-4">◆</span>
        <span className="cyber-sparkle cs-5">✦</span>
        <span className="cyber-orb co-1" />
        <span className="cyber-orb co-2" />
        <span className="cyber-orb co-3" />
        <span className="cyber-orb co-4" />
      </div>
    </div>
  );
}

/* ══════════════════════ MAIN APP ══════════════════════ */
function App() {
  const [mode, setMode] = useState('home'); // home | student-join | student-lobby | student-play | leaderboard | teacher-auth | teacher-dashboard | teacher-create | teacher-lobby | teacher-live
  const [session, setSession] = useState(null);
  const [player, setPlayer] = useState(null);
  const [notice, setNotice] = useState('');
  const [isTeacherUnlocked, setIsTeacherUnlocked] = useState(false);
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3200);
    return () => clearTimeout(t);
  }, [notice]);

  // Restore teacher token from storage if session exists
  useEffect(() => {
    if (session?.pin && !session.teacher_token) {
      const storedToken = getTeacherToken(session.pin);
      if (storedToken) {
        setSession(s => (s ? { ...s, teacher_token: storedToken } : s));
      }
    }
  }, [session?.pin]);

  // Restore player token from storage if session and player exist
  useEffect(() => {
    if (session?.pin && player?.id && !player.token) {
      const auth = getPlayerAuth(session.pin);
      if (auth && auth.id === player.id && auth.token) {
        setPlayer(p => (p ? { ...p, token: auth.token } : p));
      }
    }
  }, [session?.pin, player?.id]);

  const copyMobileLink = async () => {
    sfx.play('click');
    const link = getMobileUrl();
    try {
      await navigator.clipboard.writeText(link);
      setNotice(`📱 تم نسخ رابط الموبايل: ${link}`);
    } catch {
      setNotice(`📱 رابط الموبايل: ${link}`);
    }
  };

  const openTeacherPortal = () => {
    sfx.play('click');
    if (isTeacherUnlocked) {
      setMode('teacher-dashboard');
    } else {
      setMode('teacher-auth');
    }
  };

  return (
    <div className="game-universe">
      {/* ── Tecorbi Kids Arena Intro Overlay (tecorbi-intro.html) ── */}
      {showIntro && (
        <TecorbiIntro
          onComplete={() => setShowIntro(false)}
        />
      )}

      {/* ── Official Tecorbi Kids Arena Header ── */}
      <header className="game-navbar">
        <button className="navbar-brand" onClick={() => { sfx.play('click'); setMode('home'); }}>
          <div className="brand-logo-disc">
            <img src="/images/tecorbi-icon.png" alt="Tecorbi Icon" style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
          </div>
          <div className="brand-text">
            <span className="brand-title">Tecorbi</span>
            <span className="brand-sub">Kids Arena 🚀</span>
          </div>
        </button>

        <div className="navbar-center-tag">
          <span className="pulse-dot-green" />
          <span>المسابقات المدرسية المباشرة · Live Quiz</span>
        </div>

        <div className="navbar-actions">
          {/* Dedicated Intro Replay Button */}
          {mode === 'home' && (
            <button
              className="btn-replay-intro-nav"
              onClick={() => { sfx.play('click'); setShowIntro(true); }}
              title="مشاهدة إنترو Tecorbi Kids Arena"
            >
              <Sparkles size={16} />
              <span>الإنترو 🎮</span>
            </button>
          )}

          {player && (
            <div className="player-hud-pill">
              <span className="hud-emoji"><AvatarDisplay avatarId={player.avatar} /></span>
              <span className="hud-name">{player.name}</span>
              <span className="hud-score"><Zap size={14} fill="currentColor" /> {player.score || 0} XP</span>
            </div>
          )}

          {session && (
            <div className="session-pin-chip" title="كود المسابقة الحالية">
              <small>PIN</small>
              <strong>{session.pin}</strong>
            </div>
          )}

          {/* Dedicated Teacher Portal Button (Only visible on Home or Teacher screens, hidden during student gameplay) */}
          {(mode === 'home' || mode.startsWith('teacher')) && (
            <button className="btn-teacher-portal-nav" onClick={openTeacherPortal} title="دخول استوديو المعلم">
              <GraduationCap size={18} />
              <span>بوابة المعلّم 👨‍🏫</span>
            </button>
          )}
        </div>
      </header>

      <div className="game-canvas">
        {mode === 'home' && <StudentHomeEnterPin setMode={setMode} setSession={setSession} setNotice={setNotice} copyMobileLink={copyMobileLink} />}
        {mode === 'student-join' && <StudentJoin setMode={setMode} setSession={setSession} setPlayer={setPlayer} setNotice={setNotice} initialPin={session?.pin || ''} />}
        {mode === 'student-lobby' && <StudentLobby session={session} setMode={setMode} player={player} />}
        {mode === 'student-play' && <StudentPlay session={session} player={player} setMode={setMode} setNotice={setNotice} setPlayer={setPlayer} />}
        {mode === 'leaderboard' && <Leaderboard session={session} setMode={setMode} player={player} />}

        {/* Teacher Dedicated Screens */}
        {mode === 'teacher-auth' && <TeacherAuthModal setMode={setMode} setIsTeacherUnlocked={setIsTeacherUnlocked} setNotice={setNotice} />}
        {mode === 'teacher-dashboard' && <TeacherDashboard setMode={setMode} setSession={setSession} setNotice={setNotice} copyMobileLink={copyMobileLink} />}
        {mode === 'teacher-create' && <TeacherCreate setMode={setMode} setSession={setSession} setNotice={setNotice} />}
        {mode === 'teacher-lobby' && <TeacherLobby session={session} setSession={setSession} setMode={setMode} setNotice={setNotice} copyMobileLink={copyMobileLink} />}
        {mode === 'teacher-live' && <TeacherLive session={session} setSession={setSession} setMode={setMode} setNotice={setNotice} />}
      </div>

      {mode === 'home' && (
        <footer className="game-footer">
          <div className="footer-content">
            <span>✨ Tecorbi Kids Arena · صُمم لتعليم ممتع وتفاعلي للأبطال</span>
          </div>
        </footer>
      )}

      {notice && (
        <div className="game-toast-alert" role="status">
          <Sparkles size={20} className="toast-sparkle" />
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════ STUDENT HOME: DIRECT PIN ENTRY ══════════════════════ */
function StudentHomeEnterPin({ setMode, setSession, setNotice, copyMobileLink }) {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  async function checkAndProceed(targetPin) {
    if (!targetPin || targetPin.length !== 6) {
      setNotice('يرجى كتابة كود مكوّن من 6 أرقام');
      return;
    }
    setLoading(true);
    sfx.play('click');
    try {
      let data = await get(`/sessions/${targetPin}`);
      if (data.status === 'completed') {
        if (targetPin === '123456') {
          // Auto-reset demo session so it is always ready to replay!
          await teacherPost(targetPin, `/sessions/${targetPin}/reset`);
          data = await get(`/sessions/${targetPin}`);
        } else {
          setNotice('⚠️ هذه المسابقة انتهت بالفعل');
          setLoading(false);
          return;
        }
      }
      setSession(data);
      setMode('student-join');
      sfx.play('join');
    } catch {
      setNotice('❌ لم يتم العثور على مسابقة بهذا الكود. تأكد من المعلم وحاول مجدداً');
    }
    setLoading(false);
  }

  return (
    <main className="space-lobby-view student-home-space-view">
      <CosmicDecorations />

      {/* ── Hero Stage: Bold Typography & Live Status ── */}
      <div className="tecorbi-hero-stage">
        {/* Live Pill Badge */}
        <div className="tecorbi-live-badge-row">
          <div className="tecorbi-live-badge">
            <span className="badge-pulse-dot" />
            <Zap size={14} />
            <span>ساحة التحديات التعليمية الذكية للأبطال</span>
          </div>
        </div>

        {/* Brand Headline (Forced LTR so English reads Tecorbi Kids Arena on one line) */}
        <h1 className="tecorbi-main-title" dir="ltr" style={{ direction: 'ltr' }}>
          <span className="title-indigo">Tecorbi</span>
          <span className="title-navy">Kids Arena</span>
          <span className="title-emoji">🎮</span>
        </h1>

        <p className="tecorbi-main-subtitle">
          اكتب كود المسابقة المكوّن من 6 أرقام المعروض على شاشة المعلم وابدأ التحدي ⚡
        </p>
      </div>

      {/* ── Holographic Game PIN Console ── */}
      <div className="tecorbi-pin-console">
        {/* Console Header */}
        <div className="tpc-header">
          <div className="tpc-gamepad-disc">
            <Gamepad2 size={24} />
          </div>
          <span className="tpc-title">(GAME PIN) كود انضمام الطلاب للمسابقة</span>
        </div>

        {/* PIN Input */}
        <div className="tpc-input-wrap">
          <input
            className="tpc-pin-input"
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            maxLength={6}
            inputMode="numeric"
            autoFocus
          />
          {pin.length > 0 && (
            <button
              type="button"
              className="tpc-clear-btn"
              onClick={() => { sfx.play('click'); setPin(''); }}
              title="مسح الكود"
            >
              ✕
            </button>
          )}
        </div>

        {/* Arcade Launch Button */}
        <button
          className={`btn-arcade-launch ${pin.length === 6 ? 'ready' : ''}`}
          onClick={() => {
            if (pin.length === 6) {
              sfx.play('click');
              checkAndProceed(pin);
            } else {
              sfx.play('wrong');
              setNotice('⚠️ يرجى إدخال كود المسابقة المكوّن من 6 أرقام أولاً');
            }
          }}
          disabled={loading}
        >
          {loading ? (
            <span className="btn-loading-state">جاري التحقق من الكود... ⏳</span>
          ) : pin.length === 6 ? (
            <>
              <ArrowRight size={22} className="launch-arrow" />
              <span>انطلق إلى المسابقة 🚀</span>
            </>
          ) : (
            <>
              <Gamepad2 size={20} />
              <span>أدخل كود الـ PIN (6 أرقام)</span>
            </>
          )}
        </button>

        {/* Interactive Quick Demo Helper Button with Sound & Auto-fill */}
        <div className="tpc-quick-demo-row">
          <button
            type="button"
            className="btn-quick-demo-pill"
            onClick={() => {
              sfx.play('correct');
              setPin('123456');
            }}
            title="انقر لتعبئة الكود التجريبي فوراً"
          >
            <span className="demo-chip-icon">⚡</span>
            <span className="demo-chip-label">تجربة سريعة:</span>
            <span className="demo-chip-code">123456</span>
            <span className="demo-chip-tap">اضغط للتعبئة 🎯</span>
          </button>
        </div>
      </div>
    </main>
  );
}

/* ══════════════════════ TEACHER: AUTH / GATEWAY ══════════════════════ */
function TeacherAuthModal({ setMode, setIsTeacherUnlocked, setNotice }) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    // Default teacher passcode is 1234
    if (passcode === '1234' || passcode === '') {
      sfx.play('win');
      setIsTeacherUnlocked(true);
      setMode('teacher-dashboard');
      setNotice('👋 أهلاً بك يا معلّم في لوحة التحكم!');
    } else {
      sfx.play('wrong');
      setError('رمز المرور غير صحيح (الرمز الافتراضي: 1234)');
    }
  };

  return (
    <main className="teacher-auth-layout">
      <div className="teacher-auth-box">
        <div className="auth-lock-icon">
          <Lock size={36} />
        </div>
        <h2>بوابة المعلّم الخاصة 👨‍🏫</h2>
        <p>هذه المنطقة مخصصة للمعلمين لإنشاء وإدارة المسابقات المباشرة</p>

        <form onSubmit={handleLogin}>
          <div className="field-block">
            <label>رمز دخول المعلم (الافتراضي: 1234)</label>
            <input
              type="password"
              value={passcode}
              onChange={e => { setPasscode(e.target.value); setError(''); }}
              placeholder="1234"
              autoFocus
            />
            {error && <small className="auth-error-msg">{error}</small>}
          </div>

          <button type="submit" className="btn-3d btn-primary-giant" style={{ marginTop: '16px' }}>
            <GraduationCap size={20} /> فتح استوديو المعلم 🚀
          </button>
        </form>

        <button className="btn-back-link" onClick={() => { sfx.play('click'); setMode('home'); }}>
          <ArrowLeft size={16} /> العودة لشاشة الطلاب
        </button>
      </div>
    </main>
  );
}

/* ══════════════════════ TEACHER: DASHBOARD ══════════════════════ */
function TeacherDashboard({ setMode, setSession, setNotice, copyMobileLink }) {
  async function launchDemoTeacher() {
    sfx.play('click');
    try {
      let data;
      const demoToken = getTeacherToken('123456') || 'tecorbi-demo-teacher-token-123456';
      saveTeacherToken('123456', demoToken);
      try {
        data = await get('/sessions/123456');
        if (data.status === 'completed') {
          await teacherPost('123456', '/sessions/123456/reset');
          data = await get('/sessions/123456');
        }
      } catch {
        // If 123456 doesn't exist on server, create a ready demo quiz dynamically
        const created = await post('/sessions', {
          title: 'تحدي أذكياء المستقبل 🌟',
          teacher_name: 'الأستاذ أحمد',
          questions: [
            {
              question_text: 'How many planets are in our solar system?',
              question_text_ar: 'كم عدد الكواكب في مجموعتنا الشمسية؟',
              time_limit: 20,
              choices: [
                { choice_text: '7 planets', choice_text_ar: '٧ كواكب', is_correct: false },
                { choice_text: '8 planets', choice_text_ar: '٨ كواكب', is_correct: true },
                { choice_text: '9 planets', choice_text_ar: '٩ كواكب', is_correct: false },
                { choice_text: '10 planets', choice_text_ar: '١٠ كواكب', is_correct: false },
              ],
            },
            {
              question_text: 'What is 8 multiplied by 7?',
              question_text_ar: 'ما حاصل ضرب ٨ × ٧؟',
              time_limit: 15,
              choices: [
                { choice_text: '54', choice_text_ar: '٥٤', is_correct: false },
                { choice_text: '56', choice_text_ar: '٥٦', is_correct: true },
                { choice_text: '48', choice_text_ar: '٤٨', is_correct: false },
                { choice_text: '64', choice_text_ar: '٦٤', is_correct: false },
              ],
            },
            {
              question_text: 'Which organ pumps blood through the human body?',
              question_text_ar: 'ما العضو الذي يضخ الدم في جسم الإنسان؟',
              time_limit: 20,
              choices: [
                { choice_text: 'The Lungs', choice_text_ar: 'الرئتان', is_correct: false },
                { choice_text: 'The Brain', choice_text_ar: 'المخ', is_correct: false },
                { choice_text: 'The Heart', choice_text_ar: 'القلب', is_correct: true },
                { choice_text: 'The Stomach', choice_text_ar: 'المعدة', is_correct: false },
              ],
            },
          ],
        });
        data = created;
        if (created?.teacher_token) {
          saveTeacherToken(created.pin || '123456', created.teacher_token);
        }
      }
      const sessionObj = data?.session || data?.data?.session || data?.data || data;
      const pin = String(data?.pin || data?.session?.pin || sessionObj?.pin || '123456');
      const activeTeacherToken = data?.teacher_token || getTeacherToken(pin) || demoToken;
      saveTeacherToken(pin, activeTeacherToken);
      setSession({ ...sessionObj, pin, teacher_token: activeTeacherToken });
      setMode('teacher-lobby');
      sfx.play('join');
      setNotice('🚀 تم فتح لوحة تحكم المعلم للمسابقة التجريبية جاهزة للاستخدام!');
    } catch (e) {
      console.error('Launch demo error:', e);
      setNotice('تعذر تحميل السيشن التجريبي');
    }
  }

  return (
    <main className="teacher-dashboard-layout">
      <div className="section-header-row">
        <div>
          <span className="mini-badge-title"><GraduationCap size={15} /> لوحة تحكم المعلم</span>
          <h1 className="page-bold-title">استوديو المعلم (Teacher Studio)</h1>
          <p className="page-muted-sub">أنشئ مسابقات جديدة، شارك الرابط مع الطلاب، وتحكم في الجولات المباشرة</p>
        </div>
        <button className="btn-3d btn-back-home" onClick={() => { sfx.play('click'); setMode('home'); }}>
          <ArrowLeft size={16} /> وضع الطالب (Student View)
        </button>
      </div>

      <div className="teacher-actions-grid">
        {/* Create Quiz Card */}
        <div className="teacher-dash-card create-card" onClick={() => { sfx.play('click'); setMode('teacher-create'); }}>
          <div className="tdc-icon create-icon">
            <Plus size={36} />
          </div>
          <h3>إنشاء مسابقة جديدة</h3>
          <p>أضف أسئلة جديدة، خيارات ملونة، وحدد وقت الإجابة لكل سؤال</p>
          <button className="btn-3d btn-teacher">
            <Plus size={18} /> إنشاء الآن ✏️
          </button>
        </div>

        {/* Demo Ready Quiz Card */}
        <div className="teacher-dash-card demo-card" onClick={launchDemoTeacher}>
          <div className="tdc-icon demo-icon">
            <Trophy size={36} />
          </div>
          <span className="pin-pill-mini">كود: 123456</span>
          <h3>تشغيل المسابقة التجريبية الجاهزة</h3>
          <p>مسابقة جاهزة عن الفضاء والعلوم لإجراء تجربة فورية مع الفصل</p>
          <button className="btn-3d btn-demo-teacher">
            <Play size={18} fill="currentColor" /> فتح غرفة الانتظار (Lobby) 🚀
          </button>
        </div>
      </div>

      {/* Mobile Link Banner for Teacher */}
      <div className="teacher-mobile-link-banner">
        <div className="tml-left">
          <Smartphone size={28} className="phone-bounce-icon" />
          <div>
            <strong>رابط الطلاب على الهواتف والأجهزة اللوحية (Mobile Link):</strong>
            <p>أعطِ هذا الرابط لطلابك في الفصل ليفتحوه من هواتفهم على نفس شبكة الواي فاي:</p>
            <code className="mobile-code-chip">{getMobileUrl()}</code>
          </div>
        </div>
        <button className="btn-3d btn-copy-mobile" onClick={copyMobileLink}>
          <Copy size={18} /> نسخ الرابط 📋
        </button>
      </div>
    </main>
  );
}

/* ══════════════════════ TEACHER: CREATE ══════════════════════ */
function TeacherCreate({ setMode, setSession, setNotice }) {
  const [title, setTitle] = useState('');
  const [teacherName, setTeacherName] = useState('');
  const [questions, setQuestions] = useState([emptyQuestion()]);
  const [loading, setLoading] = useState(false);

  function emptyQuestion() {
    return {
      question_text: '', question_text_ar: '', time_limit: 20,
      choices: [
        { choice_text: '', choice_text_ar: '', is_correct: true },
        { choice_text: '', choice_text_ar: '', is_correct: false },
        { choice_text: '', choice_text_ar: '', is_correct: false },
        { choice_text: '', choice_text_ar: '', is_correct: false },
      ],
    };
  }

  function loadDemoTemplate() {
    sfx.play('click');
    setTitle('تحدي أذكياء المستقبل 🌟');
    setTeacherName('الأستاذ كريم');
    setQuestions([
      {
        question_text: 'How many planets are in our solar system?',
        question_text_ar: 'كم عدد الكواكب في مجموعتنا الشمسية؟',
        time_limit: 20,
        choices: [
          { choice_text: '7 planets', choice_text_ar: '٧ كواكب', is_correct: false },
          { choice_text: '8 planets', choice_text_ar: '٨ كواكب', is_correct: true },
          { choice_text: '9 planets', choice_text_ar: '٩ كواكب', is_correct: false },
          { choice_text: '10 planets', choice_text_ar: '١٠ كواكب', is_correct: false },
        ],
      },
      {
        question_text: 'What is 8 multiplied by 7?',
        question_text_ar: 'ما حاصل ضرب ٨ × ٧؟',
        time_limit: 15,
        choices: [
          { choice_text: '54', choice_text_ar: '٥٤', is_correct: false },
          { choice_text: '56', choice_text_ar: '٥٦', is_correct: true },
          { choice_text: '48', choice_text_ar: '٤٨', is_correct: false },
          { choice_text: '64', choice_text_ar: '٦٤', is_correct: false },
        ],
      },
      {
        question_text: 'Which organ pumps blood through the human body?',
        question_text_ar: 'ما العضو الذي يضخ الدم في جسم الإنسان؟',
        time_limit: 20,
        choices: [
          { choice_text: 'The Lungs', choice_text_ar: 'الرئتان', is_correct: false },
          { choice_text: 'The Brain', choice_text_ar: 'المخ', is_correct: false },
          { choice_text: 'The Heart', choice_text_ar: 'القلب', is_correct: true },
          { choice_text: 'The Stomach', choice_text_ar: 'المعدة', is_correct: false },
        ],
      },
    ]);
    setNotice('✨ تم تحميل نموذج أسئلة جاهز بنجاح!');
  }

  function updateQuestion(qi, field, value) {
    setQuestions(qs => qs.map((q, i) => i === qi ? { ...q, [field]: value } : q));
  }

  function updateChoice(qi, ci, field, value) {
    setQuestions(qs => qs.map((q, i) => {
      if (i !== qi) return q;
      const choices = q.choices.map((c, j) => {
        if (field === 'is_correct') return { ...c, is_correct: j === ci };
        return j === ci ? { ...c, [field]: value } : c;
      });
      return { ...q, choices };
    }));
  }

  function addQuestion() {
    sfx.play('click');
    setQuestions(qs => [...qs, emptyQuestion()]);
  }

  function removeQuestion(qi) {
    sfx.play('click');
    if (questions.length > 1) setQuestions(qs => qs.filter((_, i) => i !== qi));
  }

  async function submit() {
    if (!title.trim() || !teacherName.trim()) { setNotice('يرجى ملء عنوان المسابقة واسم المعلم'); return; }
    const valid = questions.every(q => q.question_text.trim() && q.choices.filter(c => c.choice_text.trim()).length >= 2);
    if (!valid) { setNotice('كل سؤال يجب أن يحتوي على نص وخيارين على الأقل'); return; }
    setLoading(true);
    sfx.play('click');
    try {
      const data = await post('/sessions', {
        title: title.trim(), teacher_name: teacherName.trim(),
        questions: questions.map(q => ({
          ...q,
          choices: q.choices.filter(c => c.choice_text.trim()),
        })),
      });
      const sessionObj = data?.session || data?.data?.session || data?.data || data;
      const sessionPin = String(data?.pin || data?.session?.pin || data?.data?.pin || sessionObj?.pin || '');
      if (data?.teacher_token) {
        saveTeacherToken(sessionPin, data.teacher_token);
      }
      const fullSession = {
        ...sessionObj,
        pin: sessionPin,
        teacher_token: data?.teacher_token,
      };
      setSession(fullSession);
      setMode('teacher-lobby');
      sfx.play('join');
      setNotice(`🎉 تم إنشاء المسابقة بنجاح! كود الـ PIN: ${sessionPin}`);
    } catch (e) {
      console.error('Create session error:', e);
      setNotice('حدث خطأ أثناء إنشاء المسابقة');
    }
    setLoading(false);
  }

  return (
    <main className="form-page-container">
      <div className="section-header-row">
        <div>
          <span className="mini-badge-title"><Sparkles size={14} /> استوديو المعلم</span>
          <h1 className="page-bold-title">إنشاء مسابقة جديدة</h1>
          <p className="page-muted-sub">أدخل تفاصيل المسابقة وأسئلتك وخيارات الإجابة</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn-3d btn-sample-template" onClick={loadDemoTemplate} type="button">
            <Sparkles size={16} /> تعبئة نموذج أسئلة جاهز ⚡
          </button>
          <button className="btn-3d btn-back-home" onClick={() => setMode('teacher-dashboard')} type="button">
            <ArrowLeft size={16} /> لوحة المعلم
          </button>
        </div>
      </div>

      <div className="form-card-container">
        <div className="form-two-columns">
          <div className="field-block">
            <label>اسم المعلم / المعلمة</label>
            <input value={teacherName} onChange={e => setTeacherName(e.target.value)} placeholder="مثال: الأستاذ أحمد / مس سارة" />
          </div>
          <div className="field-block">
            <label>عنوان المسابقة</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: تحدي العلوم - الصف الخامس" />
          </div>
        </div>

        <div className="questions-designer-list">
          {questions.map((q, qi) => (
            <div key={qi} className="question-design-box">
              <div className="qdb-header-bar">
                <div className="q-badge-num">سؤال {qi + 1}</div>
                <div className="q-inputs-row">
                  <input className="input-q-en" value={q.question_text} onChange={e => updateQuestion(qi, 'question_text', e.target.value)} placeholder="نص السؤال بالإنجليزي (أو العربي)..." />
                  <input className="input-q-ar" value={q.question_text_ar} onChange={e => updateQuestion(qi, 'question_text_ar', e.target.value)} placeholder="الترجمة أو النص العربي (اختياري)..." dir="rtl" />
                </div>
                <div className="q-timer-picker">
                  <Clock3 size={16} />
                  <input type="number" value={q.time_limit} onChange={e => updateQuestion(qi, 'time_limit', +e.target.value)} min={5} max={120} />
                  <span>ثانية</span>
                </div>
                {questions.length > 1 && (
                  <button className="btn-delete-q" onClick={() => removeQuestion(qi)} title="حذف السؤال">
                    <X size={18} />
                  </button>
                )}
              </div>

              <div className="choices-designer-grid">
                {q.choices.map((c, ci) => (
                  <div key={ci} className={`choice-designer-item tone-${SHAPES[ci].color} ${c.is_correct ? 'is-correct-pick' : ''}`}>
                    <button
                      type="button"
                      className="choice-correct-checkbox"
                      onClick={() => { sfx.play('click'); updateChoice(qi, ci, 'is_correct', true); }}
                      title="اضغط هنا لتحديد هذا الخيار كإجابة صحيحة"
                    >
                      {c.is_correct ? <CheckSquare size={22} className="check-icon-active" /> : <div className="check-box-empty" />}
                      <span className="shape-symbol">{SHAPES[ci].symbol}</span>
                    </button>
                    <input
                      value={c.choice_text}
                      onChange={e => updateChoice(qi, ci, 'choice_text', e.target.value)}
                      placeholder={`الخيار ${ci + 1}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="form-bottom-actions">
          <button className="btn-3d btn-add-question" onClick={addQuestion}>
            <Plus size={18} /> إضافة سؤال جديد
          </button>
          <button className="btn-3d btn-submit-game" onClick={submit} disabled={loading}>
            {loading ? 'جاري الإنشاء...' : <><Rocket size={20} /> إنشاء المسابقة وعرض الكود 🚀</>}
          </button>
        </div>
      </div>
    </main>
  );
}

/* ══════════════════════ TEACHER: LOBBY (3D SPACE & GLASSMORPHISM) ══════════════════════ */
function TeacherLobby({ session, setSession, setMode, setNotice, copyMobileLink }) {
  const [players, setPlayers] = useState([]);
  const prevCount = useRef(0);
  const interval = useRef(null);

  const poll = useCallback(async () => {
    try {
      const data = await get(`/sessions/${session.pin}/players`);
      const newPlayers = data.players || [];
      if (newPlayers.length > prevCount.current) {
        sfx.play('join');
      }
      prevCount.current = newPlayers.length;
      setPlayers(newPlayers);
    } catch {}
  }, [session]);

  useEffect(() => {
    let isMounted = true;
    let timer = null;

    const schedulePoll = () => {
      if (!isMounted) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!isMounted) return;
        if (!document.hidden) {
          await poll();
        }
        schedulePoll();
      }, 1000); // 1000ms in lobby
    };

    poll().then(schedulePoll);

    const onVisibilityChange = () => {
      if (!document.hidden && isMounted) {
        poll();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Real-time WebSocket listener for instant student joining
    const unsubscribe = subscribeToSession(session.pin, {
      PlayerJoined: (data) => {
        if (data?.player) {
          setPlayers(prev => {
            if (prev.some(p => p.id === data.player.id)) return prev;
            sfx.play('join');
            return [...prev, data.player];
          });
        }
      },
    }, poll);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [session, poll]);

  async function startGame() {
    sfx.play('win');
    await teacherPost(session.pin, `/sessions/${session.pin}/start`);
    setMode('teacher-live');
    setNotice('🚀 انطلقت المسابقة الآن!');
  }

  async function copyPin() {
    sfx.play('click');
    try {
      await navigator.clipboard.writeText(session.pin);
      setNotice(`✅ تم نسخ كود المسابقة: ${session.pin}`);
    } catch {
      setNotice(`كود المسابقة: ${session.pin}`);
    }
  }

  return (
    <main className="space-lobby-view">
      <CosmicDecorations />

      {/* Top Glass Bar (Matching iOS / visionOS Screenshot) */}
      <div className="space-top-bar">
        {/* Left: Brand Squircle */}
        <div className="glass-brand-badge">
          <div className="gbb-icon-disc">
            <GraduationCap size={22} className="gbb-cap" />
          </div>
          <div className="gbb-text">
            <strong className="gbb-title">Tecorbia</strong>
            <span className="gbb-sub">Kids Arena •</span>
          </div>
        </div>

        {/* Center: Live Quiz Squircle */}
        <div className="glass-quiz-badge">
          <span>المسابقات المدرسية</span>
          <span>- المتنزية</span>
          <strong>Live Quiz</strong>
        </div>

        {/* Right: Golden PIN Badge */}
        <div className="glass-pin-badge" onClick={copyPin} title="اضغط لنسخ الكود">
          <div className="gpb-star">
            <Star size={13} fill="#fbbf24" color="#fbbf24" />
          </div>
          <span className="gpb-label">PIN {session.pin}</span>
        </div>
      </div>

      {/* Live Status Pill */}
      <div className="space-live-pill-row">
        <div className="space-live-pill">
          <span className="live-dot-green" />
          <Radio size={14} className="live-radio-wave" />
          <span>غرفة الانتظار المباشرة</span>
        </div>
      </div>

      {/* Hero Section: 3D Planet + Arabic Headline + 3D Rocket */}
      <div className="space-hero-section">
        {/* Left 3D Planet */}
        <div className="space-planet-anchor">
          <SpacePlanet3D />
        </div>

        {/* Center Arabic Title & Teacher */}
        <div className="space-hero-content">
          <h1 className="space-hero-title">
            <span>Tecorbi</span>
            <span>Game 🎮</span>
          </h1>
          <p className="space-hero-teacher">
            بقيادة المعلم: <strong>{session.teacher_name || 'الأستاذ أحمد'}</strong>
          </p>
        </div>

        {/* Right 3D Rocket */}
        <div className="space-rocket-anchor">
          <SpaceRocket3D />
        </div>
      </div>

      {/* Game PIN Central Glass Card (Realistic iOS Glassmorphism) */}
      <div className="space-pin-glass-card" onClick={copyPin} title="اضغط هنا لنسخ الكود">
        <div className="spgc-header">
          <div className="spgc-gamepad-disc">
            <Gamepad2 size={24} />
          </div>
          <span className="spgc-title">(GAME PIN) كود الانضمام بالطلب</span>
        </div>

        <div className="spgc-numbers-display">
          <div className="spgc-num-row">{session.pin.slice(0, 3)} -</div>
          <div className="spgc-num-row">{session.pin.slice(3)}</div>
        </div>

        <div className="spgc-copy-action">
          <div className="spgc-copy-btn">
            <Copy size={16} />
          </div>
          <span className="spgc-copy-hint">الضغط هنا لنسخ الكود ومشاركته مع الفصل</span>
        </div>
      </div>

      {/* Mobile Direct URL Strip for Classroom Projection */}
      <div className="space-mobile-url-strip" onClick={copyMobileLink}>
        <Smartphone size={20} className="smus-icon" />
        <div className="smus-text">
          <span>ادخلوا من الموبايل على الرابط التالي:</span>
          <strong>{getMobileUrl()}</strong>
        </div>
        <button className="btn-copy-chip-glass" type="button">
          <Copy size={14} /> نسخ الرابط
        </button>
      </div>

      {/* Connected Players Grid */}
      <div className="space-players-section">
        <div className="sps-header">
          <div className="sps-title">
            <Users size={20} />
            <h2>الطلاب المنضمون للغرفة</h2>
          </div>
          <span className="sps-counter-chip">{players.length} بطل جاهز</span>
        </div>

        {players.length === 0 ? (
          <div className="space-players-empty">
            <div className="space-radar-glow">
              <div className="srg-circle srg-1" />
              <div className="srg-circle srg-2" />
              <Gamepad2 size={36} className="srg-gamepad" />
            </div>
            <h3>في انتظار دخول الطلاب...</h3>
            <p>أخبر الطلاب بالدخول على الرابط وإدخال كود المسابقة <strong>{session.pin}</strong></p>
          </div>
        ) : (
          <div className="space-players-grid">
            {players.map(p => (
              <div key={p.id} className="space-player-bubble">
                <span className="spb-emoji"><AvatarDisplay avatarId={p.avatar} /></span>
                <span className="spb-name">{p.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Teacher Launch Live Action */}
      <div className="space-lobby-footer-actions">
        <button
          className="btn-3d btn-launch-live"
          onClick={startGame}
          disabled={players.length === 0}
        >
          <Play size={24} fill="currentColor" /> بدء المسابقة الآن ({players.length} طلاب جاهزون) 🚀
        </button>
      </div>
    </main>
  );
}

/* ══════════════════════ TEACHER: LIVE CONTROL (WITH REVEAL BUTTON) ══════════════════════ */
function TeacherLive({ session, setSession, setMode, setNotice }) {
  const [poll, setPoll] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [liveRemaining, setLiveRemaining] = useState(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const timerRef = useRef(null);
  const isMountedRef = useRef(true);
  const pollRef = useRef(poll);
  pollRef.current = poll;

  const refresh = useCallback(async () => {
    try {
      const p = await get(`/sessions/${session.pin}/poll`);
      if (!isMountedRef.current) return;
      setPoll(p);
      if (p.leaderboard) {
        setLeaderboard(p.leaderboard);
      }
      if (p.status === 'completed') {
        if (timerRef.current) clearTimeout(timerRef.current);
        setMode('leaderboard');
      }
    } catch {}
  }, [session, setMode]);

  useEffect(() => {
    isMountedRef.current = true;
    refresh();

    // Real-time WebSocket subscriptions
    const unsubscribe = subscribeToSession(session.pin, {
      StudentAnswered: (data) => {
        if (data && data.answered_count !== undefined) {
          setAnsweredCount(data.answered_count);
          refresh();
        }
      },
      QuestionChanged: () => {
        setAnsweredCount(0);
        refresh();
      },
      LeaderboardUpdated: (data) => {
        if (data?.leaderboard) {
          setLeaderboard(data.leaderboard);
        }
      },
      GameFinished: () => {
        setMode('leaderboard');
      },
    }, refresh);

    // Adaptive polling: 2000ms during active question, 1000ms between questions/revealed
    let isPolling = false;
    const scheduleNextPoll = () => {
      if (!isMountedRef.current) return;
      const currentPoll = pollRef.current;
      const isActive = currentPoll?.status === 'active' && currentPoll?.question_state === 'answering';
      const delay = isActive ? 2000 : 1000;

      timerRef.current = setTimeout(async () => {
        if (isMountedRef.current && !isPolling) {
          isPolling = true;
          try {
            if (!document.hidden) {
              await refresh();
            }
          } finally {
            isPolling = false;
            scheduleNextPoll();
          }
        } else {
          scheduleNextPoll();
        }
      }, delay);
    };
    scheduleNextPoll();

    const onVisibility = () => {
      if (!document.hidden && isMountedRef.current) {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Live clock tick driven by server-authoritative timestamps
    const clockInterval = setInterval(() => {
      const p = pollRef.current;
      if (!p || !p.current_question) {
        setLiveRemaining(null);
        return;
      }
      const startedAt = p.question_started_at;
      const limit = p.current_question.time_limit || 20;
      if (startedAt && p.status === 'active' && p.question_state === 'answering') {
        const now = serverNow();
        if (now < startedAt) {
          setLiveRemaining(limit);
        } else {
          const rem = Math.max(0, Math.ceil(limit - (now - startedAt) / 1000));
          setLiveRemaining(rem);
        }
      } else {
        setLiveRemaining(null);
      }
    }, 200);

    return () => {
      isMountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(clockInterval);
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [session, refresh, setMode]);

  async function nextQ() {
    if (isProcessing) return;
    setIsProcessing(true);
    sfx.play('click');
    try {
      const res = await teacherPost(session.pin, `/sessions/${session.pin}/next`, {
        expected_index: poll?.current_question_index,
      });
      setAnsweredCount(0);
      if (res && res.status === 'completed') {
        setMode('leaderboard');
        return;
      }
      await refresh();
    } catch (e) {
      console.error(e);
      if (e?.status === 403) setNotice('جلسة المعلم غير مصرحة');
    } finally {
      setIsProcessing(false);
    }
  }

  async function revealAnswer() {
    if (isProcessing) return;
    setIsProcessing(true);
    sfx.play('win');
    try {
      await teacherPost(session.pin, `/sessions/${session.pin}/reveal`);
      await refresh();
    } catch (e) {
      console.error(e);
      if (e?.status === 403) setNotice('جلسة المعلم غير مصرحة');
    } finally {
      setIsProcessing(false);
    }
  }

  async function pauseGame() {
    if (isProcessing) return;
    setIsProcessing(true);
    sfx.play('click');
    try {
      await teacherPost(session.pin, `/sessions/${session.pin}/pause`);
      await refresh();
    } catch (e) {
      if (e?.status === 403) setNotice('جلسة المعلم غير مصرحة');
    } finally {
      setIsProcessing(false);
    }
  }

  async function resumeGame() {
    if (isProcessing) return;
    setIsProcessing(true);
    sfx.play('click');
    try {
      await teacherPost(session.pin, `/sessions/${session.pin}/resume`);
      await refresh();
    } catch (e) {
      if (e?.status === 403) setNotice('جلسة المعلم غير مصرحة');
    } finally {
      setIsProcessing(false);
    }
  }

  async function endGame() {
    if (isProcessing) return;
    setIsProcessing(true);
    sfx.play('win');
    try {
      await teacherPost(session.pin, `/sessions/${session.pin}/end`);
      setMode('leaderboard');
    } catch (e) {
      if (e?.status === 403) setNotice('جلسة المعلم غير مصرحة');
    } finally {
      setIsProcessing(false);
    }
  }

  async function copyPin() {
    sfx.play('click');
    try {
      await navigator.clipboard.writeText(session.pin);
      setNotice(`✅ تم نسخ كود المسابقة: ${session.pin}`);
    } catch {
      setNotice(`كود المسابقة: ${session.pin}`);
    }
  }

  if (!poll) return (
    <div className="loading-state-box">
      <Gamepad2 size={48} className="spin-bounce" />
      <h2>جاري تحضير شاشة التحكم المباشر...</h2>
    </div>
  );

  const isRevealed = poll.question_state === 'revealed';
  const totalStudents = poll.player_count || leaderboard.length || 0;

  return (
    <main className="live-control-layout">
      <CosmicDecorations />

      {/* ── Top Bar Control Hub ── */}
      <div className="lc-top-bar">
        <div className="lc-brand-group">
          <button className="lc-home-btn" onClick={() => setMode('teacher-dashboard')} title="العودة للوحة المعلم">
            <ArrowLeft size={18} />
          </button>
          <div className="lc-brand-info">
            <div className="lc-kicker-tag">
              <span className="live-dot-pulse" />
              <Radio size={14} />
              <span>البث المباشر للمعلم</span>
            </div>
            <h1 className="lc-title">{session.title || 'مسابقة Tecorbi Arena 🎮'}</h1>
          </div>
        </div>

        <div className="lc-progress-badge">
          <span className="lcp-label">السؤال</span>
          <strong className="lcp-cur">{poll.current_question_index + 1}</strong>
          <span className="lcp-slash">/</span>
          <span className="lcp-total">{poll.total_questions}</span>
        </div>

        <div className="lc-actions-group">
          <div className={`status-pill ${poll.status}`}>
            <span className="online-dot" />
            <span>{poll.status === 'active' ? 'الجولة نشطة' : poll.status === 'paused' ? 'إيقاف مؤقت' : poll.status}</span>
          </div>

          <button className="lc-pin-pill" onClick={copyPin} title="اضغط لنسخ الكود ومشاركته">
            <span className="lpp-label">PIN</span>
            <strong className="lpp-code">{session.pin}</strong>
            <Copy size={13} className="lpp-icon" />
          </button>
        </div>
      </div>

      {/* ── Main Two-Column Grid ── */}
      <div className="lc-main-grid">
        {/* Right (Main) Column: Current Question Preview & Action Dock */}
        <div className="lc-question-side">
          {poll.current_question ? (
            <div className="card question-live-preview-card">
              <div className="qlp-topline">
                <div className="qlp-badges-left">
                  <span className="q-badge-num">سؤال {poll.current_question_index + 1}</span>
                  <span className={`reveal-status-indicator ${isRevealed ? 'is-revealed' : 'is-answering'}`}>
                    {isRevealed ? '✅ الإجابة معروضة' : '⏳ جاري استقبال الإجابات'}
                  </span>
                  {totalStudents > 0 && !isRevealed && (
                    <span className="qlp-answered-chip" title="الطلاب الذين أجابوا">
                      <Users size={14} /> {answeredCount} / {totalStudents} أجابوا
                    </span>
                  )}
                </div>

                <div className={`time-badge ${liveRemaining !== null && liveRemaining <= 5 && !isRevealed ? 'is-urgent' : ''}`}>
                  <Clock3 size={16} />
                  <span>{liveRemaining !== null ? `${liveRemaining}s` : `${poll.current_question.time_limit}s`}</span>
                </div>
              </div>

              {/* Question Text (dir="auto" so English ? appears at the end) */}
              <h2 className="qlp-question-title" dir="auto">
                {poll.current_question.question_text}
              </h2>
              {poll.current_question.question_text_ar && (
                <p className="qlp-question-arabic" dir="rtl">
                  {poll.current_question.question_text_ar}
                </p>
              )}

              {/* Choices Grid (2x2) */}
              <div className="qlp-choices-grid">
                {poll.current_question.choices.map((c, i) => {
                  const isCorrect = poll.current_question.correct_choice_id === c.id;
                  const shape = SHAPES[i] || SHAPES[0];
                  return (
                    <div
                      key={c.id}
                      className={`qlp-choice-pill tone-${shape.color} ${isCorrect ? 'teacher-choice-correct' : ''}`}
                    >
                      <div className="shape-marker">{shape.symbol}</div>
                      <div className="choice-texts-box" dir="auto">
                        <span className="choice-text-bold">{c.choice_text}</span>
                        {c.choice_text_ar && <small className="choice-text-sub">{c.choice_text_ar}</small>}
                      </div>
                      {isCorrect && (
                        <span className="correct-stamp">
                          <CheckCheck size={14} /> الإجابة الصحيحة
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="card question-live-preview-card qlp-empty-card">
              <Trophy size={48} className="gold-color spin-bounce" />
              <h2>المسابقة انتهت أو لا يوجد سؤال نشط حالياً</h2>
            </div>
          )}

          {/* Teacher Interactive Live Control Action Dock */}
          <div className="lc-controls-panel">
            {/* Primary Action Button (Giant, Full Width) */}
            <div className="lc-primary-action-wrap">
              {!isRevealed ? (
                <button
                  className="btn-3d btn-primary-giant btn-reveal-giant"
                  onClick={revealAnswer}
                  disabled={isProcessing}
                  title="كشف الإجابة الصحيحة لجميع الطلاب الآن"
                >
                  <Eye size={22} />
                  <span>{isProcessing ? 'جاري الكشف...' : 'كشف الإجابة الصحيحة للطلاب 👁️'}</span>
                </button>
              ) : (
                <button
                  className="btn-3d btn-primary-giant btn-next-giant"
                  onClick={nextQ}
                  disabled={isProcessing}
                  title="الانتقال للسؤال التالي"
                >
                  <SkipForward size={22} />
                  <span>{isProcessing ? 'جاري الانتقال...' : 'الانتقال للسؤال التالي ⏭️'}</span>
                </button>
              )}
            </div>

            {/* Secondary Controls (2-Column Balanced Row) */}
            <div className="lc-secondary-actions-row">
              {poll.status === 'active' ? (
                <button className="btn-3d btn-control-secondary btn-pause" onClick={pauseGame} disabled={isProcessing}>
                  <Pause size={18} />
                  <span>إيقاف مؤقت ⏸️</span>
                </button>
              ) : (
                <button className="btn-3d btn-control-secondary btn-resume" onClick={resumeGame} disabled={isProcessing}>
                  <Play size={18} fill="currentColor" />
                  <span>استئناف اللعب ▶️</span>
                </button>
              )}

              <button className="btn-3d btn-control-secondary btn-end" onClick={endGame} disabled={isProcessing}>
                <Square size={16} fill="currentColor" />
                <span>إنهاء وعرض الفائزين 🏆</span>
              </button>
            </div>
          </div>
        </div>

        {/* Left Column: Live Leaderboard Side Panel */}
        <div className="lc-leaderboard-side">
          <div className="card live-rankings-card">
            <div className="lrc-header">
              <div className="lrc-title-wrap">
                <Trophy size={20} className="gold-trophy-icon" />
                <h3>المتصدرون (Live Ranking)</h3>
              </div>
              <span className="lrc-count-chip">{leaderboard.length} متسابق</span>
            </div>

            <div className="lrc-list">
              {leaderboard.length === 0 ? (
                <div className="lrc-empty-state">
                  <div className="lrc-radar-dot" />
                  <p>في انتظار إجابات الطلاب...</p>
                </div>
              ) : (
                leaderboard.map(p => {
                  const medalEmoji = p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : null;
                  return (
                    <div key={p.id} className={`lrc-row rank-item-${p.rank}`}>
                      <span className={`rank-disc rank-${p.rank}`}>
                        {medalEmoji || p.rank}
                      </span>
                      <span className="player-avatar-small">
                        <AvatarDisplay avatarId={p.avatar} />
                      </span>
                      <span className="player-display-name">
                        {p.name}
                        {p.streak > 1 && <span className="streak-mini-chip">🔥{p.streak}</span>}
                      </span>
                      <strong className="player-live-score" dir="ltr">
                        {p.score.toLocaleString()} XP
                      </strong>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ══════════════════════ STUDENT: JOIN PROFILE ══════════════════════ */
function StudentJoin({ setMode, setSession, setPlayer, setNotice, initialPin = '' }) {
  const [step, setStep] = useState(initialPin ? 'profile' : 'pin');
  const [pin, setPin] = useState(initialPin);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('spongebob');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialPin && initialPin.length === 6) {
      checkPinWith(initialPin);
    }
  }, [initialPin]);

  async function checkPinWith(pinCode) {
    if (pinCode.length !== 6) { setNotice('يرجى كتابة كود مكوّن من 6 أرقام'); return; }
    setLoading(true);
    sfx.play('click');
    try {
      const data = await get(`/sessions/${pinCode}`);
      if (data.status === 'completed') { setNotice('⚠️ هذه المسابقة انتهت بالفعل'); setLoading(false); return; }
      setSessionInfo(data);
      setStep('profile');
      sfx.play('join');
    } catch {
      setNotice('❌ لم يتم العثور على مسابقة بهذا الكود. تحقق من الكود وحاول مجدداً');
    }
    setLoading(false);
  }

  async function joinGame() {
    if (!name.trim()) { setNotice('يرجى كتابة اسمك'); return; }
    setLoading(true);
    sfx.play('click');
    try {
      const data = await post(`/sessions/${pin}/join`, { name: name.trim(), avatar });
      if (!data || !data.player) { setNotice('❌ حدث خطأ غير متوقع. حاول مرة أخرى'); setLoading(false); return; }
      if (data.player_token) {
        savePlayerAuth(pin, data.player, data.player_token);
      }
      setPlayer({ ...data.player, token: data.player_token });
      setSession({ ...sessionInfo, pin });
      setMode('student-lobby');
      sfx.play('win');
      setNotice(`مرحباً يا بطل! تم انضمامك للمسابقة بنجاح 🎉`);
    } catch (e) {
      console.error('Join error:', e);
      setNotice('حدث خطأ أثناء الانضمام للمسابقة. تأكد من الاتصال بالسيرفر');
    }
    setLoading(false);
  }

  return (
    <main className="space-lobby-view join-screen-space">
      <CosmicDecorations />
      <div className="space-pin-glass-card profile-selection-card-space">
        {sessionInfo && (
          <div className="space-live-pill-row" style={{ justifyContent: 'center', marginBottom: '16px' }}>
            <div className="space-live-pill" style={{ borderColor: 'rgba(56, 189, 248, 0.4)' }}>
              <CheckCircle2 size={16} />
              <span>تم العثور على: <strong>{sessionInfo.title}</strong> (المعلم: {sessionInfo.teacher_name})</span>
            </div>
          </div>
        )}

        <h2 className="select-avatar-title-space">اختر بطلك الكرتوني 🌟</h2>
        <p className="select-avatar-subtitle-space">اختر الشخصية التي ستمثلك على منصة التتويج ولوحة الشرف:</p>

        {/* ── Avatar Grid (Direct Selection) ── */}
        <div className="avatars-card-grid">
          {AVATARS.map(a => (
            <button
              key={a.id}
              type="button"
              className={`avatar-character-card-space ${avatar === a.id ? 'is-selected' : ''}`}
              onClick={() => { sfx.play('click'); setAvatar(a.id); }}
            >
              {a.image ? (
                <div className="avatar-img-container">
                  <img src={a.image} alt={a.name} className="avatar-card-figure" />
                </div>
              ) : (
                <span className="character-emoji">{a.emoji}</span>
              )}
              <strong className="character-name">{a.name}</strong>
              <small className="character-role">{a.role}</small>
            </button>
          ))}
        </div>

        <div className="player-name-field-space">
          <label>اسمك الذي سيظهر للمتسابقين</label>
          <input
            className="input-space-glass"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="اكتب اسمك هنا (مثال: عمر البطل)..."
            maxLength={35}
            autoFocus
          />
        </div>

        <button
          className="btn-3d btn-primary-giant"
          onClick={joinGame}
          disabled={loading || !name.trim()}
          style={{ width: '100%' }}
        >
          {loading ? 'جاري الدخول...' : <><Rocket size={22} /> انطلق إلى ساحة الأبطال 🎮</>}
        </button>
      </div>
    </main>
  );
}

/* ══════════════════════ STUDENT: LOBBY WAIT ══════════════════════ */
function StudentLobby({ session, setMode, player }) {
  const [players, setPlayers] = useState([]);
  const prevCount = useRef(0);

  const pollPlayers = useCallback(async () => {
    if (!session?.pin) return;
    try {
      const data = await get(`/sessions/${session.pin}/players`);
      const newPlayers = data.players || [];
      if (newPlayers.length > prevCount.current && prevCount.current > 0) {
        sfx.play('join');
      }
      prevCount.current = newPlayers.length;
      setPlayers(newPlayers);
    } catch {}
  }, [session?.pin]);

  useEffect(() => {
    let isMounted = true;
    let timer = null;

    const check = async () => {
      if (!isMounted) return;
      try {
        const [stateData] = await Promise.all([
          get(`/sessions/${session.pin}/state`),
          pollPlayers()
        ]);
        if (!isMounted) return;
        if (stateData && stateData.status === 'active') {
          sfx.play('win');
          setMode('student-play');
          return;
        }
      } catch {}
      if (isMounted) {
        timer = setTimeout(check, 1000); // 1000ms in lobby
      }
    };
    check();

    const onVisibility = () => {
      if (!document.hidden && isMounted) {
        check();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Instant WebSocket triggers
    const unsubscribe = subscribeToSession(session.pin, {
      GameStarted: () => {
        sfx.play('win');
        setMode('student-play');
      },
      PlayerJoined: (data) => {
        if (data?.player) {
          setPlayers(prev => {
            if (prev.some(p => p.id === data.player.id)) return prev;
            sfx.play('join');
            return [...prev, data.player];
          });
        }
      },
    }, check);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [session, setMode, pollPlayers]);

  return (
    <main className="space-lobby-view student-waiting-arena-space">
      <CosmicDecorations />
      <div className="space-pin-glass-card wait-portal-card-space">
        <div className="wait-avatar-ring">
          {getAvatar(player.avatar).image ? (
            <div className="floating-avatar-3d-wrap">
              <img
                src={getAvatar(player.avatar).image}
                alt={getAvatar(player.avatar).name}
                className="floating-avatar-giant-3d"
              />
            </div>
          ) : (
            <span className="floating-avatar-giant">{getAvatar(player.avatar).emoji}</span>
          )}
          <div className="ring-pulse rp-1" />
          <div className="ring-pulse rp-2" />
        </div>
        <h1 className="wait-title-space">أنت في اللعبة يا {player.name}! 🚀</h1>
        <p className="wait-msg-sub-space">نحن الآن في غرفة الانتظار بانتظار إشارة البدء من المعلم...</p>
        <div className="wait-character-chip-space">
          <span>شخصيتك:</span>
          <strong>{getAvatar(player.avatar).name}</strong>
        </div>
      </div>

      {/* Connected Players in Lobby */}
      <div className="space-players-section" style={{ maxWidth: '800px', margin: '20px auto 0', width: '100%' }}>
        <div className="sps-header">
          <div className="sps-title">
            <Users size={20} />
            <h2>الطلاب المنضمون للغرفة</h2>
          </div>
          <span className="sps-counter-chip">{players.length > 0 ? players.length : 1} أبطال جاهزون ⚡</span>
        </div>

        {players.length === 0 ? (
          <div className="space-players-empty">
            <div className="space-radar-glow">
              <div className="srg-circle srg-1" />
              <div className="srg-circle srg-2" />
              <Gamepad2 size={36} className="srg-gamepad" />
            </div>
            <h3>في انتظار باقي الأبطال...</h3>
          </div>
        ) : (
          <div className="space-players-grid">
            {players.map(p => {
              const isMe = p.id === player.id;
              return (
                <div key={p.id} className={`space-player-bubble ${isMe ? 'is-me-bubble' : ''}`}>
                  <span className="spb-emoji"><AvatarDisplay avatarId={p.avatar} /></span>
                  <span className="spb-name">
                    {p.name} {isMe && <span style={{ color: '#3925DE', fontSize: '0.85em', display: 'block', fontWeight: '900' }}>⭐ (أنت)</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="tips-banner-space" style={{ maxWidth: '600px', margin: '16px auto 0' }}>
        <Sparkles size={18} /> نصيحة: الإجابة الأسرع تمنحك نقاط XP إضافية وبونص سرعة!
      </div>
    </main>
  );
}

/* ══════════════════════ STUDENT: PLAY ARENA (DELAYED REVEAL) ══════════════════════ */
function StudentPlay({ session, player, setMode, setNotice, setPlayer }) {
  const [question, setQuestion] = useState(null);
  const [qNumber, setQNumber] = useState(0);
  const [totalQ, setTotalQ] = useState(0);
  const [selected, setSelected] = useState(null);
  const [pendingResult, setPendingResult] = useState(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [timerDisplay, setTimerDisplay] = useState(20);
  const [isLeadPeriod, setIsLeadPeriod] = useState(false);
  const [gameStatus, setGameStatus] = useState('active');
  const [correctChoiceId, setCorrectChoiceId] = useState(null);

  // Mid-game leaderboard state
  const [showMidBoard, setShowMidBoard] = useState(false);
  const [midLeaderboard, setMidLeaderboard] = useState([]);
  const [myRank, setMyRank] = useState(null);

  const lastQId = useRef(null);
  const qIndexRef = useRef(null);
  const questionStartedAtRef = useRef(null);
  const timeLimitRef = useRef(20);
  const currentVersionRef = useRef(0);
  const preDeadlinePolledRef = useRef(false);
  const lastSoundTickRef = useRef(null);

  const playedSound = useRef(false);
  const midBoardTimer = useRef(null);
  const pendingResultRef = useRef(null);
  const submittingRef = useRef(false);
  const pendingPromiseRef = useRef(null);
  const isRevealedRef = useRef(isRevealed);
  isRevealedRef.current = isRevealed;
  const playerRef = useRef(player);
  playerRef.current = player;
  const gameStatusRef = useRef(gameStatus);
  gameStatusRef.current = gameStatus;

  const applyResultSoundAndScore = useCallback((res) => {
    if (!res) return;
    if (res.total_score !== undefined) {
      setPlayer(p => ({ ...p, score: res.total_score, streak: res.streak ?? p?.streak ?? 0 }));
    }
    if (!playedSound.current) {
      playedSound.current = true;
      if (res.is_correct) {
        sfx.play('correct');
      } else {
        sfx.play('wrong');
      }
    }
  }, [setPlayer]);

  const handleNewQuestion = useCallback((qData, qIdx, totalCount, startedAt = null, version = 0) => {
    if (!qData) return;
    if (version && currentVersionRef.current && version < currentVersionRef.current) {
      return; // Ignore stale version
    }
    if (version) {
      currentVersionRef.current = version;
    }

    lastQId.current = qData.id;
    qIndexRef.current = qIdx;
    questionStartedAtRef.current = startedAt;
    timeLimitRef.current = qData.time_limit || 20;
    preDeadlinePolledRef.current = false;
    lastSoundTickRef.current = null;

    setQuestion(qData);
    setQNumber(qIdx + 1);
    setTotalQ(totalCount);
    setSelected(null);
    setPendingResult(null);
    pendingResultRef.current = null;
    submittingRef.current = false;
    pendingPromiseRef.current = null;
    setIsRevealed(false);
    setCorrectChoiceId(null);
    setShowMidBoard(false);
    playedSound.current = false;
    if (midBoardTimer.current) clearTimeout(midBoardTimer.current);

    sfx.play('join');
  }, []);

  // Precise Authoritative Timer Tick (~150ms redraw, never accumulates)
  useEffect(() => {
    if (gameStatus !== 'active' || !question || isRevealed) return;

    const updateCountdown = () => {
      const now = serverNow();
      const startedAt = questionStartedAtRef.current;
      const limit = timeLimitRef.current || 20;

      if (!startedAt) {
        setTimerDisplay(limit);
        setIsLeadPeriod(false);
        return;
      }

      if (now < startedAt) {
        // Lead period before answering opens
        setIsLeadPeriod(true);
        setTimerDisplay(limit);
        return;
      }

      setIsLeadPeriod(false);
      const elapsedSec = (now - startedAt) / 1000;
      const remainingSec = Math.max(0, limit - elapsedSec);
      const rounded = Math.ceil(remainingSec);

      setTimerDisplay(rounded);

      if (rounded <= 4 && rounded > 0 && lastSoundTickRef.current !== rounded) {
        lastSoundTickRef.current = rounded;
        sfx.play('click');
      }

      if (remainingSec <= 0 && !isRevealedRef.current) {
        triggerReveal();
      }
    };

    updateCountdown();
    const tickInterval = setInterval(updateCountdown, 150);

    return () => clearInterval(tickInterval);
  }, [gameStatus, question, isRevealed]);

  // Real-time WebSocket subscription for instant question changes & answer reveals
  useEffect(() => {
    const unsubscribe = subscribeToSession(session?.pin, {
      QuestionChanged: (data) => {
        if (data?.question) {
          handleNewQuestion(
            data.question,
            data.current_question_index ?? 0,
            data.total_questions ?? 1,
            data.question_started_at || null,
            data.state_version || 0
          );
        }
      },
      AnswerRevealed: (data) => {
        if (!isRevealedRef.current) {
          triggerReveal(data.correct_choice_id);
        }
      },
      LeaderboardUpdated: (data) => {
        if (data?.leaderboard) {
          setMidLeaderboard(data.leaderboard);
          const myId = playerRef.current?.id;
          const idx = data.leaderboard.findIndex(p => p.id === myId);
          setMyRank(idx >= 0 ? idx + 1 : null);
          const myP = data.leaderboard.find(p => p.id === myId);
          if (myP && myP.score !== undefined) {
            setPlayer(p => ({ ...p, score: myP.score }));
          }
        }
      },
      GameFinished: () => {
        sfx.play('win');
        setMode('leaderboard');
      },
      SessionReset: () => {
        setMode('home');
      },
    }, () => {
      // One-time sync on reconnect
      if (!session?.pin) return;
      get(`/sessions/${session.pin}/state`).then(data => {
        if (data.status === 'completed') {
          setMode('leaderboard');
        } else if (data.current_question) {
          if (data.current_question.id !== lastQId.current || data.current_question_index !== qIndexRef.current) {
            handleNewQuestion(
              data.current_question,
              data.current_question_index,
              data.total_questions,
              data.question_started_at,
              data.state_version
            );
          }
          if (data.question_state === 'revealed' && !isRevealedRef.current) {
            triggerReveal(data.current_question.correct_choice_id);
          }
        }
      }).catch(() => {});
    });

    return () => {
      unsubscribe();
    };
  }, [session?.pin, setMode, setPlayer, handleNewQuestion]);

  // Adaptive polling: 2000ms while active, 1000ms otherwise, extra poll before deadline
  useEffect(() => {
    let isMounted = true;
    let isPolling = false;
    let pollTimer = null;

    const pollState = async () => {
      if (!isMounted) return;
      try {
        const data = await get(`/sessions/${session.pin}/state`);
        if (!isMounted) return;

        // Version check to ignore stale/out-of-order responses
        if (data.state_version !== undefined && data.state_version < currentVersionRef.current) {
          return;
        }

        if (data.status === 'completed') {
          sfx.play('win');
          if (pollTimer) clearTimeout(pollTimer);
          setMode('leaderboard');
          return;
        }
        setGameStatus(data.status);

        const isNewQuestion = data.current_question && (
          data.current_question.id !== lastQId.current ||
          data.current_question_index !== qIndexRef.current
        );

        if (isNewQuestion && (data.status === 'active' || data.status === 'waiting')) {
          handleNewQuestion(
            data.current_question,
            data.current_question_index,
            data.total_questions,
            data.question_started_at,
            data.state_version
          );
        } else if (data.current_question) {
          if (data.question_started_at) {
            questionStartedAtRef.current = data.question_started_at;
          }
          if (data.state_version) {
            currentVersionRef.current = data.state_version;
          }
          if (data.question_state === 'revealed' && !isRevealedRef.current) {
            triggerReveal(data.current_question.correct_choice_id);
          }
        }
      } catch {}
    };

    const scheduleNext = () => {
      if (!isMounted) return;
      const startedAt = questionStartedAtRef.current;
      const limit = timeLimitRef.current || 20;
      const now = serverNow();

      let delay = 1000;
      if (gameStatusRef.current === 'active' && !isRevealedRef.current && startedAt) {
        delay = 2000;

        // Extra poll shortly before deadline
        const remaining = limit - (now - startedAt) / 1000;
        if (remaining > 0.8 && remaining < 2.5 && !preDeadlinePolledRef.current) {
          delay = Math.max(300, Math.round((remaining - 0.5) * 1000));
          preDeadlinePolledRef.current = true;
        }
      }

      pollTimer = setTimeout(async () => {
        if (isMounted && !isPolling) {
          isPolling = true;
          try {
            if (!document.hidden) {
              await pollState();
            }
          } finally {
            isPolling = false;
            scheduleNext();
          }
        } else {
          scheduleNext();
        }
      }, delay);
    };

    pollState().then(scheduleNext);

    const onVisibility = () => {
      if (!document.hidden && isMounted) {
        pollState();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [session, handleNewQuestion, setMode]);

  // After reveal => fetch mid-game leaderboard after 3 seconds
  useEffect(() => {
    if (!isRevealed) return;
    midBoardTimer.current = setTimeout(async () => {
      try {
        const lb = await get(`/sessions/${session.pin}/leaderboard`);
        const board = lb.leaderboard || [];
        setMidLeaderboard(board);
        const idx = board.findIndex(p => p.id === player.id);
        setMyRank(idx >= 0 ? idx + 1 : null);
        const myP = board.find(p => p.id === player.id);
        if (myP && myP.score !== undefined) {
          setPlayer(p => ({ ...p, score: myP.score }));
        }
        setShowMidBoard(true);
        sfx.play('join');
      } catch {}
    }, 3000);
    return () => { if (midBoardTimer.current) clearTimeout(midBoardTimer.current); };
  }, [isRevealed, session, player, setPlayer]);

  async function triggerReveal(revealedCorrectId = null) {
    setIsRevealed(true);
    if (revealedCorrectId) {
      setCorrectChoiceId(revealedCorrectId);
    }
    // If request is still in-flight, wait for it so we don't prematurely show 'Wrong'!
    if (submittingRef.current && pendingPromiseRef.current) {
      try {
        await pendingPromiseRef.current;
      } catch {}
    }

    // If result was already received with is_correct (legacy mode), apply it
    const res = pendingResultRef.current;
    if (res && res.is_correct !== undefined) {
      applyResultSoundAndScore(res);
      return;
    }

    // Secure mode: Fetch authenticated result from /my-result
    const activeToken = player?.token || getPlayerAuth(session?.pin)?.token;
    try {
      const myRes = await playerGet(session.pin, `/sessions/${session.pin}/my-result`, activeToken);
      if (myRes) {
        if (myRes.correct_choice_id) {
          setCorrectChoiceId(myRes.correct_choice_id);
        }
        pendingResultRef.current = myRes;
        setPendingResult(myRes);
        applyResultSoundAndScore(myRes);
        return;
      }
    } catch (e) {
      if (e?.status === 403) {
        clearPlayerAuth(session?.pin);
        setNotice('انتهت صلاحية جلستك، يرجى الانضمام مجدداً');
        setMode('student-join');
        return;
      }
    }

    if (selected === null && !playedSound.current) {
      // Time expired without answering
      playedSound.current = true;
      sfx.play('wrong');
    }
  }

  async function submitAnswer(choiceId) {
    if (selected !== null || isRevealed || isLeadPeriod || timerDisplay <= 0) return;
    sfx.play('click');
    setSelected(choiceId);
    submittingRef.current = true;

    // Send client time_taken for backward compatibility; server computes authoritatively
    const startedAt = questionStartedAtRef.current || serverNow();
    const clientTimeTaken = Math.max(0, (serverNow() - startedAt) / 1000);
    const activeToken = player?.token || getPlayerAuth(session?.pin)?.token;

    const prom = playerPost(session.pin, `/sessions/${session.pin}/answer`, {
      player_id: player.id,
      choice_id: choiceId,
      time_taken: clientTimeTaken,
    }, activeToken);
    pendingPromiseRef.current = prom;

    try {
      const data = await prom;
      submittingRef.current = false;
      if (data && data.is_correct !== undefined) {
        // Legacy mode (QUIZ_REVEAL_ON_ANSWER=true)
        pendingResultRef.current = data;
        setPendingResult(data);
        if (data.correct_choice_id) {
          setCorrectChoiceId(data.correct_choice_id);
        }
        if (isRevealed) {
          applyResultSoundAndScore(data);
        }
      } else {
        // Secure mode (QUIZ_REVEAL_ON_ANSWER=false): result fetched upon reveal
        pendingResultRef.current = { accepted: true };
        setPendingResult({ accepted: true });
      }
    } catch (e) {
      submittingRef.current = false;
      if (e?.status === 403) {
        clearPlayerAuth(session?.pin);
        setNotice('انتهت صلاحية جلستك، يرجى الانضمام مجدداً');
        setMode('student-join');
        return;
      }
      // Handle other 4xx rejection gracefully (treat as time's up / locked out without crashing)
      const errRes = { is_correct: false, points_earned: 0, total_score: player?.score || 0 };
      pendingResultRef.current = errRes;
      setPendingResult(errRes);
      if (isRevealed) {
        applyResultSoundAndScore(errRes);
      }
    }
  }

  if (!question) {
    return (
      <main className="loading-state-box">
        <div className="game-loader">
          <Gamepad2 size={48} className="spin-bounce" />
          <h2>جاري تحضير السؤال... استعد!</h2>
        </div>
      </main>
    );
  }

  if (gameStatus === 'paused') {
    return (
      <main className="student-waiting-arena">
        <div className="wait-portal-card paused-state">
          <Pause size={54} className="pause-icon-big" />
          <h1>المسابقة متوقفة مؤقتاً</h1>
          <p>أوقف المعلم الجولة مؤقتاً لمراجعة الشرح... استعد للاستئناف!</p>
        </div>
      </main>
    );
  }

  // ═══ MID-GAME LEADERBOARD OVERLAY ═══
  if (showMidBoard) {
    const RANK_EMOJIS = ['🥇', '🥈', '🥉'];
    const RANK_COLORS = ['#fbbf24', '#94a3b8', '#f97316'];
    const RANK_LABELS = ['الأول', 'الثاني', 'الثالث'];

    return (
      <main className="mid-board-container">
        <CosmicDecorations />

        <div className="mid-board-hero">
          <div className="mid-board-badge-row">
            <div className="mid-board-badge">
              <Trophy size={18} />
              <span>ترتيب الأبطال بعد السؤال {qNumber} من {totalQ}</span>
            </div>
          </div>

          <h1 className="mid-board-title">من يتصدّر المنافسة؟ 🏆</h1>
          <p className="mid-board-subtitle">
            {myRank === 1
              ? '🌟 أحسنت! أنت في المركز الأول حالياً!'
              : myRank
                ? `أنت في المركز #${myRank} الآن - اقترب من القمة! 💪`
                : 'استمر في التنافس!'}
          </p>
        </div>

        {/* Top 3 Mini Podium */}
        {midLeaderboard.length >= 1 && (
          <div className="mid-podium-row">
            {/* 2nd */}
            <div className="mid-podium-slot mid-slot-2">
              {midLeaderboard[1] ? (
                <>
                  <div className="mid-pod-emoji-ring" style={{ borderColor: RANK_COLORS[1] }}>
                    <span><AvatarDisplay avatarId={midLeaderboard[1].avatar} /></span>
                  </div>
                  <span className="mid-pod-rank" style={{ background: RANK_COLORS[1] }}>🥈</span>
                  <strong className="mid-pod-name">{midLeaderboard[1].name}</strong>
                  <span className="mid-pod-score">{midLeaderboard[1].score.toLocaleString()} XP</span>
                </>
              ) : (
                <div className="mid-pod-empty">🥈</div>
              )}
            </div>

            {/* 1st */}
            <div className="mid-podium-slot mid-slot-1">
              {midLeaderboard[0] && (
                <>
                  <span className="mid-pod-crown">👑</span>
                  <div className="mid-pod-emoji-ring mid-ring-gold" style={{ borderColor: RANK_COLORS[0] }}>
                    <span><AvatarDisplay avatarId={midLeaderboard[0].avatar} /></span>
                  </div>
                  <span className="mid-pod-rank" style={{ background: RANK_COLORS[0], color: '#1e1b4b' }}>🥇</span>
                  <strong className="mid-pod-name mid-name-gold">{midLeaderboard[0].name}</strong>
                  <span className="mid-pod-score mid-score-gold">{midLeaderboard[0].score.toLocaleString()} XP</span>
                </>
              )}
            </div>

            {/* 3rd */}
            <div className="mid-podium-slot mid-slot-3">
              {midLeaderboard[2] ? (
                <>
                  <div className="mid-pod-emoji-ring" style={{ borderColor: RANK_COLORS[2] }}>
                    <span><AvatarDisplay avatarId={midLeaderboard[2].avatar} /></span>
                  </div>
                  <span className="mid-pod-rank" style={{ background: RANK_COLORS[2] }}>🥉</span>
                  <strong className="mid-pod-name">{midLeaderboard[2].name}</strong>
                  <span className="mid-pod-score">{midLeaderboard[2].score.toLocaleString()} XP</span>
                </>
              ) : (
                <div className="mid-pod-empty">🥉</div>
              )}
            </div>
          </div>
        )}

        {/* Full list (rest of players) */}
        {midLeaderboard.length > 3 && (
          <div className="mid-board-list-card">
            {midLeaderboard.slice(3).map((p, idx) => {
              const rank = idx + 4;
              const isMe = player && p.id === player.id;
              return (
                <div key={p.id} className={`mid-list-row ${isMe ? 'mid-list-me' : ''}`}>
                  <span className="mlr-rank">#{rank}</span>
                  <span className="mlr-emoji"><AvatarDisplay avatarId={p.avatar} /></span>
                  <span className="mlr-name">{p.name} {isMe && '⭐'}</span>
                  <strong className="mlr-score">{p.score.toLocaleString()} XP</strong>
                </div>
              );
            })}
          </div>
        )}

        {/* My position highlight (if not in top 3) */}
        {myRank && myRank > 3 && (
          <div className="mid-board-my-position">
            <div className="mbmp-inner">
              <span className="mbmp-emoji"><AvatarDisplay avatarId={player.avatar} /></span>
              <div className="mbmp-info">
                <strong>أنت · {player.name}</strong>
                <span>المركز #{myRank}</span>
              </div>
              <div className="mbmp-score">
                <Zap size={16} fill="currentColor" />
                <strong>{(player.score || 0).toLocaleString()} XP</strong>
              </div>
            </div>
          </div>
        )}

        <div className="mid-board-wait-hint">
          <Clock3 size={16} className="spin-bounce" />
          <span>في انتظار السؤال التالي من المعلم...</span>
        </div>
      </main>
    );
  }

  const effectiveCorrectId = correctChoiceId || pendingResult?.correct_choice_id;

  return (
    <main className="play-arena-container">
      {/* Top Status & Timer Bar */}
      <div className="arena-top-hud">
        <div className="hud-q-counter">
          <span>السؤال</span>
          <strong>{qNumber}</strong>
          <small>/ {totalQ}</small>
        </div>

        {/* Circular Countdown Timer */}
        <div className={`countdown-clock ${timerDisplay <= 5 && !isRevealed && !isLeadPeriod ? 'is-urgent' : ''} ${isRevealed ? 'time-finished' : ''} ${isLeadPeriod ? 'is-lead' : ''}`}>
          <Clock3 size={20} />
          <span className="clock-number">{isRevealed ? 'انتهى الوقت' : isLeadPeriod ? 'استعد...' : `${timerDisplay}s`}</span>
        </div>

        <div className="hud-streak-chip">
          <Flame size={18} fill="currentColor" className="flame-icon" />
          <span>سلسلة: {player.streak || 0}</span>
        </div>
      </div>

      {/* Main Big Question Box */}
      <div className="big-question-stage">
        <div className="bqs-badge">
          <CircleHelp size={16} /> سؤال التحدي
        </div>
        <h2 className="bqs-title">{question.question_text}</h2>
        {question.question_text_ar && (
          <p className="bqs-arabic" dir="rtl">{question.question_text_ar}</p>
        )}
      </div>

      {/* 4 Giant Kahoot-Style Answer Buttons */}
      <div className="kahoot-answers-grid">
        {question.choices.map((c, i) => {
          const isSelected = selected === c.id;
          const isCorrect = isRevealed && effectiveCorrectId === c.id;
          const isWrong = isRevealed && isSelected && !pendingResult?.is_correct;
          const shape = SHAPES[i] || SHAPES[0];

          return (
            <button
              key={c.id}
              className={`kahoot-btn tone-${shape.color} ${isSelected ? 'selected-btn' : ''} ${isCorrect ? 'correct-btn' : ''} ${isWrong ? 'wrong-btn' : ''}`}
              onClick={() => submitAnswer(c.id)}
              disabled={selected !== null || timerDisplay <= 0 || isRevealed || isLeadPeriod}
            >
              <div className="shape-disc">{shape.symbol}</div>
              <div className="kahoot-text-box">
                <span className="k-choice-main">{c.choice_text}</span>
                {c.choice_text_ar && <small className="k-choice-sub">{c.choice_text_ar}</small>}
              </div>

              {/* During answering: show simple check that answer was selected */}
              {isSelected && !isRevealed && (
                <CheckCircle2 size={28} className="pick-checkmark" />
              )}
              {/* After reveal: show checkmark for correct answer */}
              {isCorrect && (
                <CheckCheck size={32} className="reveal-check-icon" />
              )}
            </button>
          );
        })}
      </div>

      {/* State 1: Answer submitted, waiting for time to expire or teacher to reveal */}
      {selected !== null && !isRevealed && (
        <div className="answer-locked-banner">
          <Clock3 size={24} className="spin-bounce" />
          <div className="alb-text">
            <strong>تم تأكيد إجابتك بنجاح! 🔒</strong>
            <p>النتيجة والإجابة الصحيحة ستظهر للجميع أول ما الوقت يخلص أو يكشفها المعلم ⏳</p>
          </div>
        </div>
      )}

      {/* State 2: Time up or Teacher revealed -> Show full correction */}
      {isRevealed && (
        <div className={`answer-feedback-popup ${
          pendingResult
            ? (pendingResult.is_correct ? 'feedback-correct' : 'feedback-wrong')
            : (selected !== null ? 'feedback-verifying' : 'feedback-wrong')
        }`}>
          <div className="feedback-content">
            {pendingResult?.is_correct ? (
              <>
                <div className="feedback-icon-bubble">🎉</div>
                <div className="feedback-text">
                  <h3>إجابة صحيحة وعبقرية!</h3>
                  <p>كسبت <strong>+{pendingResult.points_earned}</strong> نقطة XP ⚡</p>
                </div>
              </>
            ) : selected !== null && !pendingResult ? (
              <>
                <div className="feedback-icon-bubble">⏳</div>
                <div className="feedback-text">
                  <h3>جاري التحقق واحتساب النتيجة...</h3>
                  <p>لحظات ويتم تسجيل نقاطك في لوحة المنافسة ⚡</p>
                </div>
              </>
            ) : selected !== null ? (
              <>
                <div className="feedback-icon-bubble">💪</div>
                <div className="feedback-text">
                  <h3>إجابة غير صحيحة!</h3>
                  <p>الإجابة الصحيحة موضحة باللون الأخضر أعلاه. ركّز في السؤال القادم!</p>
                </div>
              </>
            ) : (
              <>
                <div className="feedback-icon-bubble">⏰</div>
                <div className="feedback-text">
                  <h3>انتهى الوقت دون اختيار إجابة!</h3>
                  <p>الإجابة الصحيحة موضحة باللون الأخضر. استعد للسؤال القادم!</p>
                </div>
              </>
            )}
          </div>
          <div className="feedback-score-total">
            مجموع نقاطك: <strong>{(pendingResultRef.current?.total_score ?? pendingResult?.total_score ?? player?.score ?? 0).toLocaleString()} XP</strong>
          </div>
        </div>
      )}

      {/* Bottom Floating Player Bar */}
      <div className="bottom-student-bar">
        <div className="bsb-avatar"><AvatarDisplay avatarId={player.avatar} /></div>
        <div className="bsb-info">
          <strong>{player.name}</strong>
          <span>{getAvatar(player.avatar).name}</span>
        </div>
        <div className="bsb-xp">
          <Zap size={16} fill="currentColor" />
          <strong>{(pendingResultRef.current?.total_score ?? pendingResult?.total_score ?? player?.score ?? 0).toLocaleString()} XP</strong>
        </div>
      </div>
    </main>
  );
}

/* ══════════════════════ ESPORTS HALL OF FAME LEADERBOARD ══════════════════════ */
function Leaderboard({ session, setMode, player }) {
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState('individual');
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [showAllPlayers, setShowAllPlayers] = useState(false);

  const pin = session?.pin || '123456';

  // Audio & confetti celebration
  const blastAnthem = useCallback(() => {
    sfx.play('win');
    try {
      confetti({
        particleCount: 80,
        spread: 100,
        origin: { y: 0.6 },
        colors: ['#fbbf24', '#f59e0b', '#38bdf8', '#06b6d4', '#ec4899', '#c084fc']
      });
      setTimeout(() => {
        confetti({
          particleCount: 50,
          angle: 60,
          spread: 70,
          origin: { x: 0.1, y: 0.7 },
          colors: ['#fbbf24', '#f59e0b', '#fde047']
        });
        confetti({
          particleCount: 50,
          angle: 120,
          spread: 70,
          origin: { x: 0.9, y: 0.7 },
          colors: ['#38bdf8', '#818cf8', '#c084fc']
        });
      }, 250);
    } catch {}
  }, []);

  const fetchResults = useCallback(async () => {
    try {
      const data = await get(`/sessions/${pin}/results`);
      if (data && data.results) {
        setResults(data);
        setTimeout(blastAnthem, 400);
        return;
      }
    } catch {}

    // Fallback: poll session
    try {
      const pollData = await get(`/sessions/${pin}/poll`);
      setResults({
        title: session?.title || pollData?.title || 'Tecorbi Game 🎮',
        total_questions: pollData?.total_questions || 3,
        total_players: pollData?.player_count || 3,
        results: []
      });
      setTimeout(blastAnthem, 400);
    } catch {
      // Guaranteed fallback so podium never hangs
      setResults({
        title: session?.title || 'منصة أبطال المسابقة 🏆',
        total_questions: 3,
        total_players: 3,
        results: []
      });
      setTimeout(blastAnthem, 400);
    }
  }, [pin, session, blastAnthem]);

  useEffect(() => {
    sfx.play('win');
    fetchResults();

    const unsubscribe = subscribeToSession(pin, {
      ResultsRevealed: (data) => {
        if (data && data.results) {
          setResults(data);
          setTimeout(blastAnthem, 400);
        }
      },
      SessionReset: () => {
        setMode('home');
      },
    });

    const emergencyUnlock = setTimeout(() => {
      setResults(prev => prev || {
        title: session?.title || 'منصة أبطال المسابقة 🏆',
        total_questions: 3,
        total_players: 3,
        results: []
      });
    }, 2800);

    return () => {
      unsubscribe();
      clearTimeout(emergencyUnlock);
    };
  }, [fetchResults, session, pin, blastAnthem, setMode]);

  if (!results) {
    return (
      <main className="loading-state-box">
        <div className="game-loader">
          <Trophy size={56} className="spin-bounce gold-color" />
          <h2>جاري تتويج الأبطال وحساب منصة التكريم... 🏆</h2>
          <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
            <button
              className="btn-3d"
              onClick={() => setResults({
                title: session?.title || 'منصة أبطال المسابقة 🏆',
                total_questions: 3,
                total_players: 3,
                results: []
              })}
              style={{ padding: '8px 18px', fontSize: '13px' }}
            >
              عرض المنصة مباشرة 🚀
            </button>
            <button
              className="btn-3d"
              onClick={() => setMode('home')}
              style={{ padding: '8px 18px', fontSize: '13px', background: 'rgba(255,255,255,0.1)' }}
            >
              الرئيسية 🏠
            </button>
          </div>
        </div>
      </main>
    );
  }

  const allPlayers = results.results || [];

  // Helper to enrich player with level, accuracy, avg speed and role
  const enrichPlayer = (p, defaultRank, fallbackData) => {
    if (!p) {
      return {
        id: `mock-${defaultRank}`,
        name: fallbackData.name,
        role: fallbackData.role,
        avatar: fallbackData.avatar,
        score: fallbackData.score,
        level: fallbackData.level,
        accuracy: fallbackData.accuracy,
        avgTime: fallbackData.avgTime,
        isMock: true,
      };
    }
    const avatarObj = getAvatar(p.avatar);
    const scoreVal = p.score || 0;
    const calcLevel = Math.max(1, Math.floor(scoreVal / 450) + 1);
    const calcAccuracy = p.accuracy ?? (p.total_answers > 0 ? Math.round((p.correct_answers / p.total_answers) * 100) : 95);
    const speedFallback = defaultRank === 1 ? '0.9s' : defaultRank === 2 ? '1.1s' : '1.4s';

    return {
      ...p,
      role: avatarObj.role || (defaultRank === 1 ? 'CHAMPION' : defaultRank === 2 ? 'CREATIVE MASTER' : 'GALAXY SCOUT'),
      level: calcLevel,
      accuracy: calcAccuracy,
      avgTime: p.avg_time ? `${p.avg_time}s` : speedFallback,
      isMock: false,
    };
  };

  // Top 3 Podium slots (with companion bots matching user's image if testing alone)
  const top1 = enrichPlayer(allPlayers[0], 1, {
    name: 'عمر النجم',
    role: 'OMAR THE STAR',
    avatar: 'astronaut',
    score: 9450,
    level: 22,
    accuracy: 100,
    avgTime: '0.9s',
  });

  const top2 = enrichPlayer(allPlayers[1], 2, {
    name: 'سارة المبدعة',
    role: 'SARAH CREATIVE',
    avatar: 'artist',
    score: 8820,
    level: 18,
    accuracy: 95,
    avgTime: '1.1s',
  });

  const top3 = enrichPlayer(allPlayers[2], 3, {
    name: 'ريان البطل',
    role: 'RAYAN HERO',
    avatar: 'superhero',
    score: 7990,
    level: 15,
    accuracy: 90,
    avgTime: '1.4s',
  });

  // Remaining challengers (rank 4+) or all players
  const restPlayers = allPlayers.slice(3).map((p, idx) => enrichPlayer(p, idx + 4, {}));
  const displayChallengers = showAllPlayers ? allPlayers.map((p, idx) => enrichPlayer(p, idx + 1, {})) : restPlayers;

  // Filtered challengers
  const filteredChallengers = displayChallengers.filter(p => {
    if (selectedFilter === 'perfect') return p.accuracy === 100;
    if (selectedFilter === 'speed') return parseFloat(p.avgTime) <= 1.2;
    if (selectedFilter === 'brain') return p.level >= 10;
    if (selectedFilter === 'streak') return (p.streak || 0) >= 3;
    return true;
  });

  const resetGame = async () => {
    sfx.play('click');
    try {
      await teacherPost(session.pin, `/sessions/${session.pin}/reset`);
      setMode('home');
    } catch {
      setMode('home');
    }
  };

  return (
    <main className="hof-universe">
      {/* ── Top Header Section (matches reference image) ── */}
      <header className="hof-header">
        <div className="hof-header-left">
          <div className="hof-session-badge">
            <span className="pulse-dot-amber" />
            <span>SESSION COMPLETED • PIN #{session.pin}</span>
          </div>
          <h1 className="hof-main-title">Final Match Champions Podium</h1>
          <p className="hof-subtitle">
            {results.title || 'Grade 6-B Science Arena'} • {results.total_questions || 5} Rounds Solved • {Math.max(allPlayers.length, 3)} Combatants
          </p>
        </div>

        <div className="hof-header-right">
          <div className="hof-tabs-segmented" role="tablist">
            <button
              className={`hof-tab-pill ${activeTab === 'individual' ? 'is-active' : ''}`}
              onClick={() => { sfx.play('click'); setActiveTab('individual'); }}
            >
              <Users size={14} />
              <span>Individual Arena</span>
            </button>
            <button
              className={`hof-tab-pill ${activeTab === 'team' ? 'is-active' : ''}`}
              onClick={() => { sfx.play('click'); setActiveTab('team'); }}
            >
              <Shield size={14} />
              <span>Team Guilds</span>
            </button>
          </div>

          <button className="btn-anthem-chime" onClick={blastAnthem} title="تشغيل احتفال الأبطال وإطلاق الكونفيتي">
            <Sparkles size={16} />
            <span>Blast Anthem Chime</span>
          </button>
        </div>
      </header>

      {/* ── Official Hall of Fame Glass Card (matches reference image) ── */}
      <section className="hof-stage-card">
        {/* Top Center Tag */}
        <div className="hof-center-badge">
          <Award size={15} />
          <span>OFFICIAL HALL OF FAME</span>
        </div>

        {/* The 3 Podium Columns: Left #2 (Silver), Center #1 (Champion), Right #3 (Bronze) */}
        <div className="hof-podium-grid">
          {/* ═══════ Column #2: Silver (Left) ═══════ */}
          <div className="hof-column col-silver">
            <div className="hof-rank-badge badge-silver">
              <Trophy size={13} />
              <span>#2 SILVER</span>
            </div>

            <div className="hof-avatar-anchor">
              <div className="hof-avatar-circle circle-silver">
                {getAvatar(top2.avatar).image ? (
                  <img src={getAvatar(top2.avatar).image} alt={top2.name} className="hof-avatar-3d-champ" />
                ) : (
                  <span className="hof-avatar-emoji">{getAvatar(top2.avatar).emoji}</span>
                )}
              </div>
              <span className="hof-corner-pin pin-silver" title="Silver Medal">🥈</span>
            </div>

            <div className="hof-player-info">
              <strong className="hof-player-name">{top2.name}</strong>
              <span className="hof-player-role role-silver">{top2.role}</span>
              <div className="hof-score-chip chip-silver">
                <strong>{top2.score.toLocaleString()} XP</strong>
                <span className="hof-dot">•</span>
                <span>Lvl {top2.level}</span>
              </div>
            </div>

            {/* Stat row above podium */}
            <div className="hof-stats-row">
              <span className="stat-label">ACCURACY: {top2.accuracy}%</span>
              <span className="stat-label">AVG: {top2.avgTime}</span>
            </div>

            {/* Solid Dark Podium Block #2 with Neon Cyan bottom bar */}
            <div className="hof-podium-block block-silver">
              <span className="hof-block-number">2</span>
              <div className="hof-neon-bar bar-silver" />
            </div>
          </div>

          {/* ═══════ Column #1: Champion (Center - Tallest) ═══════ */}
          <div className="hof-column col-champion">
            <div className="hof-rank-badge badge-champion">
              <Crown size={15} />
              <span>#1 CHAMPION</span>
            </div>

            <div className="hof-avatar-anchor">
              <div className="hof-avatar-circle circle-champion">
                <span className="champion-gold-aura" />
                {getAvatar(top1.avatar).image ? (
                  <img src={getAvatar(top1.avatar).image} alt={top1.name} className="hof-avatar-3d-champ" />
                ) : (
                  <span className="hof-avatar-emoji emoji-champ">{getAvatar(top1.avatar).emoji}</span>
                )}
              </div>
              <span className="hof-corner-pin pin-gold" title="Gold Star">⭐</span>
            </div>

            <div className="hof-player-info">
              <strong className="hof-player-name name-champion">{top1.name}</strong>
              <span className="hof-player-role role-champion">{top1.role}</span>
              <div className="hof-score-chip chip-champion">
                <strong>{top1.score.toLocaleString()} XP</strong>
                <span className="hof-dot">•</span>
                <span>Lvl {top1.level}</span>
              </div>
            </div>

            {/* Stat row above champion podium */}
            <div className="hof-stats-row row-champion">
              <span className="stat-pill-perfect">
                {top1.accuracy === 100 ? `${results.total_questions}/${results.total_questions} PERFECT` : `ACCURACY: ${top1.accuracy}%`}
              </span>
              <span className="stat-label gold-label">
                AVG: {top1.avgTime} <Zap size={13} fill="currentColor" />
              </span>
            </div>

            {/* Solid Dark Podium Block #1 with Glowing Golden bottom bar */}
            <div className="hof-podium-block block-champion">
              <span className="hof-block-number num-champion">1</span>
              <div className="hof-neon-bar bar-champion" />
            </div>
          </div>

          {/* ═══════ Column #3: Bronze (Right) ═══════ */}
          <div className="hof-column col-bronze">
            <div className="hof-rank-badge badge-bronze">
              <Shield size={13} />
              <span>#3 BRONZE</span>
            </div>

            <div className="hof-avatar-anchor">
              <div className="hof-avatar-circle circle-bronze">
                {getAvatar(top3.avatar).image ? (
                  <img src={getAvatar(top3.avatar).image} alt={top3.name} className="hof-avatar-3d-champ" />
                ) : (
                  <span className="hof-avatar-emoji">{getAvatar(top3.avatar).emoji}</span>
                )}
              </div>
              <span className="hof-corner-pin pin-bronze" title="Bronze Bolt">⚡</span>
            </div>

            <div className="hof-player-info">
              <strong className="hof-player-name">{top3.name}</strong>
              <span className="hof-player-role role-bronze">{top3.role}</span>
              <div className="hof-score-chip chip-bronze">
                <strong>{top3.score.toLocaleString()} XP</strong>
                <span className="hof-dot">•</span>
                <span>Lvl {top3.level}</span>
              </div>
            </div>

            {/* Stat row above podium */}
            <div className="hof-stats-row">
              <span className="stat-label">ACCURACY: {top3.accuracy}%</span>
              <span className="stat-label">AVG: {top3.avgTime}</span>
            </div>

            {/* Solid Dark Podium Block #3 with Neon Amber bottom bar */}
            <div className="hof-podium-block block-bronze">
              <span className="hof-block-number">3</span>
              <div className="hof-neon-bar bar-bronze" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Live Challenger Rankings (Ranks 4+) Section (matches reference image) ── */}
      <section className="hof-challengers-card">
        <div className="hcs-header">
          <div className="hcs-title-box">
            <Target size={18} className="gold-color" />
            <h3>Live Challenger Rankings {showAllPlayers ? '(جميع المتسابقين)' : '(Ranks 4+)'}</h3>
            <span className="hcs-count-tag">{allPlayers.length} أبطال</span>
          </div>

          <div className="hcs-filter-chips">
            <button
              className={`hcs-chip ${selectedFilter === 'all' ? 'active-chip' : ''}`}
              onClick={() => setSelectedFilter('all')}
            >
              الكل
            </button>
            <button
              className={`hcs-chip chip-speed ${selectedFilter === 'speed' ? 'active-chip' : ''}`}
              onClick={() => setSelectedFilter(selectedFilter === 'speed' ? 'all' : 'speed')}
            >
              ⚡ Lightning Fast (&lt;1.5s)
            </button>
            <button
              className={`hcs-chip chip-brain ${selectedFilter === 'brain' ? 'active-chip' : ''}`}
              onClick={() => setSelectedFilter(selectedFilter === 'brain' ? 'all' : 'brain')}
            >
              🧠 Einstein Brain
            </button>
            <button
              className={`hcs-chip chip-streak ${selectedFilter === 'streak' ? 'active-chip' : ''}`}
              onClick={() => setSelectedFilter(selectedFilter === 'streak' ? 'all' : 'streak')}
            >
              🔥 5-Streak
            </button>
            <button
              className={`hcs-chip chip-perfect ${selectedFilter === 'perfect' ? 'active-chip' : ''}`}
              onClick={() => setSelectedFilter(selectedFilter === 'perfect' ? 'all' : 'perfect')}
            >
              🎯 100% Accuracy
            </button>
          </div>
        </div>

        {/* Challenger List */}
        <div className="hcs-table-body">
          {filteredChallengers.length > 0 ? (
            filteredChallengers.map((p, idx) => {
              const isMe = player && p.id === player.id;
              const displayRank = showAllPlayers ? (p.rank || idx + 1) : idx + 4;
              return (
                <div key={p.id || idx} className={`hcs-row ${isMe ? 'is-me-row' : ''}`}>
                  <div className="hcs-rank-col">
                    <span className="hcs-rank-pill">#{displayRank}</span>
                  </div>

                  <div className="hcs-player-col">
                    <div className="hcs-avatar-mini"><AvatarDisplay avatarId={p.avatar} /></div>
                    <div className="hcs-names">
                      <strong>{p.name} {isMe && <span className="hcs-me-tag">أنت ⭐</span>}</strong>
                      <small>{p.role || getAvatar(p.avatar).role}</small>
                    </div>
                  </div>

                  <div className="hcs-level-col">
                    <span className="hcs-lvl-chip">Lvl {p.level || 5}</span>
                  </div>

                  <div className="hcs-acc-col">
                    <div className="hcs-acc-track">
                      <div className="hcs-acc-fill" style={{ width: `${p.accuracy}%` }} />
                    </div>
                    <span className="hcs-acc-text">{p.accuracy}%</span>
                  </div>

                  <div className="hcs-speed-col">
                    <span>{p.avgTime || '1.2s'}</span>
                  </div>

                  <div className="hcs-score-col">
                    <strong>{(p.score || 0).toLocaleString()}</strong>
                    <small>XP</small>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="hcs-empty-state">
              <Trophy size={32} />
              <p>الثلاثة الأوائل يتصدرون المنصة الشرفية بالأعلى! 🏆</p>
              <button className="hcs-toggle-btn" onClick={() => setShowAllPlayers(true)}>
                عرض جدول جميع المتسابقين
              </button>
            </div>
          )}
        </div>

        {restPlayers.length > 0 && !showAllPlayers && (
          <div className="hcs-footer-toggle">
            <button className="hcs-toggle-btn" onClick={() => setShowAllPlayers(true)}>
              عرض كل المتسابقين بالكامل ({allPlayers.length})
            </button>
          </div>
        )}
      </section>

      {/* ── Footer Action Buttons ── */}
      <footer className="hof-actions-footer">
        <button className="btn-hof btn-hof-home" onClick={() => { sfx.play('click'); setMode('home'); }}>
          <ArrowLeft size={18} />
          <span>العودة للصفحة الرئيسية</span>
        </button>

        <button className="btn-hof btn-hof-reset" onClick={resetGame}>
          <RotateCcw size={18} />
          <span>إعادة تشغيل المسابقة 🔄</span>
        </button>
      </footer>
    </main>
  );
}

/* ── Mount ── */
createRoot(document.getElementById('root')).render(<App />);



