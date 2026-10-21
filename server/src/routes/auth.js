import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { clearSession, issueSession, requireAuth } from '../middleware/auth.js';
import { HttpError, parseBody } from '../middleware/errors.js';
import { User } from '../models/User.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts; try again in a few minutes' },
});

const RegisterSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});

router.post('/register', authLimiter, async (req, res) => {
  const body = parseBody(RegisterSchema, req.body);
  if (await User.exists({ email: body.email })) throw new HttpError(409, 'An account with this email already exists');
  const user = await User.create({ name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, 12) });
  issueSession(res, user);
  res.status(201).json({ user: user.toPublic() });
});

router.post('/login', authLimiter, async (req, res) => {
  const body = parseBody(LoginSchema, req.body);
  const user = await User.findOne({ email: body.email }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) throw new HttpError(401, 'Incorrect email or password');
  issueSession(res, user);
  res.json({ user: user.toPublic() });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new HttpError(401, 'Account not found');
  res.json({ user: user.toPublic() });
});

export default router;
