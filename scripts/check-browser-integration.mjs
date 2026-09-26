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
  workerTests: read('apps/app/src/features/asr/asr.worker.test.ts'),
  asr: read('apps/app/src/features/asr/asr-models.ts'),
  asrSettings: read('apps/app/src/features/asr/AsrSettings.tsx'),
  asrAssetCache: read('apps/app/src/features/asr/asr-asset-cache.ts'),
  asrAssetCacheTests: read('apps/app/src/features/asr/asr-asset-cache.test.ts'),
  asrProtocol: read('apps/app/src/features/asr/asr-download-protocol.ts'),
  restoreDownloads: read('apps/app/src/features/downloads/restore-downloads.ts'),
  resumableDownload: read('apps/app/src/features/network/resumable-download.ts'),
  diarization: read('apps/app/src/features/asr/browser-diarization.ts'),
  speakerAlignment: read('apps/app/src/features/asr/speaker-alignment.ts'),
  diarizationModels: read('apps/app/src/features/asr/browser-diarization-models.ts'),
  transcriptPanel: read('apps/app/src/features/notes/NoteTranscriptPanel.tsx'),
  voiceRecorder: read('apps/app/src/features/notes/VoiceRecordingButton.tsx'),
  noteFiles: read('apps/app/src/state/note-files.ts'),
  noteFilesTests: read('apps/app/src/state/note-files.test.ts'),
  noteTranscription: read('apps/app/src/state/note-transcription.ts'),
  noteTranscriptionTests: read('apps/app/src/state/note-transcription.test.ts'),
  retentionCleanup: read('apps/app/src/state/note-retention-cleanup.ts'),
  patientNotes: read('apps/app/src/state/patient-notes.ts'),
  patientWorkspace: read('apps/app/src/features/notes/PatientWorkspace.tsx'),
  patientWorkspaceCss: read('apps/app/src/styles/patient-workspace.css'),
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
    'Whisper revisions are immutable',
    files.asrProtocol.includes('1846881b6b3a3024392c1eea3ad983695bc23925') &&
      files.asrProtocol.includes('36050c46d777d46dc4b5f43f6d90574fc38f8732') &&
      !files.asrProtocol.includes('/resolve/(main|') &&
      files.worker.includes("revision: ASR_MODEL_REVISIONS['onnx-community/whisper-base']") &&
      files.worker.includes("revision: ASR_MODEL_REVISIONS['onnx-community/whisper-small']"),
  ],
  [
    'Whisper cache is admitted only after ready',
    files.asrAssetCache.includes("minimed-asr-asset-cache-v1") &&
      files.asrAssetCache.includes('admitted: false') &&
      files.asrAssetCache.includes('assets.put({ ...record, admitted: true })') &&
      files.asrAssetCache.includes('requirements: readonly AsrAssetRequirement[]') &&
      files.asr.includes('commitAsrModelCacheManifest('),
  ],
  [
    'Whisper startup restore is cache-only',
    files.asr.includes('hasCompleteCachedAsrModel(id)') &&
      files.asr.includes("activateAsrModel(id, { cachedOnly: true })") &&
      files.asr.includes("if (response === undefined && cachedOnlyActivations.has(request.modelId))") &&
      files.restoreDownloads.includes('let resumingSpeech = false') &&
      files.restoreDownloads.includes('await asr.activateSelectedAsrModel()'),
  ],
  [
    'manual Whisper resume may reuse staged verified bytes',
    files.asr.includes('allowUnadmitted: !cachedOnlyActivations.has(request.modelId)') &&
      files.asrAssetCache.includes('options: { readonly allowUnadmitted?: boolean } = {}') &&
      files.asr.includes('discardUnadmittedAsrAssets(message.modelId)'),
  ],
  [
    'single Whisper worker exposes only its current pipeline as ready',
    files.asr.includes('readyModels.clear()') &&
      files.asr.includes('readyModels.add(message.modelId)') &&
      files.asr.includes('One worker owns exactly one pipeline'),
  ],
  [
    'Whisper model switch unloads the previous runtime',
    files.asr.includes('const switchingRuntime =') &&
      files.asr.includes('stopAsrRuntime(new AsrCancelledError())') &&
      files.asr.includes("if (selectedAsrModelId() !== id) selectAsrModel(null)"),
  ],
  [
    'Whisper can be deactivated without deleting its cache',
    files.asr.includes('export function deactivateAsrModel()') &&
      files.asrSettings.includes('deactivateAsrModel()') &&
      files.asr.includes('setTranscriptionEngine(null)'),
  ],
  [
    'cached Whisper can be removed from browser storage',
    files.asrAssetCache.includes('export async function deleteCachedAsrModel(') &&
      files.asr.includes('export async function removeAsrModel(') &&
      files.asr.includes('await deleteCachedAsrModel(id)') &&
      files.asr.includes('clearResumableDownloadsByPrefix(') &&
      files.asrSettings.includes('Удалить речевую модель?') &&
      files.asrSettings.includes('Удалить модель'),
  ],
  [
    'Whisper cache deletion is isolated by model',
    files.asrAssetCacheTests.includes('deletes only the requested admitted model') &&
      files.asrAssetCacheTests.includes('hasCompleteCachedAsrModel(baseId)') &&
      files.asrAssetCacheTests.includes('hasCompleteCachedAsrModel(smallId)') &&
      files.asrAssetCacheTests.includes('deleteCachedAsrModel(baseId)') &&
      files.asrAssetCacheTests.includes("stores.get('models')?.records.has(smallId)"),
  ],
  [
    'runtime stop becomes retryable transcript failure, not stale running state',
    files.noteTranscription.includes(
      'if (ctx.signal.aborted || !canWrite() || cause instanceof PreemptedError)',
    ) &&
      !files.noteTranscription.includes("cause.name === 'AbortError'"),
  ],
  [
    'Whisper fetch guard handles Request inputs',
    files.worker.includes('input instanceof Request') &&
      files.worker.includes("request?.url ?? String(input)") &&
      files.worker.includes("request.method !== 'GET'") &&
      files.worker.includes("request.headers.get('range')") &&
      files.workerTests.includes('accepts a pinned Hugging Face Request') &&
      files.workerTests.includes('rejects non-GET Request inputs') &&
      files.workerTests.includes('rejects unsupported Request Range headers'),
  ],
  [
    'Whisper worker crash clears stale ready state',
    files.asr.includes('instance.onerror = () => {') &&
      files.asr.includes('readyModels.clear()') &&
      files.asr.includes('setTranscriptionEngine(null)') &&
      files.asr.includes('selectAsrModel(null)') &&
      files.asr.includes("warnCache(cause, 'очистить незавершённый')"),
  ],
  [
    'obsolete unpinned Whisper partials are purged',
    files.restoreDownloads.includes(
      "clearResumableDownloadsByPrefix('speech:transformers-whisper-q8-v1:')",
    ) &&
      files.resumableDownload.includes(
        'export async function clearResumableDownloadsByPrefix(prefix: string)',
      ),
  ],
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
    'replacement is atomic while deletion remains privacy-first',
    replaceFileSection.indexOf('await deleteTranscript(fileId)') >
      replaceFileSection.indexOf('window.dispatchEvent(new Event(NOTE_FILES_EVENT))') &&
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
    'atomic replacement retention has behavioural coverage',
    files.noteFilesTests.includes('deletes the old transcript only after a replacement file is committed') &&
      files.noteFilesTests.includes('does not delete a transcript when replacement fails before touching the file store') &&
      files.noteFilesTests.includes("expect(transcripts.get(fileId)?.text).toBe('Нельзя потерять этот текст')"),
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
    'transcript deletion races have behavioural coverage',
    files.noteTranscriptionTests.includes('tombstones an explicitly deleted transcript') &&
      files.noteTranscriptionTests.includes('does not recreate a transcript when an active Whisper job resolves after deletion') &&
      files.noteTranscriptionTests.includes('expect(records.has(fileId)).toBe(false)'),
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
    'patient backup scope and destructive import are explicit',
    files.patientWorkspace.includes('Импорт заменит текущие карточки пациентов') &&
      files.patientWorkspace.includes('Личные заметки, голосовые вложения и их расшифровки') &&
      files.patientWorkspace.includes('Backup этого раздела не включает личные заметки') &&
      files.patientWorkspace.includes("label: 'Экспорт карточек пациентов'") &&
      files.patientWorkspace.includes("label: 'Импорт карточек пациентов'"),
  ],
  [
    'patient workspace reuses shared visible form controls',
    (files.patientWorkspace.match(/<input\\b/gu) ?? []).length === 1 &&
      files.patientWorkspace.includes('class="visually-hidden"') &&
      files.patientWorkspace.includes('type="file"') &&
      !files.patientWorkspace.includes('<textarea') &&
      (files.patientWorkspace.match(/<TextField\\b/gu) ?? []).length >= 13 &&
      files.patientWorkspace.includes('<TextArea') &&
      !files.patientWorkspace.includes('inputClass="patient-workspace__control"') &&
      !files.patientWorkspace.includes('textareaClass="patient-workspace__control"') &&
      files.patientWorkspace.includes('<Button\n          class="patient-workspace__quick-action"') &&
      !files.patientWorkspace.includes('<button\n          class="patient-workspace__quick-action"') &&
      files.patientWorkspace.includes('class="patient-workspace__event-action"') &&
      files.patientWorkspaceCss.includes('select.patient-workspace__control') &&
      files.patientWorkspaceCss.includes('output.patient-workspace__control') &&
      !files.patientWorkspaceCss.includes('.patient-workspace__event-revision-input'),
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
