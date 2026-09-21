/** Small authored equipment marks, shared by the hotbar and supply shop.
 * Definitions keep their existing icon strings; UI consumers can also use IDs. */
const INK = '#243e38', CREAM = '#f0dfae', TEAL = '#69a99a', GOLD = '#e4b753';
const drawings: Record<string, string> = {
  hand: `<path fill="${CREAM}" d="M10 25 6 19c-2-3 0-5 2-3l2 2V8c0-3 4-3 4 0V5c0-3 4-3 4 0v3c0-3 4-3 4 0v3c0-3 4-2 4 0v8c0 4-3 5-4 7Z"/><path fill="${TEAL}" d="m10 25 13-1 1 5H10Z"/><path d="M14 9v7m4-7v7m4-4v4"/>`,
  basket: `<path fill="none" stroke="${GOLD}" stroke-width="3" d="M9 14V9a7 7 0 0 1 14 0v5"/><path fill="${CREAM}" d="M4 13h24l-3 15H7Z"/><path fill="${TEAL}" d="M3 11h26v5H3Z"/><path d="m11 19 1 6m8-6-1 6M7 22h18"/>`,
  ladder: `<path stroke="${GOLD}" stroke-width="5" d="M8 28 16 4m1 25 8-24"/><path stroke="${CREAM}" stroke-width="3" d="m10 23 9 1m-7-8 9 1m-7-8 9 1"/>`,
  net: `<path stroke="${GOLD}" stroke-width="5" d="M6 28 16 17"/><path fill="${TEAL}" d="M12 9c0-6 12-9 16-3 5 7-4 17-10 15-4-1-7-7-6-12Z"/><path stroke="${CREAM}" stroke-width="1.5" d="m16 7 9 10M13 12l7 8m-4-1 10-9m-12 5L24 5"/><path fill="none" stroke="${CREAM}" stroke-width="3" d="M12 9c0-6 12-9 16-3 5 7-4 17-10 15-4-1-7-7-6-12Z"/>`,
  shaker: `<path fill="${TEAL}" d="M10 13h12l3 5-2 9H8L6 19Z"/><path fill="${GOLD}" d="M12 14V9H7V3h5v3h7V3h5v6h-5v5Z"/><path fill="${CREAM}" d="M11 19h9v5h-9Z"/><path d="M4 15 2 18m26-3 2 3"/>`,
  ropegun: `<path fill="${CREAM}" d="M4 11h18v10H12l-2 8H5l2-10H4Z"/><path fill="${TEAL}" d="M3 10h20v6H3Z"/><path fill="${GOLD}" d="M23 9h5v9h-5Z"/><path fill="none" stroke="${GOLD}" d="M26 8V4h-5c-5 0-5 6-1 6"/><circle fill="${GOLD}" cx="14" cy="16" r="4"/><circle fill="${INK}" stroke="none" cx="14" cy="16" r="1.3"/>`,
  aircannon: `<path fill="${TEAL}" d="M6 10h14v14H6c-5-2-5-12 0-14Z"/><path fill="${GOLD}" d="M18 10 28 5v24l-10-5Z"/><path fill="${INK}" d="M26 10h3v14h-3Z"/><path fill="${CREAM}" d="M7 24h6v5H7Zm0-17h9v4H7Z"/><circle fill="${CREAM}" cx="10" cy="16" r="4"/><path d="m10 16 2-2"/>`,
  boots: `<path fill="${TEAL}" d="M8 4h13v14l6 3c3 1 3 6 0 7H6V17Z"/><path fill="${GOLD}" d="M6 25h23v4H5Zm2-21h13v5H8Z"/><path stroke="${CREAM}" d="M13 12h7m-7 4h7m-7 4h7"/>`,
  harness: `<path fill="${CREAM}" d="m10 3 5 3 1 7 1-7 5-3 6 9-4 16H8L4 12Z"/><path fill="${TEAL}" d="M10 4h4l-1 24H9Zm8 0h4l1 24h-4Z"/><path fill="${GOLD}" d="M6 19h20v5H6Z"/><path fill="${CREAM}" d="M13 18h6v7h-6Z"/>`,
  padding: `<path fill="${GOLD}" d="m9 4 7 4 7-4 5 8-4 4v12H8V16l-4-4Z"/><path fill="${TEAL}" d="m9 4 5 3v21H8V16l-4-4Zm14 0-5 3v21h6V16l4-4Z"/><path stroke="${CREAM}" d="M9 18h4m6 0h4M9 23h4m6 0h4"/>`,
};

const aliases: Record<string, string> = {
  '✋': 'hand', '🧺': 'basket', bigBasket: 'basket', '🪜': 'ladder',
  '🥅': 'net', '🌳': 'shaker', '🪝': 'ropegun', '💨': 'aircannon',
  '🥾': 'boots', '🎽': 'harness', '🦺': 'padding',
};

const escapeText = (text: string): string => text.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]!));

/** Decorative: the adjacent existing label supplies the accessible name. */
export function toolIconMarkup(iconOrId: string, fallback = iconOrId): string {
  const id = aliases[iconOrId] ?? iconOrId;
  const drawing = Object.prototype.hasOwnProperty.call(drawings, id) ? drawings[id] : null;
  if (!drawing) return escapeText(fallback);
  return `<svg class="tool-icon" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${drawing}</svg>`;
}
