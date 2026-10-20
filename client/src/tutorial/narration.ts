// The how-to-play tutorial's narration (v0.20): Amy, the TV host's voice
// (hostLines.ts: same voice, model eleven_v4), one clip per scene in
// client/public/tutorial/<id>.mp3. Each line is the text exactly as sent to
// ElevenLabs ([tags] are delivery directions); `words` are ElevenLabs Scribe's
// word timings for that recording ([text, start ms, end ms]). The captions and
// every word-synced cue in scenes.ts read them, so a re-recorded line needs
// its words re-transcribed too.

export type Word = [text: string, start: number, end: number];

export interface Clip {
  id: string;
  line: string;
  ms: number; // the recording's length
  words: Word[];
}

export const CLIPS: Clip[] = [
  {
    id: "n1",
    line: "[excited] Welcome to How Did You Know That! Here's how to play.",
    ms: 3920,
    words: [["Welcome", 160, 560], ["to", 720, 880], ["How", 1040, 1200], ["Did", 1280, 1360], ["You", 1440, 1520], ["Know", 1600, 1840], ["That!", 1920, 2440], ["Here's", 2640, 2880], ["how", 2960, 3040], ["to", 3120, 3200], ["play.", 3400, 3920]],
  },
  {
    id: "n2",
    line: "It's a pop quiz. Ten questions, and everyone answers on their own phone.",
    ms: 5120,
    words: [["It's", 0, 200], ["a", 240, 280], ["pop", 320, 560], ["quiz.", 640, 1120], ["Ten", 1520, 1680], ["questions,", 1840, 2480], ["and", 2600, 2720], ["everyone", 2800, 3200], ["answers", 3280, 3760], ["on", 3840, 3920], ["their", 4040, 4160], ["own", 4240, 4400], ["phone.", 4560, 5120]],
  },
  {
    id: "n3",
    line: "[mischievously] But one of you is secretly the cheater... and their phone shows a tiny dot on the right answer.",
    ms: 6880,
    words: [["But", 80, 320], ["one", 480, 640], ["of", 720, 800], ["you", 880, 1120], ["is", 1200, 1440], ["secretly", 1520, 2080], ["the", 2200, 2320], ["cheater…", 2400, 3280], ["and", 3400, 3520], ["their", 3600, 3840], ["phone", 3920, 4240], ["shows", 4360, 4480], ["a", 4640, 4827], ["tiny", 5013, 5200], ["dot", 5280, 5600], ["on", 5680, 5760], ["the", 5840, 5920], ["right", 6040, 6160], ["answer.", 6240, 6880]],
  },
  {
    id: "n4",
    line: "If the cheater's score reaches the graduation line, they graduate... and the class loses.",
    ms: 6320,
    words: [["If", 0, 160], ["the", 200, 240], ["cheater's", 320, 720], ["score", 800, 1120], ["reaches", 1200, 1600], ["the", 1680, 1720], ["graduation", 1760, 2400], ["line,", 2480, 3040], ["they", 3120, 3280], ["graduate…", 3600, 4400], ["and", 4480, 4560], ["the", 4640, 4720], ["class", 4800, 5200], ["loses.", 5440, 6320]],
  },
  {
    id: "n5",
    line: "After every question, everyone sees who picked what, and how fast. Evidence cards flag anything suspicious.",
    ms: 8800,
    words: [["After", 0, 320], ["every", 480, 720], ["question,", 800, 1680], ["everyone", 1760, 2160], ["sees", 2320, 2640], ["who", 2720, 2880], ["picked", 2960, 3200], ["what,", 3280, 3760], ["and", 3840, 4160], ["how", 4240, 4480], ["fast.", 4560, 5120], ["Evidence", 5680, 6160], ["cards", 6240, 6640], ["flag", 6720, 7120], ["anything", 7200, 7680], ["suspicious.", 7760, 8800]],
  },
  {
    id: "n6",
    line: "Suspicious? Point at them. Sure? Raise your hand and accuse! You get one accusation, then the class votes on who goes to detention.",
    ms: 10640,
    words: [["Suspicious?", 0, 960], ["Point", 1440, 1680], ["at", 1760, 1840], ["them.", 1920, 2160], ["Sure?", 2720, 3400], ["Raise", 3680, 3920], ["your", 4000, 4160], ["hand", 4240, 4480], ["and", 4640, 4720], ["accuse!", 4880, 5600], ["You", 6080, 6160], ["get", 6280, 6400], ["one", 6560, 6720], ["accusation,", 6840, 7840], ["then", 7920, 8000], ["the", 8040, 8080], ["class", 8160, 8480], ["votes", 8560, 8880], ["on", 8960, 9120], ["who", 9200, 9360], ["goes", 9440, 9680], ["to", 9760, 9800], ["detention.", 9840, 10640]],
  },
  {
    id: "n7",
    line: "[excited] Catch the cheater, and the class wins! But send an innocent to detention, and the line drops. [dramatically] Two wrong detentions, and the cheater graduates!",
    ms: 10320,
    words: [["Catch", 80, 400], ["the", 480, 560], ["cheater,", 640, 1160], ["and", 1280, 1360], ["the", 1400, 1440], ["class", 1520, 1840], ["wins!", 1920, 2600], ["But", 2800, 2960], ["send", 3040, 3280], ["an", 3400, 3520], ["innocent", 3600, 4000], ["to", 4040, 4080], ["detention,", 4160, 4840], ["and", 4960, 5040], ["the", 5120, 5200], ["line", 5280, 5600], ["drops.", 5760, 6480], ["Two", 6800, 7040], ["wrong", 7120, 7360], ["detentions,", 7480, 8320], ["and", 8400, 8480], ["the", 8520, 8560], ["cheater", 8720, 9120], ["graduates!", 9200, 10320]],
  },
  {
    id: "n8",
    line: "Nobody caught by question ten? Top of the class wins the period. [mischievously] And cheater... don't look too smart.",
    ms: 7840,
    words: [["Nobody", 0, 400], ["caught", 480, 720], ["by", 800, 880], ["question", 960, 1280], ["ten?", 1440, 2040], ["Top", 2320, 2480], ["of", 2560, 2640], ["the", 2680, 2720], ["class", 2800, 3120], ["wins", 3240, 3360], ["the", 3440, 3480], ["period.", 3520, 4280], ["And", 4560, 4800], ["cheater…", 5040, 5920], ["don't", 6160, 6400], ["look", 6560, 6720], ["too", 6880, 7040], ["smart.", 7200, 7840]],
  },
  {
    id: "n9",
    line: "[excited] Now grab your phone. Class is in session!",
    ms: 3280,
    words: [["Now", 80, 240], ["grab", 320, 560], ["your", 640, 800], ["phone.", 1000, 1400], ["Class", 1600, 2000], ["is", 2080, 2240], ["in", 2360, 2480], ["session!", 2560, 3280]],
  },
];
