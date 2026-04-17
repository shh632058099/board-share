import {
  addBusinessHours,
  isOverdue,
  isValidDurationHours,
  normalizeBusinessStart,
} from './businessTime.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { createId } from './id.js';

const ACTIVE = 'active';
const RESERVED = 'reserved';
const RETURNED = 'returned';

function nowIso(now) {
  return now.toISOString();
}

function trim(value) {
  return String(value || '').trim();
}

function sameBoardNo(left, right) {
  return trim(left).toLowerCase() === trim(right).toLowerCase();
}

function asDate(value, label = '时间') {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badRequest(`${label}格式不正确`);
  }
  return date;
}

function reservationStart(reservation) {
  return asDate(reservation.startedAt, '开始时间');
}

function reservationEnd(reservation) {
  return asDate(reservation.plannedEndAt, '结束时间');
}

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart.getTime() < rightEnd.getTime() && rightStart.getTime() < leftEnd.getTime();
}

function isOpenReservation(reservation) {
  return reservation.status !== RETURNED;
}

function isFutureReservation(reservation, now = new Date()) {
  return isOpenReservation(reservation) && reservationStart(reservation).getTime() > now.getTime();
}

export function deriveReservationStatus(reservation, now = new Date()) {
  if (!reservation) return '';
  if (reservation.status === RETURNED) return RETURNED;
  if (reservationStart(reservation).getTime() > now.getTime()) return RESERVED;
  return isOverdue(reservation.plannedEndAt, now) ? 'overdue' : ACTIVE;
}

function publicReservation(reservation, board = undefined, now = new Date()) {
  if (!reservation) return null;
  const status = deriveReservationStatus(reservation, now);
  return {
    id: reservation.id,
    boardId: reservation.boardId,
    boardNo: board?.boardNo || '',
    userId: reservation.userId,
    userName: reservation.userName,
    durationHours: reservation.durationHours,
    purpose: reservation.purpose || '',
    startedAt: reservation.startedAt,
    plannedEndAt: reservation.plannedEndAt,
    returnedAt: reservation.returnedAt,
    status,
    rawStatus: reservation.status,
    returnRequestCount: reservation.returnRequestCount || 0,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
  };
}

export function getActiveReservation(state, boardId, now = new Date()) {
  return state.reservations.find((reservation) => {
    const status = deriveReservationStatus(reservation, now);
    return reservation.boardId === boardId && (status === ACTIVE || status === 'overdue');
  });
}

function getNextReservation(state, boardId, now = new Date()) {
  return state.reservations
    .filter((reservation) => reservation.boardId === boardId && isFutureReservation(reservation, now))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
}

export function deriveBoardStatus(board, reservation, now = new Date()) {
  if (board.deleted) return 'deleted';
  if (!reservation) return 'available';
  return isOverdue(reservation.plannedEndAt, now) ? 'overdue' : 'in_use';
}

export function publicBoard(board, state, now = new Date()) {
  const activeReservation = getActiveReservation(state, board.id, now);
  const nextReservation = getNextReservation(state, board.id, now);
  const status = deriveBoardStatus(board, activeReservation, now);
  return {
    id: board.id,
    boardNo: board.boardNo,
    type: board.type,
    version: board.version,
    systemVersion: board.systemVersion,
    subcards: board.subcards || [],
    status,
    currentUserId: activeReservation?.userId || '',
    currentUserName: activeReservation?.userName || '',
    currentReservationId: activeReservation?.id || '',
    currentReservation: publicReservation(activeReservation, board, now),
    nextReservation: publicReservation(nextReservation, board, now),
    remark: board.remark || '',
    deleted: Boolean(board.deleted),
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}

export function isAdminUser(user, state, config) {
  const userIds = [user?.id, user?.openId, user?.userId, user?.unionId].filter(Boolean);
  if (!userIds.length) return false;
  if (config.adminUserIds.some((adminId) => userIds.includes(adminId))) return true;
  return state.admins.some((admin) => admin.enabled && userIds.includes(admin.userId));
}

export function requireAdmin(user, state, config) {
  if (!isAdminUser(user, state, config)) {
    throw forbidden('只有管理员可以执行此操作');
  }
}

export function listBoards(state, { includeDeleted = false, now = new Date() } = {}) {
  return state.boards
    .filter((board) => includeDeleted || !board.deleted)
    .map((board) => publicBoard(board, state, now))
    .sort((a, b) => a.boardNo.localeCompare(b.boardNo, 'zh-Hans-CN'));
}

function validateBoardInput(input, { partial = false } = {}) {
  const result = {};

  if (!partial || input.boardNo !== undefined) {
    result.boardNo = trim(input.boardNo);
    if (!result.boardNo) throw badRequest('单板编号不能为空');
  }

  if (!partial || input.type !== undefined) result.type = trim(input.type);
  if (!partial || input.version !== undefined) result.version = trim(input.version);
  if (!partial || input.systemVersion !== undefined) result.systemVersion = trim(input.systemVersion);
  if (!partial || input.remark !== undefined) result.remark = trim(input.remark);

  if (!partial || input.subcards !== undefined) {
    if (input.subcards === undefined || input.subcards === null || input.subcards === '') {
      result.subcards = [];
    } else if (!Array.isArray(input.subcards)) {
      throw badRequest('子卡信息必须是数组');
    } else {
      result.subcards = input.subcards
        .map((subcard) => ({
          name: trim(subcard.name),
          model: trim(subcard.model),
          remark: trim(subcard.remark),
        }))
        .filter((subcard) => subcard.name || subcard.model || subcard.remark);
    }
  }

  return result;
}

function assertUniqueBoardNo(state, boardNo, ignoreId = undefined) {
  const duplicated = state.boards.some(
    (board) => board.id !== ignoreId && sameBoardNo(board.boardNo, boardNo),
  );
  if (duplicated) {
    throw conflict('单板编号已存在');
  }
}

function findBoard(state, boardId) {
  const board = state.boards.find((item) => item.id === boardId);
  if (!board) throw notFound('单板不存在');
  return board;
}

function findReservation(state, reservationId) {
  const reservation = state.reservations.find((item) => item.id === reservationId);
  if (!reservation) throw notFound('申请记录不存在');
  return reservation;
}

function assertReservationSlotAvailable(state, boardId, startAt, endAt, ignoreReservationId = undefined) {
  const conflicting = state.reservations.find((reservation) => {
    if (reservation.id === ignoreReservationId || reservation.boardId !== boardId || !isOpenReservation(reservation)) {
      return false;
    }
    return overlaps(startAt, endAt, reservationStart(reservation), reservationEnd(reservation));
  });

  if (conflicting) {
    throw conflict('该时间段已被预约或占用');
  }
}

export function createBoard(state, input, user, config, now = new Date()) {
  requireAdmin(user, state, config);
  const values = validateBoardInput(input);
  assertUniqueBoardNo(state, values.boardNo);

  const timestamp = nowIso(now);
  const board = {
    id: createId('board'),
    boardNo: values.boardNo,
    type: values.type,
    version: values.version,
    systemVersion: values.systemVersion,
    subcards: values.subcards,
    status: 'available',
    currentUserId: '',
    currentUserName: '',
    currentReservationId: '',
    remark: values.remark,
    deleted: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.boards.push(board);
  return publicBoard(board, state, now);
}

export function updateBoard(state, boardId, input, user, config, now = new Date()) {
  requireAdmin(user, state, config);
  const board = findBoard(state, boardId);
  if (board.deleted) {
    throw conflict('已删除单板不能编辑');
  }

  const values = validateBoardInput(input, { partial: true });
  if (values.boardNo !== undefined) {
    assertUniqueBoardNo(state, values.boardNo, board.id);
  }

  Object.assign(board, values, { updatedAt: nowIso(now) });
  return publicBoard(board, state, now);
}

export function deleteBoard(state, boardId, user, config, now = new Date()) {
  requireAdmin(user, state, config);
  const board = findBoard(state, boardId);
  if (board.deleted) return publicBoard(board, state, now);
  const hasOpenReservation = state.reservations.some((reservation) => {
    return reservation.boardId === board.id && isOpenReservation(reservation) && reservationEnd(reservation) > now;
  });
  if (hasOpenReservation) {
    throw conflict('单板存在未完成占用或预约，请处理后再删除');
  }

  board.deleted = true;
  board.status = 'deleted';
  board.updatedAt = nowIso(now);
  return publicBoard(board, state, now);
}

export function createReservation(state, input, user, now = new Date()) {
  const boardId = trim(input.boardId);
  const board = findBoard(state, boardId);
  if (board.deleted) throw conflict('已删除单板不能申请');

  const durationHours = Number(input.durationHours);
  if (!isValidDurationHours(durationHours)) {
    throw badRequest('申请时长必须至少 0.5 小时，并按 0.5 小时递增');
  }

  const rawStart = input.startAt ? asDate(input.startAt, '预约开始时间') : now;
  const startAt = normalizeBusinessStart(rawStart);
  if (startAt.getTime() < now.getTime() - 1000) {
    throw badRequest('预约开始时间不能早于当前时间');
  }
  const plannedEnd = addBusinessHours(startAt, durationHours);
  assertReservationSlotAvailable(state, board.id, startAt, plannedEnd);

  const timestamp = nowIso(now);
  const reservation = {
    id: createId('resv'),
    boardId: board.id,
    userId: user.id,
    userName: user.name,
    durationHours,
    purpose: trim(input.purpose),
    startedAt: startAt.toISOString(),
    plannedEndAt: plannedEnd.toISOString(),
    returnedAt: null,
    status: startAt.getTime() > now.getTime() ? RESERVED : ACTIVE,
    returnRequestCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.reservations.push(reservation);

  const activeReservation = getActiveReservation(state, board.id, now);
  board.status = deriveBoardStatus(board, activeReservation, now);
  board.currentUserId = activeReservation?.userId || '';
  board.currentUserName = activeReservation?.userName || '';
  board.currentReservationId = activeReservation?.id || '';
  board.updatedAt = timestamp;

  return publicReservation(reservation, board, now);
}

export function returnReservation(state, reservationId, user, config, now = new Date()) {
  const reservation = findReservation(state, reservationId);
  const board = findBoard(state, reservation.boardId);
  const status = deriveReservationStatus(reservation, now);
  if (status === RETURNED) {
    throw conflict('该申请记录已归还');
  }
  if (status === RESERVED) {
    throw conflict('预约尚未开始，暂不能归还');
  }

  const canReturn = reservation.userId === user.id || isAdminUser(user, state, config);
  if (!canReturn) {
    throw forbidden('只有当前使用人或管理员可以归还该单板');
  }

  const timestamp = nowIso(now);
  reservation.status = RETURNED;
  reservation.returnedAt = timestamp;
  reservation.updatedAt = timestamp;

  const activeReservation = getActiveReservation(state, board.id, now);
  board.status = deriveBoardStatus(board, activeReservation, now);
  board.currentUserId = activeReservation?.userId || '';
  board.currentUserName = activeReservation?.userName || '';
  board.currentReservationId = activeReservation?.id || '';
  board.updatedAt = timestamp;

  return publicReservation(reservation, board, now);
}

export async function requestReturn(state, reservationId, user, now = new Date(), notifier = undefined) {
  const reservation = findReservation(state, reservationId);
  const board = findBoard(state, reservation.boardId);
  const status = deriveReservationStatus(reservation, now);

  if (status === RETURNED) {
    throw conflict('该申请记录已归还');
  }
  if (status === RESERVED) {
    throw conflict('预约尚未开始，暂不能请求归还');
  }
  if (reservation.userId === user.id) {
    throw conflict('当前使用人不需要请求自己归还');
  }
  if (status !== 'overdue') {
    throw conflict('单板未超时，暂不能请求归还');
  }

  const timestamp = nowIso(now);
  const request = {
    id: createId('retreq'),
    reservationId: reservation.id,
    requesterUserId: user.id,
    requesterName: user.name,
    requestedAt: timestamp,
    notificationStatus: 'pending',
  };

  state.returnRequests.push(request);
  reservation.returnRequestCount = (reservation.returnRequestCount || 0) + 1;
  reservation.updatedAt = timestamp;

  if (notifier) {
    try {
      request.notificationStatus = await notifier.sendReturnRequest({ reservation, board, requester: user });
    } catch {
      request.notificationStatus = 'failed';
    }
  } else {
    request.notificationStatus = 'skipped';
  }

  return {
    id: request.id,
    reservationId: request.reservationId,
    requesterUserId: request.requesterUserId,
    requesterName: request.requesterName,
    requestedAt: request.requestedAt,
    notificationStatus: request.notificationStatus,
  };
}

export function listMyReservations(state, user, now = new Date()) {
  const reservations = state.reservations
    .filter((reservation) => reservation.userId === user.id)
    .map((reservation) => {
      const board = state.boards.find((item) => item.id === reservation.boardId);
      return {
        ...publicReservation(reservation, board, now),
        board: board ? publicBoard(board, state, now) : null,
      };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return {
    current: reservations.filter((reservation) => ['active', 'overdue'].includes(reservation.status)),
    upcoming: reservations.filter((reservation) => reservation.status === RESERVED),
    history: reservations.filter((reservation) => reservation.status === RETURNED),
  };
}

export function listTimeline(state, { from, to, includeDeleted = false, now = new Date() } = {}) {
  const fromDate = from ? asDate(from, '时间线开始时间') : new Date(now.getTime());
  const toDate = to ? asDate(to, '时间线结束时间') : new Date(fromDate.getTime() + 3 * 24 * 60 * 60 * 1000);
  if (toDate.getTime() <= fromDate.getTime()) {
    throw badRequest('时间线结束时间必须晚于开始时间');
  }

  const boards = state.boards
    .filter((board) => includeDeleted || !board.deleted)
    .sort((a, b) => a.boardNo.localeCompare(b.boardNo, 'zh-Hans-CN'))
    .map((board) => {
      const reservations = state.reservations
        .filter((reservation) => {
          if (reservation.boardId !== board.id || reservation.status === RETURNED) return false;
          return overlaps(reservationStart(reservation), reservationEnd(reservation), fromDate, toDate);
        })
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .map((reservation) => publicReservation(reservation, board, now));

      return {
        board: publicBoard(board, state, now),
        reservations,
      };
    });

  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    boards,
  };
}
