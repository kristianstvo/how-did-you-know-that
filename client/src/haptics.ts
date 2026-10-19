// Haptics reinforce beats on Android (Vibration API); iOS Safari has none.
// They never carry information on their own — every buzz mirrors something
// already on screen. Chrome blocks (and logs) vibrate() before the first tap.
export function buzz(pattern: number | number[]): void {
  try {
    const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } };
    if ("vibrate" in nav && nav.userActivation?.hasBeenActive) nav.vibrate(pattern);
  } catch {
    /* unsupported */
  }
}
