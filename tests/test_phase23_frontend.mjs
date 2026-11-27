/**
 * Phase 2.3 Real Frontend Component & Mounted Lifecycle Regression Tests
 *
 * 1. Compiles actual `resources/js/app.jsx` to `os.tmpdir()` via esbuild (no temp files in repo),
 *    resolving workspace node_modules to absolute paths.
 * 2. Tests BOTH SSR markup (`renderToStaticMarkup`) AND full **mounted** React lifecycle
 *    (`react-dom/client` `createRoot` + `React.act` + in-memory DOM + controlled `fetch`)
 *    covering non-unmount PIN switches, delayed stale responses, empty/error states, and real loads.
 *
 * Run: node --test tests/test_phase23_frontend.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// ── Minimal In-Memory DOM for Real React 18 createRoot Mounting in Node ──
function createFakeDom() {
  class FakeNode {
    constructor(nodeType, nodeName = '') {
      this.nodeType = nodeType;
      this.nodeName = nodeName;
      this.childNodes = [];
      this.parentNode = null;
      this.ownerDocument = null;
      this._text = '';
    }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    get nextSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx >= 0 && idx + 1 < this.parentNode.childNodes.length ? this.parentNode.childNodes[idx + 1] : null;
    }
    get previousSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx > 0 ? this.parentNode.childNodes[idx - 1] : null;
    }
    get nodeValue() { return this._text; }
    set nodeValue(v) { this._text = String(v ?? ''); }
    get textContent() {
      if (this.nodeType === 3) return this._text;
      if (this.nodeType === 8) return '';
      return this.childNodes.map(c => c.textContent).join('');
    }
    set textContent(v) {
      if (this.nodeType === 3) { this._text = String(v ?? ''); return; }
      this.childNodes.forEach(c => { c.parentNode = null; });
      this.childNodes = [];
      if (v !== '' && v != null) {
        const t = new FakeText(String(v));
        t.ownerDocument = this.ownerDocument;
        this.appendChild(t);
      }
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(newChild, refChild) {
      if (!refChild) return this.appendChild(newChild);
      if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
      const idx = this.childNodes.indexOf(refChild);
      newChild.parentNode = this;
      if (idx === -1) this.childNodes.push(newChild);
      else this.childNodes.splice(idx, 0, newChild);
      return newChild;
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx >= 0) {
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
  }

  class FakeText extends FakeNode {
    constructor(text) { super(3, '#text'); this._text = String(text ?? ''); }
  }
  class FakeComment extends FakeNode {
    constructor(text) { super(8, '#comment'); this._text = String(text ?? ''); }
  }
  class FakeElement extends FakeNode {
    constructor(tagName) {
      super(1, String(tagName).toUpperCase());
      this.tagName = String(tagName).toUpperCase();
      this.attributes = new Map();
      this.style = {};
      this.listeners = new Map();
      this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    }
    get className() { return this.attributes.get('class') || ''; }
    set className(v) { this.attributes.set('class', String(v ?? '')); }
    get id() { return this.attributes.get('id') || ''; }
    set id(v) { this.attributes.set('id', String(v ?? '')); }
    setAttribute(k, v) { this.attributes.set(String(k), String(v ?? '')); }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
    removeAttribute(k) { this.attributes.delete(String(k)); }
    hasAttribute(k) { return this.attributes.has(String(k)); }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    focus() {}
    querySelectorAll(attrSelector) {
      const matches = [];
      const attrName = attrSelector.replace(/^\[|\]$/g, '');
      const walk = (node) => {
        if (node.nodeType === 1 && node.hasAttribute(attrName)) matches.push(node);
        node.childNodes.forEach(walk);
      };
      walk(this);
      return matches;
    }
  }

  const doc = {
    nodeType: 9,
    documentElement: new FakeElement('html'),
    body: new FakeElement('body'),
    defaultView: null,
    activeElement: null,
    createElement(tag) { const el = new FakeElement(tag); el.ownerDocument = doc; return el; },
    createElementNS(ns, tag) { const el = new FakeElement(tag); el.namespaceURI = ns; el.ownerDocument = doc; return el; },
    createTextNode(txt) { const t = new FakeText(txt); t.ownerDocument = doc; return t; },
    createComment(txt) { const c = new FakeComment(txt); c.ownerDocument = doc; return c; },
    getElementById() { return null; },
    addEventListener() {},
    removeEventListener() {},
  };
  doc.documentElement.ownerDocument = doc;
  doc.body.ownerDocument = doc;
  return doc;
}

const storageMap = () => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
};

const fakeDoc = createFakeDom();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.document = fakeDoc;
globalThis.window = {
  location: { hostname: 'localhost', port: '8000', protocol: 'http:' },
  document: fakeDoc,
  addEventListener: () => {},
  removeEventListener: () => {},
  event: undefined,
  HTMLIFrameElement: class HTMLIFrameElement {},
  HTMLElement: class HTMLElement {},
  Element: class Element {},
};
fakeDoc.defaultView = globalThis.window;
globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3, COMMENT_NODE: 8 };
globalThis.sessionStorage = storageMap();
globalThis.localStorage = storageMap();
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

// Resolve ONLY react and react-dom* explicitly so the compiled bundle in os.tmpdir() shares the exact React instance;
// let esbuild bundle all other workspace deps cleanly with CJS->ESM interop.
const pkgResolvePlugin = {
  name: 'workspace-react-externals',
  setup(b) {
    b.onResolve({ filter: /^(react|react-dom(\/.*)?)$/ }, (args) => {
      const resolved = require.resolve(args.path, { paths: [repoRoot] });
      return {
        path: args.kind === 'require-call' ? resolved : pathToFileURL(resolved).href,
        external: true,
      };
    });
  },
};

const tmpOut = path.join(os.tmpdir(), `tecorbi_app_ssr_${Date.now()}_${process.pid}.mjs`);
let appMod;
try {
  await build({
    entryPoints: [path.resolve(repoRoot, 'resources/js/app.jsx')],
    outfile: tmpOut,
    bundle: true,
    format: 'esm',
    platform: 'node',
    absWorkingDir: repoRoot,
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    banner: {
      js: `import { createRequire as __tecorbiCreateRequire } from 'node:module'; const require = __tecorbiCreateRequire(${JSON.stringify(pathToFileURL(path.join(repoRoot, 'package.json')).href)});`,
    },
    plugins: [pkgResolvePlugin],
    define: {
      'import.meta.env.VITE_REVERB_APP_KEY': '""',
      'import.meta.env.VITE_REVERB_HOST': '""',
      'import.meta.env.VITE_REVERB_PORT': '""',
      'import.meta.env.VITE_REVERB_SCHEME': '""',
      'import.meta.env.DEV': 'false',
    },
  });
  appMod = await import(pathToFileURL(tmpOut).href);
} finally {
  try { fs.unlinkSync(tmpOut); } catch {}
}
const rtMod = await import('../resources/js/realtimeState.js');

const { App, Leaderboard, StudentPlay, TeacherLive } = appMod;
const { buildStudentRestorationState } = rtMod;

const makePlayer = (id, name, score, extra = {}) => ({
  id,
  name,
  avatar: 'ninja',
  score,
  streak: extra.streak ?? 0,
  total_answers: extra.total_answers ?? 2,
  correct_answers: extra.correct_answers ?? 2,
  avg_time: extra.avg_time ?? 1.5,
  accuracy: extra.accuracy ?? 100,
  rank: extra.rank ?? id,
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flushMicrotasks = async (cycles = 6) => {
  for (let i = 0; i < cycles; i++) {
    await Promise.resolve();
  }
};

// ══════════════════════════════════════════════════════════════════════
// MOUNTED LEADERBOARD LIFECYCLE TESTS (Cases 1-7: Non-unmount switch, delayed stale response, empty, failure, success)
// ══════════════════════════════════════════════════════════════════════

test('Mounted Leaderboard: PIN switch without unmount, delayed Session A arrival, empty B, failed B, and valid B load', async () => {
  const realFetch = globalThis.fetch;
  const pendingFetches = new Map();
  globalThis.fetch = (url) => {
    const key = String(url);
    const d = deferred();
    if (!pendingFetches.has(key)) pendingFetches.set(key, []);
    pendingFetches.get(key).push(d);
    return d.promise;
  };

  const container = fakeDoc.createElement('div');
  const root = createRoot(container);

  try {
    // 1. Mount Session A (PIN 111111) and resolve Session A results
    await act(async () => {
      root.render(React.createElement(Leaderboard, { session: { pin: '111111' }, setMode: () => {}, player: null }));
      await flushMicrotasks();
    });

    const reqA = pendingFetches.get('/api/sessions/111111/results').shift();
    assert.ok(reqA, 'Session A fetch should be initiated');

    await act(async () => {
      reqA.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          pin: '111111',
          state_version: 5,
          title: 'Quiz Session A',
          total_questions: 2,
          total_players: 2,
          results: [makePlayer(101, 'AlphaSessionA', 1400), makePlayer(102, 'BetaSessionA', 1100)],
        }),
      });
      await flushMicrotasks();
    });

    assert.match(container.textContent, /AlphaSessionA/);
    assert.match(container.textContent, /BetaSessionA/);

    // 2. Switch PIN to Session B (222222) WITHOUT intermediate unmount
    // Also simulate a delayed/re-requested Session A response still in flight or arriving late
    await act(async () => {
      root.render(React.createElement(Leaderboard, { session: { pin: '222222' }, setMode: () => {}, player: null }));
      await flushMicrotasks();
    });

    // 3. Session A results MUST NEVER be visible under Session B even while Session B is loading
    assert.doesNotMatch(container.textContent, /AlphaSessionA/);
    assert.doesNotMatch(container.textContent, /BetaSessionA/);
    assert.match(container.textContent, /جاري تتويج الأبطال/);

    // 4. Simulate a delayed/stale response carrying Session A PIN arriving AFTER switching to 222222
    const reqB = pendingFetches.get('/api/sessions/222222/results').shift();
    assert.ok(reqB, 'Session B fetch should be initiated');

    // Suppose a rogue/stale cached response for PIN 111111 resolves on B's wire or a stale A promise resolves
    await act(async () => {
      // First verify empty Session B resolves cleanly with 0 players
      reqB.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          pin: '222222',
          state_version: 3,
          title: 'Quiz Session B Empty',
          total_questions: 2,
          total_players: 0,
          results: [],
        }),
      });
      await flushMicrotasks();
    });

    // 5. Session B has no players -> empty podium rendered, zero Session A or fake entries
    assert.doesNotMatch(container.textContent, /AlphaSessionA/);
    assert.doesNotMatch(container.textContent, /#1 CHAMPION/);
    assert.match(container.textContent, /لا يوجد متسابقون مسجلون في هذه الجلسة/);

    // Also verify delayed Session A response arriving on PIN C (333333) is rejected & failed C shows error, NOT Session A
    await act(async () => {
      root.render(React.createElement(Leaderboard, { session: { pin: '333333' }, setMode: () => {}, player: null }));
      await flushMicrotasks();
    });
    assert.doesNotMatch(container.textContent, /AlphaSessionA/);

    // Resolve PIN 333333 with a stale PIN 111111 payload -> MUST be rejected by pin mismatch guard (and stay loading/not show AlphaSessionA)
    const reqC = pendingFetches.get('/api/sessions/333333/results').shift();
    await act(async () => {
      reqC.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          pin: '111111',
          state_version: 5,
          title: 'Stale A Payload',
          total_questions: 2,
          total_players: 1,
          results: [makePlayer(101, 'AlphaSessionA', 1400)],
        }),
      });
      await flushMicrotasks();
    });
    assert.doesNotMatch(container.textContent, /AlphaSessionA/);

    // 6. Switch to PIN 444444 whose API fails -> error UI renders, NEVER Session A results
    // Switch back to 111111 first, load A, then switch to 444444 and reject (including retries)
    await act(async () => {
      root.render(React.createElement(Leaderboard, { session: { pin: '111111' }, setMode: () => {}, player: null }));
      await flushMicrotasks();
    });
    const reqA2 = pendingFetches.get('/api/sessions/111111/results').shift();
    await act(async () => {
      reqA2.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          pin: '111111',
          state_version: 5,
          title: 'Quiz A',
          total_questions: 2,
          total_players: 1,
          results: [makePlayer(101, 'AlphaSessionA', 1400)],
        }),
      });
      await flushMicrotasks();
    });
    assert.match(container.textContent, /AlphaSessionA/);

    // Use zero-delay setTimeout for retry acceleration during this sub-check
    const origSetTimeout = globalThis.setTimeout;
    const activeTimers = [];
    globalThis.setTimeout = (fn, _ms) => {
      const id = origSetTimeout(fn, 0);
      activeTimers.push(id);
      return id;
    };

    try {
      await act(async () => {
        root.render(React.createElement(Leaderboard, { session: { pin: '444444' }, setMode: () => {}, player: null }));
        await flushMicrotasks();
      });
      assert.doesNotMatch(container.textContent, /AlphaSessionA/);

      // Reject initial + 3 automatic retries for 444444
      for (let attempt = 0; attempt < 4; attempt++) {
        await act(async () => {
          await new Promise(r => origSetTimeout(r, 5));
          const list = pendingFetches.get('/api/sessions/444444/results') || [];
          const reqFail = list.shift();
          if (reqFail) reqFail.reject(new Error('500'));
          await flushMicrotasks();
        });
      }

      assert.doesNotMatch(container.textContent, /AlphaSessionA/);
      assert.match(container.textContent, /تعذر تحميل نتائج المسابقة النهائية/);
    } finally {
      activeTimers.forEach(clearTimeout);
      globalThis.setTimeout = origSetTimeout;
    }

    // 7. Switch to PIN 555555 and load Session B's real results successfully
    await act(async () => {
      root.render(React.createElement(Leaderboard, { session: { pin: '555555' }, setMode: () => {}, player: null }));
      await flushMicrotasks();
    });
    const req5 = pendingFetches.get('/api/sessions/555555/results').shift();
    await act(async () => {
      req5.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          pin: '555555',
          state_version: 7,
          title: 'Quiz Session 5',
          total_questions: 3,
          total_players: 1,
          results: [makePlayer(501, 'WinnerSessionB', 2200)],
        }),
      });
      await flushMicrotasks();
    });

    assert.match(container.textContent, /WinnerSessionB/);
    assert.doesNotMatch(container.textContent, /AlphaSessionA/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    globalThis.fetch = realFetch;
  }
});

test('Mounted Leaderboard: delayed async Session A response resolving after switch to Session B is dropped', async () => {
  const realFetch = globalThis.fetch;
  const pendingByPin = {};
  globalThis.fetch = (url) => {
    const d = deferred();
    pendingByPin[String(url)] = d;
    return d.promise;
  };

  const container = fakeDoc.createElement('div');
  const root = createRoot(container);

  try {
    // Mount Session A (in flight)
    await act(async () => {
      root.render(React.createElement(Leaderboard, { session: { pin: '611111' }, setMode: () => {}, player: null }));
      await flushMicrotasks();
    });
    const reqA = pendingByPin['/api/sessions/611111/results'];
    assert.ok(reqA);

    // Switch to Session B BEFORE A resolves
    await act(async () => {
      root.render(React.createElement(Leaderboard, { session: { pin: '622222' }, setMode: () => {}, player: null }));
      await flushMicrotasks();
    });
    const reqB = pendingByPin['/api/sessions/622222/results'];
    assert.ok(reqB);

    // Now delayed Session A resolves FIRST (even with valid PIN 611111!) -> MUST be ignored!
    await act(async () => {
      reqA.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          pin: '611111',
          state_version: 4,
          title: 'Old Quiz A',
          total_questions: 1,
          total_players: 1,
          results: [makePlayer(610, 'DelayedGhostA', 1900)],
        }),
      });
      await flushMicrotasks();
    });

    assert.doesNotMatch(container.textContent, /DelayedGhostA/);
    assert.match(container.textContent, /جاري تتويج الأبطال/);

    // Now Session B resolves -> Session B renders cleanly
    await act(async () => {
      reqB.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          pin: '622222',
          state_version: 2,
          title: 'Current Quiz B',
          total_questions: 1,
          total_players: 1,
          results: [makePlayer(620, 'RealPlayerB', 1600)],
        }),
      });
      await flushMicrotasks();
    });

    assert.match(container.textContent, /RealPlayerB/);
    assert.doesNotMatch(container.textContent, /DelayedGhostA/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    globalThis.fetch = realFetch;
  }
});

// ══════════════════════════════════════════════════════════════════════
// LEADERBOARD COMPONENT SSR RENDERING REGRESSION TESTS
// ══════════════════════════════════════════════════════════════════════

test('Leaderboard (Case 1 & 9): Empty session renders zero podium slots and zero fake/placeholder players', () => {
  const html = renderToStaticMarkup(
    React.createElement(Leaderboard, {
      session: { pin: '550001' },
      setMode: () => {},
      player: null,
      initialResults: {
        pin: '550001',
        state_version: 5,
        title: 'Empty Quiz',
        total_questions: 3,
        total_players: 0,
        results: [],
      },
    })
  );

  assert.doesNotMatch(html, /#1 CHAMPION/);
  assert.doesNotMatch(html, /#2 SILVER/);
  assert.doesNotMatch(html, /#3 BRONZE/);
  assert.match(html, /لا يوجد متسابقون مسجلون في هذه الجلسة/);
  assert.match(html, /0 Combatants/);
});

test('Leaderboard (Case 2): One real player renders ONLY #1 CHAMPION, no #2 SILVER or #3 BRONZE', () => {
  const html = renderToStaticMarkup(
    React.createElement(Leaderboard, {
      session: { pin: '550002' },
      setMode: () => {},
      player: null,
      initialResults: {
        pin: '550002',
        state_version: 5,
        title: 'Solo Quiz',
        total_questions: 2,
        total_players: 1,
        results: [makePlayer(41, 'OmarReal', 980)],
      },
    })
  );

  assert.match(html, /#1 CHAMPION/);
  assert.match(html, /OmarReal/);
  assert.match(html, /data-player-id="41"/);
  assert.doesNotMatch(html, /#2 SILVER/);
  assert.doesNotMatch(html, /#3 BRONZE/);
});

test('Leaderboard (Case 3): Two real players render ONLY #1 and #2 podium columns, no #3 BRONZE', () => {
  const html = renderToStaticMarkup(
    React.createElement(Leaderboard, {
      session: { pin: '550003' },
      setMode: () => {},
      player: null,
      initialResults: {
        pin: '550003',
        state_version: 6,
        title: 'Duo Quiz',
        total_questions: 2,
        total_players: 2,
        results: [makePlayer(51, 'FirstHero', 1500), makePlayer(52, 'SecondHero', 1200)],
      },
    })
  );

  assert.match(html, /#1 CHAMPION/);
  assert.match(html, /#2 SILVER/);
  assert.match(html, /FirstHero/);
  assert.match(html, /SecondHero/);
  assert.doesNotMatch(html, /#3 BRONZE/);
});

test('Leaderboard (Case 4 & 5): 3 and 5 real players render exact podium & stable-ID challenger rows without hardcoded fallbacks', () => {
  const players = [
    makePlayer(61, 'ChampOne', 2500),
    makePlayer(62, 'ChampTwo', 2100),
    makePlayer(63, 'ChampThree', 1800),
    makePlayer(64, 'ChallengerFour', 900, { total_answers: 0, correct_answers: 0, avg_time: 0, accuracy: 0 }),
    makePlayer(65, 'ChallengerFive', 750),
  ];

  const html = renderToStaticMarkup(
    React.createElement(Leaderboard, {
      session: { pin: '550005' },
      setMode: () => {},
      player: { id: 64, name: 'ChallengerFour' },
      initialResults: {
        pin: '550005',
        state_version: 8,
        title: 'Full Class Quiz',
        total_questions: 3,
        total_players: 5,
        results: players,
      },
    })
  );

  assert.match(html, /#1 CHAMPION/);
  assert.match(html, /#2 SILVER/);
  assert.match(html, /#3 BRONZE/);
  assert.match(html, /ChallengerFour/);
  assert.match(html, /ChallengerFive/);
  assert.match(html, /data-player-id="64"/);
  assert.match(html, /data-player-id="65"/);
  assert.doesNotMatch(html, /1\.2s/);
});

test('Leaderboard (Case 8): API failure renders error & retry state, zero mock podium players', () => {
  const html = renderToStaticMarkup(
    React.createElement(Leaderboard, {
      session: { pin: '550008' },
      setMode: () => {},
      player: null,
      initialResults: null,
      initialFetchError: true,
    })
  );

  assert.match(html, /تعذر تحميل نتائج المسابقة النهائية/);
  assert.match(html, /إعادة المحاولة/);
  assert.doesNotMatch(html, /#1 CHAMPION/);
  assert.doesNotMatch(html, /#2 SILVER/);
  assert.doesNotMatch(html, /#3 BRONZE/);
});

test('Leaderboard (Case 10): Mismatched initialResults PIN is ignored on session switch rather than rendering stale players', () => {
  const html = renderToStaticMarkup(
    React.createElement(Leaderboard, {
      session: { pin: '999002' },
      setMode: () => {},
      player: null,
      initialResults: {
        pin: '999001',
        state_version: 9,
        title: 'Old Session',
        total_questions: 2,
        total_players: 1,
        results: [makePlayer(99, 'OldSessionGhost', 9999)],
      },
      initialFetchError: false,
    })
  );

  assert.match(html, /جاري تتويج الأبطال/);
  assert.doesNotMatch(html, /OldSessionGhost/);
  assert.doesNotMatch(html, /#1 CHAMPION/);
});

// ══════════════════════════════════════════════════════════════════════
// STUDENTPLAY PENDING-RESULT FEEDBACK REGRESSION TESTS
// ══════════════════════════════════════════════════════════════════════

const sampleQuestion = {
  id: 700,
  question_text: 'What is 2 + 2?',
  question_text_ar: 'كم ناتج 2 + 2؟',
  time_limit: 20,
  order: 0,
  choices: [
    { id: 7001, choice_text: '3', order: 0 },
    { id: 7002, choice_text: '4', order: 1 },
  ],
};

test('StudentPlay: { accepted: true } before fetchMyResult resolves MUST NOT flash wrong-btn or feedback-wrong', () => {
  const restored = buildStudentRestorationState({
    player: { id: 10, name: 'Sara', score: 0, streak: 0 },
    session: {
      pin: '880011',
      status: 'active',
      current_question_index: 0,
      total_questions: 2,
      question_state: 'answering',
      state_version: 1,
      current_question: sampleQuestion,
    },
    answered: true,
    answer: { question_id: 700, choice_id: 7002 },
  });

  const html = renderToStaticMarkup(
    React.createElement(StudentPlay, {
      session: { pin: '880011' },
      player: { id: 10, name: 'Sara', score: 0, streak: 0 },
      setMode: () => {},
      setNotice: () => {},
      setPlayer: () => {},
      restoredMe: { ...restored, isRevealed: true },
    })
  );

  assert.match(html, /feedback-verifying/);
  assert.match(html, /جاري التحقق واحتساب النتيجة/);
  assert.doesNotMatch(html, /feedback-wrong/);
  assert.doesNotMatch(html, /wrong-btn/);
  assert.doesNotMatch(html, /إجابة غير صحيحة/);
});

test('StudentPlay: Restored revealed session shows accurate correct vs wrong feedback', () => {
  const restoredCorrect = buildStudentRestorationState({
    player: { id: 10, name: 'Sara', score: 950, streak: 1 },
    session: {
      pin: '880012',
      status: 'active',
      current_question_index: 0,
      total_questions: 2,
      question_state: 'revealed',
      state_version: 2,
      current_question: { ...sampleQuestion, correct_choice_id: 7002 },
    },
    answered: true,
    answer: { question_id: 700, choice_id: 7002, is_correct: true, points_earned: 950 },
  });

  const htmlCorrect = renderToStaticMarkup(
    React.createElement(StudentPlay, {
      session: { pin: '880012' },
      player: { id: 10, name: 'Sara', score: 950, streak: 1 },
      setMode: () => {},
      setNotice: () => {},
      setPlayer: () => {},
      restoredMe: restoredCorrect,
    })
  );

  assert.match(htmlCorrect, /feedback-correct/);
  assert.match(htmlCorrect, /إجابة صحيحة وعبقرية/);
  assert.match(htmlCorrect, /\+950/);
  assert.doesNotMatch(htmlCorrect, /feedback-wrong/);

  const restoredWrong = buildStudentRestorationState({
    player: { id: 11, name: 'Zaid', score: 0, streak: 0 },
    session: {
      pin: '880012',
      status: 'active',
      current_question_index: 0,
      total_questions: 2,
      question_state: 'revealed',
      state_version: 2,
      current_question: { ...sampleQuestion, correct_choice_id: 7002 },
    },
    answered: true,
    answer: { question_id: 700, choice_id: 7001, is_correct: false, points_earned: 0 },
  });

  const htmlWrong = renderToStaticMarkup(
    React.createElement(StudentPlay, {
      session: { pin: '880012' },
      player: { id: 11, name: 'Zaid', score: 0, streak: 0 },
      setMode: () => {},
      setNotice: () => {},
      setPlayer: () => {},
      restoredMe: restoredWrong,
    })
  );

  assert.match(htmlWrong, /feedback-wrong/);
  assert.match(htmlWrong, /wrong-btn/);
  assert.match(htmlWrong, /إجابة غير صحيحة/);
});

// ══════════════════════════════════════════════════════════════════════
// TEACHERLIVE 3-STEP FLOW (REVEAL RESULT -> NEXT TOP 5 -> NEXT QUESTION)
// ══════════════════════════════════════════════════════════════════════

test('TeacherLive: Revealed result stage shows stats & "Next -> Top 5" button before Next Question', () => {
  const sevenPlayers = Array.from({ length: 7 }, (_, i) => ({
    rank: i + 1,
    id: i + 1,
    name: `Kid${i + 1}`,
    avatar: 'ninja',
    score: (7 - i) * 200,
    streak: i === 0 ? 3 : 0,
  }));

  const basePoll = {
    pin: '770011',
    status: 'active',
    current_question_index: 0,
    total_questions: 3,
    question_state: 'revealed',
    show_mid_leaderboard: false,
    player_count: 7,
    leaderboard: sevenPlayers,
    current_question: { ...sampleQuestion, correct_choice_id: 7002 },
  };

  const sampleStats = {
    question_id: 700,
    total_answers: 7,
    stats: [
      { choice_id: 7001, is_correct: false, count: 2 },
      { choice_id: 7002, is_correct: true, count: 5 },
    ],
  };

  // Step 2: Question Result ("صح ولا غلط")
  const htmlResult = renderToStaticMarkup(
    React.createElement(TeacherLive, {
      session: { pin: '770011', title: 'Top5 Quiz' },
      setSession: () => {},
      setMode: () => {},
      setNotice: () => {},
      initialPoll: basePoll,
      initialShowTop5: false,
      initialStats: sampleStats,
    })
  );

  assert.match(htmlResult, /نتيجة السؤال \(صح أم خطأ\)/);
  assert.match(htmlResult, /5 صح/);
  assert.match(htmlResult, /2 خطأ/);
  assert.match(htmlResult, /التالي — عرض الترتيب \(Top 5\)/);
  assert.doesNotMatch(htmlResult, /أفضل 5 متصدرين/);

  // Step 3: Top-5 Leaderboard stage (capped at 5th place)
  const htmlTop5 = renderToStaticMarkup(
    React.createElement(TeacherLive, {
      session: { pin: '770011', title: 'Top5 Quiz' },
      setSession: () => {},
      setMode: () => {},
      setNotice: () => {},
      initialPoll: { ...basePoll, show_mid_leaderboard: true },
      initialShowTop5: true,
      initialStats: sampleStats,
    })
  );

  assert.match(htmlTop5, /أفضل 5 متصدرين/);
  assert.match(htmlTop5, /Kid1/);
  assert.match(htmlTop5, /Kid5/);
  assert.doesNotMatch(htmlTop5, /Kid6/);
  assert.doesNotMatch(htmlTop5, /Kid7/);
  assert.match(htmlTop5, /السؤال التالي/);
});

test('StudentPlay: Restored show_mid_leaderboard caps mid-board to Top 5', () => {
  const restored = buildStudentRestorationState({
    player: { id: 10, name: 'Sara', score: 950, streak: 1 },
    session: {
      pin: '880099',
      status: 'active',
      current_question_index: 0,
      total_questions: 2,
      question_state: 'revealed',
      show_mid_leaderboard: true,
      state_version: 3,
      current_question: { ...sampleQuestion, correct_choice_id: 7002 },
    },
    answered: true,
    answer: { question_id: 700, choice_id: 7002, is_correct: true, points_earned: 950 },
  });

  assert.equal(restored.showMidLeaderboard, true);
  assert.equal(restored.isRevealed, true);

  const html = renderToStaticMarkup(
    React.createElement(StudentPlay, {
      session: { pin: '880099' },
      player: { id: 10, name: 'Sara', score: 950, streak: 1 },
      setMode: () => {},
      setNotice: () => {},
      setPlayer: () => {},
      restoredMe: restored,
    })
  );

  assert.match(html, /من يتصدّر المنافسة؟/);
});

test('App: Refresh with saved student session prompts Continue vs Exit and obeys choice', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/sessions/555666/me')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          player: { id: 99, name: 'Omar', avatar: 'ninja', score: 350, streak: 1 },
          session: {
            pin: '555666',
            title: 'Science Refresh Test',
            status: 'active',
            current_question_index: 0,
            total_questions: 3,
            question_state: 'answering',
            show_mid_leaderboard: false,
            state_version: 2,
            current_question: sampleQuestion,
          },
          answered: false,
          answer: null,
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const findByClass = (rootNode, cls) => {
    let found = null;
    const walk = (n) => {
      if (found || !n) return;
      if (n.nodeType === 1 && String(n.className || '').split(/\s+/).includes(cls)) {
        found = n;
        return;
      }
      (n.childNodes || []).forEach(walk);
    };
    walk(rootNode);
    return found;
  };
  const clickReactBtn = (el) => {
    const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
    assert.ok(propsKey && typeof el[propsKey]?.onClick === 'function', 'Button should have React onClick prop');
    el[propsKey].onClick({ preventDefault: () => {}, stopPropagation: () => {} });
  };

  const seedSession = () => {
    localStorage.setItem('tecorbi_last_session_pin', '555666');
    localStorage.setItem('tecorbi_player_555666', JSON.stringify({ id: 99, token: 'tok-99', name: 'Omar' }));
  };

  const container = fakeDoc.createElement('div');
  const root = createRoot(container);
  const rootsToCleanup = [root];

  try {
    // 1. Mount after refresh -> shows Continue vs Exit prompt instead of forcing back into gameplay
    seedSession();
    await act(async () => {
      root.render(React.createElement(App));
      await new Promise(r => setTimeout(r, 30));
      await flushMicrotasks(20);
    });

    assert.match(container.textContent, /هل تريد استكمال الجيم أم الخروج؟/);
    assert.match(container.textContent, /555666/);
    assert.match(container.textContent, /Omar/);
    assert.doesNotMatch(container.textContent, /What is 2 \+ 2\?/);

    // 2. Click "Exit" -> clears storage and stays on Home screen
    const exitBtn = findByClass(container, 'btn-restore-exit');
    assert.ok(exitBtn, 'Exit button must be rendered in restore prompt');
    await act(async () => {
      clickReactBtn(exitBtn);
      await flushMicrotasks(12);
    });

    assert.equal(localStorage.getItem('tecorbi_last_session_pin'), null);
    assert.equal(localStorage.getItem('tecorbi_player_555666'), null);
    assert.doesNotMatch(container.textContent, /هل تريد استكمال الجيم أم الخروج؟/);

    // 3. Re-seed and remount, then click "Continue" -> enters StudentPlay
    await act(async () => {
      root.unmount();
    });
    const container2 = fakeDoc.createElement('div');
    const root2 = createRoot(container2);
    rootsToCleanup.push(root2);
    seedSession();
    await act(async () => {
      root2.render(React.createElement(App));
      await new Promise(r => setTimeout(r, 30));
      await flushMicrotasks(20);
    });

    const continueBtn = findByClass(container2, 'btn-restore-continue');
    assert.ok(continueBtn, 'Continue button must be rendered in restore prompt');
    await act(async () => {
      clickReactBtn(continueBtn);
      await flushMicrotasks(12);
    });

    assert.doesNotMatch(container2.textContent, /هل تريد استكمال الجيم أم الخروج؟/);
    assert.match(container2.textContent, /What is 2 \+ 2\?/);
  } finally {
    await act(async () => {
      for (const r of rootsToCleanup) {
        try { r.unmount(); } catch {}
      }
    });
    globalThis.fetch = realFetch;
    localStorage.removeItem('tecorbi_last_session_pin');
    localStorage.removeItem('tecorbi_player_555666');
  }
});

test('TeacherLive: Polling answered_count === player_count triggers auto-reveal without WebSocket', async () => {
  const realFetch = globalThis.fetch;
  let revealCalls = 0;
  let isRevealedServer = false;

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/sessions/667788/reveal') && (opts.method || 'GET').toUpperCase() === 'POST') {
      revealCalls++;
      isRevealedServer = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ question_state: 'revealed', correct_choice_id: 7002, state_version: 3 }),
      };
    }
    if (u.includes('/sessions/667788/question-stats')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          question_id: 700,
          total_answers: 2,
          stats: [
            { choice_id: 7001, is_correct: false, count: 0 },
            { choice_id: 7002, is_correct: true, count: 2 },
          ],
        }),
      };
    }
    if (u.includes('/sessions/667788/poll')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          pin: '667788',
          status: 'active',
          current_question_index: 0,
          total_questions: 2,
          question_state: isRevealedServer ? 'revealed' : 'answering',
          show_mid_leaderboard: false,
          question_started_at: Date.now() - 2000,
          player_count: 2,
          answered_count: 2,
          leaderboard: [makePlayer(1, 'Ali', 900), makePlayer(2, 'Mona', 850)],
          current_question: {
            ...sampleQuestion,
            correct_choice_id: isRevealedServer ? 7002 : null,
          },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const container = fakeDoc.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(TeacherLive, {
        session: { pin: '667788', title: 'Auto Reveal Poll Test' },
        setSession: () => {},
        setMode: () => {},
        setNotice: () => {},
      }));
      await new Promise(r => setTimeout(r, 40));
      await flushMicrotasks(20);
    });

    assert.equal(revealCalls, 1, 'TeacherLive should automatically POST /reveal once all players answered via /poll');
    assert.match(container.textContent, /نتيجة السؤال \(صح أم خطأ\)/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    globalThis.fetch = realFetch;
  }
});

test('StudentPlay: Stays on question feedback after reveal, then opens Top 5 ONLY when server sets show_mid_leaderboard=true', async () => {
  const realFetch = globalThis.fetch;
  let serverShowMid = false;
  let serverVersion = 3;

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/sessions/998877/state')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          pin: '998877',
          status: 'active',
          current_question_index: 0,
          total_questions: 2,
          question_state: 'revealed',
          show_mid_leaderboard: serverShowMid,
          state_version: serverVersion,
          question_started_at: Date.now() - 5000,
          player_count: 2,
          answered_count: 2,
          leaderboard: [
            { rank: 1, id: 10, name: 'Sara', avatar: 'ninja', score: 950, streak: 1 },
            { rank: 2, id: 11, name: 'Omar', avatar: 'ninja', score: 700, streak: 0 },
          ],
          current_question: { ...sampleQuestion, correct_choice_id: 7002 },
        }),
      };
    }
    if (u.includes('/sessions/998877/my-result')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          answered: true,
          is_correct: true,
          points_earned: 950,
          total_score: 950,
          streak: 1,
          choice_id: 7002,
          correct_choice_id: 7002,
        }),
      };
    }
    if (u.includes('/sessions/998877/leaderboard')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          pin: '998877',
          leaderboard: [
            { rank: 1, id: 10, name: 'Sara', avatar: 'ninja', score: 950, streak: 1 },
            { rank: 2, id: 11, name: 'Omar', avatar: 'ninja', score: 700, streak: 0 },
          ],
          my_rank: 1,
          my_score: 950,
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const container = fakeDoc.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(StudentPlay, {
        session: { pin: '998877' },
        player: { id: 10, name: 'Sara', avatar: 'ninja', score: 0, streak: 0, token: 't-10' },
        setMode: () => {},
        setNotice: () => {},
        setPlayer: () => {},
      }));
      await new Promise(r => setTimeout(r, 40));
      await flushMicrotasks(20);
    });

    // Revealed -> shows answer feedback (player didn't select, so time-expired msg), does NOT auto-open mid leaderboard
    assert.match(container.textContent, /تم الكشف/);
    assert.doesNotMatch(container.textContent, /من يتصدّر المنافسة؟/);

    // Now teacher clicks Top 5 -> server sets show_mid_leaderboard = true & increments version
    serverShowMid = true;
    serverVersion = 4;

    await act(async () => {
      await new Promise(r => setTimeout(r, 1150));
      await flushMicrotasks(20);
    });

    assert.match(container.textContent, /من يتصدّر المنافسة؟/);
    assert.match(container.textContent, /Sara/);
    assert.match(container.textContent, /Omar/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    globalThis.fetch = realFetch;
  }
});
