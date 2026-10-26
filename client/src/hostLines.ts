// The TV host's script (v0.19): every line the big screen's host can say,
// exactly as it was sent to ElevenLabs. The [tags] are eleven_v4 delivery
// directions, not words. The recordings are client/public/voice/<id>.mp3:
// to re-record one, generate the same text with the same voice and model and
// replace the file (voice.ts measures each clip as it loads, so no timings
// are stored here).
// Host lines only: she never reads a question out. Players read at their own
// pace on their phones, and a spoken question would favour whoever sits
// nearest the TV. Nor does she ever say anything the screen doesn't show.

export const HOST_VOICE = {
  name: "Amy, cheerful and friendly Aussie presenter",
  voiceId: "rSeWUeOepJe3YA3pacAe",
  model: "eleven_v4",
  format: "mp3_44100_128",
} as const;

export const HOST_LINES = {
  // The lobby, once, when the big screen first gets sound.
  welcome: "[excited] Good evening, and welcome to How Did You Know That! Grab your phone, scan the code, and find a seat. Class starts soon!",
  // The bell: the first period of the day, then every one after it. With a
  // big screen the bell holds for ROLE_SCREEN_TV_MS: both must end by 6s.
  period_first: "[dramatically] Pop quiz! One of you can see the answers. [mischievously] Find the cheater before they graduate!",
  period_next: "[excited] Back to class! New period, new cheater. [mischievously] Or is it the same one?",
  // Each question as it lands. v0.26: the class sets the difficulty, so the
  // calls no longer promise a ramp (q1, q4 and q8 re-recorded).
  q1: "[excited] Question one! Let's see what you know.",
  q2: "Question two!",
  q3: "Question three!",
  q4: "Question four!",
  q5: "Question five!",
  q6: "Question six!",
  q7: "Question seven!",
  q8: "[dramatically] Question eight!",
  q9: "Question nine!",
  q10: "[dramatically] The final question!",
  // v0.26 the curve: instead of the number, when the class moved the difficulty.
  harder: "[excited] Everybody got that one? Then here comes a harder one!",
  easier: "[mischievously] Nobody got that one! Let's try an easier one.",
  // The clock (two takes each, alternated).
  five_a: "Five seconds!",
  five_b: "[excited] Five seconds left!",
  pencils_a: "[excited] Pencils down!",
  pencils_b: "Time's up! Pencils down.",
  // The answer: the letter lands as it lights up. The long call needs ~2s of
  // runway before the answer beat; quick reveals get the short one.
  answer_a: "[dramatically] The answer is... A!",
  answer_b: "[dramatically] The answer is... B!",
  answer_c: "[dramatically] The answer is... C!",
  answer_d: "[dramatically] The answer is... D!",
  quick_a: "[excited] It's... A!",
  quick_b: "[excited] It's... B!",
  quick_c: "[excited] It's... C!",
  quick_d: "[excited] It's... D!",
  // The evidence card, by callout kind ("silent" has no line).
  co_lone_correct: "[curious] Only one of you got that. Genius... or cheat sheet?",
  co_against_crowd: "Almost everyone fell for that trap. [mischievously] Almost.",
  co_lightning: "[surprised] Whoa, that was fast. Suspiciously fast.",
  co_streak: "Someone hasn't missed in a while. [mischievously] Teacher's pet... or something else?",
  co_hard_sweep: "[curious] Perfect on every hard one? Who studies that much?",
  co_near_line: "[dramatically] Someone is close to graduating. Watch the line!",
  co_cleared: "Over the line, and no siren. That one's innocent. Cleared!",
  co_stumper: "[laughs] Nobody got that one. Not a single person!",
  // How to play, on the first reveals of the night.
  accuse_open: "Suspicious? Point at them... or raise your hand and accuse!",
  // A hand goes up.
  vote_a: "[excited] A hand goes up! Someone's been accused. Everybody, vote!",
  vote_b: "[dramatically] An accusation! Who's the cheater? Cast your votes!",
  vote_urgent: "Five seconds to vote!",
  // The verdict.
  vr_caught: "[excited] Caught red-handed! That was the cheater!",
  vr_innocent: "[gasps] Detention... for an innocent student! The graduation line drops.",
  vr_strike: "That's a strike against the class. Careful who you accuse!",
  vr_struckout: "[dramatically] Too many innocents in detention! The cheater graduates!",
  vr_tie: "It's a tie! Nobody goes to detention.",
  // The period's end.
  me_graduated: "[dramatically] Alarm bells! The cheater graduated. Nobody stopped them!",
  me_caught: "[excited] Class dismissed! The cheater has been caught!",
  me_top: "That's ten questions, and nobody caught the cheater. Top of the class takes the period!",
  me_drumroll: "[whispers] And the cheater was...",
  // Graduation day.
  se_crown: "[excited] That's the end of the school day! Congratulations to our valedictorian! [laughs] Class dismissed!",
} as const;

export type LineId = keyof typeof HOST_LINES;
