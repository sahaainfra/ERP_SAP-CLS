// Part 06: icons come in the sizes of the design tokens (icon.size sm 16, md 20, lg 24). A numeric size off that scale snaps to the nearest
// step at or above it; 32 and above stay as given (the illustrations of empty states).
/** @param {number | string} n */
export const snapIconSize = (n) => (typeof n !== 'number' || n >= 32 ? n : n <= 16 ? 16 : n <= 20 ? 20 : 24);
