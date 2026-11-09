/**
 * Which texts of an entry were dictated (CBT1 stage 3): each recognised piece is remembered with
 * the field it went into, and when the entry is saved the field's final text tells whether the
 * patient changed it. The doctor reads «голосом, 2:13 · текст исправлен».
 */

import type { VoiceOrigin } from '@/diary/VoiceNote';
import type { DiarySpoken } from '@/features/diary/diary-model';

interface Piece {
  readonly target: string;
  readonly text: string;
  readonly origin: VoiceOrigin;
}

export interface SpokenTracker {
  readonly add: (target: string, text: string, origin: VoiceOrigin) => void;
  /** The marks to save with the entry, given the final text of each field. */
  readonly marks: (texts: Readonly<Record<string, unknown>>) => DiarySpoken[] | undefined;
}

/** `earlier`: the marks already saved with the entry being edited. */
export function createSpokenTracker(earlier: readonly DiarySpoken[] = []): SpokenTracker {
  const pieces: Piece[] = [];
  return {
    add: (target, text, origin) => {
      pieces.push({ target, text, origin });
    },
    marks: (texts) => {
      const fresh = pieces.flatMap((piece): DiarySpoken[] => {
        const final = texts[piece.target];
        if (typeof final !== 'string' || !final.trim()) return [];
        return [
          {
            target: piece.target,
            seconds: piece.origin.seconds,
            engine: piece.origin.engine,
            ...(final.includes(piece.text) ? {} : { edited: true as const }),
            ...(piece.origin.clip ? { clip: piece.origin.clip } : {}),
          },
        ];
      });
      // Earlier marks stay while their field still has text.
      const kept = earlier.filter((mark) => {
        const final = texts[mark.target];
        return typeof final === 'string' && final.trim();
      });
      const all = [...kept, ...fresh].slice(-16);
      return all.length ? all : undefined;
    },
  };
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The doctor's line under a dictated text: «голосом, 0:42 · распознано на телефоне (whisper-base)». */
export function spokenWords(marks: readonly DiarySpoken[]): string {
  if (!marks.length) return '';
  const seconds = marks.reduce((total, mark) => total + mark.seconds, 0);
  const engines = [...new Set(marks.map((mark) => mark.engine))].join(', ');
  const edited = marks.some((mark) => mark.edited) ? ' · текст исправлен' : '';
  return `голосом, ${clock(seconds)} · распознано на телефоне (${engines})${edited}`;
}
