// v0.21: the class photo. Every avatar is one of sixteen cartoon students
// (drawn for the game with an image model on ElevenLabs, one character sheet
// cut into client/public/avatars/<slug>.webp). The emoji stays the avatar's
// ID everywhere else (protocol, engine, saves) and is the text fallback.

export interface Student {
  slug: string;
  /** Their yearbook nickname, shown when you pick them. */
  title: string;
}

export const STUDENTS: Record<string, Student> = {
  "🎒": { slug: "backpack", title: "The Overpacker" },
  "📚": { slug: "books", title: "The Bookworm" },
  "✏️": { slug: "pencil", title: "The Doodler" },
  "🧪": { slug: "testtube", title: "The Mad Scientist" },
  "🔬": { slug: "microscope", title: "The Big Brain" },
  "📐": { slug: "setsquare", title: "The Square" },
  "🎨": { slug: "palette", title: "The Artiste" },
  "🎧": { slug: "headphones", title: "The Too-Cool Kid" },
  "⚽": { slug: "soccer", title: "The Jock" },
  "🍎": { slug: "apple", title: "The Teacher's Pet" },
  "🧮": { slug: "abacus", title: "The Mathlete" },
  "🗺️": { slug: "map", title: "The Explorer" },
  "🖍️": { slug: "crayon", title: "The Crayon Eater" },
  "🏀": { slug: "basketball", title: "The Beanpole" },
  "🎺": { slug: "trumpet", title: "The Band Kid" },
  "💻": { slug: "laptop", title: "The Hacker" },
};

const BASE: string = import.meta.env?.BASE_URL ?? "/";

/** The portrait's URL, or "" for anything that isn't one of the students. */
export const faceUrl = (avatar: string): string => (STUDENTS[avatar] ? `${BASE}avatars/${STUDENTS[avatar].slug}.webp` : "");

const escText = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A student's round portrait, 1em across like the emoji it replaces, so
 *  every layout sized by font keeps working. Avatars arrive from other
 *  phones: anything that isn't one of the sixteen is shown as escaped text. */
export function face(avatar: string, cls = ""): string {
  const url = faceUrl(avatar);
  const c = cls ? ` ${cls}` : "";
  return url ? `<img class="face${c}" src="${url}" alt="" draggable="false">` : `<span class="face face-txt${c}">${escText(avatar)}</span>`;
}
