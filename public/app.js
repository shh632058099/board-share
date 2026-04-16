const state = {
  user: null,
  boards: [],
  my: { current: [], history: [] },
  tab: 'boards',
};

const els = {
  userSummary: document.querySelector('#userSummary'),
  identityForm: document.querySelector('#identityForm'),
  userIdInput: document.querySelector('#userIdInput'),
  userNameInput: document.querySelector('#userNameInput'),
  tabs: document.querySelectorAll('.tab'),
  refreshButton: document.querySelector('#refreshButton'),
  boardsView: document.querySelector('#boardsView'),
  mineView: document.querySelector('#mineView'),
  adminView: document.querySelector('#adminView'),
  boardList: document.querySelector('#boardList'),
  statusFilter: document.querySelector('#statusFilter'),
  myCurrent: document.querySelector('#myCurrent'),
  myHistory: document.querySelector('#myHistory'),
  boardForm: document.querySelector('#boardForm'),
  editingBoardId: document.querySelector('#editingBoardId'),
  boardNoInput: document.querySelector('#boardNoInput'),
  typeInput: document.querySelector('#typeInput'),
  versionInput: document.querySelector('#versionInput'),
  systemVersionInput: document.querySelector('#systemVersionInput'),
  subcardsInput: document.querySelector('#subcardsInput'),
  remarkInput: document.querySelector('#remarkInput'),
  cancelEditButton: document.querySelector('#cancelEditButton'),
  adminBoardList: document.querySelector('#adminBoardList'),
  applyDialog: document.querySelector('#applyDialog'),
  applyForm: document.querySelector('#applyForm'),
  applyBoardId: document.querySelector('#applyBoardId'),
  applyTitle: document.querySelector('#applyTitle'),
  durationInput: document.querySelector('#durationInput'),
  purposeInput: document.querySelector('#purposeInput'),
  closeApplyButton: document.querySelector('#closeApplyButton'),
  toast: document.querySelector('#toast'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function currentIdentity() {
  return {
    id: localStorage.getItem('share-board.userId') || 'ou_admin',
    name: localStorage.getItem('share-board.userName') || '本地管理员',
  };
}

function requestHeaders(hasJsonBody = false) {
  const identity = currentIdentity();
  return {
    ...(hasJsonBody ? { 'content-type': 'application/json' } : {}),
    'x-user-id': identity.id,
    'x-user-name': encodeURIComponent(identity.name),
  };
}

async function api(path, options = {}) {
  const hasBody = options.body !== undefined;
  const response = await fetch(path, {
    ...options,
    headers: {
      ...requestHeaders(hasBody),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || '请求失败');
  }
  return payload;
}

function formatDate(value) {
  if (!value) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusText(status) {
  return {
    available: '可申请',
    in_use: '使用中',
    overdue: '已超时',
    deleted: '已删除',
  }[status] || status;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 2600);
}

function subcardsText(subcards) {
  if (!subcards?.length) return '无子卡';
  return subcards
    .map((item) => [item.name, item.model, item.remark].filter(Boolean).join(' / '))
    .filter(Boolean)
    .join('；');
}

function boardActions(board) {
  const isMine = board.currentUserId && board.currentUserId === state.user?.id;
  const canReturn = board.currentReservationId && (isMine || state.user?.isAdmin);
  const canRequestReturn = board.status === 'overdue' && board.currentReservationId && !isMine;
  const actions = [];

  if (board.status === 'available') {
    actions.push(`<button type="button" data-action="apply" data-board-id="${escapeHtml(board.id)}">申请</button>`);
  }
  if (canReturn) {
    actions.push(
      `<button type="button" class="ghost-button" data-action="return" data-reservation-id="${escapeHtml(
        board.currentReservationId,
      )}">归还</button>`,
    );
  }
  if (canRequestReturn) {
    actions.push(
      `<button type="button" data-action="request-return" data-reservation-id="${escapeHtml(
        board.currentReservationId,
      )}">请求归还</button>`,
    );
  }

  return actions.join('');
}

function renderBoards() {
  const filter = els.statusFilter.value;
  const boards = state.boards.filter((board) => filter === 'all' || board.status === filter);

  if (!boards.length) {
    els.boardList.innerHTML = '<div class="empty">暂无符合条件的单板</div>';
    return;
  }

  els.boardList.innerHTML = boards
    .map(
      (board) => `<article class="board-card">
        <div class="card-title">
          <strong>${escapeHtml(board.boardNo)}</strong>
          <span class="badge ${escapeHtml(board.status)}">${statusText(board.status)}</span>
        </div>
        <div class="meta">
          <span>类型：${escapeHtml(board.type || '未填写')}</span>
          <span>版本号：${escapeHtml(board.version || '未填写')}</span>
          <span>系统版本号：${escapeHtml(board.systemVersion || '未填写')}</span>
          <span>子卡：${escapeHtml(subcardsText(board.subcards))}</span>
          <span>当前使用人：${escapeHtml(board.currentUserName || '无')}</span>
          <span>预计归还：${escapeHtml(formatDate(board.currentReservation?.plannedEndAt))}</span>
          <span>备注：${escapeHtml(board.remark || '无')}</span>
        </div>
        <div class="card-actions">${boardActions(board)}</div>
      </article>`,
    )
    .join('');
}

function reservationRow(reservation, allowReturn) {
  const action =
    allowReturn && reservation.status === 'active'
      ? `<button type="button" class="ghost-button" data-action="return" data-reservation-id="${escapeHtml(
          reservation.id,
        )}">归还</button>`
      : '';
  return `<article class="reservation-row">
    <div class="meta">
      <strong>${escapeHtml(reservation.boardNo || reservation.board?.boardNo || '未知单板')}</strong>
      <span>开始：${escapeHtml(formatDate(reservation.startedAt))}</span>
      <span>计划归还：${escapeHtml(formatDate(reservation.plannedEndAt))}</span>
      <span>实际归还：${escapeHtml(formatDate(reservation.returnedAt))}</span>
      <span>用途：${escapeHtml(reservation.purpose || '无')}</span>
    </div>
    <div>${action}</div>
  </article>`;
}

function renderMine() {
  els.myCurrent.innerHTML = state.my.current.length
    ? state.my.current.map((reservation) => reservationRow(reservation, true)).join('')
    : '<div class="empty">当前没有占用的单板</div>';
  els.myHistory.innerHTML = state.my.history.length
    ? state.my.history.map((reservation) => reservationRow(reservation, false)).join('')
    : '<div class="empty">暂无历史申请</div>';
}

function subcardsToTextarea(subcards) {
  return (subcards || [])
    .map((item) => [item.name, item.model, item.remark].filter(Boolean).join(' | '))
    .join('\n');
}

function parseSubcards(value) {
  return String(value || '')
    .split('\n')
    .map((line) => {
      const [name = '', model = '', remark = ''] = line.split('|').map((item) => item.trim());
      return { name, model, remark };
    })
    .filter((item) => item.name || item.model || item.remark);
}

function renderAdmin() {
  if (!state.user?.isAdmin) {
    els.adminBoardList.innerHTML = '<div class="empty">当前用户不是管理员</div>';
    return;
  }

  if (!state.boards.length) {
    els.adminBoardList.innerHTML = '<div class="empty">暂无单板</div>';
    return;
  }

  els.adminBoardList.innerHTML = state.boards
    .map(
      (board) => `<article class="admin-row">
        <div><strong>${escapeHtml(board.boardNo)}</strong><p>${escapeHtml(board.type || '未填写类型')}</p></div>
        <div>${escapeHtml(board.version || '未填写版本')}</div>
        <div><span class="badge ${escapeHtml(board.status)}">${statusText(board.status)}</span></div>
        <div class="admin-actions">
          <button type="button" class="ghost-button" data-action="edit-board" data-board-id="${escapeHtml(board.id)}" ${
            board.deleted ? 'disabled' : ''
          }>编辑</button>
          <button type="button" class="ghost-button" data-action="delete-board" data-board-id="${escapeHtml(board.id)}" ${
            board.deleted || board.status !== 'available' ? 'disabled' : ''
          }>删除</button>
        </div>
      </article>`,
    )
    .join('');
}

function renderShell() {
  els.userSummary.textContent = state.user
    ? `${state.user.name} (${state.user.id})${state.user.isAdmin ? '，管理员' : ''}`
    : '未登录';
  document.querySelectorAll('.admin-only').forEach((item) => {
    item.hidden = !state.user?.isAdmin;
  });

  if (!state.user?.isAdmin && state.tab === 'admin') {
    state.tab = 'boards';
  }

  els.tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.tab === state.tab));
  els.boardsView.hidden = state.tab !== 'boards';
  els.mineView.hidden = state.tab !== 'mine';
  els.adminView.hidden = state.tab !== 'admin';
}

function renderAll() {
  renderShell();
  renderBoards();
  renderMine();
  renderAdmin();
}

async function loadAll() {
  const mePayload = await api('/api/me');
  state.user = mePayload.user;
  const boardsPath = state.user.isAdmin ? '/api/boards?includeDeleted=true' : '/api/boards';
  const [boardsPayload, myPayload] = await Promise.all([api(boardsPath), api('/api/my/reservations')]);
  state.boards = boardsPayload.boards;
  state.my = myPayload;
  renderAll();
}

function openApplyDialog(boardId) {
  const board = state.boards.find((item) => item.id === boardId);
  if (!board) return;
  els.applyBoardId.value = board.id;
  els.applyTitle.textContent = `申请 ${board.boardNo}`;
  els.durationInput.value = '1';
  els.purposeInput.value = '';
  els.applyDialog.showModal();
}

function fillBoardForm(board) {
  els.editingBoardId.value = board.id;
  els.boardNoInput.value = board.boardNo || '';
  els.typeInput.value = board.type || '';
  els.versionInput.value = board.version || '';
  els.systemVersionInput.value = board.systemVersion || '';
  els.subcardsInput.value = subcardsToTextarea(board.subcards);
  els.remarkInput.value = board.remark || '';
  els.boardNoInput.focus();
}

function resetBoardForm() {
  els.editingBoardId.value = '';
  els.boardForm.reset();
}

async function handleAction(target) {
  const action = target.dataset.action;
  if (!action) return;

  if (action === 'apply') {
    openApplyDialog(target.dataset.boardId);
    return;
  }

  if (action === 'return') {
    await api(`/api/reservations/${encodeURIComponent(target.dataset.reservationId)}/return`, {
      method: 'POST',
      body: '{}',
    });
    showToast('已归还');
    await loadAll();
    return;
  }

  if (action === 'request-return') {
    await api(`/api/reservations/${encodeURIComponent(target.dataset.reservationId)}/request-return`, {
      method: 'POST',
      body: '{}',
    });
    showToast('已发送归还请求');
    await loadAll();
    return;
  }

  if (action === 'edit-board') {
    const board = state.boards.find((item) => item.id === target.dataset.boardId);
    if (board) fillBoardForm(board);
    return;
  }

  if (action === 'delete-board') {
    const board = state.boards.find((item) => item.id === target.dataset.boardId);
    if (!board || !window.confirm(`确认删除 ${board.boardNo}？`)) return;
    await api(`/api/boards/${encodeURIComponent(board.id)}`, { method: 'DELETE' });
    showToast('已删除');
    await loadAll();
  }
}

els.identityForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  localStorage.setItem('share-board.userId', els.userIdInput.value.trim());
  localStorage.setItem('share-board.userName', els.userNameInput.value.trim());
  await loadAll().catch((error) => showToast(error.message));
});

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    state.tab = tab.dataset.tab;
    renderAll();
  });
});

els.refreshButton.addEventListener('click', () => {
  loadAll().then(() => showToast('已刷新')).catch((error) => showToast(error.message));
});

els.statusFilter.addEventListener('change', renderBoards);

els.applyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/reservations', {
      method: 'POST',
      body: JSON.stringify({
        boardId: els.applyBoardId.value,
        durationHours: Number(els.durationInput.value),
        purpose: els.purposeInput.value,
      }),
    });
    els.applyDialog.close();
    showToast('申请成功');
    await loadAll();
  } catch (error) {
    showToast(error.message);
  }
});

els.closeApplyButton.addEventListener('click', () => els.applyDialog.close());

els.boardForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const boardId = els.editingBoardId.value;
  const payload = {
    boardNo: els.boardNoInput.value,
    type: els.typeInput.value,
    version: els.versionInput.value,
    systemVersion: els.systemVersionInput.value,
    subcards: parseSubcards(els.subcardsInput.value),
    remark: els.remarkInput.value,
  };

  try {
    if (boardId) {
      await api(`/api/boards/${encodeURIComponent(boardId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      showToast('已保存');
    } else {
      await api('/api/boards', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      showToast('已新增');
    }
    resetBoardForm();
    await loadAll();
  } catch (error) {
    showToast(error.message);
  }
});

els.cancelEditButton.addEventListener('click', resetBoardForm);

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  handleAction(target).catch((error) => showToast(error.message));
});

const identity = currentIdentity();
els.userIdInput.value = identity.id;
els.userNameInput.value = identity.name;
loadAll().catch((error) => showToast(error.message));
