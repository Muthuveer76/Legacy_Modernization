import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from './errors.js';

export const AUTH_COOKIE = 'lmp_token';

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user._id.toString(), name: user.name }, config.jwtSecret, { expiresIn: config.tokenTtlSeconds });
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.tokenTtlSeconds * 1000,
    path: '/',
  });
  return token;
}

export function clearSession(res) {
  res.clearCookie(AUTH_COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/' });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = req.cookies?.[AUTH_COOKIE] || (header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) return next(new HttpError(401, 'Sign in to continue'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, name: payload.name };
    return next();
  } catch {
    return next(new HttpError(401, 'Your session has expired; sign in again'));
  }
}
