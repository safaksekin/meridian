import type { Lang } from '../core/i18n';

export interface ModeContext {
  /** Day number (1-based) of today's puzzle. */
  day: number;
  /** Element the mode renders into. It is emptied before mount. */
  root: HTMLElement;
}

export interface ModeModule {
  /** Render today's puzzle. Restore any saved state for ctx.day. */
  mount(ctx: ModeContext): void | Promise<void>;
  /** Optional cleanup when leaving the mode (timers, listeners on window). */
  unmount?(): void;
  /** Content of the "How to play" dialog. */
  howTo(): Node;
}

export interface ModeDef {
  id: string;
  icon: string;
  name: Record<Lang, string>;
  blurb: Record<Lang, string>;
  /** The flagship game: its own showcase on the home page, outside the six-card daily grid. */
  flagship?: boolean;
  load: () => Promise<{ default: ModeModule }>;
}
