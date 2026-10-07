// Модель данных (SPEC §4).
export type BlockKind = 'text' | 'heading' | 'list-item';
export type BlockSize = 'short' | 'medium' | 'long';

/** Смещения в block.sourceText, end не включительно. */
export interface Keyphrase {
  start: number;
  end: number;
}

export interface BlockHints {
  maxLevel: 0 | 1 | 2 | 3 | 4;
  opens: { 1: number; 2: number; 3: number };
  peeks: number;
  peekMs: number;
}

export interface Block {
  id: string;
  paragraphIndex: number;
  kind: BlockKind;
  sourceText: string;
  keyphrases: Keyphrase[];
  userText: string;
  status: 'pending' | 'writing' | 'done';
  hints: BlockHints;
  typedChars: number;
  pastedChars: number;
  activeMs: number;
}

export interface Doc {
  id: string;
  title: string;
  source: string;
  blockSize: BlockSize;
  manualEdits: boolean;
  blocks: Block[];
  currentIndex: number;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
}

export type PressureMode = 'off' | 'soft' | 'kamikaze';

export interface Settings {
  theme: 'dark' | 'light' | 'sepia';
  defaultBlockSize: BlockSize;
  pressure: PressureMode;
  pressureDelaySec: number;
  allowPaste: boolean;
  writingFont: 'serif' | 'mono';
  /** Строка-намёк про подсказки на первом экране письма уже показана и закрыта первой открытой подсказкой. */
  hintsIntroSeen: boolean;
  /** Пояснение при первом включении режима разреза на Split уже показано. */
  cutIntroSeen: boolean;
}
