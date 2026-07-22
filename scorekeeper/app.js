/* ============================================================
 * 记分牌  PWA  —— 纯静态，无构建、无服务端
 * 数据全部存于 localStorage
 * ============================================================ */

/* ---------- 工具 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const STORE_KEY = 'sk_games_v1';

function loadGames() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
  catch { return []; }
}
function saveGames(games) {
  localStorage.setItem(STORE_KEY, JSON.stringify(games));
}
// 当前内存中的对局列表（保证一致）
let GAMES = loadGames();

function findGame(id) { return GAMES.find((g) => g.id === id); }

/* ---------- 记分模型（纯函数） ---------- */
// 座位：0,2 为 A 队（对门）；1,3 为 B 队
const teamOf = (i) => (i % 2 === 0 ? 'A' : 'B');

function computeScores(game) {
  const scores = {};
  game.players.forEach((p) => (scores[p.id] = p.initial || 0));
  (game.rounds || []).forEach((r) => {
    const val = game.tiers[r.tier] || 0;
    r.seats.forEach((pid, i) => {
      if (!pid) return;
      const team = teamOf(i);
      scores[pid] = (scores[pid] || 0) + (team === r.winner ? val : -val);
    });
  });
  return scores;
}

/* ---------- 视图路由 ---------- */
const app = $('#app');
let curGameId = null;

function setHeader(title, { back = false, share = false } = {}) {
  $('#appTitle').textContent = title;
  $('#btnBack').hidden = !back;
  $('#btnShare').hidden = !share;
}
$('#btnBack').addEventListener('click', () => {
  if (curGameId) { const g = findGame(curGameId); if (g && g.finished) { curGameId = null; renderHome(); } else { renderHome(); } }
  else renderHome();
});
$('#btnShare').addEventListener('click', onShare);

/* ============================================================
 * 视图 1：首页 —— 对局历史列表
 * ============================================================ */
function renderHome() {
  curGameId = null;
  setHeader('记分牌', { back: false, share: false });
  GAMES = loadGames();
  const live = GAMES.filter((g) => !g.finished).sort((a, b) => b.createdAt - a.createdAt);
  const done = GAMES.filter((g) => g.finished).sort((a, b) => b.createdAt - a.createdAt);

  let html = `<button class="btn primary" id="newGame">＋ 新建对局</button>`;
  html += `<div class="row" style="margin-bottom:14px">
    <button class="btn ghost sm" id="exportAll">⬇ 导出全部</button>
    <button class="btn ghost sm" id="importAll">⬆ 导入</button>
  </div>`;
  html += `<div class="section-title">进行中（${live.length}）</div>`;
  html += live.length
    ? live.map(gameCardHTML).join('')
    : `<div class="empty">暂无进行中的对局</div>`;
  html += `<div class="section-title">已结束（${done.length}）</div>`;
  html += done.length
    ? done.map(gameCardHTML).join('')
    : `<div class="empty">暂无已结束的对局</div>`;

  app.innerHTML = html;
  $('#newGame').addEventListener('click', renderSetup);
  $('#exportAll').addEventListener('click', exportAll);
  $('#importAll').addEventListener('click', importAll);
  $$('.game-card').forEach((c) => {
    const id = c.dataset.id;
    // 长按删除（移动端友好）
    let pressTimer = null, longFired = false;
    const startPress = () => {
      longFired = false;
      pressTimer = setTimeout(() => { longFired = true; confirmDeleteGame(id); }, 600);
    };
    const cancelPress = () => { clearTimeout(pressTimer); };
    c.addEventListener('touchstart', startPress, { passive: true });
    c.addEventListener('touchend', cancelPress);
    c.addEventListener('touchmove', cancelPress);
    c.addEventListener('mousedown', startPress);
    c.addEventListener('mouseup', cancelPress);
    c.addEventListener('mouseleave', cancelPress);

    c.addEventListener('click', (e) => {
      if (e.target.closest('.gc-del')) return; // 删除图标单独处理
      if (longFired) { longFired = false; return; } // 长按已触发删除，不再打开
      openGame(id);
    });
    c.querySelector('.gc-del').addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDeleteGame(id);
    });
  });
}

// 删除单个对局（首页 / 详情页共用）
function confirmDeleteGame(id) {
  const g = findGame(id);
  if (!g) return;
  confirmModal('删除本局', `确定删除对局「${g.name || '未命名对局'}」？此操作不可撤销。`, [
    { label: '取消', cls: 'ghost', onClick: closeModal },
    { label: '删除', cls: 'danger', onClick: () => {
        GAMES = GAMES.filter((x) => x.id !== id);
        saveGames(GAMES); closeModal(); showToast('已删除'); renderHome();
      } }
  ]);
}

function gameCardHTML(g) {
  const totalRounds = g.rounds ? g.rounds.length : 0;
  const sub = `${g.players.length}人 · ${totalRounds}轮 · ${g.finished ? '已结束' : '进行中'}`;
  return `<div class="game-card" data-id="${g.id}">
    <div class="gc-main">
      <div class="gc-title">${escapeHTML(g.name || '未命名对局')}</div>
      <div class="gc-sub">${sub}</div>
    </div>
    <span class="badge ${g.finished ? 'done' : 'live'}">${g.finished ? '已结束' : '进行中'}</span>
    <button class="gc-del" data-del="${g.id}" aria-label="删除">🗑</button>
  </div>`;
}

function openGame(id) {
  curGameId = id;
  const g = findGame(id);
  if (!g) { renderHome(); return; }
  if (g.finished) renderGameView(g, true);
  else renderGameView(g, false);
}

/* ============================================================
 * 视图 2：新建 / 编辑 对局设置
 * ============================================================ */
function renderSetup() {
  setHeader('新建对局', { back: true });
  // 编辑态内存暂存
  setupState = {
    name: '',
    players: [newPlayer(), newPlayer(), newPlayer(), newPlayer()],
    tiers: [10, 20, 30]
  };
  drawSetup();
}

function newPlayer(name = '') {
  return { id: uid(), name, initial: 0 };
}

let setupState = null;

function drawSetup() {
  const players = setupState.players.map((p, i) => `
    <div class="player-row" data-i="${i}">
      <input class="name" type="text" placeholder="玩家${i + 1}" value="${escapeHTML(p.name)}" />
      <input class="num" type="number" placeholder="初始分" value="${p.initial}" />
      <button class="icon-btn del" aria-label="删除">×</button>
    </div>`).join('');

  const tiers = setupState.tiers.map((t, i) =>
    `<label class="field" style="flex:1;margin:0">
       <span>第${['一', '二', '三'][i]}档</span>
       <input type="number" data-tier="${i}" value="${t}" />
     </label>`).join('');

  app.innerHTML = `
    <div class="card">
      <label class="field"><span>对局名称（可选）</span>
        <input type="text" id="gameName" placeholder="例如：周五牌局" value="${escapeHTML(setupState.name)}" />
      </label>
      <div class="section-title">玩家（4-6 人，可中途添加）</div>
      <div id="playerList">${players}</div>
      <button class="btn ghost sm" id="addPlayer">＋ 添加玩家</button>
      <div class="tiny muted" style="margin-top:6px">初始分默认 0，可填写（例如带入的分值）</div>
    </div>

    <div class="card">
      <div class="section-title">三档倍率（开局设定后不再修改）</div>
      <div class="row">${tiers}</div>
      <div class="tiny muted" style="margin-top:6px">每档分值可任意设置，例如 10 / 20 / 30</div>
    </div>

    <button class="btn primary" id="startGame">开始对局</button>
  `;

  // 绑定
  $('#gameName').addEventListener('input', (e) => (setupState.name = e.target.value));
  $$('#playerList .player-row').forEach((row) => {
    const i = +row.dataset.i;
    row.querySelector('.name').addEventListener('input', (e) => (setupState.players[i].name = e.target.value));
    row.querySelector('.num').addEventListener('input', (e) => (setupState.players[i].initial = Number(e.target.value) || 0));
    row.querySelector('.del').addEventListener('click', () => {
      if (setupState.players.length <= 4) { showToast('至少保留 4 名玩家'); return; }
      setupState.players.splice(i, 1);
      drawSetup();
    });
  });
  $('#addPlayer').addEventListener('click', () => {
    if (setupState.players.length >= 6) { showToast('最多 6 名玩家'); return; }
    setupState.players.push(newPlayer());
    drawSetup();
  });
  $$('input[data-tier]').forEach((inp) =>
    inp.addEventListener('input', (e) => (setupState.tiers[+e.target.dataset.tier] = Number(e.target.value) || 0))
  );
  $('#startGame').addEventListener('click', startGame);
}

function startGame() {
  const players = setupState.players.map((p) => ({
    id: p.id,
    name: (p.name || '').trim() || `玩家${setupState.players.indexOf(p) + 1}`,
    initial: p.initial || 0
  }));
  const game = {
    id: uid(),
    name: (setupState.name || '').trim() || '未命名对局',
    createdAt: Date.now(),
    finished: false,
    tiers: setupState.tiers.slice(),
    players,
    rounds: []
  };
  GAMES.push(game);
  saveGames(GAMES);
  openGame(game.id);
}

/* ============================================================
 * 视图 3：对局进行 / 查看（进行中可编辑，已结束只读）
 * ============================================================ */
function renderGameView(game, readOnly) {
  setHeader(game.name || '对局', { back: true, share: true });
  const scores = computeScores(game);
  const ordered = [...game.players].sort((a, b) => scores[b.id] - scores[a.id]);

  const board = ordered.map((p) => {
    const v = scores[p.id] || 0;
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
    return `<div class="score-chip">
      <div class="name">${escapeHTML(p.name)}</div>
      <div class="val ${cls}">${v > 0 ? '+' : ''}${v}</div>
      ${p.initial ? `<div class="tiny muted">初始 ${p.initial}</div>` : ''}
    </div>`;
  }).join('');

  const tiers = game.tiers.map((t, i) => `第${['一', '二', '三'][i]}档 ${t}`).join(' ｜ ');

  const roundsHTML = roundsTableHTML(game, readOnly);

  const imgBtn = `<button class="btn ghost" id="shareImg">🖼 生成成绩图片</button>`;
  const delBtn = `<button class="btn danger" id="delGame" style="margin-top:10px">删除本局</button>`;
  let actions = '';
  if (!readOnly) {
    actions = `
      <div class="divider"></div>
      ${imgBtn}
      <button class="btn primary" id="addRound">＋ 记一轮</button>
      <div class="row" style="margin-top:10px">
        <button class="btn ghost" id="editSetup">编辑设置</button>
        <button class="btn accent" id="finishGame">结束对局</button>
      </div>
      ${delBtn}`;
  } else {
    actions = `<div class="divider"></div>${imgBtn}<div class="muted" style="text-align:center;margin:8px 0">本局已结束（只读）</div>${delBtn}`;
  }

  app.innerHTML = `
    <div class="card">
      <div class="muted tiny">倍率：${tiers}</div>
      <div class="section-title">实时总分</div>
      <div class="scoreboard">${board}</div>
    </div>
    <div class="section-title">轮次记录（${game.rounds.length}）</div>
    <div id="roundList">${roundsHTML}</div>
    ${actions}
  `;

  if (!readOnly) {
    $('#addRound').addEventListener('click', () => openRoundForm(game, null));
    $('#editSetup').addEventListener('click', () => openSetupEdit(game));
    $('#finishGame').addEventListener('click', () => {
      confirmModal('结束对局', '结束后本局将归档为只读，仍可随时回看。确定结束？', [
        { label: '取消', cls: 'ghost', onClick: closeModal },
        { label: '结束并归档', cls: 'accent', onClick: () => {
            game.finished = true; saveGames(GAMES); closeModal(); showToast('已归档'); renderGameView(game, true);
          } }
      ]);
    });
    $$('#roundList [data-act="edit"]').forEach((b) =>
      b.addEventListener('click', () => openRoundForm(game, +b.dataset.idx))
    );
    $$('#roundList [data-act="del"]').forEach((b) =>
      b.addEventListener('click', () => {
        const idx = +b.dataset.idx;
        confirmModal('删除本轮', `确定删除第 ${idx + 1} 轮？删除后总分自动重算。`, [
          { label: '取消', cls: 'ghost', onClick: closeModal },
          { label: '删除', cls: 'danger', onClick: () => { game.rounds.splice(idx, 1); saveGames(GAMES); closeModal(); renderGameView(game, false); } }
        ]);
      })
    );
  }

  const sb = $('#shareImg');
  if (sb) sb.addEventListener('click', () => shareGameImage(game));

  const db = $('#delGame');
  if (db) db.addEventListener('click', () => confirmDeleteGame(game.id));
}

/* 轮次得分表格：行=轮次，列=各玩家；含初始行与总分行，便于核对 */
function roundsTableHTML(game, readOnly) {
  if (!game.rounds.length) {
    return `<div class="empty">还没有记录，点下方“记一轮”开始</div>`;
  }
  const players = game.players;
  const scores = computeScores(game);
  const cellVal = (v) => {
    const cls = v > 0 ? 'rt-pos' : v < 0 ? 'rt-neg' : 'rt-zero';
    return `<td class="${cls}">${v > 0 ? '+' : ''}${v}</td>`;
  };

  let head = `<th class="rt-rnd">轮</th>`;
  head += players.map((p) => `<th>${escapeHTML(p.name)}</th>`).join('');
  head += `<th class="rt-info">档/胜</th>`;
  if (!readOnly) head += `<th class="rt-act">操作</th>`;

  const emptyTail = `<td class="rt-info"></td>${readOnly ? '' : '<td class="rt-act"></td>'}`;

  const hasInit = players.some((p) => p.initial);
  let initRow = '';
  if (hasInit) {
    initRow = `<tr class="rt-sub"><td class="rt-rnd">初</td>` +
      players.map((p) => `<td class="rt-zero">${p.initial || 0}</td>`).join('') +
      emptyTail + `</tr>`;
  }

  const rows = game.rounds.map((r, idx) => {
    const val = game.tiers[r.tier] || 0;
    const byPid = {};
    r.seats.forEach((pid, i) => { if (pid) byPid[pid] = teamOf(i) === r.winner ? val : -val; });
    const cells = players.map((p) =>
      (p.id in byPid) ? cellVal(byPid[p.id]) : `<td class="rt-na">–</td>`
    ).join('');
    const nameOf = (pid) => (game.players.find((p) => p.id === pid) || {}).name || '?';
    const teamA = [r.seats[0], r.seats[2]].filter(Boolean).map(nameOf);
    const teamB = [r.seats[1], r.seats[3]].filter(Boolean).map(nameOf);
    const aWin = r.winner === 'A';
    const info =
      `<span class="${aWin ? 'rt-win' : 'rt-lose'}">${aWin ? '✓ ' : ''}${escapeHTML(teamA.join('、'))}</span><br>` +
      `<span class="${!aWin ? 'rt-win' : 'rt-lose'}">${!aWin ? '✓ ' : ''}${escapeHTML(teamB.join('、'))}</span><br>` +
      `<span class="rt-tier">${['一', '二', '三'][r.tier]}档 ${val}</span>`;
    const act = readOnly ? '' : `<td class="rt-act">
      <button class="rt-btn edit" data-act="edit" data-idx="${idx}">改</button>
      <button class="rt-btn del" data-act="del" data-idx="${idx}">删</button></td>`;
    return `<tr><td class="rt-rnd">${idx + 1}</td>${cells}<td class="rt-info">${info}</td>${act}</tr>`;
  }).join('');

  const totalRow = `<tr class="rt-total"><td class="rt-rnd">总</td>` +
    players.map((p) => cellVal(scores[p.id] || 0)).join('') +
    emptyTail + `</tr>`;

  return `<div class="rt-wrap"><table class="rt">
    <thead><tr>${head}</tr></thead>
    <tbody>${initRow}${rows}${totalRow}</tbody>
  </table></div>`;
}

/* ============================================================
 * 轮次录入 / 编辑 弹窗（牌桌座位选择）
 * ============================================================ */
let roundForm = null;

function openRoundForm(game, idx) {
  if (idx === null) {
    // 新一轮：默认沿用上一轮的座位（位置不变），档位/胜方每轮重选
    const last = game.rounds[game.rounds.length - 1];
    const seats = last ? last.seats.slice() : [null, null, null, null];
    roundForm = { seats, winner: null, tier: null, editing: null };
  } else {
    const r = game.rounds[idx];
    roundForm = { seats: r.seats.slice(), winner: r.winner, tier: r.tier, editing: idx };
  }
  drawRoundForm(game);
}

// 某队当前座上玩家名（用于胜方按钮，随座位调整实时刷新）
function winNames(game, team) {
  const idxs = team === 'A' ? [0, 2] : [1, 3];
  const names = idxs
    .map((i) => roundForm.seats[i])
    .filter(Boolean)
    .map((pid) => (game.players.find((p) => p.id === pid) || {}).name || '?');
  return names.length ? names.join('、') : '未选人';
}

function drawRoundForm(game) {
  const seatHTML = roundForm.seats.map((pid, i) => {
    const name = pid ? (game.players.find((p) => p.id === pid) || {}).name || '?' : '点击选人';
    const teamCls = i % 2 === 0 ? 'sel-A' : 'sel-B';
    const tag = i % 2 === 0 ? 'A队' : 'B队';
    const sel = pid ? teamCls : '';
    return `<div class="seat ${sel}" data-pos="${i + 1}" data-seat="${i}">
      <div class="seat-tag">${tag}</div>
      <div class="seat-name">${escapeHTML(name)}</div>
    </div>`;
  }).join('');

  const tierBtns = game.tiers.map((t, i) =>
    `<div class="tier-btn ${roundForm.tier === i ? 'active' : ''}" data-tier="${i}">
       <div class="tv">${t}</div><div class="tl">第${['一', '二', '三'][i]}档</div>
     </div>`).join('');

  const body = `
    <div class="muted tiny" style="text-align:center">对角为队友：上/下 = A队，左/右 = B队</div>
    <div class="table-seats">
      ${seatHTML}
      <div class="team-label A">A</div>
      <div class="team-label B">B</div>
    </div>
    <div class="section-title">选择档位</div>
    <div class="tier-group">${tierBtns}</div>
    <div class="section-title">选择胜方</div>
    <div class="win-group">
      <div class="win-btn A ${roundForm.winner === 'A' ? 'active' : ''}" data-win="A">
        <div class="wl">A 队胜</div><div class="wn">${escapeHTML(winNames(game, 'A'))}</div>
      </div>
      <div class="win-btn B ${roundForm.winner === 'B' ? 'active' : ''}" data-win="B">
        <div class="wl">B 队胜</div><div class="wn">${escapeHTML(winNames(game, 'B'))}</div>
      </div>
    </div>
    <div class="muted tiny" id="formHint">需选满 4 个座位、档位与胜方。</div>
  `;

  openModal(roundForm.editing !== null ? '修改本轮' : '记一轮', body, [
    { label: '取消', cls: 'ghost', onClick: closeModal },
    { label: roundForm.editing !== null ? '保存修改' : '保存本轮', cls: 'primary', onClick: () => saveRound(game) }
  ]);

  // 绑定座位
  $$('.seat').forEach((s) => {
    s.addEventListener('click', () => pickSeat(game, +s.dataset.seat));
  });
  // 档位
  $$('.tier-btn').forEach((b) => b.addEventListener('click', () => {
    roundForm.tier = +b.dataset.tier; drawRoundForm(game);
  }));
  // 胜方
  $$('.win-btn').forEach((b) => b.addEventListener('click', () => {
    roundForm.winner = b.dataset.win; drawRoundForm(game);
  }));
}

function pickSeat(game, seatIdx) {
  const cur = roundForm.seats[seatIdx];
  const seatTeam = (i) => (teamOf(i) === 'A' ? 'A队' : 'B队');

  const items = game.players.map((p) => {
    const atIdx = roundForm.seats.indexOf(p.id);
    let tag = '';
    if (atIdx === seatIdx) tag = '<span class="badge live">当前座位</span>';
    else if (atIdx !== -1) tag = `<span class="badge swap">在${seatTeam(atIdx)}·交换</span>`;
    return `<div class="pick-item" data-pick="${p.id}">
       <span class="pick-name">${escapeHTML(p.name)}</span>${tag}
     </div>`;
  }).join('');
  const clearBtn = cur ? `<div class="pick-item danger" data-clear="1">清空此座位</div>` : '';

  openModal(`选择第 ${seatIdx + 1} 号位（${seatTeam(seatIdx)}）`, `<div id="pickList">${clearBtn}${items}</div>`, [
    { label: '关闭', cls: 'ghost', onClick: () => { closeModal(); drawRoundForm(game); } }
  ]);

  $$('#pickList [data-pick]').forEach((it) =>
    it.addEventListener('click', () => {
      const pid = it.dataset.pick;
      const atIdx = roundForm.seats.indexOf(pid);
      if (atIdx === seatIdx) {
        // 点自己：无变化
      } else if (atIdx !== -1) {
        // 已在场上：两个座位互换（对方换到本座位原来的人的位置）
        roundForm.seats[atIdx] = roundForm.seats[seatIdx];
        roundForm.seats[seatIdx] = pid;
      } else {
        // 新人：直接替换本座位
        roundForm.seats[seatIdx] = pid;
      }
      closeModal(); drawRoundForm(game);
    })
  );
  const clr = $('#pickList [data-clear]');
  if (clr) clr.addEventListener('click', () => { roundForm.seats[seatIdx] = null; closeModal(); drawRoundForm(game); });
}

function saveRound(game) {
  const filled = roundForm.seats.every(Boolean);
  const distinct = new Set(roundForm.seats).size === 4;
  if (!filled) { showToast('请选满 4 个座位'); return; }
  if (!distinct) { showToast('4 个座位必须是不同的人'); return; }
  if (roundForm.tier === null) { showToast('请选择档位'); return; }
  if (!roundForm.winner) { showToast('请选择胜方'); return; }

  const r = { seats: roundForm.seats.slice(), winner: roundForm.winner, tier: roundForm.tier };
  if (roundForm.editing !== null) game.rounds[roundForm.editing] = r;
  else game.rounds.push(r);
  saveGames(GAMES);
  closeModal();
  renderGameView(game, false);
  showToast(roundForm.editing !== null ? '已修改' : '已记录');
}

/* ============================================================
 * 编辑对局设置（倍率仅在无轮次时可改；初始分随时可改）
 * ============================================================ */
function openSetupEdit(game) {
  const tiersLocked = game.rounds.length > 0; // 有轮次后倍率锁定
  const players = game.players.map((p, i) => {
    const isNew = !!p._new; // 本次编辑新添加、尚未保存的玩家
    return `
    <div class="player-row" data-i="${i}">
      <input class="name" type="text" placeholder="玩家${i + 1}" value="${escapeHTML(p.name)}" ${isNew ? '' : 'disabled'} />
      <input class="num" type="number" placeholder="初始分" value="${p.initial}" />
      ${isNew ? '<button class="icon-btn del" aria-label="删除">×</button>' : '<span class="lock-tag" title="已有玩家不可删除/改名">🔒</span>'}
    </div>`;
  }).join('');

  const tiers = game.tiers.map((t, i) =>
    `<label class="field" style="flex:1;margin:0">
       <span>第${['一', '二', '三'][i]}档</span>
       <input type="number" data-tier="${i}" value="${t}" ${tiersLocked ? 'disabled' : ''} />
     </label>`).join('');

  const body = `
    <label class="field"><span>对局名称</span>
      <input type="text" id="editName" value="${escapeHTML(game.name)}" />
    </label>
    <div class="section-title">玩家（已有玩家不可改名/删除，可添加新玩家）</div>
    <div id="editPlayers">${players}</div>
    <button class="btn ghost sm" id="editAdd">＋ 添加玩家</button>
    <div class="section-title">三档倍率${tiersLocked ? '（已有轮次，已锁定）' : '（开局设定）'}</div>
    <div class="row">${tiers}</div>
    <div class="tiny muted" style="margin-top:6px">初始分可随时修改，保存后总分自动重算。</div>
  `;

  openModal('编辑设置', body, [
    { label: '取消', cls: 'ghost', onClick: closeModal },
    { label: '保存', cls: 'primary', onClick: () => applySetupEdit(game, tiersLocked) }
  ]);
  // 未保存关闭（取消/×/遮罩）时丢弃新玩家；保存时 _new 已转正故不受影响
  setModalCloseHook(() => cleanupNewPlayers(game));

  $$('#editPlayers .player-row').forEach((row) => {
    const i = +row.dataset.i;
    const nameInp = row.querySelector('.name');
    if (nameInp && !nameInp.disabled) nameInp.addEventListener('input', (e) => (game.players[i].name = e.target.value));
    row.querySelector('.num').addEventListener('input', (e) => (game.players[i].initial = Number(e.target.value) || 0));
    const del = row.querySelector('.del');
    if (del) del.addEventListener('click', () => { game.players.splice(i, 1); openSetupEdit(game); });
  });
  $$('input[data-tier]').forEach((inp) => inp.addEventListener('input', (e) => (game.tiers[+e.target.dataset.tier] = Number(e.target.value) || 0)));
  $('#editName').addEventListener('input', (e) => (game.name = e.target.value));
  $('#editAdd').addEventListener('click', () => {
    if (game.players.length >= 6) { showToast('最多 6 人'); return; }
    const p = newPlayer(); p._new = true;
    game.players.push(p);
    openSetupEdit(game);
  });
}

// 取消编辑时，丢弃尚未保存的新玩家
function cleanupNewPlayers(game) {
  game.players = game.players.filter((p) => !p._new);
}

function applySetupEdit(game, tiersLocked) {
  game.name = ($('#editName').value || '').trim() || '未命名对局';
  if (!tiersLocked) game.tiers = game.tiers.map((t) => Number(t) || 0);
  game.players.forEach((p, i) => {
    p.name = (p.name || '').trim() || `玩家${i + 1}`;
    delete p._new; // 转正为已有玩家
  });
  saveGames(GAMES);
  closeModal();
  renderGameView(game, false);
  showToast('已保存');
}

/* ============================================================
 * 分享 / 导出导入 / 成绩图片
 * ============================================================ */
function buildShareText(g) {
  const scores = computeScores(g);
  const lines = [...g.players]
    .sort((a, b) => scores[b.id] - scores[a.id])
    .map((p, i) => `${i + 1}. ${p.name} ${scores[p.id] > 0 ? '+' : ''}${scores[p.id]}`)
    .join('\n');
  return `【${g.name}】\n${lines}\n—— 记分牌`;
}

function onShare() {
  const g = findGame(curGameId);
  if (!g) return;
  const text = buildShareText(g);
  if (navigator.share) {
    navigator.share({ title: g.name, text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('成绩已复制，可粘贴分享')).catch(() => showToast(text));
  } else {
    showToast('当前环境不支持分享，结果：' + text);
  }
}

function onShareText(game) {
  const text = buildShareText(game);
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('成绩已复制')).catch(() => showToast(text));
  } else {
    showToast(text);
  }
}

/* 生成成绩图片（canvas），可分享或保存 */
function shareGameImage(game) {
  showToast('正在生成图片…');
  const canvas = buildScoreImage(game);
  const dataURL = canvas.toDataURL('image/png');
  canvas.toBlob((blob) => {
    const file = blob ? new File([blob], `${(game.name || 'score')}.png`, { type: 'image/png' }) : null;
    const canShare = file && navigator.canShare && navigator.canShare({ files: [file] });
    const body = `<div style="text-align:center"><img src="${dataURL}" style="width:100%;border-radius:12px;border:1px solid var(--line)" alt="成绩" /></div>`;
    const foot = [];
    if (canShare) {
      foot.push({ label: '分享', cls: 'primary', onClick: async () => {
        try { await navigator.share({ title: game.name, files: [file] }); closeModal(); }
        catch (e) { /* 用户取消，留在预览 */ }
      }});
    }
    foot.push({
      label: canShare ? '保存图片' : '保存图片',
      cls: canShare ? 'ghost' : 'primary',
      onClick: () => {
        const a = document.createElement('a');
        a.href = dataURL; a.download = `${(game.name || 'score')}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        showToast('已保存，可去相册查看');
      }
    });
    foot.push({ label: '复制文字', cls: 'ghost', onClick: () => { onShareText(game); closeModal(); } });
    openModal('成绩图片', body, foot);
  }, 'image/png');
}

function buildScoreImage(game) {
  const dpr = window.devicePixelRatio || 1;
  const W = 720, pad = 28;
  const scores = computeScores(game);
  const ordered = [...game.players].sort((a, b) => scores[b.id] - scores[a.id]);
  const players = game.players;
  const nameOf = (pid) => (game.players.find((p) => p.id === pid) || {}).name || '?';

  const lineH = 36, headH = 96, standingsGap = 24;
  const standingsH = ordered.length * lineH;
  const tableTop = 44, colH = 34;
  const hasInit = players.some((p) => p.initial);
  const tableRows = game.rounds.length + 1 + (hasInit ? 1 : 0);
  const tableH = colH * tableRows;
  const H = headH + standingsH + standingsGap + tableTop + tableH + pad;

  const fit = (c, text, maxW) => {
    if (c.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  };

  const canvas = document.createElement('canvas');
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#12181d'; ctx.fillRect(0, 0, W, H);

  // 标题 + 元信息
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd166'; ctx.font = '700 28px sans-serif';
  ctx.fillText(fit(ctx, game.name || '未命名对局', W - 2 * pad), pad, 34);
  ctx.fillStyle = '#93a4b1'; ctx.font = '14px sans-serif';
  const dateStr = new Date(game.createdAt).toLocaleString('zh-CN');
  ctx.fillText(`${dateStr} · ${players.length}人 · ${game.rounds.length}轮 · ${game.finished ? '已结束' : '进行中'}`, pad, 66);

  // 最终排名
  let y = headH;
  ctx.fillStyle = '#93a4b1'; ctx.font = '600 16px sans-serif';
  ctx.fillText('最终排名', pad, y);
  y += 24;
  ordered.forEach((p, i) => {
    const v = scores[p.id] || 0;
    ctx.fillStyle = i === 0 ? '#ffd166' : '#e7eef3'; ctx.font = '700 17px sans-serif';
    ctx.fillText(`${i + 1}. ${p.name}`, pad, y + lineH / 2);
    ctx.fillStyle = v > 0 ? '#2ec4b6' : v < 0 ? '#ef476f' : '#93a4b1';
    ctx.font = '700 19px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(`${v > 0 ? '+' : ''}${v}`, W - pad, y + lineH / 2);
    ctx.textAlign = 'left';
    y += lineH;
  });

  // 轮次明细表
  y += standingsGap;
  ctx.fillStyle = '#93a4b1'; ctx.font = '600 16px sans-serif';
  ctx.fillText('轮次明细', pad, y);
  y += 24;
  const top = y;
  const labelW = 44, tierW = 104;
  const left = pad + labelW;
  const colW = (W - 2 * pad - labelW - tierW) / players.length;
  const tableW = W - 2 * pad;

  ctx.fillStyle = '#1f2933';
  ctx.fillRect(pad, top, tableW, colH * tableRows);

  let ry = top;
  const cell = (x, w, text, color, font, align = 'center', maxW = null) => {
    ctx.fillStyle = color; ctx.font = font; ctx.textAlign = align;
    const t = maxW ? fit(ctx, text, maxW) : text;
    const tx = align === 'left' ? x + 6 : x + w / 2;
    ctx.fillText(t, tx, ry + colH / 2);
  };

  // 表头
  ctx.fillStyle = '#27343f'; ctx.fillRect(pad, ry, tableW, colH);
  cell(pad, labelW, '轮', '#93a4b1', '700 13px sans-serif');
  players.forEach((p, i) => cell(left + i * colW, colW, p.name, '#e7eef3', '600 13px sans-serif', 'center', colW - 8));
  cell(left + players.length * colW, tierW, '档/胜', '#93a4b1', '600 13px sans-serif');
  ry += colH;

  // 初始行
  if (hasInit) {
    cell(pad, labelW, '初', '#93a4b1', '700 13px sans-serif');
    players.forEach((p, i) => cell(left + i * colW, colW, `${p.initial || 0}`, '#93a4b1', '600 13px sans-serif'));
    cell(left + players.length * colW, tierW, '', '#93a4b1', '600 13px sans-serif');
    ry += colH;
  }

  // 每轮
  game.rounds.forEach((r, idx) => {
    const v = game.tiers[r.tier] || 0;
    const byPid = {};
    r.seats.forEach((pid, i) => { if (pid) byPid[pid] = teamOf(i) === r.winner ? v : -v; });
    cell(pad, labelW, `${idx + 1}`, '#93a4b1', '700 13px sans-serif');
    players.forEach((p) => {
      const d = p.id in byPid ? byPid[p.id] : null;
      const color = d === null ? '#5a6b78' : d > 0 ? '#2ec4b6' : d < 0 ? '#ef476f' : '#e7eef3';
      const txt = d === null ? '–' : `${d > 0 ? '+' : ''}${d}`;
      cell(left + players.indexOf(p) * colW, colW, txt, color, '700 14px sans-serif');
    });
    const teamA = [r.seats[0], r.seats[2]].filter(Boolean).map(nameOf).join('、');
    const teamB = [r.seats[1], r.seats[3]].filter(Boolean).map(nameOf).join('、');
    const info = `${r.winner}胜 ${teamA}/ ${teamB} ${['一', '二', '三'][r.tier]}(${v})`;
    cell(left + players.length * colW, tierW, info, '#93a4b1', '11px sans-serif', 'left', tierW - 8);
    ry += colH;
  });

  // 总分行
  ctx.fillStyle = '#27343f'; ctx.fillRect(pad, ry, tableW, colH);
  cell(pad, labelW, '总', '#ffd166', '700 14px sans-serif');
  players.forEach((p, i) => {
    const s = scores[p.id] || 0;
    const color = s > 0 ? '#2ec4b6' : s < 0 ? '#ef476f' : '#e7eef3';
    cell(left + i * colW, colW, `${s > 0 ? '+' : ''}${s}`, color, '700 15px sans-serif');
  });
  cell(left + players.length * colW, tierW, '', '#93a4b1', '600 13px sans-serif');
  ry += colH;

  // 网格线
  ctx.strokeStyle = '#34434f'; ctx.lineWidth = 1;
  for (let r = 0; r <= tableRows; r++) {
    const yy = top + r * colH + 0.5;
    ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(pad + tableW, yy); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(pad + labelW + 0.5, top); ctx.lineTo(pad + labelW + 0.5, top + colH * tableRows); ctx.stroke();
  for (let i = 1; i <= players.length; i++) {
    const xx = left + i * colW + 0.5;
    ctx.beginPath(); ctx.moveTo(xx, top); ctx.lineTo(xx, top + colH * tableRows); ctx.stroke();
  }
  // 总分行顶部分隔加粗
  ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2;
  const yyTop = top + colH * (tableRows - 1) + 0.5;
  ctx.beginPath(); ctx.moveTo(pad, yyTop); ctx.lineTo(pad + tableW, yyTop); ctx.stroke();

  return canvas;
}

/* 导出全部对局为 JSON 文件（备份 / 换手机迁移） */
function exportAll() {
  const data = { app: 'scorekeeper', version: 1, exportedAt: Date.now(), games: GAMES };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  a.href = url; a.download = `scorekeeper-backup-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('已导出全部对局');
}

/* 从 JSON 文件导入（相同ID覆盖，其余合并） */
function importAll() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.addEventListener('change', () => {
    const f = inp.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const games = Array.isArray(data) ? data : data.games;
        if (!Array.isArray(games)) throw new Error('文件格式不正确');
        confirmModal('导入对局', `将导入 ${games.length} 个对局（相同ID会覆盖，其余合并）。确定？`, [
          { label: '取消', cls: 'ghost', onClick: closeModal },
          { label: '导入', cls: 'primary', onClick: () => {
              const map = new Map(GAMES.map((g) => [g.id, g]));
              games.forEach((g) => { if (g && g.id) map.set(g.id, g); });
              GAMES = [...map.values()];
              saveGames(GAMES); closeModal(); renderHome(); showToast('导入完成');
            } }
        ]);
      } catch (e) {
        showToast('导入失败：' + e.message);
      }
    };
    reader.readAsText(f);
  });
  inp.click();
}

/* ============================================================
 * 通用弹窗 / 轻提示
 * ============================================================ */
function openModal(title, bodyHTML, footButtons = []) {
  modalCloseHook = null; // 新弹窗打开时清除上一次的关闭钩子
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHTML;
  const foot = $('#modalFoot');
  foot.innerHTML = '';
  footButtons.forEach((b) => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.cls || '');
    btn.textContent = b.label;
    btn.addEventListener('click', b.onClick);
    foot.appendChild(btn);
  });
  $('#modalRoot').hidden = false;
}
let modalCloseHook = null;
function setModalCloseHook(fn) { modalCloseHook = fn; }
function closeModal() {
  if (modalCloseHook) { const fn = modalCloseHook; modalCloseHook = null; fn(); }
  $('#modalRoot').hidden = true; $('#modalBody').innerHTML = ''; $('#modalFoot').innerHTML = '';
}
function confirmModal(title, msg, buttons) { openModal(title, `<p>${escapeHTML(msg)}</p>`, buttons); }
$('#modalClose').addEventListener('click', closeModal);
$('.modal-mask').addEventListener('click', closeModal);

let toastTimer = null;
function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 1800);
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================================================
 * 启动 + Service Worker 注册
 * ============================================================ */
renderHome();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
