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
  voiceRecorder: read('apps/app/src/features/notes/VoiceRecordingButton.tsx'),
  noteFiles: read('apps/app/src/state/note-files.ts'),
  noteTranscription: read('apps/app/src/state/note-transcription.ts'),
  retentionCleanup: read('apps/app/src/state/note-retention-cleanup.ts'),
  patientNotes: read('apps/app/src/state/patient-notes.ts'),
  diaryPanel: read('apps/app/src/features/diary/PatientDiaryPanel.tsx'),
  diary: read('apps/app/src/diary/DiaryApp.tsx'),
  diaryMain: read('apps/app/src/diary/main.tsx'),
  vite: read('apps/app/vite.config.ts'),
  appPackage: read('apps/app/package.json'),
  notesCss: read('apps/app/src/styles/notes-polish.css'),
  drawing: read('apps/app/src/features/notes/NoteDrawingEditor.tsx'),
};

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  return source.slice(start, end < 0 ? source.length : end);
}

const replaceFileSection = sourceSection(
  files.noteFiles,
  'export async function replaceNoteFile',
  'async function loadByNoteIds',
);
const deleteFileSection = sourceSection(
  files.noteFiles,
  'export async function deleteNoteFile',
  'export async function deleteNoteFilesForNotes',
);
const bulkDeleteSection = sourceSection(
  files.noteFiles,
  'export async function deleteNoteFilesForNotes',
  '/** Save a stored attachment',
);

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
    'failed MediaRecorder capture is discarded',
    files.voiceRecorder.includes('let captureFailed = false') &&
      files.voiceRecorder.includes('captureFailed = true') &&
      files.voiceRecorder.includes('if (disposed || captureFailed)') &&
      files.voiceRecorder.includes('chunks = []'),
  ],
  [
    'attachment deletion is privacy-first',
    replaceFileSection.indexOf('await deleteTranscript(fileId)') >= 0 &&
      replaceFileSection.indexOf('await deleteTranscript(fileId)') <
        replaceFileSection.indexOf('const database = await openDatabase()') &&
      deleteFileSection.indexOf('await deleteTranscript(fileId)') >= 0 &&
      deleteFileSection.indexOf('await deleteTranscript(fileId)') <
        deleteFileSection.indexOf('const database = await openDatabase()') &&
      bulkDeleteSection.indexOf('await deleteTranscriptsForNotes(noteIds)') >= 0 &&
      bulkDeleteSection.indexOf('await deleteTranscriptsForNotes(noteIds)') <
        bulkDeleteSection.indexOf('const database = await openDatabase()') &&
      files.noteTranscription.includes('export async function deleteTranscript(') &&
      files.noteTranscription.includes('export async function deleteTranscriptsForNotes('),
  ],
  [
    'cancelled transcription cannot recreate deleted data',
    files.noteTranscription.includes('const cancelledTranscriptions = new Set<string>()') &&
      files.noteTranscription.includes('cancelledTranscriptions.add(fileId)') &&
      files.noteTranscription.includes('const canWrite = (): boolean => !cancelledTranscriptions.has(input.fileId)') &&
      files.noteTranscription.includes('await putTranscript(next, canWrite)') &&
      files.noteTranscription.includes('await putTranscript({') &&
      files.noteTranscription.includes('}, canWrite)') &&
      files.noteTranscription.includes('if (noteIds.has(active.noteId)) cancelTranscription(fileId)'),
  ],
  [
    'transcript can be deleted without deleting audio',
    files.transcriptPanel.includes('Удалить расшифровку') &&
      files.transcriptPanel.includes('Исходная') &&
      files.transcriptPanel.includes('аудиозапись останется в заметке'),
  ],
  [
    'note/card deletion journals retention cleanup',
    files.patientNotes.includes('scheduleNoteRetentionCleanup(doomedNoteIds)') &&
      files.patientNotes.includes('scheduleNoteRetentionCleanup([...doomed])') &&
      files.retentionCleanup.includes("minimed-note-retention-cleanup-v1") &&
      files.retentionCleanup.includes('persistPending(pendingIds())'),
  ],
  [
    'retention journal resumes after reload',
    files.retentionCleanup.includes('runPendingNoteRetentionCleanup()') &&
      files.retentionCleanup.includes('await deleteNoteFilesForNotes(ids)') &&
      files.retentionCleanup.includes('await deleteNoteImagesForNotes(ids)') &&
      files.retentionCleanup.includes("if (typeof window !== 'undefined')") &&
      files.retentionCleanup.includes('queueMicrotask'),
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
