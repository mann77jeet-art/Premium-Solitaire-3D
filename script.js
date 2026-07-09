/* =========================================================
   PREMIUM 3D KLONDIKE SOLITAIRE — CORE ENGINE
   Vanilla ES6, no dependencies.
   ========================================================= */

(() => {
  'use strict';

  /* ---------------------------------------------------------
     CONSTANTS
  --------------------------------------------------------- */
  const SUITS = ['S', 'H', 'D', 'C'];
  const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const RED_SUITS = ['H', 'D'];
  const SAVE_KEY = 'klondike_save_v1';
  const STATS_KEY = 'klondike_stats_v1';
  const PREF_KEY = 'klondike_prefs_v1';

  function rankLabel(r) {
    if (r === 1) return 'A';
    if (r === 11) return 'J';
    if (r === 12) return 'Q';
    if (r === 13) return 'K';
    return String(r);
  }
  function isRed(suit) { return RED_SUITS.includes(suit); }
  function cardId(rank, suit) { return rank + suit; }
  function parseId(id) {
    const suit = id.slice(-1);
    const rank = parseInt(id.slice(0, -1), 10);
    return { rank, suit };
  }

  /* ---------------------------------------------------------
     STATE
  --------------------------------------------------------- */
  const game = {
    tableau: [[], [], [], [], [], [], []],
    foundations: { S: [], H: [], D: [], C: [] },
    stock: [],
    waste: [],
    drawMode: 1,
    score: 0,
    moves: 0,
    timeSeconds: 0,
    initialOrder: [],
    history: [],
    won: false,
    started: false
  };

  const allCards = {}; // id -> card object {id, rank, suit, color, faceUp}
  const cardEls = {};  // id -> DOM element

  let timerId = null;
  let boardEl, cardLayerEl;
  let slotPositions = {}; // pile key -> {x,y}
  const soundEnabled = { on: true };
  let audioCtx = null;

  /* ---------------------------------------------------------
     PREFERENCES
  --------------------------------------------------------- */
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      if (p.theme) document.body.setAttribute('data-theme', p.theme);
      if (typeof p.sound === 'boolean') soundEnabled.on = p.sound;
      if (p.drawMode) game.drawMode = p.drawMode;
    } catch (e) { /* ignore */ }
  }
  function savePrefs() {
    const theme = document.body.getAttribute('data-theme');
    localStorage.setItem(PREF_KEY, JSON.stringify({ theme, sound: soundEnabled.on, drawMode: game.drawMode }));
  }

  /* ---------------------------------------------------------
     STATISTICS
  --------------------------------------------------------- */
  function loadStats() {
    try {
      return JSON.parse(localStorage.getItem(STATS_KEY)) || {
        gamesPlayed: 0, gamesWon: 0, bestTime: null, bestScore: null,
        currentStreak: 0, bestStreak: 0, totalMoves: 0
      };
    } catch (e) {
      return { gamesPlayed: 0, gamesWon: 0, bestTime: null, bestScore: null, currentStreak: 0, bestStreak: 0, totalMoves: 0 };
    }
  }
  function saveStats(stats) { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); }
  function recordGameStart() {
    const stats = loadStats();
    stats.gamesPlayed++;
    saveStats(stats);
  }
  function recordWin() {
    const stats = loadStats();
    stats.gamesWon++;
    stats.currentStreak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
    if (stats.bestTime === null || game.timeSeconds < stats.bestTime) stats.bestTime = game.timeSeconds;
    if (stats.bestScore === null || game.score > stats.bestScore) stats.bestScore = game.score;
    saveStats(stats);
  }
  function recordLoss() {
    const stats = loadStats();
    stats.currentStreak = 0;
    saveStats(stats);
  }

  /* ---------------------------------------------------------
     AUDIO (synthesized, no external files)
  --------------------------------------------------------- */
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
    }
  }
  function playTone(freq, dur, type = 'sine', vol = 0.08) {
    if (!soundEnabled.on) return;
    ensureAudio();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  }
  const sfx = {
    move: () => playTone(520, 0.09, 'triangle', 0.06),
    flip: () => playTone(340, 0.1, 'sine', 0.05),
    invalid: () => playTone(140, 0.15, 'sawtooth', 0.05),
    draw: () => playTone(660, 0.06, 'square', 0.03),
    foundation: () => playTone(880, 0.12, 'sine', 0.07),
    win: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => playTone(f, 0.3, 'sine', 0.08), i * 130)); }
  };

  /* ---------------------------------------------------------
     DECK / CARD BUILDING
  --------------------------------------------------------- */
  function buildAllCards() {
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) {
        const id = cardId(rank, suit);
        allCards[id] = { id, rank, suit, color: isRed(suit) ? 'red' : 'black', faceUp: false };
      }
    }
  }

  function shuffledDeckIds() {
    const ids = Object.keys(allCards);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  }

  /* ---------------------------------------------------------
     DOM CARD CREATION (built once)
  --------------------------------------------------------- */
  function buildCardDom() {
    const frag = document.createDocumentFragment();
    for (const id in allCards) {
      const c = allCards[id];
      const el = document.createElement('div');
      el.className = 'card down ' + c.color;
      el.dataset.id = id;
      el.dataset.pile = 'stock';

      const inner = document.createElement('div');
      inner.className = 'card-inner';

      const front = document.createElement('div');
      front.className = 'card-face card-front';
      front.innerHTML =
        `<div class="corner top-left"><span class="rank">${rankLabel(c.rank)}</span><span class="suit">${SUIT_SYMBOL[c.suit]}</span></div>` +
        `<div class="center-suit">${SUIT_SYMBOL[c.suit]}</div>` +
        `<div class="corner bottom-right"><span class="rank">${rankLabel(c.rank)}</span><span class="suit">${SUIT_SYMBOL[c.suit]}</span></div>`;

      const back = document.createElement('div');
      back.className = 'card-face card-back';

      inner.appendChild(front);
      inner.appendChild(back);
      el.appendChild(inner);
      frag.appendChild(el);
      cardEls[id] = el;
    }
    cardLayerEl.appendChild(frag);
  }

  /* ---------------------------------------------------------
     LAYOUT / SIZING
  --------------------------------------------------------- */
  function updateCardSize() {
    const boardWidth = Math.min(boardEl.clientWidth, 980);
    const gap = boardWidth < 500 ? 6 : 10;
    const cw = Math.floor((boardWidth - gap * 6) / 7);
    const ch = Math.round(cw * 1.4);
    document.documentElement.style.setProperty('--cw', cw + 'px');
    document.documentElement.style.setProperty('--ch', ch + 'px');
    document.documentElement.style.setProperty('--gap', gap + 'px');
  }

  function computeSlotPositions() {
    slotPositions = {};
    document.querySelectorAll('.slot').forEach(slot => {
      const key = slot.dataset.pile;
      slotPositions[key] = { x: slot.offsetLeft, y: slot.offsetTop };
    });
  }

  /* ---------------------------------------------------------
     PILE HELPERS
  --------------------------------------------------------- */
  function tableauKey(i) { return 'tableau-' + i; }
  function foundationKey(s) { return 'foundation-' + s; }

  function findLocation(id) {
    for (let i = 0; i < 7; i++) {
      const idx = game.tableau[i].findIndex(c => c.id === id);
      if (idx !== -1) return { pile: 'tableau', col: i, index: idx, arr: game.tableau[i] };
    }
    for (const s of SUITS) {
      const idx = game.foundations[s].findIndex(c => c.id === id);
      if (idx !== -1) return { pile: 'foundation', suit: s, index: idx, arr: game.foundations[s] };
    }
    let idx = game.waste.findIndex(c => c.id === id);
    if (idx !== -1) return { pile: 'waste', index: idx, arr: game.waste };
    idx = game.stock.findIndex(c => c.id === id);
    if (idx !== -1) return { pile: 'stock', index: idx, arr: game.stock };
    return null;
  }

  /* ---------------------------------------------------------
     RENDER
  --------------------------------------------------------- */
  function render() {
    // Stock
    game.stock.forEach((c, i) => {
      placeCard(c, 'stock', slotPositions['stock'].x, slotPositions['stock'].y + Math.min(i, 6) * 0.4, i, false);
    });
    // Waste
    const wasteBase = slotPositions['waste'];
    const wasteFanCount = game.drawMode === 3 ? Math.min(3, game.waste.length) : 1;
    game.waste.forEach((c, i) => {
      const fromEnd = game.waste.length - 1 - i;
      let x = wasteBase.x, y = wasteBase.y;
      if (fromEnd < wasteFanCount) {
        const fanIndex = wasteFanCount - 1 - fromEnd;
        x += fanIndex * (parseFloat(getCssVar('--cw')) * 0.22);
      }
      placeCard(c, 'waste', x, y, i, true, fromEnd < wasteFanCount);
    });
    // Foundations
    for (const s of SUITS) {
      const base = slotPositions[foundationKey(s)];
      game.foundations[s].forEach((c, i) => {
        placeCard(c, foundationKey(s), base.x, base.y, i, true);
      });
    }
    // Tableau
    for (let col = 0; col < 7; col++) {
      const base = slotPositions[tableauKey(col)];
      const cards = game.tableau[col];
      const cw = parseFloat(getCssVar('--cw'));
      const ch = parseFloat(getCssVar('--ch'));
      const downOffset = ch * 0.16;
      const upOffset = ch * 0.24;
      let y = base.y;
      cards.forEach((c, i) => {
        placeCard(c, tableauKey(col), base.x, y, i, c.faceUp);
        y += c.faceUp ? upOffset : downOffset;
      });
    }
    updateHUD();
    updateAutoCompleteVisibility();
  }

  function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name);
  }

  function placeCard(c, pileKey, x, y, index, faceUp, elevated) {
    const el = cardEls[c.id];
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.zIndex = 100 + index + (elevated ? 500 : 0);
    el.dataset.pile = pileKey;
    if (faceUp) el.classList.remove('down'); else el.classList.add('down');
  }

  /* ---------------------------------------------------------
     HUD
  --------------------------------------------------------- */
  function updateHUD() {
    document.getElementById('hudScore').textContent = Math.max(0, game.score);
    document.getElementById('hudMoves').textContent = game.moves;
    const m = Math.floor(game.timeSeconds / 60).toString().padStart(2, '0');
    const s = (game.timeSeconds % 60).toString().padStart(2, '0');
    document.getElementById('hudTime').textContent = `${m}:${s}`;
  }

  function startTimer() {
    stopTimer();
    timerId = setInterval(() => {
      game.timeSeconds++;
      updateHUD();
    }, 1000);
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  /* ---------------------------------------------------------
     HISTORY / UNDO
  --------------------------------------------------------- */
  function snapshotState() {
    return {
      tableau: game.tableau.map(col => col.map(c => ({ id: c.id, faceUp: c.faceUp }))),
      foundations: Object.fromEntries(SUITS.map(s => [s, game.foundations[s].map(c => ({ id: c.id }))])),
      stock: game.stock.map(c => ({ id: c.id })),
      waste: game.waste.map(c => ({ id: c.id })),
      score: game.score,
      moves: game.moves
    };
  }
  function pushHistory() {
    game.history.push(snapshotState());
    if (game.history.length > 500) game.history.shift();
  }
  function restoreSnapshot(snap) {
    game.tableau = snap.tableau.map(col => col.map(o => {
      const c = allCards[o.id]; c.faceUp = o.faceUp; return c;
    }));
    for (const s of SUITS) {
      game.foundations[s] = snap.foundations[s].map(o => { allCards[o.id].faceUp = true; return allCards[o.id]; });
    }
    game.stock = snap.stock.map(o => { allCards[o.id].faceUp = false; return allCards[o.id]; });
    game.waste = snap.waste.map(o => { allCards[o.id].faceUp = true; return allCards[o.id]; });
    game.score = snap.score;
    game.moves = snap.moves;
  }
  function undo() {
    if (game.history.length === 0) { showToast('Nothing to undo'); return; }
    const snap = game.history.pop();
    restoreSnapshot(snap);
    render();
    saveGame();
  }

  /* ---------------------------------------------------------
     GAME SETUP
  --------------------------------------------------------- */
  function dealNewGame(keepOrder) {
    stopTimer();
    game.tableau = [[], [], [], [], [], [], []];
    game.foundations = { S: [], H: [], D: [], C: [] };
    game.stock = [];
    game.waste = [];
    game.score = 0;
    game.moves = 0;
    game.timeSeconds = 0;
    game.history = [];
    game.won = false;

    const order = keepOrder && game.initialOrder.length ? game.initialOrder.slice() : shuffledDeckIds();
    game.initialOrder = order.slice();

    // reset all cards face down
    for (const id in allCards) allCards[id].faceUp = false;

    let cursor = 0;
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row <= col; row++) {
        const c = allCards[order[cursor++]];
        c.faceUp = (row === col);
        game.tableau[col].push(c);
      }
    }
    while (cursor < order.length) {
      game.stock.push(allCards[order[cursor++]]);
    }

    game.started = true;
    computeSlotPositions();
    animateDeal();
    startTimer();
    recordGameStart();
    saveGame();
  }

  function animateDeal() {
    // place all cards at stock position instantly, then stagger reveal to true layout
    const stockPos = slotPositions['stock'];
    for (const id in cardEls) {
      const el = cardEls[id];
      el.classList.add('down');
      el.style.transition = 'none';
      el.style.transform = `translate(${stockPos.x}px, ${stockPos.y}px)`;
    }
    // force reflow
    void cardLayerEl.offsetWidth;
    for (const id in cardEls) {
      cardEls[id].style.transition = '';
    }
    let delay = 0;
    const order = [];
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row <= col; row++) order.push(game.tableau[col][row].id);
    }
    order.forEach((id, i) => {
      setTimeout(() => { render(); }, 20 + i * 28);
    });
    setTimeout(render, 20 + order.length * 28 + 60);
  }

  /* ---------------------------------------------------------
     MOVE VALIDATION
  --------------------------------------------------------- */
  function canStackTableau(movingCard, targetTopCard) {
    if (!targetTopCard) return movingCard.rank === 13; // empty column needs King
    if (movingCard.color === targetTopCard.color) return false;
    return movingCard.rank === targetTopCard.rank - 1;
  }
  function canStackFoundation(movingCard, foundationArr) {
    if (foundationArr.length === 0) return movingCard.rank === 1;
    const top = foundationArr[foundationArr.length - 1];
    return movingCard.suit === top.suit && movingCard.rank === top.rank + 1;
  }

  /* ---------------------------------------------------------
     CORE MOVE EXECUTION
  --------------------------------------------------------- */
  function moveGroupToTableau(cards, sourceLoc, targetCol) {
    pushHistory();
    const sourceArr = sourceLoc.arr;
    sourceArr.splice(sourceLoc.index, cards.length);
    game.tableau[targetCol].push(...cards);
    game.moves++;
    if (sourceLoc.pile === 'waste') game.score += 5;
    if (sourceLoc.pile === 'foundation') game.score -= 15;
    revealNewTop(sourceLoc);
    finalizeMove();
  }

  function moveCardToFoundation(card, sourceLoc) {
    pushHistory();
    const sourceArr = sourceLoc.arr;
    sourceArr.splice(sourceLoc.index, 1);
    game.foundations[card.suit].push(card);
    card.faceUp = true;
    game.moves++;
    game.score += 10;
    sfx.foundation();
    revealNewTop(sourceLoc);
    finalizeMove();
  }

  function revealNewTop(sourceLoc) {
    if (sourceLoc.pile === 'tableau') {
      const col = game.tableau[sourceLoc.col];
      if (col.length > 0 && !col[col.length - 1].faceUp) {
        col[col.length - 1].faceUp = true;
        game.score += 5;
        sfx.flip();
      }
    }
  }

  function finalizeMove() {
    render();
    saveGame();
    checkWin();
  }

  /* ---------------------------------------------------------
     STOCK / WASTE
  --------------------------------------------------------- */
  function drawFromStock() {
    if (game.stock.length === 0) {
      if (game.waste.length === 0) return;
      pushHistory();
      while (game.waste.length) {
        const c = game.waste.pop();
        c.faceUp = false;
        game.stock.push(c);
      }
      game.moves++;
      render();
      saveGame();
      sfx.flip();
      return;
    }
    pushHistory();
    const n = Math.min(game.drawMode, game.stock.length);
    for (let i = 0; i < n; i++) {
      const c = game.stock.pop();
      c.faceUp = true;
      game.waste.push(c);
    }
    game.moves++;
    sfx.draw();
    render();
    saveGame();
  }

  /* ---------------------------------------------------------
     AUTO / TAP MOVE
  --------------------------------------------------------- */
  function attemptAutoMove(id) {
    const loc = findLocation(id);
    if (!loc) return false;
    const card = allCards[id];

    if (loc.pile === 'stock') { drawFromStock(); return true; }

    const isTopOfPile = loc.index === loc.arr.length - 1;

    // Try foundation first (only single top card)
    if (isTopOfPile && card.faceUp && canStackFoundation(card, game.foundations[card.suit])) {
      moveCardToFoundation(card, loc);
      return true;
    }

    // Try tableau sequence move
    if (loc.pile === 'tableau' && card.faceUp) {
      const group = loc.arr.slice(loc.index);
      if (group.every(c => c.faceUp) && isValidSequence(group)) {
        for (let col = 0; col < 7; col++) {
          if (loc.pile === 'tableau' && col === loc.col) continue;
          const targetArr = game.tableau[col];
          const top = targetArr[targetArr.length - 1];
          if (canStackTableau(group[0], top)) {
            moveGroupToTableau(group, loc, col);
            return true;
          }
        }
      }
    } else if ((loc.pile === 'waste' || loc.pile === 'foundation') && isTopOfPile) {
      for (let col = 0; col < 7; col++) {
        const targetArr = game.tableau[col];
        const top = targetArr[targetArr.length - 1];
        if (canStackTableau(card, top)) {
          moveGroupToTableau([card], loc, col);
          return true;
        }
      }
    }
    sfx.invalid();
    return false;
  }

  function isValidSequence(cards) {
    for (let i = 0; i < cards.length - 1; i++) {
      if (!canStackTableau(cards[i + 1], cards[i])) return false;
    }
    return true;
  }

  /* ---------------------------------------------------------
     DRAG AND DROP (Pointer Events)
  --------------------------------------------------------- */
  const drag = {
    active: false, ids: [], startX: 0, startY: 0, offsetX: 0, offsetY: 0,
    originX: 0, originY: 0, sourceLoc: null, pointerId: null, moved: false, startTime: 0
  };

  function onPointerDown(e) {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    const id = cardEl.dataset.id;
    const loc = findLocation(id);
    if (!loc) return;
    const card = allCards[id];

    drag.startTime = Date.now();
    drag.moved = false;
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    drag.pointerId = e.pointerId;
    drag.sourceLoc = loc;
    drag.ids = [];

    let group = [];
    if (loc.pile === 'tableau') {
      if (!card.faceUp) return;
      group = loc.arr.slice(loc.index);
      if (!group.every(c => c.faceUp) || !isValidSequence(group)) return;
    } else if (loc.pile === 'waste') {
      if (loc.index !== loc.arr.length - 1) return;
      group = [card];
    } else if (loc.pile === 'foundation') {
      if (loc.index !== loc.arr.length - 1) return;
      group = [card];
    } else {
      return; // stock handled via click
    }

    drag.ids = group.map(c => c.id);
    drag.active = true;

    const firstEl = cardEls[drag.ids[0]];
    const match = firstEl.style.transform.match(/-?\d+\.?\d*/g);
    drag.originX = match ? parseFloat(match[0]) : 0;
    drag.originY = match ? parseFloat(match[1]) : 0;

    drag.ids.forEach((cid, i) => {
      const el = cardEls[cid];
      el.classList.add('dragging');
      el.style.zIndex = 9000 + i;
      el.style.pointerEvents = 'none';
    });

    try { cardEl.setPointerCapture(e.pointerId); } catch (err) {}
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(e) {
    if (!drag.active) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
    const ch = parseFloat(getCssVar('--ch'));
    drag.ids.forEach((cid, i) => {
      const el = cardEls[cid];
      el.style.transform = `translate(${drag.originX + dx}px, ${drag.originY + dy + i * (ch * 0.24)}px)`;
    });
  }

  function onPointerUp(e) {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    if (!drag.active) return;

    const wasQuickTap = !drag.moved && (Date.now() - drag.startTime) < 300;

    drag.ids.forEach(cid => {
      const el = cardEls[cid];
      el.classList.remove('dragging');
      el.style.pointerEvents = '';
    });

    if (wasQuickTap) {
      drag.active = false;
      attemptAutoMove(drag.ids[0]);
      render();
      return;
    }

    // Determine drop target
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const pileEl = target ? target.closest('[data-pile]') : null;
    let handled = false;

    if (pileEl) {
      const pileKey = pileEl.dataset.pile;
      const group = drag.ids.map(id => allCards[id]);
      const firstCard = group[0];

      if (pileKey.startsWith('tableau-')) {
        const col = parseInt(pileKey.split('-')[1], 10);
        const targetArr = game.tableau[col];
        const top = targetArr[targetArr.length - 1];
        const isSameColumn = drag.sourceLoc.pile === 'tableau' && drag.sourceLoc.col === col;
        if (!isSameColumn && canStackTableau(firstCard, top)) {
          moveGroupToTableau(group, drag.sourceLoc, col);
          handled = true;
        }
      } else if (pileKey.startsWith('foundation-') && group.length === 1) {
        const suit = pileKey.split('-')[1];
        if (suit === firstCard.suit && canStackFoundation(firstCard, game.foundations[suit])) {
          moveCardToFoundation(firstCard, drag.sourceLoc);
          handled = true;
        }
      }
    }

    drag.active = false;

    if (!handled) {
      sfx.invalid();
      render(); // snap back
    }
  }

  /* ---------------------------------------------------------
     DOUBLE CLICK
  --------------------------------------------------------- */
  function onDblClick(e) {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    attemptAutoMove(cardEl.dataset.id);
  }

  /* ---------------------------------------------------------
     STOCK CLICK
  --------------------------------------------------------- */
  function onSlotClick(e) {
    const slot = e.target.closest('[data-pile]');
    if (!slot) return;
    if (slot.dataset.pile === 'stock') drawFromStock();
  }

  /* ---------------------------------------------------------
     HINT
  --------------------------------------------------------- */
  function findHint() {
    // waste -> foundation
    if (game.waste.length) {
      const c = game.waste[game.waste.length - 1];
      if (canStackFoundation(c, game.foundations[c.suit])) return { from: cardEls[c.id], to: document.getElementById('slot-foundation-' + c.suit) };
    }
    // tableau top -> foundation
    for (let col = 0; col < 7; col++) {
      const arr = game.tableau[col];
      if (arr.length) {
        const c = arr[arr.length - 1];
        if (c.faceUp && canStackFoundation(c, game.foundations[c.suit])) {
          return { from: cardEls[c.id], to: document.getElementById('slot-foundation-' + c.suit) };
        }
      }
    }
    // waste -> tableau
    if (game.waste.length) {
      const c = game.waste[game.waste.length - 1];
      for (let col = 0; col < 7; col++) {
        const top = game.tableau[col][game.tableau[col].length - 1];
        if (canStackTableau(c, top)) return { from: cardEls[c.id], to: document.getElementById('slot-tableau-' + col) };
      }
    }
    // tableau -> tableau
    for (let col = 0; col < 7; col++) {
      const arr = game.tableau[col];
      const faceUpStart = arr.findIndex(c => c.faceUp);
      if (faceUpStart === -1) continue;
      const group = arr.slice(faceUpStart);
      if (!isValidSequence(group)) continue;
      for (let tcol = 0; tcol < 7; tcol++) {
        if (tcol === col) continue;
        const top = game.tableau[tcol][game.tableau[tcol].length - 1];
        if (canStackTableau(group[0], top)) {
          // avoid meaningless king-to-empty shuffle with no benefit
          if (faceUpStart === 0 && !top) continue;
          return { from: cardEls[group[0].id], to: document.getElementById('slot-tableau-' + tcol) };
        }
      }
    }
    // stock available
    if (game.stock.length) return { from: document.getElementById('slot-stock'), to: null, drawHint: true };
    if (game.waste.length) return { from: document.getElementById('slot-stock'), to: null, drawHint: true };
    return null;
  }

  function showHint() {
    const h = findHint();
    if (!h) { showToast('No moves available'); return; }
    if (h.drawHint) {
      h.from.classList.add('hint-glow');
      setTimeout(() => h.from.classList.remove('hint-glow'), 2000);
      showToast('Draw from the stock pile');
      return;
    }
    h.from.classList.add('hint-glow');
    if (h.to) h.to.classList.add('hint-glow');
    setTimeout(() => {
      h.from.classList.remove('hint-glow');
      if (h.to) h.to.classList.remove('hint-glow');
    }, 2000);
  }

  /* ---------------------------------------------------------
     AUTO COMPLETE
  --------------------------------------------------------- */
  function canAutoComplete() {
    return game.tableau.every(col => col.every(c => c.faceUp));
  }
  function updateAutoCompleteVisibility() {
    const btn = document.getElementById('btnAutoComplete');
    if (!game.won && canAutoComplete() && (game.stock.length + game.waste.length + game.tableau.flat().length) > 0 && game.tableau.flat().length > 0) {
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }
  function autoCompleteAll() {
    document.getElementById('btnAutoComplete').classList.add('hidden');
    const step = () => {
      if (game.won) return;
      let moved = false;

      if (game.waste.length) {
        const c = game.waste[game.waste.length - 1];
        if (canStackFoundation(c, game.foundations[c.suit])) {
          moveCardToFoundation(c, { pile: 'waste', index: game.waste.length - 1, arr: game.waste });
          moved = true;
        }
      }
      if (!moved) {
        for (let col = 0; col < 7; col++) {
          const arr = game.tableau[col];
          if (arr.length) {
            const c = arr[arr.length - 1];
            if (canStackFoundation(c, game.foundations[c.suit])) {
              moveCardToFoundation(c, { pile: 'tableau', col, index: arr.length - 1, arr });
              moved = true;
              break;
            }
          }
        }
      }
      if (!moved && game.stock.length) { drawFromStock(); moved = true; }
      if (!moved && !game.stock.length && game.waste.length) { drawFromStock(); moved = true; }

      if (moved && !game.won) {
        setTimeout(step, 130);
      }
    };
    step();
  }

  /* ---------------------------------------------------------
     WIN
  --------------------------------------------------------- */
  function checkWin() {
    const total = SUITS.reduce((sum, s) => sum + game.foundations[s].length, 0);
    if (total === 52 && !game.won) {
      game.won = true;
      stopTimer();
      sfx.win();
      recordWin();
      clearSave();
      spawnConfetti();
      setTimeout(showWinModal, 500);
    }
  }

  function spawnConfetti() {
    const layer = document.getElementById('confettiLayer');
    const colors = ['#e9c46a', '#4cc9a0', '#e76f51', '#f2d38a', '#8ecae6', '#f4a261'];
    for (let i = 0; i < 140; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = (2.2 + Math.random() * 1.8) + 's';
      piece.style.animationDelay = (Math.random() * 0.6) + 's';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      layer.appendChild(piece);
      setTimeout(() => piece.remove(), 5000);
    }
  }

  /* ---------------------------------------------------------
     SAVE / LOAD GAME
  --------------------------------------------------------- */
  function saveGame() {
    if (!game.started || game.won) return;
    const data = {
      tableau: game.tableau.map(col => col.map(c => ({ id: c.id, faceUp: c.faceUp }))),
      foundations: Object.fromEntries(SUITS.map(s => [s, game.foundations[s].map(c => c.id)])),
      stock: game.stock.map(c => c.id),
      waste: game.waste.map(c => c.id),
      drawMode: game.drawMode,
      score: game.score,
      moves: game.moves,
      timeSeconds: game.timeSeconds,
      initialOrder: game.initialOrder
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  }

  function clearSave() { localStorage.removeItem(SAVE_KEY); }

  function loadGame() {
    let data;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return false; }
    if (!data) return false;
    try {
      for (const id in allCards) allCards[id].faceUp = false;
      game.tableau = data.tableau.map(col => col.map(o => { allCards[o.id].faceUp = o.faceUp; return allCards[o.id]; }));
      game.foundations = {};
      for (const s of SUITS) game.foundations[s] = data.foundations[s].map(id => { allCards[id].faceUp = true; return allCards[id]; });
      game.stock = data.stock.map(id => { allCards[id].faceUp = false; return allCards[id]; });
      game.waste = data.waste.map(id => { allCards[id].faceUp = true; return allCards[id]; });
      game.drawMode = data.drawMode || 1;
      game.score = data.score || 0;
      game.moves = data.moves || 0;
      game.timeSeconds = data.timeSeconds || 0;
      game.initialOrder = data.initialOrder || [];
      game.history = [];
      game.won = false;
      game.started = true;
      return true;
    } catch (e) { return false; }
  }

  /* ---------------------------------------------------------
     UI: MODALS / MENU / TOAST
  --------------------------------------------------------- */
  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.classList.add('hidden'), 250);
    }, 1800);
  }

  function openMenu() { document.getElementById('menuOverlay').classList.remove('hidden'); }
  function closeMenu() { document.getElementById('menuOverlay').classList.add('hidden'); }

  function openModal(html) {
    document.getElementById('modalContent').innerHTML = html;
    document.getElementById('modalOverlay').classList.remove('hidden');
  }
  function closeModal() { document.getElementById('modalOverlay').classList.add('hidden'); }

  function showStatsModal() {
    const s = loadStats();
    const fmtTime = t => t === null ? '--:--' : `${Math.floor(t / 60).toString().padStart(2, '0')}:${(t % 60).toString().padStart(2, '0')}`;
    openModal(`
      <h2>Statistics</h2>
      <div class="stat-grid">
        <div class="stat-card"><div class="num">${s.gamesPlayed}</div><div class="lbl">Played</div></div>
        <div class="stat-card"><div class="num">${s.gamesWon}</div><div class="lbl">Won</div></div>
        <div class="stat-card"><div class="num">${s.gamesPlayed ? Math.round(100 * s.gamesWon / s.gamesPlayed) : 0}%</div><div class="lbl">Win Rate</div></div>
        <div class="stat-card"><div class="num">${s.bestStreak}</div><div class="lbl">Best Streak</div></div>
        <div class="stat-card"><div class="num">${fmtTime(s.bestTime)}</div><div class="lbl">Best Time</div></div>
        <div class="stat-card"><div class="num">${s.bestScore ?? 0}</div><div class="lbl">Best Score</div></div>
      </div>
    `);
  }

  function showHowToModal() {
    openModal(`
      <h2>How To Play</h2>
      <p>Build tableau piles in descending order, alternating colors. Move Kings to empty columns.</p>
      <p>Build the four foundation piles up from Ace to King, one suit each.</p>
      <p>Tap the stock pile to draw cards. Drag cards or double-tap them to move automatically.</p>
      <p>Use Undo to reverse moves and Hint if you get stuck. Complete all four foundations to win!</p>
    `);
  }

  function showWinModal() {
    openModal(`
      <div class="win-title">🎉 You Won!</div>
      <div class="win-sub">Score ${Math.max(0,game.score)} · ${game.moves} moves · ${document.getElementById('hudTime').textContent}</div>
      <div class="modal-actions">
        <button class="menu-btn primary" id="btnWinNewGame">New Game</button>
      </div>
    `);
    document.getElementById('btnWinNewGame').addEventListener('click', () => {
      closeModal();
      dealNewGame(false);
    });
  }

  /* ---------------------------------------------------------
     EVENT WIRING
  --------------------------------------------------------- */
  function wireEvents() {
    cardLayerEl.addEventListener('pointerdown', onPointerDown);
    cardLayerEl.addEventListener('dblclick', onDblClick);
    boardEl.addEventListener('click', onSlotClick);

    document.getElementById('btnMenu').addEventListener('click', openMenu);
    document.getElementById('btnCloseMenu').addEventListener('click', closeMenu);
    document.getElementById('menuOverlay').addEventListener('click', e => { if (e.target.id === 'menuOverlay') closeMenu(); });

    document.getElementById('btnModalClose').addEventListener('click', closeModal);
    document.getElementById('modalOverlay').addEventListener('click', e => { if (e.target.id === 'modalOverlay') closeModal(); });

    document.getElementById('btnUndo').addEventListener('click', undo);
    document.getElementById('btnHint').addEventListener('click', showHint);
    document.getElementById('btnAutoComplete').addEventListener('click', autoCompleteAll);

    document.getElementById('btnNewGame').addEventListener('click', () => {
      closeMenu();
      if (game.started && game.moves > 0 && !game.won) recordLoss();
      dealNewGame(false);
      showToast('New game started');
    });
    document.getElementById('btnRestart').addEventListener('click', () => {
      closeMenu();
      dealNewGame(true);
      showToast('Deal restarted');
    });

    document.getElementById('btnStats').addEventListener('click', () => { closeMenu(); showStatsModal(); });
    document.getElementById('btnHowTo').addEventListener('click', () => { closeMenu(); showHowToModal(); });

    document.getElementById('drawModeToggle').addEventListener('click', e => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      const mode = parseInt(btn.dataset.mode, 10);
      if (mode === game.drawMode) return;
      [...btn.parentElement.children].forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      game.drawMode = mode;
      savePrefs();
      closeMenu();
      dealNewGame(false);
      showToast(`Draw ${mode} mode — new game started`);
    });

    document.getElementById('themeToggle').addEventListener('click', e => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      [...btn.parentElement.children].forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.body.setAttribute('data-theme', btn.dataset.theme);
      savePrefs();
    });

    document.getElementById('soundToggle').addEventListener('change', e => {
      soundEnabled.on = e.target.checked;
      savePrefs();
    });

    window.addEventListener('resize', debounce(() => {
      updateCardSize();
      requestAnimationFrame(() => { computeSlotPositions(); render(); });
    }, 120));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) saveGame();
    });
    window.addEventListener('beforeunload', saveGame);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ---------------------------------------------------------
     INIT
  --------------------------------------------------------- */
  function init() {
    boardEl = document.getElementById('board');
    cardLayerEl = document.getElementById('cardLayer');

    loadPrefs();
    document.getElementById('soundToggle').checked = soundEnabled.on;
    const theme = document.body.getAttribute('data-theme');
    document.querySelectorAll('#themeToggle .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));

    buildAllCards();
    buildCardDom();
    updateCardSize();
    computeSlotPositions();
    wireEvents();

    document.querySelectorAll('#drawModeToggle .seg-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.mode, 10) === game.drawMode));

    const resumed = loadGame();
    if (resumed) {
      computeSlotPositions();
      render();
      startTimer();
      showToast('Resumed your game');
    } else {
      dealNewGame(false);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

})();
