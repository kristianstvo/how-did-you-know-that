// v0.26: the questions this phone has hosted, remembered across nights, so a
// group that plays again gets questions it hasn't seen. A repeat is worse
// than boring in this game: whoever remembers the answer looks exactly like
// the cheater (right, and fast). Kept on this phone only; nothing leaves it.
const KEY = "hdykt-seen";
const CAP = 800; // about forty periods; the oldest are forgotten first

/** Short stable key for a question: its text, case and spacing ignored. */
export function seenKey(text: string): string {
  const s = text.toLowerCase().replace(/\s+/g, " ").trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

let list: string[] | null = null;
let set = new Set<string>();

/** null where there is no storage (the simulator runs in Node). */
function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): string[] {
  if (list) return list;
  list = [];
  try {
    const parsed: unknown = JSON.parse(store()?.getItem(KEY) ?? "[]");
    if (Array.isArray(parsed)) list = parsed.filter((k): k is string => typeof k === "string").slice(-CAP);
  } catch {
    /* a damaged list starts over */
  }
  set = new Set(list);
  return list;
}

export const isSeen = (text: string): boolean => (store() ? (load(), set.has(seenKey(text))) : false);

/** Remember a question this phone hosted (the newest go last). */
export function markSeen(text: string): void {
  const s = store();
  if (!s) return;
  const all = load();
  const k = seenKey(text);
  const i = all.indexOf(k);
  if (i >= 0) all.splice(i, 1);
  all.push(k);
  if (all.length > CAP) all.splice(0, all.length - CAP);
  set = new Set(all);
  try {
    s.setItem(KEY, JSON.stringify(all));
  } catch {
    /* full or blocked storage: remembered for this visit only */
  }
}

export const seenCount = (): number => (store() ? load().length : 0);

export function forgetSeen(): void {
  list = [];
  set = new Set();
  try {
    store()?.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}
