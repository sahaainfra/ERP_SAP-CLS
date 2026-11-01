import { HttpError } from './errors.js';

/**
 * The restricted onboarding state (part 02.03, FR-03): a person who is known but holds no approved role may reach only what lets them
 * finish onboarding (their own profile, sessions, devices and second step, a password change, the session summary the page needs to
 * draw itself, the feature-flag lookup and their own profile photo). Every other API answers 403 whatever route it is, so a module
 * added later is closed to them without anyone remembering to close it. Development headers carry no user record, so they are not gated.
 */
export const ONBOARDING_OPEN = [
  /^\/iam\/me(\/|$)/,
  /^\/iam\/auth\/password\/change$/,
  /^\/core\/session$/,
  /^\/core\/feature-flags\/evaluate$/,
  /^\/core\/files(\/|$)/,
  /^\/ui\/preferences$/, // their own theme, density and language (part 03.01; found missing in 03.02, D-121)
  /^\/ui\/navigation$/, // the menu the shell draws: the pages onboarding allows (part 03.05)
];

export function onboardingGate(req, _res, next) {
  if (!req.actor?.onboarding || ONBOARDING_OPEN.some((re) => re.test(req.path))) return next();
  next(new HttpError(403, 'ONBOARDING_RESTRICTED', 'Your account has no approved role yet, so only your profile is available. Ask an administrator to request access for you.'));
}
