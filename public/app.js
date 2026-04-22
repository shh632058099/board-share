const state = {
  user: null,
  boards: [],
  timeline: null,
  my: { current: [], upcoming: [], history: [] },
  admins: [],
  tab: 'boards',
  authConfig: null,
  hasLoaded: false,
  isRefreshing: false,
  lastUpdatedAt: null,
  refreshPromise: null,
  refreshQueued: false,
};

let loginRedirecting = false;
let pollingStarted = false;
const POLL_INTERVAL_MS = 30 * 1000;

const els = {
  userSummary: document.querySelector('#userSummary'),
  identityForm: document.querySelector('#identityForm'),
  userIdInput: document.querySelector('#userIdInput'),
  userNameInput: document.querySelector('#userNameInput'),
  tabs: document.querySelectorAll('.tab'),
  refreshButton: document.querySelector('#refreshButton'),
  lastUpdated: document.querySelector('#lastUpdated'),
  boardsView: document.querySelector('#boardsView'),
  timelineView: document.querySelector('#timelineView'),
  mineView: document.querySelector('#mineView'),
  helpView: document.querySelector('#helpView'),
  adminView: document.querySelector('#adminView'),
  boardList: document.querySelector('#boardList'),
  statusFilter: document.querySelector('#statusFilter'),
  timelineForm: document.querySelector('#timelineForm'),
  timelineFromInput: document.querySelector('#timelineFromInput'),
  timelineToInput: document.querySelector('#timelineToInput'),
  timelineBoard: document.querySelector('#timelineBoard'),
  myCurrent: document.querySelector('#myCurrent'),
  myUpcoming: document.querySelector('#myUpcoming'),
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
  adminForm: document.querySelector('#adminForm'),
  adminUserIdInput: document.querySelector('#adminUserIdInput'),
  adminNameInput: document.querySelector('#adminNameInput'),
  adminUserList: document.querySelector('#adminUserList'),
  applyDialog: document.querySelector('#applyDialog'),
  applyForm: document.querySelector('#applyForm'),
  applyBoardId: document.querySelector('#applyBoardId'),
  applyTitle: document.querySelector('#applyTitle'),
  startAtInput: document.querySelector('#startAtInput'),
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

function pad(value) {
  return String(value).padStart(2, '0');
}

function toDateTimeLocalValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function parseDateTimeLocalInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function roundToNextHalfHour(value = new Date()) {
  const date = new Date(value.getTime());
  date.setSeconds(0, 0);
  const minutes = date.getMinutes();
  const addMinutes = minutes === 0 || minutes === 30 ? 0 : minutes < 30 ? 30 - minutes : 60 - minutes;
  date.setMinutes(minutes + addMinutes);
  return date;
}

function currentIdentity() {
  return {
    id: localStorage.getItem('share-board.userId') || 'ou_admin',
    name: localStorage.getItem('share-board.userName') || '本地管理员',
  };
}

function requestHeaders(hasJsonBody = false) {
  const headers = {
    ...(hasJsonBody ? { 'content-type': 'application/json' } : {}),
  };

  if (state.authConfig?.devAuth !== false) {
    const identity = currentIdentity();
    headers['x-user-id'] = identity.id;
    headers['x-user-name'] = encodeURIComponent(identity.name);
  }

  return headers;
}

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function api(path, options = {}) {
  const { skipLoginRedirect = false, ...fetchOptions } = options;
  const hasBody = fetchOptions.body !== undefined;
  const response = await fetch(path, {
    ...fetchOptions,
    credentials: 'same-origin',
    headers: {
      ...requestHeaders(hasBody),
      ...(fetchOptions.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new ApiError(payload.error?.message || '请求失败', response.status, payload.error?.code);
    if (error.status === 401 && state.authConfig?.devAuth === false && !skipLoginRedirect) {
      redirectToFeishuLogin();
    }
    throw error;
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

function formatClock(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatAxisDate(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).format(new Date(value));
}

function formatDurationText(minutesValue) {
  const totalMinutes = Math.max(0, Math.ceil(Number(minutesValue) || 0));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days) parts.push(`${days}天`);
  if (hours) parts.push(`${hours}小时`);
  if (!days && !hours && minutes) parts.push(`${minutes}分钟`);
  if (!parts.length) parts.push('1分钟内');

  return parts.slice(0, 2).join('');
}

function overdueDurationText(plannedEndAt, now = new Date()) {
  if (!plannedEndAt) return '';
  const end = new Date(plannedEndAt);
  const diffMs = now.getTime() - end.getTime();
  if (Number.isNaN(end.getTime()) || diffMs <= 0) return '';
  return formatDurationText(diffMs / (60 * 1000));
}

function statusText(status) {
  return {
    available: '可申请',
    in_use: '使用中',
    overdue: '已超时',
    reserved: '已预约',
    active: '占用中',
    returned: '已归还',
    canceled: '已取消',
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

function friendlyErrorMessage(error) {
  const rawMessage = String(error?.message || '请求失败');
  if (rawMessage.includes('该时间段已被预约或占用')) {
    return '该时间段已被预约，请在时间线选择绿色空闲段';
  }
  if (rawMessage.includes('请先登录')) {
    return '登录已失效，正在重新登录';
  }
  if (rawMessage.includes('只有管理员可以执行此操作')) {
    return '当前用户不是管理员';
  }
  if (rawMessage.includes('单板存在未完成占用或预约')) {
    return '请先处理该单板的占用或预约后再删除';
  }
  if (rawMessage.includes('只能取消尚未开始的预约')) {
    return '只能取消尚未开始的预约';
  }
  if (rawMessage.includes('只有预约人或管理员可以取消该预约')) {
    return '只有预约人或管理员可以取消该预约';
  }
  if (rawMessage.includes('不能删除最后一个管理员')) {
    return '至少保留一个管理员';
  }
  if (rawMessage.includes('配置管理员不能从页面删除')) {
    return '配置管理员需要在环境变量中调整';
  }
  return rawMessage;
}

function showError(error) {
  console.error('请求失败:', error);
  showToast(friendlyErrorMessage(error));
}

function renderLastUpdated() {
  els.lastUpdated.textContent = state.lastUpdatedAt ? `上次更新 ${formatClock(state.lastUpdatedAt)}` : '尚未更新';
}

function setRefreshButtonLoading() {
  els.refreshButton.disabled = state.isRefreshing;
  els.refreshButton.textContent = state.isRefreshing ? '刷新中...' : '刷新';
}

function renderLoadingPlaceholders() {
  const loading = '<div class="empty">正在加载</div>';
  els.boardList.innerHTML = loading;
  els.timelineBoard.innerHTML = loading;
  els.myCurrent.innerHTML = loading;
  els.myUpcoming.innerHTML = loading;
  els.myHistory.innerHTML = loading;
  els.adminBoardList.innerHTML = loading;
  els.adminUserList.innerHTML = loading;
}

function updateGlobalLoading() {
  setRefreshButtonLoading();
  renderLastUpdated();
  if (state.isRefreshing && !state.hasLoaded) {
    renderLoadingPlaceholders();
  }
}

async function withButtonLoading(button, callback, loadingText = '处理中...') {
  if (!button) return callback();
  if (button.disabled) return undefined;
  const originalText = button.textContent;
  const originalDisabled = button.disabled;
  button.disabled = true;
  button.textContent = loadingText;
  try {
    return await callback();
  } finally {
    if (document.contains(button)) {
      button.disabled = originalDisabled;
      button.textContent = originalText;
    }
  }
}

function submitButton(form, submitter) {
  return submitter || form.querySelector('button[type="submit"]');
}

function currentPageRedirectUri() {
  return state.authConfig?.redirectUri || `${window.location.origin}${window.location.pathname}`;
}

function randomState() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function redirectToFeishuLogin() {
  if (state.authConfig?.devAuth !== false || loginRedirecting) return;
  loginRedirecting = true;

  if (!state.authConfig?.feishuAuthEnabled || !state.authConfig?.feishuAppId) {
    els.userSummary.textContent = '飞书登录未配置';
    showToast('未配置 FEISHU_APP_ID 或 FEISHU_APP_SECRET');
    loginRedirecting = false;
    return;
  }

  const loginState = randomState();
  sessionStorage.setItem('share-board.feishuState', loginState);

  const url = new URL(state.authConfig.loginUrl || 'https://open.feishu.cn/open-apis/authen/v1/index');
  url.searchParams.set('app_id', state.authConfig.feishuAppId);
  url.searchParams.set('redirect_uri', currentPageRedirectUri());
  url.searchParams.set('state', loginState);

  els.userSummary.textContent = '正在进入飞书免登';
  window.location.href = url.toString();
}

async function loadAuthConfig() {
  const payload = await api('/api/auth/config', { skipLoginRedirect: true });
  state.authConfig = payload.auth;
  els.identityForm.hidden = state.authConfig?.devAuth === false;
}

async function completeFeishuLoginIfNeeded() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return;

  const returnedState = params.get('state') || '';
  const expectedState = sessionStorage.getItem('share-board.feishuState') || '';
  if (expectedState && returnedState !== expectedState) {
    throw new Error('飞书登录 state 校验失败');
  }

  await api('/api/auth/feishu', {
    method: 'POST',
    body: JSON.stringify({ code, state: returnedState, redirectUri: currentPageRedirectUri() }),
    skipLoginRedirect: true,
  });

  sessionStorage.removeItem('share-board.feishuState');
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
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

  actions.push(`<button type="button" data-action="apply" data-board-id="${escapeHtml(board.id)}">预约</button>`);

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
          <span>下次预约：${escapeHtml(formatDate(board.nextReservation?.startedAt))}</span>
          <span>备注：${escapeHtml(board.remark || '无')}</span>
        </div>
        <div class="card-actions">${boardActions(board)}</div>
      </article>`,
    )
    .join('');
}

function reservationRow(reservation, { allowReturn = false, allowCancel = false } = {}) {
  const actions = [];
  const endLabel = reservation.status === 'canceled' ? '取消时间' : '实际归还';
  const endValue = reservation.status === 'canceled' ? reservation.updatedAt : reservation.returnedAt;
  if (allowReturn && ['active', 'overdue'].includes(reservation.status)) {
    actions.push(
      `<button type="button" class="ghost-button" data-action="return" data-reservation-id="${escapeHtml(
        reservation.id,
      )}">归还</button>`,
    );
  }
  if (allowCancel && reservation.status === 'reserved') {
    actions.push(
      `<button type="button" class="ghost-button" data-action="cancel-reservation" data-reservation-id="${escapeHtml(
        reservation.id,
      )}">取消预约</button>`,
    );
  }

  return `<article class="reservation-row">
    <div class="meta">
      <strong>${escapeHtml(reservation.boardNo || reservation.board?.boardNo || '未知单板')}</strong>
      <span>状态：${escapeHtml(statusText(reservation.status))}</span>
      <span>开始：${escapeHtml(formatDate(reservation.startedAt))}</span>
      <span>计划归还：${escapeHtml(formatDate(reservation.plannedEndAt))}</span>
      <span>${escapeHtml(endLabel)}：${escapeHtml(formatDate(endValue))}</span>
      <span>用途：${escapeHtml(reservation.purpose || '无')}</span>
    </div>
    <div class="row-actions">${actions.join('')}</div>
  </article>`;
}

function renderMine() {
  els.myCurrent.innerHTML = state.my.current.length
    ? state.my.current.map((reservation) => reservationRow(reservation, { allowReturn: true })).join('')
    : '<div class="empty">当前没有占用的单板</div>';
  els.myUpcoming.innerHTML = state.my.upcoming.length
    ? state.my.upcoming.map((reservation) => reservationRow(reservation, { allowCancel: true })).join('')
    : '<div class="empty">暂无未来预约</div>';
  els.myHistory.innerHTML = state.my.history.length
    ? state.my.history.map((reservation) => reservationRow(reservation)).join('')
    : '<div class="empty">暂无历史申请</div>';
}

function timelineBlockClass(status) {
  if (status === 'overdue') return 'overdue';
  if (status === 'reserved') return 'reserved';
  return 'active';
}

function percentInRange(value, from, totalMs) {
  return Math.max(0, Math.min(100, ((value - from.getTime()) / totalMs) * 100));
}

function timelineBusyEnd(reservation, to) {
  if (reservation.status === 'overdue') {
    return to.getTime();
  }
  return new Date(reservation.plannedEndAt).getTime();
}

function freeSlotsForReservations(reservations, from, to) {
  const busy = reservations
    .map((reservation) => ({
      start: Math.max(new Date(reservation.startedAt).getTime(), from.getTime()),
      end: Math.min(timelineBusyEnd(reservation, to), to.getTime()),
    }))
    .filter((slot) => slot.end > slot.start)
    .sort((a, b) => a.start - b.start);

  const slots = [];
  let cursor = from.getTime();
  for (const item of busy) {
    if (item.start > cursor) {
      slots.push({ start: cursor, end: item.start });
    }
    cursor = Math.max(cursor, item.end);
  }
  if (cursor < to.getTime()) {
    slots.push({ start: cursor, end: to.getTime() });
  }
  return slots;
}

function normalizeBusinessStartValue(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  const start = new Date(date.getTime());
  start.setHours(9, 0, 0, 0);
  const end = new Date(date.getTime());
  end.setHours(21, 0, 0, 0);

  if (date < start) return start;
  if (date >= end) {
    start.setDate(start.getDate() + 1);
    return start;
  }
  return date;
}

function usableFreeSlotStart(slot) {
  const nextUsableStart = roundToNextHalfHour(new Date()).getTime();
  return normalizeBusinessStartValue(new Date(Math.max(slot.start, nextUsableStart))).getTime();
}

function suggestedDurationHours(slot, start) {
  const halfHourMs = 30 * 60 * 1000;
  const availableHalfHours = Math.floor((slot.end - start) / halfHourMs);
  if (availableHalfHours < 1) return null;
  return Math.min(1, availableHalfHours * 0.5);
}

function renderFreeSlot(board, slot, from, totalMs) {
  const clickStart = usableFreeSlotStart(slot);
  const durationHours = suggestedDurationHours(slot, clickStart);
  if (!durationHours) return '';

  const left = percentInRange(slot.start, from, totalMs);
  const width = Math.max(4, ((slot.end - slot.start) / totalMs) * 100);
  const startIso = new Date(clickStart).toISOString();
  return `<button type="button" class="timeline-free-slot" style="left:${left}%;width:${width}%" data-action="apply" data-board-id="${escapeHtml(
    board.id,
  )}" data-start-at="${escapeHtml(startIso)}" data-duration-hours="${escapeHtml(
    durationHours,
  )}" title="从 ${escapeHtml(formatDate(clickStart))} 开始预约 ${escapeHtml(durationHours)} 小时">
    <span>预约</span>
  </button>`;
}

function timelineSegments(reservation, from, to) {
  const windowStart = from.getTime();
  const windowEnd = to.getTime();
  const startAt = new Date(reservation.startedAt).getTime();
  const plannedEndAt = new Date(reservation.plannedEndAt).getTime();

  if (Number.isNaN(startAt) || Number.isNaN(plannedEndAt)) {
    return [];
  }

  if (reservation.status === 'overdue') {
    const segments = [];
    const activeStart = Math.max(startAt, windowStart);
    const activeEnd = Math.min(plannedEndAt, windowEnd);
    if (activeEnd > activeStart) {
      segments.push({ status: 'active', start: activeStart, end: activeEnd, openEnded: false });
    }

    const overdueStart = Math.max(plannedEndAt, windowStart);
    if (windowEnd > overdueStart) {
      segments.push({ status: 'overdue', start: overdueStart, end: windowEnd, openEnded: true });
    }

    return segments;
  }

  const start = Math.max(startAt, windowStart);
  const end = Math.min(plannedEndAt, windowEnd);
  if (end <= start) {
    return [];
  }

  return [{ status: reservation.status, start, end, openEnded: false }];
}

function timelineBlockSubtitle(reservation, segmentStatus, now = new Date()) {
  if (segmentStatus === 'overdue') {
    const overdueText = overdueDurationText(reservation.plannedEndAt, now);
    return overdueText ? `已超时 ${overdueText}` : '已超时';
  }
  if (segmentStatus === 'reserved') {
    return `开始 ${formatDate(reservation.startedAt)}`;
  }
  return `计划归还 ${formatDate(reservation.plannedEndAt)}`;
}

function timelineBlockTitle(reservation, segmentStatus, now = new Date()) {
  const parts = [
    reservation.userName || '未知用户',
    `开始 ${formatDate(reservation.startedAt)}`,
    `计划归还 ${formatDate(reservation.plannedEndAt)}`,
  ];

  if (segmentStatus === 'overdue') {
    const overdueText = overdueDurationText(reservation.plannedEndAt, now);
    parts.push(overdueText ? `已超时 ${overdueText}` : '已超时');
  }

  return parts.join(' · ');
}

function timelineBoardDetails(board, now = new Date()) {
  if (board.currentReservation) {
    const overdueText = overdueDurationText(board.currentReservation.plannedEndAt, now);
    return [
      `<span>当前占用人：${escapeHtml(board.currentUserName || '未知用户')}</span>`,
      `<span>计划归还：${escapeHtml(formatDate(board.currentReservation.plannedEndAt))}</span>`,
      board.status === 'overdue'
        ? `<span class="timeline-detail warning">已超时：${escapeHtml(overdueText || '1分钟内')}</span>`
        : `<span>申请用途：${escapeHtml(board.currentReservation.purpose || '未填写')}</span>`,
    ].join('');
  }

  if (board.nextReservation) {
    return [
      '<span>当前空闲</span>',
      `<span>下次预约：${escapeHtml(formatDate(board.nextReservation.startedAt))}</span>`,
      `<span>预约人：${escapeHtml(board.nextReservation.userName || '未知用户')}</span>`,
    ].join('');
  }

  return ['<span>当前空闲</span>', '<span>暂无后续预约</span>', '<span>可直接从绿色空闲段发起预约</span>'].join('');
}

function timelineRowActions(board, firstFreeSlot) {
  const isMine = board.currentUserId && board.currentUserId === state.user?.id;
  const canReturn = board.currentReservationId && (isMine || state.user?.isAdmin);
  const canRequestReturn = board.status === 'overdue' && board.currentReservationId && !isMine;
  const startAtAttr = firstFreeSlot
    ? ` data-start-at="${escapeHtml(new Date(firstFreeSlot.start).toISOString())}"`
    : '';
  const durationAttr = firstFreeSlot
    ? ` data-duration-hours="${escapeHtml(firstFreeSlot.durationHours)}"`
    : '';
  const actions = [
    `<button type="button" class="ghost-button" data-action="apply" data-board-id="${escapeHtml(board.id)}"${startAtAttr}${durationAttr} ${
      firstFreeSlot ? '' : 'disabled'
    }>预约</button>`,
  ];

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

function renderTimeline() {
  const timeline = state.timeline;
  if (!timeline) {
    els.timelineBoard.innerHTML = '<div class="empty">正在加载</div>';
    return;
  }

  const from = new Date(timeline.from);
  const to = new Date(timeline.to);
  const totalMs = to.getTime() - from.getTime();
  const renderNow = new Date();
  const axis = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(from.getTime() + (totalMs * index) / 5);
    return `<span>${escapeHtml(formatAxisDate(date))}</span>`;
  }).join('');

  const rows = timeline.boards
    .map(({ board, reservations }) => {
      const freeSlots = freeSlotsForReservations(reservations, from, to);
      const freeSlotBlocks = freeSlots.map((slot) => renderFreeSlot(board, slot, from, totalMs)).join('');
      const reservationBlocks = reservations
        .map((reservation) => {
          return timelineSegments(reservation, from, to)
            .map((segment) => {
              const left = percentInRange(segment.start, from, totalMs);
              const width = Math.max(4, ((segment.end - segment.start) / totalMs) * 100);
              return `<div class="timeline-block ${timelineBlockClass(segment.status)} ${
                segment.openEnded ? 'open-ended' : ''
              }" style="left:${left}%;width:${width}%" title="${escapeHtml(
                timelineBlockTitle(reservation, segment.status, renderNow),
              )}">
                <strong>${escapeHtml(reservation.userName || '未知用户')}</strong>
                <span>${escapeHtml(timelineBlockSubtitle(reservation, segment.status, renderNow))}</span>
              </div>`;
            })
            .join('');
        })
        .join('');
      const firstFreeSlot = freeSlots
        .map((slot) => {
          const start = usableFreeSlotStart(slot);
          return { start, durationHours: suggestedDurationHours(slot, start) };
        })
        .find((slot) => slot.durationHours);

      return `<div class="timeline-row">
        <div class="timeline-label">
          <div class="timeline-label-top">
            <strong>${escapeHtml(board.boardNo)}</strong>
            <span class="badge ${escapeHtml(board.status)}">${escapeHtml(statusText(board.status))}</span>
          </div>
          <p>${escapeHtml(board.type || '未填写类型')}</p>
          <div class="timeline-details">${timelineBoardDetails(board, renderNow)}</div>
        </div>
        <div class="timeline-canvas">${freeSlotBlocks}${reservationBlocks}</div>
        <div class="timeline-action">${timelineRowActions(board, firstFreeSlot)}</div>
      </div>`;
    })
    .join('');

  els.timelineBoard.innerHTML = `<div class="timeline-head">
    <div class="timeline-label">单板</div>
    <div class="timeline-canvas"><div class="timeline-axis">${axis}</div></div>
    <div class="timeline-action">操作</div>
  </div>${rows || '<div class="empty">暂无单板</div>'}`;
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

function renderAdmins() {
  if (!state.user?.isAdmin) {
    els.adminUserList.innerHTML = '<div class="empty">当前用户不是管理员</div>';
    return;
  }

  if (!state.admins.length) {
    els.adminUserList.innerHTML = '<div class="empty">暂无管理员</div>';
    return;
  }

  els.adminUserList.innerHTML = state.admins
    .map((admin) => {
      const isEnv = admin.source === 'env';
      const isSelf = admin.userId === state.user?.id;
      return `<article class="admin-row admin-user-row">
        <div>
          <strong>${escapeHtml(admin.userId)}</strong>
          <p>${escapeHtml(admin.name || '未填写姓名')}</p>
        </div>
        <div><span class="badge ${admin.enabled ? 'available' : 'deleted'}">${admin.enabled ? '启用' : '停用'}</span></div>
        <div><span class="admin-source">${isEnv ? '配置管理员' : '页面管理员'}</span></div>
        <div class="admin-actions">
          <button type="button" class="ghost-button" data-action="delete-admin" data-admin-id="${escapeHtml(
            admin.userId,
          )}" ${isEnv ? 'disabled' : ''}>${isSelf ? '删除自己' : '删除'}</button>
        </div>
      </article>`;
    })
    .join('');
}

function renderAdmin() {
  if (!state.user?.isAdmin) {
    els.adminBoardList.innerHTML = '<div class="empty">当前用户不是管理员</div>';
    els.adminUserList.innerHTML = '<div class="empty">当前用户不是管理员</div>';
    return;
  }

  renderAdmins();

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
            board.deleted || board.status !== 'available' || board.nextReservation ? 'disabled' : ''
          }>删除</button>
          <button type="button" class="ghost-button" data-action="restore-board" data-board-id="${escapeHtml(board.id)}" ${
            board.deleted ? '' : 'disabled'
          }>恢复</button>
        </div>
      </article>`,
    )
    .join('');
}

function renderShell() {
  els.userSummary.textContent = state.user
    ? `${state.user.name} (${state.user.id})${state.user.isAdmin ? '，管理员' : ''}`
    : '未登录';
  els.identityForm.hidden = state.authConfig?.devAuth === false;
  setRefreshButtonLoading();
  renderLastUpdated();
  document.querySelectorAll('.admin-only').forEach((item) => {
    item.hidden = !state.user?.isAdmin;
  });

  if (!state.user?.isAdmin && state.tab === 'admin') {
    state.tab = 'boards';
  }

  els.tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.tab === state.tab));
  els.boardsView.hidden = state.tab !== 'boards';
  els.timelineView.hidden = state.tab !== 'timeline';
  els.mineView.hidden = state.tab !== 'mine';
  els.helpView.hidden = state.tab !== 'help';
  els.adminView.hidden = state.tab !== 'admin';
}

function renderAll() {
  renderShell();
  renderBoards();
  renderTimeline();
  renderMine();
  renderAdmin();
}

function initTimelineRange() {
  if (els.timelineFromInput.value && els.timelineToInput.value) return;
  const from = roundToNextHalfHour(new Date());
  const to = new Date(from.getTime() + 3 * 24 * 60 * 60 * 1000);
  els.timelineFromInput.value = toDateTimeLocalValue(from);
  els.timelineToInput.value = toDateTimeLocalValue(to);
}

async function loadTimeline() {
  initTimelineRange();
  const query = new URLSearchParams({
    from: new Date(els.timelineFromInput.value).toISOString(),
    to: new Date(els.timelineToInput.value).toISOString(),
  });
  if (state.user?.isAdmin) {
    query.set('includeDeleted', 'true');
  }
  state.timeline = await api(`/api/timeline?${query}`);
}

async function fetchAllData() {
  const mePayload = await api('/api/me');
  state.user = mePayload.user;
  const boardsPath = state.user.isAdmin ? '/api/boards?includeDeleted=true' : '/api/boards';
  const [boardsPayload, myPayload, adminsPayload] = await Promise.all([
    api(boardsPath),
    api('/api/my/reservations'),
    state.user.isAdmin ? api('/api/admins') : Promise.resolve({ admins: [] }),
  ]);
  state.boards = boardsPayload.boards;
  state.my = { current: [], upcoming: [], history: [], ...myPayload };
  state.admins = adminsPayload.admins || [];
  await loadTimeline();
}

async function refreshData({ silent = false, keepTab = true } = {}) {
  if (state.isRefreshing) {
    state.refreshQueued = true;
    return state.refreshPromise;
  }

  state.isRefreshing = true;
  updateGlobalLoading();
  state.refreshPromise = (async () => {
    try {
      do {
        state.refreshQueued = false;
        await fetchAllData();
        if (!keepTab) {
          state.tab = 'boards';
        }
        state.lastUpdatedAt = new Date();
        state.hasLoaded = true;
        renderAll();
      } while (state.refreshQueued);
      if (!silent) {
        showToast('已刷新');
      }
    } finally {
      state.isRefreshing = false;
      state.refreshPromise = null;
      updateGlobalLoading();
    }
  })();

  return state.refreshPromise;
}

function openApplyDialog(boardId, startAt = undefined, durationHours = '1') {
  const board = state.boards.find((item) => item.id === boardId) || state.timeline?.boards.find((item) => item.board.id === boardId)?.board;
  if (!board) return;
  els.applyBoardId.value = board.id;
  els.applyTitle.textContent = `预约 ${board.boardNo}`;
  els.startAtInput.value = toDateTimeLocalValue(startAt ? new Date(startAt) : roundToNextHalfHour(new Date()));
  const normalizedDuration = Number(durationHours);
  els.durationInput.value = Number.isFinite(normalizedDuration) && normalizedDuration >= 0.5 ? String(normalizedDuration) : '1';
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
    openApplyDialog(target.dataset.boardId, target.dataset.startAt, target.dataset.durationHours);
    return;
  }

  if (action === 'return') {
    await withButtonLoading(target, async () => {
      await api(`/api/reservations/${encodeURIComponent(target.dataset.reservationId)}/return`, {
        method: 'POST',
        body: '{}',
      });
      showToast('已归还');
      await refreshData({ silent: true });
    });
    return;
  }

  if (action === 'request-return') {
    await withButtonLoading(target, async () => {
      await api(`/api/reservations/${encodeURIComponent(target.dataset.reservationId)}/request-return`, {
        method: 'POST',
        body: '{}',
      });
      showToast('已发送归还请求');
      await refreshData({ silent: true });
    });
    return;
  }

  if (action === 'cancel-reservation') {
    if (!window.confirm('确认取消这个预约？')) return;
    await withButtonLoading(target, async () => {
      await api(`/api/reservations/${encodeURIComponent(target.dataset.reservationId)}/cancel`, {
        method: 'POST',
        body: '{}',
      });
      showToast('已取消预约');
      await refreshData({ silent: true });
    });
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
    await withButtonLoading(target, async () => {
      await api(`/api/boards/${encodeURIComponent(board.id)}`, { method: 'DELETE' });
      showToast('已删除');
      await refreshData({ silent: true });
    });
    return;
  }

  if (action === 'restore-board') {
    const board = state.boards.find((item) => item.id === target.dataset.boardId);
    if (!board || !window.confirm(`确认恢复 ${board.boardNo}？`)) return;
    await withButtonLoading(target, async () => {
      await api(`/api/boards/${encodeURIComponent(board.id)}/restore`, { method: 'POST', body: '{}' });
      showToast('已恢复');
      await refreshData({ silent: true });
    });
    return;
  }

  if (action === 'delete-admin') {
    const admin = state.admins.find((item) => item.userId === target.dataset.adminId);
    if (!admin) return;
    const message =
      admin.userId === state.user?.id
        ? '确认删除自己的管理员权限？删除后会退出管理页。'
        : `确认删除管理员 ${admin.name || admin.userId}？`;
    if (!window.confirm(message)) return;
    await withButtonLoading(target, async () => {
      await api(`/api/admins/${encodeURIComponent(admin.userId)}`, { method: 'DELETE' });
      showToast('已删除管理员');
      await refreshData({ silent: true });
    });
    return;
  }
}

els.identityForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.authConfig?.devAuth === false) {
    showToast('正式环境使用飞书身份登录');
    return;
  }
  await withButtonLoading(submitButton(els.identityForm, event.submitter), async () => {
    localStorage.setItem('share-board.userId', els.userIdInput.value.trim());
    localStorage.setItem('share-board.userName', els.userNameInput.value.trim());
    await refreshData({ silent: true });
  }).catch(showError);
});

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    state.tab = tab.dataset.tab;
    renderAll();
  });
});

els.refreshButton.addEventListener('click', () => {
  refreshData().catch(showError);
});

els.statusFilter.addEventListener('change', renderBoards);

els.timelineForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await withButtonLoading(submitButton(els.timelineForm, event.submitter), async () => {
    await refreshData({ silent: true });
  }).catch(showError);
});

els.applyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await withButtonLoading(submitButton(els.applyForm, event.submitter), async () => {
    const startAt = parseDateTimeLocalInput(els.startAtInput.value);
    if (!startAt) {
      showToast('请选择有效的开始时间');
      return;
    }

    await api('/api/reservations', {
      method: 'POST',
      body: JSON.stringify({
        boardId: els.applyBoardId.value,
        startAt: startAt.toISOString(),
        durationHours: Number(els.durationInput.value),
        purpose: els.purposeInput.value,
      }),
    });
    els.applyDialog.close();
    showToast('预约成功');
    await refreshData({ silent: true });
  }).catch(showError);
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

  await withButtonLoading(submitButton(els.boardForm, event.submitter), async () => {
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
    await refreshData({ silent: true });
  }).catch(showError);
});

els.cancelEditButton.addEventListener('click', resetBoardForm);

els.adminForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await withButtonLoading(submitButton(els.adminForm, event.submitter), async () => {
    await api('/api/admins', {
      method: 'POST',
      body: JSON.stringify({
        userId: els.adminUserIdInput.value.trim(),
        name: els.adminNameInput.value.trim(),
      }),
    });
    els.adminForm.reset();
    showToast('已新增管理员');
    await refreshData({ silent: true });
  }).catch(showError);
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  handleAction(target).catch(showError);
});

function startAutoRefresh() {
  if (pollingStarted) return;
  pollingStarted = true;

  window.setInterval(() => {
    if (document.visibilityState === 'hidden' || loginRedirecting) return;
    refreshData({ silent: true }).catch(showError);
  }, POLL_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.hasLoaded && !loginRedirecting) {
      refreshData({ silent: true }).catch(showError);
    }
  });
}

async function bootstrap() {
  try {
    initTimelineRange();
    await loadAuthConfig();
    await completeFeishuLoginIfNeeded();
    await refreshData({ silent: true });
    startAutoRefresh();
  } catch (error) {
    if (error.status === 401 && state.authConfig?.devAuth === false) {
      redirectToFeishuLogin();
      return;
    }
    state.user = null;
    renderShell();
    showError(error);
  }
}

const identity = currentIdentity();
els.userIdInput.value = identity.id;
els.userNameInput.value = identity.name;
bootstrap();
