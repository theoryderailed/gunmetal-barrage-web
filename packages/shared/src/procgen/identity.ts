import { createRng, pickWeighted, randInt } from "../rng.js";

/** Playstyle archetype — drives AI and presentation. */
export type BotPersona =
  | "brawler"
  | "camper"
  | "artillery"
  | "reckless"
  | "sniper"
  | "chaotic";

export type TankFlair =
  | "horn"
  | "banner"
  | "spikes"
  | "antenna"
  | "smokestack"
  | "scoop"
  | "none";

export interface PilotIdentity {
  /** Shown in lobby, HUD, edge markers */
  displayName: string;
  /** Short epithet under the name */
  title: string;
  persona: BotPersona;
  motto: string;
  /** Accent RGB 0–1 for decals / flair */
  accent: [number, number, number];
  flair: TankFlair;
  /** 0 easy … 1 hard — aim noise / patience */
  skill: number;
}

const PERSONAS: { persona: BotPersona; weight: number; titles: string[]; mottos: string[] }[] = [
  {
    persona: "brawler",
    weight: 3,
    titles: ["Close-Quarters Cadet", "Hull Scrapper", "Mud Wrestler"],
    mottos: ["Get in their grill.", "Distance is for cowards.", "Ram first, aim second."],
  },
  {
    persona: "camper",
    weight: 2,
    titles: ["Ridge Sitter", "Patient Siege", "Hill Hermit"],
    mottos: ["They come to me.", "Why move when dirt is free?", "One shot. One crater."],
  },
  {
    persona: "artillery",
    weight: 3,
    titles: ["High-Angle Hero", "Lob Lord", "Arc Calculator"],
    mottos: ["Math is a weapon.", "Rain steel.", "Gravity is my co-pilot."],
  },
  {
    persona: "reckless",
    weight: 2,
    titles: ["Splash Enthusiast", "Self-Damage Specialist", "Boom Addict"],
    mottos: ["Max power always.", "Friendly fire is just fire.", "YOLO trajectory."],
  },
  {
    persona: "sniper",
    weight: 2,
    titles: ["Pinpoint Pest", "Long-Range Lurker", "Deadeye Dreg"],
    mottos: ["Measure twice.", "I don't miss. Often.", "Wait for the wind."],
  },
  {
    persona: "chaotic",
    weight: 2,
    titles: ["Entropy Engine", "RNG Prophet", "Dice Pilot"],
    mottos: ["Plan? What plan?", "The shell knows the way.", "Surprise is a strategy."],
  },
];

const FIRST = [
  "Zed",
  "Nix",
  "Bolt",
  "Rook",
  "Jinx",
  "Vex",
  "Ash",
  "Kade",
  "Orin",
  "Pax",
  "Riven",
  "Sable",
  "Tov",
  "Wren",
  "Yara",
  "Hex",
  "Moth",
  "Cinder",
  "Drift",
  "Grit",
  "Havoc",
  "Ivy",
  "Jolt",
  "Knurl",
  "Lark",
  "Mire",
];

const LAST = [
  "Carbine",
  "Fuse",
  "Gasket",
  "Howitzer",
  "Ironlung",
  "Jackbolt",
  "Keel",
  "Lockjaw",
  "Muzzle",
  "Noggin",
  "Overbore",
  "Pipette",
  "Quarrel",
  "Ratchet",
  "Shellback",
  "Treadmill",
  "Undercrank",
  "Valve",
  "Wreck",
  "X-Axis",
  "Yoke",
  "Zipfuse",
  "Brass",
  "Crater",
  "Dudley",
  "Ember",
];

const FLAIRS: { flair: TankFlair; weight: number }[] = [
  { flair: "horn", weight: 2 },
  { flair: "banner", weight: 2 },
  { flair: "spikes", weight: 2 },
  { flair: "antenna", weight: 2 },
  { flair: "smokestack", weight: 2 },
  { flair: "scoop", weight: 1 },
  { flair: "none", weight: 1 },
];

/** Deterministic unique-feeling pilot identity for bots (and optional flair for anyone). */
export function generateBotIdentity(seed: number): PilotIdentity {
  const rng = createRng(seed);
  const pack = pickWeighted(
    rng,
    PERSONAS.map((p) => ({ ...p, weight: p.weight })),
  );
  const first = FIRST[randInt(rng, 0, FIRST.length - 1)]!;
  const last = LAST[randInt(rng, 0, LAST.length - 1)]!;
  const title = pack.titles[randInt(rng, 0, pack.titles.length - 1)]!;
  const motto = pack.mottos[randInt(rng, 0, pack.mottos.length - 1)]!;
  const flair = pickWeighted(rng, FLAIRS).flair;

  // Vivid accent — avoid muddy grays
  const accent: [number, number, number] = [
    0.25 + rng() * 0.75,
    0.2 + rng() * 0.75,
    0.25 + rng() * 0.75,
  ];
  // Ensure one channel is hot so tanks pop
  const hot = randInt(rng, 0, 2);
  accent[hot] = Math.min(1, accent[hot]! + 0.35);

  const skill =
    pack.persona === "sniper" || pack.persona === "artillery"
      ? 0.55 + rng() * 0.4
      : pack.persona === "chaotic" || pack.persona === "reckless"
        ? 0.25 + rng() * 0.35
        : 0.4 + rng() * 0.4;

  return {
    displayName: `${first} ${last}`,
    title,
    persona: pack.persona,
    motto,
    accent,
    flair,
    skill,
  };
}

export function personaLabel(p: BotPersona): string {
  switch (p) {
    case "brawler":
      return "Brawler";
    case "camper":
      return "Camper";
    case "artillery":
      return "Artillery";
    case "reckless":
      return "Reckless";
    case "sniper":
      return "Sniper";
    case "chaotic":
      return "Chaotic";
  }
}

/** Blend loadout hull color toward identity accent for uniqueness. */
export function applyIdentityToPalette(
  palette: [number, number, number],
  identity: PilotIdentity,
): [number, number, number] {
  const t = 0.45;
  return [
    palette[0] * (1 - t) + identity.accent[0] * t,
    palette[1] * (1 - t) + identity.accent[1] * t,
    palette[2] * (1 - t) + identity.accent[2] * t,
  ];
}
