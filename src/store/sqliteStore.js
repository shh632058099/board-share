import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { normalizeState } from '../state.js';

function parseJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonValue(value, fallback) {
  return JSON.stringify(value === undefined || value === null ? fallback : value);
}

function boolFromRow(value) {
  return Boolean(Number(value || 0));
}

function rowBool(value) {
  return value ? 1 : 0;
}

function text(value, fallback = '') {
  return value === undefined || value === null ? fallback : String(value);
}

function nowIso() {
  return new Date().toISOString();
}

function boardFromRow(row) {
  return {
    id: row.id,
    boardNo: row.board_no,
    displayName: row.display_name || '',
    type: row.type || '',
    model: row.model || '',
    version: row.version || '',
    systemVersion: row.system_version || '',
    assetNo: row.asset_no || '',
    serialNo: row.serial_no || '',
    location: row.location || '',
    ownerUserId: row.owner_user_id || '',
    ownerUserName: row.owner_user_name || '',
    subcards: parseJson(row.subcards_json, []),
    tags: parseJson(row.tags_json, []),
    attrs: parseJson(row.attrs_json, {}),
    status: row.status || 'available',
    currentUserId: row.current_user_id || '',
    currentUserName: row.current_user_name || '',
    currentReservationId: row.current_reservation_id || '',
    sortOrder: Number(row.sort_order || 0),
    remark: row.remark || '',
    deleted: boolFromRow(row.deleted),
    deletedAt: row.deleted_at || null,
    createdById: row.created_by_id || '',
    createdByName: row.created_by_name || '',
    updatedById: row.updated_by_id || '',
    updatedByName: row.updated_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function boardParams(board) {
  const timestamp = nowIso();
  return {
    id: board.id,
    boardNo: board.boardNo,
    displayName: board.displayName || '',
    type: board.type || '',
    model: board.model || '',
    version: board.version || '',
    systemVersion: board.systemVersion || '',
    assetNo: board.assetNo || '',
    serialNo: board.serialNo || '',
    location: board.location || '',
    ownerUserId: board.ownerUserId || '',
    ownerUserName: board.ownerUserName || '',
    subcardsJson: jsonValue(board.subcards, []),
    tagsJson: jsonValue(board.tags, []),
    attrsJson: jsonValue(board.attrs, {}),
    status: board.status || 'available',
    currentUserId: board.currentUserId || '',
    currentUserName: board.currentUserName || '',
    currentReservationId: board.currentReservationId || '',
    sortOrder: Number(board.sortOrder || 0),
    remark: board.remark || '',
    deleted: rowBool(board.deleted),
    deletedAt: board.deletedAt || null,
    createdById: board.createdById || '',
    createdByName: board.createdByName || '',
    updatedById: board.updatedById || '',
    updatedByName: board.updatedByName || '',
    createdAt: board.createdAt || timestamp,
    updatedAt: board.updatedAt || board.createdAt || timestamp,
  };
}

function reservationFromRow(row) {
  return {
    id: row.id,
    boardId: row.board_id,
    boardNoSnapshot: row.board_no_snapshot || '',
    boardTypeSnapshot: row.board_type_snapshot || '',
    boardVersionSnapshot: row.board_version_snapshot || '',
    userId: row.user_id,
    userName: row.user_name,
    userOpenId: row.user_open_id || '',
    userUnionId: row.user_union_id || '',
    durationHours: Number(row.duration_hours || 0),
    purpose: row.purpose || '',
    startedAt: row.started_at,
    plannedEndAt: row.planned_end_at,
    returnedAt: row.returned_at || null,
    status: row.status || 'active',
    returnRequestCount: Number(row.return_request_count || 0),
    canceledAt: row.canceled_at || null,
    canceledById: row.canceled_by_id || '',
    canceledByName: row.canceled_by_name || '',
    cancelReason: row.cancel_reason || '',
    returnedById: row.returned_by_id || '',
    returnedByName: row.returned_by_name || '',
    actualDurationHours: row.actual_duration_hours === null ? null : Number(row.actual_duration_hours),
    tags: parseJson(row.tags_json, []),
    attrs: parseJson(row.attrs_json, {}),
    createdById: row.created_by_id || '',
    createdByName: row.created_by_name || '',
    updatedById: row.updated_by_id || '',
    updatedByName: row.updated_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function reservationParams(reservation) {
  const timestamp = nowIso();
  return {
    id: reservation.id,
    boardId: reservation.boardId,
    boardNoSnapshot: reservation.boardNoSnapshot || '',
    boardTypeSnapshot: reservation.boardTypeSnapshot || '',
    boardVersionSnapshot: reservation.boardVersionSnapshot || '',
    userId: reservation.userId,
    userName: reservation.userName,
    userOpenId: reservation.userOpenId || '',
    userUnionId: reservation.userUnionId || '',
    durationHours: Number(reservation.durationHours || 0),
    purpose: reservation.purpose || '',
    startedAt: reservation.startedAt,
    plannedEndAt: reservation.plannedEndAt,
    returnedAt: reservation.returnedAt || null,
    status: reservation.status || 'active',
    returnRequestCount: Number(reservation.returnRequestCount || 0),
    canceledAt: reservation.canceledAt || null,
    canceledById: reservation.canceledById || '',
    canceledByName: reservation.canceledByName || '',
    cancelReason: reservation.cancelReason || '',
    returnedById: reservation.returnedById || '',
    returnedByName: reservation.returnedByName || '',
    actualDurationHours: reservation.actualDurationHours ?? null,
    tagsJson: jsonValue(reservation.tags, []),
    attrsJson: jsonValue(reservation.attrs, {}),
    createdById: reservation.createdById || '',
    createdByName: reservation.createdByName || '',
    updatedById: reservation.updatedById || '',
    updatedByName: reservation.updatedByName || '',
    createdAt: reservation.createdAt || timestamp,
    updatedAt: reservation.updatedAt || reservation.createdAt || timestamp,
  };
}

function returnRequestFromRow(row) {
  return {
    id: row.id,
    reservationId: row.reservation_id,
    boardId: row.board_id || '',
    boardNoSnapshot: row.board_no_snapshot || '',
    targetUserId: row.target_user_id || '',
    targetUserName: row.target_user_name || '',
    requesterUserId: row.requester_user_id,
    requesterName: row.requester_name,
    requestedAt: row.requested_at,
    notificationStatus: row.notification_status || 'pending',
    channel: row.channel || '',
    messageId: row.message_id || '',
    response: parseJson(row.response_json, {}),
    attrs: parseJson(row.attrs_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function returnRequestParams(request) {
  const timestamp = nowIso();
  return {
    id: request.id,
    reservationId: request.reservationId,
    boardId: request.boardId || '',
    boardNoSnapshot: request.boardNoSnapshot || '',
    targetUserId: request.targetUserId || '',
    targetUserName: request.targetUserName || '',
    requesterUserId: request.requesterUserId,
    requesterName: request.requesterName,
    requestedAt: request.requestedAt,
    notificationStatus: request.notificationStatus || 'pending',
    channel: request.channel || '',
    messageId: request.messageId || '',
    responseJson: jsonValue(request.response, {}),
    attrsJson: jsonValue(request.attrs, {}),
    createdAt: request.createdAt || request.requestedAt || timestamp,
    updatedAt: request.updatedAt || request.createdAt || request.requestedAt || timestamp,
  };
}

function adminFromRow(row) {
  return {
    userId: row.user_id,
    name: row.name || '',
    openId: row.open_id || '',
    unionId: row.union_id || '',
    role: row.role || 'admin',
    permissions: parseJson(row.permissions_json, {}),
    source: row.source || 'database',
    enabled: boolFromRow(row.enabled),
    remark: row.remark || '',
    attrs: parseJson(row.attrs_json, {}),
    createdById: row.created_by_id || '',
    createdByName: row.created_by_name || '',
    updatedById: row.updated_by_id || '',
    updatedByName: row.updated_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function adminParams(admin) {
  const timestamp = nowIso();
  return {
    userId: admin.userId,
    name: admin.name || '',
    openId: admin.openId || '',
    unionId: admin.unionId || '',
    role: admin.role || 'admin',
    permissionsJson: jsonValue(admin.permissions, {}),
    source: admin.source || 'database',
    enabled: admin.enabled === undefined ? 1 : rowBool(admin.enabled),
    remark: admin.remark || '',
    attrsJson: jsonValue(admin.attrs, {}),
    createdById: admin.createdById || '',
    createdByName: admin.createdByName || '',
    updatedById: admin.updatedById || '',
    updatedByName: admin.updatedByName || '',
    createdAt: admin.createdAt || timestamp,
    updatedAt: admin.updatedAt || admin.createdAt || timestamp,
  };
}

export class SQLiteStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
    this.prepareStatements();
  }

  migrate() {
    this.db.exec(`
      create table if not exists schema_migrations (
        version integer primary key,
        name text not null,
        applied_at text not null
      );

      create table if not exists app_settings (
        key text primary key,
        value_json text not null,
        updated_at text not null
      );

      create table if not exists boards (
        id text primary key,
        board_no text not null unique,
        display_name text,
        type text,
        model text,
        version text,
        system_version text,
        asset_no text,
        serial_no text,
        location text,
        owner_user_id text,
        owner_user_name text,
        subcards_json text not null default '[]',
        tags_json text not null default '[]',
        attrs_json text not null default '{}',
        status text not null default 'available',
        current_user_id text,
        current_user_name text,
        current_reservation_id text,
        sort_order integer not null default 0,
        remark text,
        deleted integer not null default 0,
        deleted_at text,
        created_by_id text,
        created_by_name text,
        updated_by_id text,
        updated_by_name text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists reservations (
        id text primary key,
        board_id text not null,
        board_no_snapshot text,
        board_type_snapshot text,
        board_version_snapshot text,
        user_id text not null,
        user_name text not null,
        user_open_id text,
        user_union_id text,
        duration_hours real not null,
        purpose text,
        started_at text not null,
        planned_end_at text not null,
        returned_at text,
        status text not null,
        return_request_count integer not null default 0,
        canceled_at text,
        canceled_by_id text,
        canceled_by_name text,
        cancel_reason text,
        returned_by_id text,
        returned_by_name text,
        actual_duration_hours real,
        tags_json text not null default '[]',
        attrs_json text not null default '{}',
        created_by_id text,
        created_by_name text,
        updated_by_id text,
        updated_by_name text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists return_requests (
        id text primary key,
        reservation_id text not null,
        board_id text,
        board_no_snapshot text,
        target_user_id text,
        target_user_name text,
        requester_user_id text not null,
        requester_name text not null,
        requested_at text not null,
        notification_status text not null default 'pending',
        channel text,
        message_id text,
        response_json text not null default '{}',
        attrs_json text not null default '{}',
        created_at text not null,
        updated_at text not null
      );

      create table if not exists admins (
        user_id text primary key,
        name text,
        open_id text,
        union_id text,
        role text not null default 'admin',
        permissions_json text not null default '{}',
        source text not null default 'database',
        enabled integer not null default 1,
        remark text,
        attrs_json text not null default '{}',
        created_by_id text,
        created_by_name text,
        updated_by_id text,
        updated_by_name text,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists idx_boards_status on boards(status);
      create index if not exists idx_boards_deleted on boards(deleted);
      create index if not exists idx_boards_board_no on boards(board_no);
      create index if not exists idx_reservations_board_time on reservations(board_id, started_at, planned_end_at);
      create index if not exists idx_reservations_user_status on reservations(user_id, status);
      create index if not exists idx_reservations_status_time on reservations(status, started_at, planned_end_at);
      create index if not exists idx_return_requests_reservation on return_requests(reservation_id);
      create index if not exists idx_admins_enabled on admins(enabled);
    `);

    const applied = this.db.prepare('select version from schema_migrations where version = 1').get();
    if (!applied) {
      this.db
        .prepare('insert into schema_migrations (version, name, applied_at) values (?, ?, ?)')
        .run(1, 'initial_sqlite_schema', nowIso());
    }
  }

  prepareStatements() {
    this.selectBoards = this.db.prepare('select * from boards order by sort_order, board_no, id');
    this.selectReservations = this.db.prepare('select * from reservations order by started_at, id');
    this.selectReturnRequests = this.db.prepare('select * from return_requests order by requested_at, id');
    this.selectAdmins = this.db.prepare('select * from admins order by user_id');

    this.insertBoard = this.db.prepare(`
      insert into boards (
        id, board_no, display_name, type, model, version, system_version, asset_no, serial_no,
        location, owner_user_id, owner_user_name, subcards_json, tags_json, attrs_json, status,
        current_user_id, current_user_name, current_reservation_id, sort_order, remark, deleted,
        deleted_at, created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at
      ) values (
        @id, @boardNo, @displayName, @type, @model, @version, @systemVersion, @assetNo, @serialNo,
        @location, @ownerUserId, @ownerUserName, @subcardsJson, @tagsJson, @attrsJson, @status,
        @currentUserId, @currentUserName, @currentReservationId, @sortOrder, @remark, @deleted,
        @deletedAt, @createdById, @createdByName, @updatedById, @updatedByName, @createdAt, @updatedAt
      )
    `);

    this.insertReservation = this.db.prepare(`
      insert into reservations (
        id, board_id, board_no_snapshot, board_type_snapshot, board_version_snapshot, user_id, user_name,
        user_open_id, user_union_id, duration_hours, purpose, started_at, planned_end_at, returned_at,
        status, return_request_count, canceled_at, canceled_by_id, canceled_by_name, cancel_reason,
        returned_by_id, returned_by_name, actual_duration_hours, tags_json, attrs_json, created_by_id,
        created_by_name, updated_by_id, updated_by_name, created_at, updated_at
      ) values (
        @id, @boardId, @boardNoSnapshot, @boardTypeSnapshot, @boardVersionSnapshot, @userId, @userName,
        @userOpenId, @userUnionId, @durationHours, @purpose, @startedAt, @plannedEndAt, @returnedAt,
        @status, @returnRequestCount, @canceledAt, @canceledById, @canceledByName, @cancelReason,
        @returnedById, @returnedByName, @actualDurationHours, @tagsJson, @attrsJson, @createdById,
        @createdByName, @updatedById, @updatedByName, @createdAt, @updatedAt
      )
    `);

    this.insertReturnRequest = this.db.prepare(`
      insert into return_requests (
        id, reservation_id, board_id, board_no_snapshot, target_user_id, target_user_name, requester_user_id,
        requester_name, requested_at, notification_status, channel, message_id, response_json, attrs_json,
        created_at, updated_at
      ) values (
        @id, @reservationId, @boardId, @boardNoSnapshot, @targetUserId, @targetUserName, @requesterUserId,
        @requesterName, @requestedAt, @notificationStatus, @channel, @messageId, @responseJson, @attrsJson,
        @createdAt, @updatedAt
      )
    `);

    this.insertAdmin = this.db.prepare(`
      insert into admins (
        user_id, name, open_id, union_id, role, permissions_json, source, enabled, remark, attrs_json,
        created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at
      ) values (
        @userId, @name, @openId, @unionId, @role, @permissionsJson, @source, @enabled, @remark, @attrsJson,
        @createdById, @createdByName, @updatedById, @updatedByName, @createdAt, @updatedAt
      )
    `);

    this.replaceState = this.db.transaction((state) => {
      this.db.prepare('delete from return_requests').run();
      this.db.prepare('delete from reservations').run();
      this.db.prepare('delete from boards').run();
      this.db.prepare('delete from admins').run();

      for (const board of state.boards) this.insertBoard.run(boardParams(board));
      for (const reservation of state.reservations) this.insertReservation.run(reservationParams(reservation));
      for (const request of state.returnRequests) this.insertReturnRequest.run(returnRequestParams(request));
      for (const admin of state.admins) this.insertAdmin.run(adminParams(admin));
    });
  }

  async read() {
    return normalizeState(
      {
        boards: this.selectBoards.all().map(boardFromRow),
        reservations: this.selectReservations.all().map(reservationFromRow),
        returnRequests: this.selectReturnRequests.all().map(returnRequestFromRow),
        admins: this.selectAdmins.all().map(adminFromRow),
      },
      { seedLocalAdmin: true },
    );
  }

  async write(state) {
    this.replaceState(normalizeState(state, { seedLocalAdmin: true }));
  }

  async update(mutator) {
    const run = async () => {
      const state = await this.read();
      const result = await mutator(state);
      await this.write(state);
      return result;
    };

    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  close() {
    this.db.close();
  }
}
