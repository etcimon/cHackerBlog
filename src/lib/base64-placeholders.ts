/**
 * Collapse/expand base64 data URLs in markdown so the editor textarea shows a
 * short "[base64 data]" placeholder instead of a multi-MB payload. Only the
 * URL position `(...)` is touched in both directions, so literal text such as
 * an escaped `\[base64 data\]` is never substituted. The store maps each
 * placeholder back to its full `data:` URL for expansion.
 */

/** "[base64 data]" for n=1, "[base64 data 2]" for n=2, … */
export function base64Placeholder(n: number): string {
  return n === 1 ? "[base64 data]" : `[base64 data ${n}]`;
}

/**
 * `(data:<mime>[;params];base64,<payload>)` — mime is type/subtype, params are
 * `;name=value` segments, payload is the base64 alphabet. Case-insensitive on
 * the prefix; no lookbehind (Safari).
 */
const DATA_URL_RE =
  /\(data:[^\s;,()]+\/[^\s;,()]+(?:;[^\s;,()]+)*;base64,[A-Za-z0-9+/=]+\)/gi;

/** Matches a parenthesised placeholder, capturing the bracketed label. */
const PLACEHOLDER_RE = /\(\s*(\[base64 data(?: \d+)?\])\s*\)/g;

/**
 * Replace every parenthesised base64 data URL with `(<placeholder>)`.
 * Identical data URLs share one placeholder. Returns the rewritten markdown
 * plus a store of placeholder -> data URL for `expandBase64`.
 */
export function collapseBase64(md: string): {
  md: string;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const placeholderByUrl = new Map<string, string>();
  let next = 1;
  const out = md.replace(DATA_URL_RE, (whole: string) => {
    const dataUrl = whole.slice(1, -1);
    let placeholder = placeholderByUrl.get(dataUrl);
    if (!placeholder) {
      placeholder = base64Placeholder(next++);
      placeholderByUrl.set(dataUrl, placeholder);
      store.set(placeholder, dataUrl);
    }
    return `(${placeholder})`;
  });
  return { md: out, store };
}

/**
 * Replace `(<placeholder>)` occurrences that exist in `store` with
 * `(<data URL>)`; anything else (unknown placeholders, literal text, freshly
 * pasted `data:` URLs) is left untouched.
 */
export function expandBase64(
  md: string,
  store: ReadonlyMap<string, string>,
): string {
  if (store.size === 0) return md;
  return md.replace(PLACEHOLDER_RE, (whole: string, placeholder: string) => {
    const dataUrl = store.get(placeholder);
    return dataUrl ? `(${dataUrl})` : whole;
  });
}
