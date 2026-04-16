import { addBusinessHours, isOverdue, isValidDurationHours } from './businessTime.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { createId } from './id.js';

const ACTIVE = 'active';
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

function publicReservation(reservation, board = undefined) {
  if (!reservation) return null;
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
    status: reservation.status,
    returnRequestCount: reservation.returnRequestCount || 0,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
  };
}

export function getActiveReservation(state, boardId) {
  return state.reservations.find(
    (reservation) => reservation.boardId === boardId && reservation.status === ACTIVE,
  );
}

export function deriveBoardStatus(board, reservation, now = new Date()) {
  if (board.deleted) return 'deleted';
  if (!reservation) return 'available';
  return isOverdue(reservation.plannedEndAt, now) ? 'overdue' : 'in_use';
}

export function publicBoard(board, state, now = new Date()) {
  const activeReservation = getActiveReservation(state, board.id);
  const status = deriveBoardStatus(board, activeReservation, now);
  return {
    id: board.id,
    boardNo: board.boardNo,
    type: board.type,
    version: board.version,
    systemVersion: board.systemVersion,
    subcards: board.subcards || [],
    status,
    currentUserId: activeReservation?.userId || board.currentUserId || '',
    currentUserName: activeReservation?.userName || board.currentUserName || '',
    currentReservationId: activeReservation?.id || board.currentReservationId || '',
    currentReservation: publicReservation(activeReservation, board),
    remark: board.remark || '',
    deleted: Boolean(board.deleted),
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}

export function isAdminUser(user, state, config) {
  if (!user?.id) return false;
  if (config.adminUserIds.includes(user.id)) return true;
  return state.admins.some((admin) => admin.enabled && admin.userId === user.id);
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
  if (getActiveReservation(state, board.id)) {
    throw conflict('单板正在使用中，请先归还后再删除');
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
  if (getActiveReservation(state, board.id)) throw conflict('该单板已被占用');

  const durationHours = Number(input.durationHours);
  if (!isValidDurationHours(durationHours)) {
    throw badRequest('申请时长必须至少 0.5 小时，并按 0.5 小时递增');
  }

  const plannedEnd = addBusinessHours(now, durationHours);
  const timestamp = nowIso(now);
  const reservation = {
    id: createId('resv'),
    boardId: board.id,
    userId: user.id,
    userName: user.name,
    durationHours,
    purpose: trim(input.purpose),
    startedAt: timestamp,
    plannedEndAt: plannedEnd.toISOString(),
    returnedAt: null,
    status: ACTIVE,
    returnRequestCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  state.reservations.push(reservation);
  board.status = deriveBoardStatus(board, reservation, now);
  board.currentUserId = user.id;
  board.currentUserName = user.name;
  board.currentReservationId = reservation.id;
  board.updatedAt = timestamp;

  return publicReservation(reservation, board);
}

export function returnReservation(state, reservationId, user, config, now = new Date()) {
  const reservation = findReservation(state, reservationId);
  const board = findBoard(state, reservation.boardId);
  if (reservation.status !== ACTIVE) {
    throw conflict('该申请记录已归还');
  }

  const canReturn = reservation.userId === user.id || isAdminUser(user, state, config);
  if (!canReturn) {
    throw forbidden('只有当前使用人或管理员可以归还该单板');
  }

  const timestamp = nowIso(now);
  reservation.status = RETURNED;
  reservation.returnedAt = timestamp;
  reservation.updatedAt = timestamp;

  if (board.currentReservationId === reservation.id || !getActiveReservation(state, board.id)) {
    board.status = 'available';
    board.currentUserId = '';
    board.currentUserName = '';
    board.currentReservationId = '';
    board.updatedAt = timestamp;
  }

  return publicReservation(reservation, board);
}

export async function requestReturn(state, reservationId, user, now = new Date(), notifier = undefined) {
  const reservation = findReservation(state, reservationId);
  const board = findBoard(state, reservation.boardId);

  if (reservation.status !== ACTIVE) {
    throw conflict('该申请记录已归还');
  }
  if (reservation.userId === user.id) {
    throw conflict('当前使用人不需要请求自己归还');
  }
  if (!isOverdue(reservation.plannedEndAt, now)) {
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
        ...publicReservation(reservation, board),
        board: board ? publicBoard(board, state, now) : null,
      };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return {
    current: reservations.filter((reservation) => reservation.status === ACTIVE),
    history: reservations.filter((reservation) => reservation.status !== ACTIVE),
  };
}
