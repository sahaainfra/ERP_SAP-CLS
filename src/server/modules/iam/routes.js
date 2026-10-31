import { Router } from 'express';
import { requirePermission } from '../../platform/auth/index.js';
import { HttpError, badRequest } from '../../platform/http/errors.js';
import { createRateLimiter } from '../../platform/integrations/breaker.js';
import {
  parseCaptcha, parseChange, parseCode, parseEnrolBegin, parseEnrolConfirm, parseEventList, parseForgot, parseId, parseLogin, parseMfaSend, parseMfaVerify, parsePhone, parsePhoneConfirm, parsePin,
  parsePinUnlock, parsePolicyChange, parsePublicId, parseReason, parseRefresh, parseRequiredChange, parseReset, parseSessionList, parseUserList, parseUsername,
} from './validators.js';

const COOKIE = 'erp_rt';
const COOKIE_PATH = '/api/v1/iam/auth';
const ctxOf = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') ?? '', country: (req.get('x-geo-country') ?? '').toUpperCase().slice(0, 2) || null, correlationId: req.correlationId });
const cookieOf = (req) => (req.get('cookie') ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === COOKIE)?.[1] ?? null;

/**
 * Sign-in routes (no token needed: they create one) and, behind the usual sign-in, the person's own sessions, devices and second
 * steps, and the security administration. The refresh token travels in an HttpOnly, SameSite=Strict cookie scoped to the sign-in
 * routes; a script on the page can never read it. Native clients ask for it in the body with `x-token-delivery: body`.
 */
export function authRoutes({ auth, config, identity, refreshMaxAgeSec }) {
  const r = Router();
  const limiter = createRateLimiter();
  const secure = config.nodeEnv === 'production' || config.nodeEnv === 'staging';
  const limit = (name, perMinute) => (req, _res, next) =>
    limiter.take(`${name}:${req.ip}`, perMinute).ok ? next() : next(new HttpError(429, 'RATE_LIMITED', 'Too many attempts from this address. Wait a minute and try again.'));

  const deliver = (req, res, result) => {
    if (result.refreshToken) {
      res.append('Set-Cookie', `${COOKIE}=${result.refreshToken}; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=${refreshMaxAgeSec}${secure ? '; Secure' : ''}`);
    }
    const { refreshToken, ...body } = result;
    res.json({ data: req.get('x-token-delivery') === 'body' && refreshToken ? { ...body, refreshToken } : body });
  };
  /** The cookie is only honoured with a header a cross-site page cannot send, so a forged request cannot rotate someone's tokens. */
  const refreshFrom = (req, body) => {
    if (body.refreshToken) return body.refreshToken;
    const fromCookie = cookieOf(req);
    if (fromCookie && req.get('x-erp-csrf') !== '1') throw badRequest('Missing the x-erp-csrf header.');
    return fromCookie;
  };

  r.get('/auth/config', (_req, res) => {
    const p = identity.policies.for(null);
    res.json({ data: { mode: config.authMode, passwordMinLength: p.password.minLength, rememberDeviceDays: p.mfa.rememberDeviceDays, sso: p.sso.enabled ? p.sso.providers.map((s) => ({ id: s.id, type: s.type, label: s.label ?? s.id })) : [] } });
  });
  r.post('/auth/captcha', limit('captcha', 30), (req, res) => res.json({ data: auth.captchaFor(parseCaptcha(req.body).username) }));
  r.post('/auth/login', limit('login', 30), async (req, res) => deliver(req, res, await auth.login(parseLogin(req.body), ctxOf(req))));
  r.post('/auth/mfa/verify', limit('mfa', 30), async (req, res) => deliver(req, res, await auth.verifyMfa(parseMfaVerify(req.body), ctxOf(req))));
  r.post('/auth/mfa/send', limit('mfa', 30), async (req, res) => res.json({ data: await auth.sendMfaCode(parseMfaSend(req.body)) }));
  r.post('/auth/mfa/enrol/begin', limit('mfa', 30), async (req, res) => res.json({ data: await auth.enrolBegin(parseEnrolBegin(req.body)) }));
  r.post('/auth/mfa/enrol/confirm', limit('mfa', 30), async (req, res) => deliver(req, res, await auth.enrolConfirm(parseEnrolConfirm(req.body), ctxOf(req))));
  r.post('/auth/password/required-change', limit('password', 20), async (req, res) => deliver(req, res, await auth.changeRequiredPassword(parseRequiredChange(req.body), ctxOf(req))));
  r.post('/auth/password/forgot', limit('forgot', 10), async (req, res) => res.json({ data: await auth.forgotPassword(parseForgot(req.body), ctxOf(req)) }));
  r.post('/auth/password/reset', limit('reset', 20), async (req, res) => res.json({ data: await auth.resetPassword(parseReset(req.body), ctxOf(req)) }));
  r.post('/auth/pin-unlock', limit('pin', 30), async (req, res) => deliver(req, res, await auth.pinUnlock(parsePinUnlock(req.body), ctxOf(req))));
  r.post('/auth/refresh', limit('refresh', 60), (req, res) => deliver(req, res, auth.refresh(refreshFrom(req, parseRefresh(req.body)), ctxOf(req))));
  // Page load: pick the session up again from the cookie. "Nobody is signed in" is a normal answer here, not an error, so an anonymous page load logs nothing red.
  r.post('/auth/resume', limit('refresh', 60), (req, res) => {
    const token = cookieOf(req);
    if (!token || req.get('x-erp-csrf') !== '1') return res.json({ data: { status: 'signed_out' } });
    try {
      return deliver(req, res, auth.refresh(token, ctxOf(req)));
    } catch (err) {
      if (err.status !== 401) throw err;
      res.append('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=0${secure ? '; Secure' : ''}`);
      return res.json({ data: { status: 'signed_out' } });
    }
  });
  r.post('/auth/logout', (req, res) => {
    const bearer = (req.get('authorization') ?? '').match(/^Bearer (.+)$/i)?.[1];
    let actor = null;
    if (bearer) {
      try {
        actor = identity.resolver.resolve(bearer);
      } catch {
        actor = null;
      }
    }
    const out = actor ? auth.logout(actor, ctxOf(req)) : auth.logoutByRefresh(refreshFrom(req, parseRefresh(req.body)), ctxOf(req));
    res.append('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=0${secure ? '; Secure' : ''}`);
    res.json({ data: out });
  });
  return r;
}

export function securityRoutes(service, auth, { idempotentRequired }) {
  const r = Router();
  const view = requirePermission('iam.security.view');
  const manage = requirePermission('iam.security.manage');
  const ctx = ctxOf;

  r.post('/auth/password/change', async (req, res) => res.json({ data: await auth.changePassword(req.actor, parseChange(req.body), ctx(req)) }));

  r.get('/me', (req, res) => res.json({ data: service.profile(req.actor) }));
  r.get('/me/sessions', (req, res) => res.json({ data: service.sessions(req.actor) }));
  r.post('/me/sessions/sign-out-others', idempotentRequired, (req, res) => res.json({ data: service.signOutOthers(req.actor, ctx(req)) }));
  r.delete('/me/sessions/:id', (req, res) => res.json({ data: service.revokeMine(req.actor, parsePublicId(req.params.id), ctx(req)) }));
  r.get('/me/devices', (req, res) => res.json({ data: service.devices(req.actor) }));
  r.delete('/me/devices/:id', (req, res) => res.json({ data: service.forgetDevice(req.actor, parseId(req.params.id)) }));
  r.post('/me/devices/:id/pin', idempotentRequired, async (req, res) => res.json({ data: await service.setPin(req.actor, parseId(req.params.id), parsePin(req.body).pin) }));
  r.get('/me/login-events', (req, res) => res.json({ data: service.myEvents(req.actor) }));

  r.post('/me/mfa/totp/begin', idempotentRequired, async (req, res) => res.json({ data: await service.totpBegin(req.actor) }));
  r.post('/me/mfa/totp/confirm', idempotentRequired, (req, res) => res.json({ data: service.totpConfirm(req.actor, parseCode(req.body).code) }));
  r.post('/me/mfa/phone/begin', idempotentRequired, async (req, res) => res.json({ data: await service.phoneBegin(req.actor, parsePhone(req.body)) }));
  r.post('/me/mfa/phone/confirm', idempotentRequired, (req, res) => { const b = parsePhoneConfirm(req.body); res.json({ data: service.phoneConfirm(req.actor, b.channel, b.code) }); });
  r.post('/me/mfa/backup-codes', idempotentRequired, (req, res) => res.json({ data: service.regenerateBackup(req.actor) }));
  r.delete('/me/mfa/:id', (req, res) => res.json({ data: service.removeFactor(req.actor, parseId(req.params.id)) }));

  r.get('/admin/policy', view, (req, res) => res.json({ data: service.policy(req.actor) }));
  r.post('/admin/policy/change-requests', manage, idempotentRequired, (req, res) => res.status(201).json({ data: service.requestPolicyChange(req.actor, parsePolicyChange(req.body)) }));
  r.get('/admin/sessions', view, (req, res) => res.json(service.sessionsAll(req.actor, parseSessionList(req.query))));
  r.post('/admin/sessions/:id/revoke', manage, idempotentRequired, (req, res) => res.json({ data: service.revokeAny(req.actor, parsePublicId(req.params.id), parseReason(req.body), ctx(req)) }));
  r.get('/admin/users', view, (req, res) => res.json(service.usersAll(req.actor, parseUserList(req.query))));
  r.post('/admin/users/:username/sign-out', manage, idempotentRequired, (req, res) => res.json({ data: service.signOutUser(req.actor, parseUsername(req.params.username), parseReason(req.body), ctx(req)) }));
  r.post('/admin/users/:username/unlock', manage, idempotentRequired, (req, res) => res.json({ data: service.unlock(req.actor, parseUsername(req.params.username), parseReason(req.body), ctx(req)) }));
  r.get('/admin/login-events', view, (req, res) => res.json(service.loginEvents(req.actor, parseEventList(req.query))));
  return r;
}
