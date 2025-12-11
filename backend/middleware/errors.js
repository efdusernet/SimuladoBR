const { AppError } = require('./errorHandler');

const badRequest = (message = 'Requisição inválida', code = 'BAD_REQUEST', details) =>
  new AppError(message, 400, code, details);

const unauthorized = (message = 'Não autorizado', code = 'UNAUTHORIZED', details) =>
  new AppError(message, 401, code, details);

const forbidden = (message = 'Proibido', code = 'FORBIDDEN', details) =>
  new AppError(message, 403, code, details);

const notFound = (message = 'Não encontrado', code = 'NOT_FOUND', details) =>
  new AppError(message, 404, code, details);

const conflict = (message = 'Conflito', code = 'CONFLICT', details) =>
  new AppError(message, 409, code, details);

const unprocessable = (message = 'Entidade não processável', code = 'UNPROCESSABLE_ENTITY', details) =>
  new AppError(message, 422, code, details);

const tooManyRequests = (message = 'Muitas requisições', code = 'TOO_MANY_REQUESTS', details) =>
  new AppError(message, 429, code, details);

const internalError = (message = 'Erro interno do servidor', code = 'INTERNAL_ERROR', details) =>
  new AppError(message, 500, code, details);

module.exports = {
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  tooManyRequests,
  internalError
};
