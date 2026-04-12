export type UserVisualProfile = {
  hue: number;
  tempo: number;
  intensity: number;
  glow: "cyan" | "lime" | "amber" | "emerald";
};

const GLOW_RGB_BY_NAME: Record<UserVisualProfile["glow"], string> = {
  cyan: "34 211 238",
  lime: "132 204 22",
  amber: "245 158 11",
  emerald: "16 185 129",
};

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function deriveUserVisualProfile(seed: string): UserVisualProfile {
  const normalized = seed.trim() || "observer";
  const hash = hashText(normalized);
  const glowOptions: Array<UserVisualProfile["glow"]> = ["cyan", "lime", "amber", "emerald"];

  return {
    hue: hash % 360,
    tempo: 0.86 + ((hash >>> 8) % 60) / 100,
    intensity: 0.72 + ((hash >>> 16) % 36) / 100,
    glow: glowOptions[(hash >>> 24) % glowOptions.length],
  };
}

export function toVisualProfileStyle(profile: UserVisualProfile): Record<string, string> {
  return {
    "--user-hue": `${profile.hue}deg`,
    "--user-tempo": profile.tempo.toFixed(2),
    "--user-intensity": profile.intensity.toFixed(2),
    "--user-glow-rgb": GLOW_RGB_BY_NAME[profile.glow],
  };
}