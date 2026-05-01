'use strict';

// ── State ─────────────────────────────────────────────────────────
const state = {
  allQuestions: [], questions: [], badges: [], levels: [],
  streakBonuses: [], encouragements: {},
  idx: 0, answered: false, shuffleOn: false, activeCategory: 'All',
  totalPoints: 0, currentStreak: 0, bestStreak: 0,
  correctTotal: 0, answeredTotal: 0, fastAnswers: 0,
  roundCorrect: 0, roundTotal: 0,
  questionsSeen: new Set(), bookmarks: new Set(), badgesEarned: new Set(),
  categoryStats: {}, dailyStreak: 0, lastPlayedDate: null,
  comebackTracker: { wrongInRow: 0, correctAfter: 0, active: false },
  questionStartTime: null,
  imageCache: {},   // cache generated images by question id
};

const $  = id => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

// ── Boot ──────────────────────────────────────────────────────────
async function init() {
  try {
    const data = await (await fetch('questions.json')).json();
    state.allQuestions   = data.questions;
    state.badges         = data.badges;
    state.levels         = data.levels;
    state.streakBonuses  = data.streakBonuses;
    state.encouragements = data.encouragements;
    loadFromStorage();
    updateDailyStreak();
    buildFilters();
    applyFilter('All');
    renderBadgesPanel();
    renderHUD();
    renderStatsPanel();
  } catch(e) {
    $('quiz-area').innerHTML = `<div class="question-card" style="text-align:center;padding:48px">
      <div style="font-size:48px;margin-bottom:16px">⚠️</div>
      <p style="color:var(--red)">Could not load <strong>questions.json</strong> — make sure it's in the same folder.</p></div>`;
  }
}

// ── AI Image Generation ───────────────────────────────────────────
async function generateImage(questionId, prompt) {
  // Return cached image if already generated
  if (state.imageCache[questionId]) return state.imageCache[questionId];

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Generate a vivid, detailed description of this image for a football trivia app, then respond with ONLY a data URI of a simple SVG illustration (no external images). Create an SVG that captures: ${prompt}. 
          
          Rules for the SVG:
          - Use viewBox="0 0 600 300"
          - Dark football/soccer themed background (#080f0a or deep green)
          - Use bold colors: greens, golds, whites
          - Include a football/soccer pitch element subtly in background
          - Make it feel like a sports trading card or match poster
          - Include relevant emoji or text elements
          - No external image src tags
          - Return ONLY the raw SVG code starting with <svg`
        }]
      })
    });

    const data = await response.json();
    const svgText = data.content?.[0]?.text || '';
    const svgMatch = svgText.match(/<svg[\s\S]*<\/svg>/i);

    if (svgMatch) {
      const svgDataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMatch[0]);
      state.imageCache[questionId] = svgDataUri;
      return svgDataUri;
    }
  } catch(err) {
    console.warn('Image generation failed:', err);
  }
  return null;
}

// ── Storage ───────────────────────────────────────────────────────
function saveToStorage() {
  localStorage.setItem('football_trivia_save', JSON.stringify({
    totalPoints: state.totalPoints, currentStreak: state.currentStreak,
    bestStreak: state.bestStreak, correctTotal: state.correctTotal,
    answeredTotal: state.answeredTotal, fastAnswers: state.fastAnswers,
    questionsSeen: [...state.questionsSeen], bookmarks: [...state.bookmarks],
    badgesEarned: [...state.badgesEarned], categoryStats: state.categoryStats,
    dailyStreak: state.dailyStreak, lastPlayedDate: state.lastPlayedDate,
    comebackTracker: state.comebackTracker, imageCache: state.imageCache,
  }));
}

function loadFromStorage() {
  const raw = localStorage.getItem('football_trivia_save');
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    state.totalPoints     = s.totalPoints     || 0;
    state.currentStreak   = s.currentStreak   || 0;
    state.bestStreak      = s.bestStreak      || 0;
    state.correctTotal    = s.correctTotal    || 0;
    state.answeredTotal   = s.answeredTotal   || 0;
    state.fastAnswers     = s.fastAnswers     || 0;
    state.questionsSeen   = new Set(s.questionsSeen  || []);
    state.bookmarks       = new Set(s.bookmarks      || []);
    state.badgesEarned    = new Set(s.badgesEarned   || []);
    state.categoryStats   = s.categoryStats   || {};
    state.dailyStreak     = s.dailyStreak     || 0;
    state.lastPlayedDate  = s.lastPlayedDate  || null;
    state.comebackTracker = s.comebackTracker || { wrongInRow: 0, correctAfter: 0, active: false };
    state.imageCache      = s.imageCache      || {};
  } catch(e) { console.warn('Save corrupted, starting fresh.'); }
}

// ── Daily Streak ──────────────────────────────────────────────────
function updateDailyStreak() {
  const today     = new Date().toISOString().slice(0,10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10);
  if (state.lastPlayedDate === today) return;
  state.dailyStreak    = state.lastPlayedDate === yesterday ? state.dailyStreak + 1 : 1;
  state.lastPlayedDate = today;
  saveToStorage();
}

// ── Filters ───────────────────────────────────────────────────────
function buildFilters() {
  const cats = ['All', ...new Set(state.allQuestions.map(q => q.category)), 'Bookmarked'];
  const wrap = $('filter-buttons');
  wrap.innerHTML = '';
  cats.forEach(cat => {
    const btn = el('button', 'f-btn');
    btn.textContent = cat;
    btn.onclick = () => applyFilter(cat);
    if (cat === 'All') btn.classList.add('active');
    wrap.appendChild(btn);
  });
}

function applyFilter(cat) {
  state.activeCategory = cat;
  state.idx = 0; state.roundCorrect = 0; state.roundTotal = 0; state.answered = false;
  document.querySelectorAll('.f-btn').forEach(b => b.classList.toggle('active', b.textContent === cat));
  let qs = cat === 'All'        ? [...state.allQuestions]
         : cat === 'Bookmarked' ? state.allQuestions.filter(q => state.bookmarks.has(q.id))
         : state.allQuestions.filter(q => q.category === cat);
  if (state.shuffleOn) qs = shuffle(qs);
  state.questions = qs;
  renderQuestion();
  renderHUD();
}

function toggleShuffle() {
  state.shuffleOn = !state.shuffleOn;
  $('btn-shuffle').textContent = `🔀 Shuffle: ${state.shuffleOn ? 'On' : 'Off'}`;
  applyFilter(state.activeCategory);
}

function toggleBookmarkFilter() {
  applyFilter(state.activeCategory === 'Bookmarked' ? 'All' : 'Bookmarked');
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function restartQuiz() {
  state.idx = 0; state.roundCorrect = 0; state.roundTotal = 0; state.answered = false;
  applyFilter(state.activeCategory);
}

// ── Render Question ───────────────────────────────────────────────
async function renderQuestion() {
  const area = $('quiz-area');

  if (!state.questions.length) {
    area.innerHTML = `<div class="question-card" style="text-align:center;padding:48px">
      <div style="font-size:48px;margin-bottom:16px">📚</div>
      <p style="color:var(--text-muted)">No questions here — try a different filter!</p></div>`;
    updateProgress(); return;
  }

  if (state.idx >= state.questions.length) { renderComplete(); return; }

  const q = state.questions[state.idx];
  state.answered = false;
  state.questionStartTime = Date.now();
  state.questionsSeen.add(q.id);

  const letters = ['A','B','C','D'];

  // Build card HTML
  area.innerHTML = `
    <div class="question-card">
      <div class="q-image-wrap" id="q-image-wrap">
        <div class="q-image-loading">
          <span class="spinner">⚽</span>
          <span>Generating image...</span>
        </div>
      </div>

      <div class="q-meta">
        <span class="q-number">Q${state.idx + 1} of ${state.questions.length}</span>
        <span class="q-category">${q.category}</span>
        <span class="q-difficulty ${q.difficulty}">${q.difficulty}</span>
        ${q.flag ? `<span class="q-flag">${q.flag}</span>` : ''}
        <span class="q-points">+${q.points} pts</span>
        <button class="bookmark-btn ${state.bookmarks.has(q.id) ? 'on' : ''}"
                onclick="toggleBookmark(${q.id})">${state.bookmarks.has(q.id) ? '🔖' : '🤍'}</button>
      </div>

      <p class="q-text">${q.question}</p>

      <ul class="options-list">
        ${q.options.map((opt, i) => `
          <li><button class="opt-btn" onclick="selectAnswer(${i})" data-i="${i}">
            <span class="opt-letter">${letters[i]}</span>
            <span class="opt-text">${opt}</span>
          </button></li>`).join('')}
      </ul>

      <div id="feedback-area"></div>

      <div class="nav-controls">
        <button class="btn btn-outline" onclick="prevQuestion()" ${state.idx === 0 ? 'disabled style="opacity:0.3"' : ''}>← Prev</button>
        <button class="btn btn-primary" id="btn-next" onclick="nextQuestion()" style="display:none">
          ${state.idx === state.questions.length - 1 ? '🏁 Finish' : 'Next →'}
        </button>
      </div>
    </div>`;

  updateProgress();
  updateStreakBanner();

  // Generate AI image asynchronously — doesn't block the question rendering
  if (q.image_prompt) {
    const imgWrap = $('q-image-wrap');
    const imgSrc  = await generateImage(q.id, q.image_prompt);
    if (imgSrc && imgWrap) {
      imgWrap.innerHTML = `
        <img src="${imgSrc}" alt="${q.image_caption || q.category}" />
        ${q.image_caption ? `<div class="q-image-caption">${q.image_caption || ''} ${q.flag || ''}</div>` : ''}`;
    } else if (imgWrap) {
      // Fallback: show emoji placeholder
      imgWrap.innerHTML = `<div style="font-size:64px;text-align:center">${q.flag || '⚽'}</div>`;
    }
  }
}

// ── Answer Logic ──────────────────────────────────────────────────
function selectAnswer(selectedIdx) {
  if (state.answered) return;
  state.answered = true;

  const q         = state.questions[state.idx];
  const isCorrect = selectedIdx === q.answer;
  const elapsed   = (Date.now() - state.questionStartTime) / 1000;

  document.querySelectorAll('.opt-btn').forEach(btn => btn.disabled = true);

  document.querySelectorAll('.opt-btn').forEach((btn, i) => {
    if (i === q.answer && i === selectedIdx) btn.classList.add('correct');
    else if (i === q.answer)                 btn.classList.add('reveal');
    else if (i === selectedIdx)              btn.classList.add('wrong');
    if (q.option_explanations?.[i]) btn.appendChild(el('span', 'opt-explain', q.option_explanations[i]));
  });

  state.answeredTotal++;
  state.roundTotal++;

  if (isCorrect) {
    state.correctTotal++;
    state.roundCorrect++;
    state.currentStreak++;
    if (state.currentStreak > state.bestStreak) state.bestStreak = state.currentStreak;
    if (elapsed < 10) { state.fastAnswers++; checkBadge('speed_demon'); }
    if (new Date().getHours() >= 22) checkBadge('night_owl');
    if (state.comebackTracker.active) {
      state.comebackTracker.correctAfter++;
      if (state.comebackTracker.correctAfter >= 5) {
        state.comebackTracker = { wrongInRow: 0, correctAfter: 0, active: false };
        checkBadge('comeback');
      }
    }
  } else {
    state.currentStreak = 0;
    state.comebackTracker.wrongInRow++;
    if (state.comebackTracker.wrongInRow >= 3) { state.comebackTracker.active = true; state.comebackTracker.correctAfter = 0; }
  }

  const multiplier = getStreakMultiplier();
  const earned     = isCorrect ? Math.round(q.points * multiplier) : 0;
  if (isCorrect) state.totalPoints += earned;

  if (!state.categoryStats[q.category]) state.categoryStats[q.category] = { correct: 0, total: 0 };
  state.categoryStats[q.category].total++;
  if (isCorrect) state.categoryStats[q.category].correct++;

  const pool    = isCorrect ? state.encouragements.correct : state.encouragements.incorrect;
  const message = pool[Math.floor(Math.random() * pool.length)];

  $('feedback-area').innerHTML = `
    <div class="feedback-msg ${isCorrect ? 'correct' : 'wrong'}">
      ${message}
      ${isCorrect ? `<span class="points-pop">+${earned}pts${multiplier > 1 ? ` (${multiplier}x🔥)` : ''}</span>` : ''}
    </div>
    <div class="explanation-box">
      <div class="explanation-title">💡 Explanation</div>
      <div class="explanation-text">${q.explanation}</div>
    </div>`;

  $('btn-next').style.display = 'inline-flex';
  checkAllBadges();
  saveToStorage();
  renderHUD();
  renderStatsPanel();
  renderCategoryStats();
  updateStreakBanner();
}

// ── Navigation ────────────────────────────────────────────────────
function nextQuestion() { state.idx++; renderQuestion(); }
function prevQuestion() { if (state.idx > 0) { state.idx--; state.answered = false; renderQuestion(); } }

// ── Streak ────────────────────────────────────────────────────────
function getStreakMultiplier() {
  let m = 1;
  state.streakBonuses.forEach(b => { if (state.currentStreak >= b.streak) m = b.multiplier; });
  return m;
}

function updateStreakBanner() {
  const banner = $('streak-banner');
  const bonus  = [...state.streakBonuses].reverse().find(b => state.currentStreak >= b.streak);
  if (bonus) {
    $('streak-msg').textContent = bonus.message.replace('{n}', state.currentStreak);
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

// ── Progress ──────────────────────────────────────────────────────
function updateProgress() {
  const total = state.questions.length;
  const done  = Math.min(state.idx, total);
  const pct   = total ? Math.round((done / total) * 100) : 0;
  $('progress-fill').style.width = pct + '%';
  $('progress-text').textContent = `Question ${done} of ${total}`;
  $('score-text').textContent    = `Score: ${state.roundCorrect} / ${state.roundTotal}`;
}

// ── HUD ───────────────────────────────────────────────────────────
function renderHUD() {
  const level = getCurrentLevel();
  const next  = getNextLevel();
  $('hud-level').textContent  = level.title;
  $('hud-points').textContent = state.totalPoints.toLocaleString();
  $('hud-streak').textContent = state.currentStreak;
  $('hud-daily').textContent  = state.dailyStreak;
  if (next) {
    const pct = ((state.totalPoints - level.min_points) / (next.min_points - level.min_points)) * 100;
    $('xp-bar').style.width   = Math.min(100, Math.round(pct)) + '%';
    $('xp-label').textContent = `${state.totalPoints} / ${next.min_points} XP to next level`;
  } else {
    $('xp-bar').style.width   = '100%';
    $('xp-label').textContent = '🐉 MAX LEVEL — Football Legend!';
  }
}

function getCurrentLevel() { return [...state.levels].reverse().find(l => state.totalPoints >= l.min_points) || state.levels[0]; }
function getNextLevel()    { return state.levels.find(l => l.min_points > state.totalPoints) || null; }

// ── Stats ─────────────────────────────────────────────────────────
function renderStatsPanel() {
  const acc = state.answeredTotal ? Math.round((state.correctTotal / state.answeredTotal) * 100) + '%' : '—';
  $('stat-answered').textContent    = state.answeredTotal;
  $('stat-correct').textContent     = state.correctTotal;
  $('stat-accuracy').textContent    = acc;
  $('stat-best-streak').textContent = state.bestStreak;
  $('bookmark-count').textContent   = state.bookmarks.size;
}

function renderCategoryStats() {
  const wrap = $('category-stats');
  wrap.innerHTML = '';
  const cats = Object.keys(state.categoryStats);
  if (!cats.length) { wrap.innerHTML = '<p class="empty-msg">Answer questions to see stats!</p>'; return; }
  cats.forEach(cat => {
    const { correct, total } = state.categoryStats[cat];
    const pct = Math.round((correct / total) * 100);
    const div = el('div', 'cat-stat-item');
    div.innerHTML = `
      <div class="cat-stat-header">
        <span class="cat-stat-name">${cat}</span>
        <span class="cat-stat-score">${correct}/${total} (${pct}%)</span>
      </div>
      <div class="cat-stat-bar"><div class="cat-stat-fill" style="width:${pct}%"></div></div>`;
    wrap.appendChild(div);
  });
}

// ── Badges ────────────────────────────────────────────────────────
function renderBadgesPanel() {
  const grid = $('badges-grid');
  grid.innerHTML = '';
  state.badges.forEach(b => {
    const earned = state.badgesEarned.has(b.id);
    const item   = el('div', `badge-item ${earned ? 'earned' : 'locked'}`);
    item.innerHTML = `
      <span class="badge-emoji">${b.icon}</span>
      <span class="badge-name">${b.name}</span>
      <div class="badge-tooltip">${b.description}</div>`;
    grid.appendChild(item);
  });
}

function checkAllBadges() {
  ['first_correct','streak_3','streak_5','streak_10','streak_20',
   'perfect_round','wc_master','pl_master','ucl_master','legend_master',
   'completionist','daily_3','daily_7','bookworm','point_500','point_1000']
  .forEach(checkBadge);
}

function checkBadge(id) {
  if (state.badgesEarned.has(id)) return;
  const badge = state.badges.find(b => b.id === id);
  if (!badge) return;

  const catPerfect = cat => {
    const s  = state.categoryStats[cat];
    const qs = state.allQuestions.filter(q => q.category === cat);
    return s && qs.length > 0 && s.total >= qs.length && s.correct === s.total;
  };

  const checks = {
    first_correct:  state.correctTotal >= 1,
    streak_3:       state.currentStreak >= 3,
    streak_5:       state.currentStreak >= 5,
    streak_10:      state.currentStreak >= 10,
    streak_20:      state.currentStreak >= 20,
    perfect_round:  state.roundTotal > 0 && state.roundCorrect === state.roundTotal && state.roundTotal === state.questions.length,
    wc_master:      catPerfect('🏆 World Cup'),
    pl_master:      catPerfect('⚽ Premier League'),
    ucl_master:     catPerfect('🏆 Champions League'),
    legend_master:  catPerfect('🌟 Players & Legends'),
    completionist:  state.questionsSeen.size >= state.allQuestions.length,
    daily_3:        state.dailyStreak >= 3,
    daily_7:        state.dailyStreak >= 7,
    speed_demon:    state.fastAnswers >= 5,
    bookworm:       state.bookmarks.size >= 5,
    comeback:       state.comebackTracker.correctAfter >= 5,
    point_500:      state.totalPoints >= 500,
    point_1000:     state.totalPoints >= 1000,
  };

  if (checks[id]) {
    state.badgesEarned.add(id);
    saveToStorage();
    renderBadgesPanel();
    showBadgeUnlock(badge);
  }
}

let toastTimeout;
function showBadgeUnlock(badge) {
  $('toast-icon').textContent  = badge.icon;
  $('toast-title').textContent = '🎉 Badge Unlocked!';
  $('toast-msg').textContent   = badge.name;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').classList.add('hidden'), 3500);
  const big = ['completionist','perfect_round','streak_10','streak_20','point_500','point_1000'];
  if (big.includes(badge.id)) setTimeout(() => showModal(badge), 400);
}

function showModal(badge) {
  $('modal-badge-icon').textContent = badge.icon;
  $('modal-badge-name').textContent = badge.name;
  $('modal-badge-desc').textContent = badge.description;
  $('badge-modal').classList.remove('hidden');
}

function closeModal() { $('badge-modal').classList.add('hidden'); }

// ── Bookmark ──────────────────────────────────────────────────────
function toggleBookmark(id) {
  state.bookmarks.has(id) ? state.bookmarks.delete(id) : state.bookmarks.add(id);
  saveToStorage();
  renderStatsPanel();
  checkBadge('bookworm');
  const btn = document.querySelector('.bookmark-btn');
  if (btn) { btn.classList.toggle('on', state.bookmarks.has(id)); btn.textContent = state.bookmarks.has(id) ? '🔖' : '🤍'; }
}

// ── Complete ──────────────────────────────────────────────────────
function renderComplete() {
  const pct   = state.roundTotal ? Math.round((state.roundCorrect / state.roundTotal) * 100) : 0;
  const grade = pct === 100 ? '💎 Clean Sheet!' : pct >= 80 ? '🌟 World Class!' : pct >= 60 ? '👍 Good Game!' : '📚 Back to Training!';

  $('quiz-area').innerHTML = `
    <div class="complete-card">
      <div class="complete-trophy">🏆</div>
      <h2 class="complete-title">${grade}</h2>
      <p class="complete-sub">Full time whistle! Here's how you did.</p>
      <div class="complete-stats">
        <div class="cs-item"><div class="cs-val ${pct >= 60 ? 'good' : 'bad'}">${pct}%</div><div class="cs-lbl">Score</div></div>
        <div class="cs-item"><div class="cs-val good">${state.roundCorrect}</div><div class="cs-lbl">Goals ⚽</div></div>
        <div class="cs-item"><div class="cs-val bad">${state.roundTotal - state.roundCorrect}</div><div class="cs-lbl">Misses ❌</div></div>
        <div class="cs-item"><div class="cs-val gold">${state.totalPoints.toLocaleString()}</div><div class="cs-lbl">Points 🌟</div></div>
      </div>
      <div class="complete-btns">
        <button class="btn btn-primary" onclick="restartQuiz()">🔄 Rematch</button>
        <button class="btn btn-outline" onclick="applyFilter('All')">📚 All Questions</button>
        <button class="btn btn-outline" onclick="toggleShuffle(); restartQuiz()">🔀 Shuffle & Play</button>
      </div>
    </div>`;

  updateProgress();
  checkAllBadges();
}

// ── Reset ─────────────────────────────────────────────────────────
function confirmReset() {
  if (confirm('⚠️ Reset ALL progress, points, badges and streaks? This cannot be undone.')) {
    localStorage.removeItem('football_trivia_save');
    location.reload();
  }
}

document.addEventListener('DOMContentLoaded', init);