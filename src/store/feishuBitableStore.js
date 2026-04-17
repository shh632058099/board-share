import { normalizeState } from '../state.js';

function textField(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return item.text || item.name || item.value || '';
        return String(item || '');
      })
      .join('');
  }
  return value.text || value.name || value.value || '';
}

function boolField(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', '启用', '是'].includes(textField(value).toLowerCase());
}

function numberField(value) {
  const number = Number(textField(value));
  return Number.isFinite(number) ? number : 0;
}

function parseJsonField(value, fallback) {
  const text = textField(value);
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function cleanFields(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function field(record, name) {
  return record.fields?.[name];
}

function boardFromRecord(record) {
  return {
    __recordId: record.record_id,
    id: textField(field(record, 'ID')) || record.record_id,
    boardNo: textField(field(record, '单板编号')),
    type: textField(field(record, '类型')),
    version: textField(field(record, '版本号')),
    systemVersion: textField(field(record, '系统版本号')),
    subcards: parseJsonField(field(record, '子卡列表'), []),
    status: textField(field(record, '状态')) || 'available',
    currentUserId: textField(field(record, '当前使用人')),
    currentUserName: textField(field(record, '当前使用人姓名')),
    currentReservationId: textField(field(record, '当前申请记录')),
    remark: textField(field(record, '备注')),
    deleted: boolField(field(record, '是否删除')),
    createdAt: textField(field(record, '创建时间')),
    updatedAt: textField(field(record, '更新时间')),
  };
}

function reservationFromRecord(record) {
  return {
    __recordId: record.record_id,
    id: textField(field(record, 'ID')) || record.record_id,
    boardId: textField(field(record, '单板ID')),
    userId: textField(field(record, '申请人')),
    userName: textField(field(record, '申请人姓名')),
    durationHours: numberField(field(record, '申请时长')),
    purpose: textField(field(record, '用途备注')),
    startedAt: textField(field(record, '开始时间')),
    plannedEndAt: textField(field(record, '计划结束时间')),
    returnedAt: textField(field(record, '实际归还时间')) || null,
    status: textField(field(record, '状态')) || 'active',
    returnRequestCount: numberField(field(record, '归还请求次数')),
    createdAt: textField(field(record, '创建时间')),
    updatedAt: textField(field(record, '更新时间')),
  };
}

function returnRequestFromRecord(record) {
  return {
    __recordId: record.record_id,
    id: textField(field(record, 'ID')) || record.record_id,
    reservationId: textField(field(record, '申请记录')),
    requesterUserId: textField(field(record, '请求人')),
    requesterName: textField(field(record, '请求人姓名')),
    requestedAt: textField(field(record, '请求时间')),
    notificationStatus: textField(field(record, '通知状态')) || 'pending',
  };
}

function adminFromRecord(record) {
  return {
    __recordId: record.record_id,
    userId: textField(field(record, '管理员飞书用户 ID')),
    name: textField(field(record, '姓名')),
    enabled: boolField(field(record, '启用状态')),
  };
}

function boardFields(board) {
  return cleanFields({
    ID: board.id,
    单板编号: board.boardNo,
    类型: board.type,
    版本号: board.version,
    系统版本号: board.systemVersion,
    子卡列表: JSON.stringify(board.subcards || []),
    状态: board.deleted ? 'deleted' : board.status || 'available',
    当前使用人: board.currentUserId || '',
    当前使用人姓名: board.currentUserName || '',
    当前申请记录: board.currentReservationId || '',
    备注: board.remark || '',
    是否删除: Boolean(board.deleted),
    创建时间: board.createdAt,
    更新时间: board.updatedAt,
  });
}

function reservationFields(reservation) {
  return cleanFields({
    ID: reservation.id,
    单板ID: reservation.boardId,
    申请人: reservation.userId,
    申请人姓名: reservation.userName,
    申请时长: reservation.durationHours,
    用途备注: reservation.purpose || '',
    开始时间: reservation.startedAt,
    计划结束时间: reservation.plannedEndAt,
    实际归还时间: reservation.returnedAt || '',
    状态: reservation.status,
    归还请求次数: reservation.returnRequestCount || 0,
    创建时间: reservation.createdAt,
    更新时间: reservation.updatedAt,
  });
}

function returnRequestFields(request) {
  return cleanFields({
    ID: request.id,
    申请记录: request.reservationId,
    请求人: request.requesterUserId,
    请求人姓名: request.requesterName,
    请求时间: request.requestedAt,
    通知状态: request.notificationStatus,
  });
}

function maskToken(value) {
  const text = String(value || '');
  if (text.length <= 8) return text || '未配置';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function adminFields(admin) {
  return cleanFields({
    '管理员飞书用户 ID': admin.userId,
    姓名: admin.name || '',
    启用状态: Boolean(admin.enabled),
  });
}

export class FeishuBitableStore {
  constructor(client, config) {
    this.client = client;
    this.config = config;
    this.queue = Promise.resolve();
  }

  get appToken() {
    return this.config.feishu.bitableAppToken;
  }

  get tables() {
    return this.config.feishu.tables;
  }

  async readTableRecords(label, tableId) {
    if (!this.appToken) {
      throw new Error(`飞书多维表格 app token 未配置，读取 ${label} 表失败`);
    }
    if (!tableId) {
      throw new Error(`飞书多维表格 ${label} table id 未配置`);
    }

    try {
      return await this.client.listBitableRecords(this.appToken, tableId);
    } catch (error) {
      throw new Error(
        `读取飞书多维表格 ${label} 表失败：${error.message}。app_token=${maskToken(
          this.appToken,
        )}，table_id=${tableId}`,
      );
    }
  }

  async read() {
    const [boards, reservations, returnRequests, admins] = await Promise.all([
      this.readTableRecords('Boards', this.tables.boards),
      this.readTableRecords('Reservations', this.tables.reservations),
      this.readTableRecords('ReturnRequests', this.tables.returnRequests),
      this.readTableRecords('Admins', this.tables.admins),
    ]);

    return normalizeState({
      boards: boards.map(boardFromRecord),
      reservations: reservations.map(reservationFromRecord),
      returnRequests: returnRequests.map(returnRequestFromRecord),
      admins: admins.map(adminFromRecord).filter((admin) => admin.userId),
    });
  }

  async write(state) {
    const normalized = normalizeState(state);
    await this.syncTable('Boards', this.tables.boards, normalized.boards, boardFields);
    await this.syncTable('Reservations', this.tables.reservations, normalized.reservations, reservationFields);
    await this.syncTable('ReturnRequests', this.tables.returnRequests, normalized.returnRequests, returnRequestFields);
    await this.syncTable('Admins', this.tables.admins, normalized.admins, adminFields);
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

  async syncTable(label, tableId, items, toFields) {
    if (!this.appToken) {
      throw new Error(`飞书多维表格 app token 未配置，写入 ${label} 表失败`);
    }
    if (!tableId) {
      throw new Error(`飞书多维表格 ${label} table id 未配置`);
    }

    for (const item of items) {
      try {
        if (item.__recordId) {
          await this.client.updateBitableRecord(this.appToken, tableId, item.__recordId, toFields(item));
        } else {
          const record = await this.client.createBitableRecord(this.appToken, tableId, toFields(item));
          item.__recordId = record?.record_id;
        }
      } catch (error) {
        throw new Error(
          `写入飞书多维表格 ${label} 表失败：${error.message}。app_token=${maskToken(
            this.appToken,
          )}，table_id=${tableId}`,
        );
      }
    }
  }
}
