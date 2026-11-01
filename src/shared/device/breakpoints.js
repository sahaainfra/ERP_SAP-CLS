// Layout rules of the application by screen width (part 03.06, FR-01). The widths are the five the application is designed and tested at.
export const BREAKPOINTS = Object.freeze({ phone: 360, tablet: 768, laptop: 1024, desktop: 1280, wide: 1920 });

/** The layout for a width in pixels: a phone has a bottom navigation, a tablet a rail that opens on demand, a computer the full sidebar. */
export function layoutFor(width) {
  if (width < BREAKPOINTS.tablet) return 'phone';
  if (width < BREAKPOINTS.laptop) return 'tablet';
  return 'desktop';
}

/** The roles whose home is the field home (part 03.06, FR-07): site people. Others land on the launchpad. */
export const FIELD_ROLES = Object.freeze(['SE', 'CSUP', 'WSUP', 'SK', 'PMSUP', 'QCE', 'HSEE', 'GUARD', 'EMP']);

/** Whether a person's roles make the field home their landing page. A person who also holds an office role keeps the launchpad. */
export function landsOnField(roles = []) {
  return roles.length > 0 && roles.every((r) => FIELD_ROLES.includes(r));
}
