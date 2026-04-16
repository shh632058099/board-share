export class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message, details) {
  return new HttpError(400, 'bad_request', message, details);
}

export function unauthorized(message = '请先登录') {
  return new HttpError(401, 'unauthorized', message);
}

export function forbidden(message = '没有权限执行此操作') {
  return new HttpError(403, 'forbidden', message);
}

export function notFound(message = '资源不存在') {
  return new HttpError(404, 'not_found', message);
}

export function conflict(message) {
  return new HttpError(409, 'conflict', message);
}
