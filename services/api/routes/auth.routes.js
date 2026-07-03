import { z } from 'zod';
import { authService } from '../services/AuthService.js';
import { validate } from '../middlewares/validate.middleware.js';
import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(120).optional(),
  organizationName: z.string().min(1).max(160).optional(),
}).strict();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
}).strict();

router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const data = await authService.register(req.body);
    res.status(201).json({ status: 'success', data });
  } catch (err) { next(err); }
});

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const data = await authService.login(req.body);
    res.json({ status: 'success', data });
  } catch (err) { next(err); }
});

router.get('/me', authenticate, (req, res) => res.json({ status: 'success', data: { user: req.user } }));

export default router;

