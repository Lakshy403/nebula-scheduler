import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { sequelize, User, Organization, OrganizationMember, Project, Queue } from '../../../packages/database/index.js';

const JWT_SECRET = process.env.JWT_SECRET;
const PBKDF2_ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

if (!JWT_SECRET) throw new Error('[AuthService] JWT_SECRET environment variable is not set.');

function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 120) || 'default';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored).split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(password, salt, Number(iterations), KEY_LENGTH, DIGEST).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}

function publicUser(user, member) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    organizationId: member.organization_id,
    role: member.role,
  };
}

function signToken(profile) {
  return jwt.sign({
    sub: profile.id,
    email: profile.email,
    name: profile.displayName,
    organizationId: profile.organizationId,
    role: profile.role,
  }, JWT_SECRET, { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN ?? '1d' });
}

export class AuthService {
  async register({ email, password, displayName, organizationName }) {
    const normalizedEmail = email.toLowerCase().trim();
    const name = displayName?.trim() || normalizedEmail.split('@')[0];
    const orgName = organizationName?.trim() || `${name}'s Organization`;

    return sequelize.transaction(async (transaction) => {
      const existing = await User.findOne({ where: { email: normalizedEmail }, transaction });
      if (existing) {
        const err = new Error('A user with this email already exists.');
        err.status = 409;
        err.code = 'USER_EXISTS';
        throw err;
      }

      const organization = await Organization.create({ name: orgName, slug: `${slugify(orgName)}-${Date.now().toString(36)}` }, { transaction });
      const user = await User.create({ email: normalizedEmail, display_name: name, password_hash: hashPassword(password) }, { transaction });
      const member = await OrganizationMember.create({ organization_id: organization.id, user_id: user.id, role: 'OWNER' }, { transaction });
      const project = await Project.create({ organization_id: organization.id, name: 'Default Project', slug: 'default', created_by: user.id }, { transaction });
      await Queue.create({ project_id: project.id, name: 'Default Queue', slug: 'default' }, { transaction });
      await Queue.create({ project_id: project.id, name: 'High Priority', slug: 'high-priority', priority: 9, concurrency_limit: 10 }, { transaction });

      const profile = publicUser(user, member);
      return { token: signToken(profile), user: profile };
    });
  }

  async login({ email, password }) {
    const user = await User.findOne({ where: { email: email.toLowerCase().trim(), status: 'ACTIVE' } });
    if (!user || !verifyPassword(password, user.password_hash)) {
      const err = new Error('Invalid email or password.');
      err.status = 401;
      err.code = 'INVALID_CREDENTIALS';
      throw err;
    }

    const member = await OrganizationMember.findOne({ where: { user_id: user.id }, order: [['created_at', 'ASC']] });
    if (!member) {
      const err = new Error('User is not a member of any organization.');
      err.status = 403;
      err.code = 'NO_ORGANIZATION';
      throw err;
    }

    await user.update({ last_login_at: new Date() });
    const profile = publicUser(user, member);
    return { token: signToken(profile), user: profile };
  }
}

export const authService = new AuthService();
