import { CosmeticPattern, FighterCosmetic, FighterPalette, MatchConfig } from './types';

export interface ColorSwatch {
  id: string;
  name: string;
  primary: string;
  dark: string;
  glow: string;
  headband: string;
}

export const COLOR_SWATCHES: ColorSwatch[] = [
  {
    id: 'amber',
    name: 'Solar Gold',
    primary: '#F59E0B',
    dark: '#B45309',
    glow: 'rgba(245, 158, 11, 0.35)',
    headband: '#FDE68A',
  },
  {
    id: 'crimson',
    name: 'Crimson',
    primary: '#EF4444',
    dark: '#991B1B',
    glow: 'rgba(239, 68, 68, 0.35)',
    headband: '#FECACA',
  },
  {
    id: 'cyan',
    name: 'Electric Cyan',
    primary: '#06B6D4',
    dark: '#0E7490',
    glow: 'rgba(6, 182, 212, 0.35)',
    headband: '#A5F3FC',
  },
  {
    id: 'emerald',
    name: 'Toxic Mint',
    primary: '#10B981',
    dark: '#065F46',
    glow: 'rgba(16, 185, 129, 0.35)',
    headband: '#A7F3D0',
  },
  {
    id: 'violet',
    name: 'Hyper Violet',
    primary: '#A855F7',
    dark: '#6B21A8',
    glow: 'rgba(168, 85, 247, 0.35)',
    headband: '#E9D5FF',
  },
  {
    id: 'rose',
    name: 'Neon Rose',
    primary: '#F43F5E',
    dark: '#9F1239',
    glow: 'rgba(244, 63, 94, 0.35)',
    headband: '#FECDD3',
  },
  {
    id: 'cobalt',
    name: 'PlayStation Blue',
    primary: '#3B82F6',
    dark: '#1D4ED8',
    glow: 'rgba(59, 130, 246, 0.35)',
    headband: '#BFDBFE',
  },
  {
    id: 'ivory',
    name: 'Ghost White',
    primary: '#F1F5F9',
    dark: '#64748B',
    glow: 'rgba(241, 245, 249, 0.3)',
    headband: '#F59E0B',
  },
];

export const PATTERN_OPTIONS: Array<{ id: CosmeticPattern; label: string }> = [
  { id: 'solid', label: 'Solid' },
  { id: 'stripes', label: 'Stripes' },
  { id: 'core', label: 'Core' },
  { id: 'viper', label: 'Viper' },
  { id: 'crown', label: 'Crown' },
];

export const DEFAULT_FIGHTER_STYLES: FighterCosmetic[] = [
  { colorId: 'amber', pattern: 'solid' },
  { colorId: 'crimson', pattern: 'stripes' },
  { colorId: 'cyan', pattern: 'core' },
  { colorId: 'emerald', pattern: 'viper' },
];

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  mode: '1p_duel',
  difficulty: 'standard',
  roundsToWin: 3,
  bloodStyle: 'crimson',
  showVirtualPsPad: false,
  startingArenaId: 'auto',
  fighterStyles: DEFAULT_FIGHTER_STYLES.map((s) => ({ ...s })),
};

export function resolveFighterPalette(
  slotId: number,
  style?: FighterCosmetic
): FighterPalette {
  const fallback = DEFAULT_FIGHTER_STYLES[slotId % DEFAULT_FIGHTER_STYLES.length];
  const chosen = style ?? fallback;
  const swatch =
    COLOR_SWATCHES.find((c) => c.id === chosen.colorId) ??
    COLOR_SWATCHES[slotId % COLOR_SWATCHES.length];

  return {
    id: slotId,
    label: `P${slotId + 1}`,
    primary: swatch.primary,
    dark: swatch.dark,
    glow: swatch.glow,
    headband: swatch.headband,
    pattern: chosen.pattern,
  };
}

const STORAGE_KEY = 'stickfight_match_config_v2';

export function loadSavedMatchConfig(): MatchConfig {
  if (typeof window === 'undefined') {
    return {
      ...DEFAULT_MATCH_CONFIG,
      fighterStyles: DEFAULT_FIGHTER_STYLES.map((s) => ({ ...s })),
    };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        ...DEFAULT_MATCH_CONFIG,
        fighterStyles: DEFAULT_FIGHTER_STYLES.map((s) => ({ ...s })),
      };
    }
    const parsed = JSON.parse(raw) as Partial<MatchConfig>;
    const styles: FighterCosmetic[] = DEFAULT_FIGHTER_STYLES.map((def, idx) => {
      const candidate = parsed.fighterStyles?.[idx];
      if (!candidate) return { ...def };
      const validColor = COLOR_SWATCHES.some((c) => c.id === candidate.colorId)
        ? candidate.colorId
        : def.colorId;
      const validPattern = PATTERN_OPTIONS.some((p) => p.id === candidate.pattern)
        ? candidate.pattern
        : def.pattern;
      return { colorId: validColor, pattern: validPattern };
    });

    return {
      mode: parsed.mode ?? DEFAULT_MATCH_CONFIG.mode,
      difficulty: parsed.difficulty ?? DEFAULT_MATCH_CONFIG.difficulty,
      roundsToWin: parsed.roundsToWin === 5 ? 5 : 3,
      bloodStyle: parsed.bloodStyle === 'fighter_ink' ? 'fighter_ink' : 'crimson',
      showVirtualPsPad: Boolean(parsed.showVirtualPsPad),
      startingArenaId:
        typeof parsed.startingArenaId === 'string' && parsed.startingArenaId.length > 0
          ? parsed.startingArenaId
          : 'auto',
      fighterStyles: styles,
    };
  } catch {
    return {
      ...DEFAULT_MATCH_CONFIG,
      fighterStyles: DEFAULT_FIGHTER_STYLES.map((s) => ({ ...s })),
    };
  }
}

export function saveMatchConfig(config: MatchConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore quota/private mode errors
  }
}
