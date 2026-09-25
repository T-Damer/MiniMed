import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const files = {
  editor: read('apps/app/src/features/notes/NoteMarkdownEditor.tsx'),
  notes: read('apps/app/src/features/notes/NotesView.tsx'),
  viewer: read('apps/app/src/features/notes/NoteAttachmentViewer.tsx'),
  viewerState: read('apps/app/src/features/notes/note-attachment-viewer-state.ts'),
  worker: read('apps/app/src/features/asr/asr.worker.ts'),
  asr: read('apps/app/src/features/asr/asr-models.ts'),
  diarization: read('apps/app/src/features/asr/browser-diarization.ts'),
  speakerAlignment: read('apps/app/src/features/asr/speaker-alignment.ts'),
  diarizationModels: read('apps/app/src/features/asr/browser-diarization-models.ts'),
  transcriptPanel: read('apps/app/src/features/notes/NoteTranscriptPanel.tsx'),
  diaryPanel: read('apps/app/src/features/diary/PatientDiaryPanel.tsx'),
  diary: read('apps/app/src/diary/DiaryApp.tsx'),
  diaryMain: read('apps/app/src/diary/main.tsx'),
  vite: read('apps/app/vite.config.ts'),
  appPackage: read('apps/app/package.json'),
  notesCss: read('apps/app/src/styles/notes-polish.css'),
  drawing: read('apps/app/src/features/notes/NoteDrawingEditor.tsx'),
};

const checks = [
  [
    'canvas link targets in editor',
    files.editor.includes('findNoteLinkTargets') && files.editor.includes('findLinkTargets='),
  ],
  [
    'structured ASR in editor',
    files.editor.includes('const output = await transcribeBlob(recording.file)') &&
      files.editor.includes('output.text.trim()'),
  ],
  [
    'transcript insertion at caret',
    files.editor.includes('onInsertTranscript') && files.editor.includes('wysiwyg?.insert'),
  ],
  ['drawing preview in notes', files.notes.includes('NoteDrawingPreview')],
  ['audio viewer transcript panel', files.viewer.includes('NoteTranscriptPanel')],
  [
    'audio state retains NoteFile',
    files.viewerState.includes('readonly record: NoteFile') && files.viewerState.includes('record,'),
  ],
  ['Whisper word timestamps', files.worker.includes("return_timestamps: 'word'")],
  ['10-minute browser ASR guard', files.asr.includes('MAX_BROWSER_TRANSCRIPTION_SECONDS = 10 * 60')],
  [
    'diarized state requires real regions',
    files.asr.includes('applyOptionalSpeakerRegions(output.segments, speakerRegions)') &&
      files.speakerAlignment.includes('if (!regions?.length)') &&
      files.speakerAlignment.includes('diarized: false') &&
      files.speakerAlignment.includes('diarized: true'),
  ],
  [
    'optional diarization seam only',
    files.diarization.includes('let activeEngine: BrowserDiarizationEngine | null = null'),
  ],
  [
    'pinned diarization models',
    files.diarizationModels.includes(
      'd582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d',
    ) &&
      files.diarizationModels.includes(
        '357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b',
      ) &&
      files.diarizationModels.includes('expectedBytes: 1_540_506') &&
      files.diarizationModels.includes('expectedBytes: 29_596_978') &&
      files.diarizationModels.includes("crypto.subtle.digest('SHA-256'") &&
      files.diarizationModels.includes("minimed-browser-diarization-models-v1") &&
      files.diarizationModels.includes('storeCachedModel(artifact, bytes)'),
  ],
  [
    'transcript export and speaker roles',
    files.transcriptPanel.includes('Скачать .txt') &&
      files.transcriptPanel.includes("setSpeakerRole(speakerId, 'Врач')") &&
      files.transcriptPanel.includes("setSpeakerRole(speakerId, 'Пациент')"),
  ],
  [
    'diary shared controls',
    files.diaryPanel.includes('<TextField') &&
      files.diaryPanel.includes('<TextArea') &&
      files.diaryPanel.includes('<ChoiceGroup') &&
      files.diaryPanel.includes('<FileButton'),
  ],
  [
    'standalone diary shared controls',
    !files.diary.includes('<input') &&
      files.diary.includes('<TextField') &&
      files.diary.includes('<Button'),
  ],
  ['standalone diary dark theme', files.diaryMain.includes("@/styles/theme-dark.css")],
  [
    'Vite multi-page diary entry',
    files.vite.includes("diary: fileURLToPath(new URL('./diary/index.html'"),
  ],
  [
    'diary dependencies',
    files.appPackage.includes('"jsqr": "1.4.0"') &&
      files.appPackage.includes('"qrcode": "1.5.4"'),
  ],
  [
    'drawing + transcript CSS',
    files.notesCss.includes('.patient-note-record-inline-file__drawing') &&
      files.notesCss.includes('.note-transcript__segments'),
  ],
  [
    'drawing editor shared controls',
    files.drawing.includes('<SearchField') && files.drawing.includes('<Button'),
  ],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}

if (failed > 0) {
  throw new Error(`Browser integration source gate failed: ${failed} check(s)`);
}

console.log(`Browser integration source gate passed: ${checks.length}/${checks.length}`);
