import { ZodError } from 'zod';
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function parseBody(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new HttpError(400, details[0] ? `${details[0].path ? `${details[0].path}: ` : ''}${details[0].message}` : 'Invalid request', details);
  }
  return result.data;
}

export function notFound(req, res, next) {
  next(new HttpError(404, `Not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Unexpected error';
  let details = err.details;
  if (err instanceof ZodError) {
    status = 400;
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    message = 'Invalid request';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is too large';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body';
  } else if (err.name === 'CastError') {
    status = 404;
    message = 'Not found';
  } else if (err.code === 11000) {
    status = 409;
    message = 'Already exists';
  }
  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, err);
    if (config.isProd) message = 'Internal server error';
  }
  res.status(status).json({ error: message, ...(details ? { details } : {}) });
}
