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
  diarizationModelTests: read('apps/app/src/features/asr/browser-diarization-models.test.ts'),
  transcriptPanel: read('apps/app/src/features/notes/NoteTranscriptPanel.tsx'),
  transcriptEditAlignment: read('apps/app/src/features/notes/transcript-edit-alignment.ts'),
  transcriptEditAlignmentTests: read(
    'apps/app/src/features/notes/transcript-edit-alignment.test.ts',
  ),
  voiceRecorder: read('apps/app/src/features/notes/VoiceRecordingButton.tsx'),
  noteFiles: read('apps/app/src/state/note-files.ts'),
  noteFilesTests: read('apps/app/src/state/note-files.test.ts'),
  noteTranscription: read('apps/app/src/state/note-transcription.ts'),
  noteTranscriptionTests: read('apps/app/src/state/note-transcription.test.ts'),
  retentionCleanup: read('apps/app/src/state/note-retention-cleanup.ts'),
  patientNotes: read('apps/app/src/state/patient-notes.ts'),
  noteImages: read('apps/app/src/state/note-images.ts'),
  personalNotesBackup: read('apps/app/src/state/personal-notes-backup.ts'),
  personalNotesBackupTests: read('apps/app/src/state/personal-notes-backup.test.ts'),
  patientWorkspace: read('apps/app/src/features/notes/PatientWorkspace.tsx'),
  patientWorkspaceCss: read('apps/app/src/styles/patient-workspace.css'),
  diaryPanel: read('apps/app/src/features/diary/PatientDiaryPanel.tsx'),
  diaryCodec: read('apps/app/src/features/diary/diary-codec.ts'),
  diaryStorage: read('apps/app/src/features/diary/diary-storage.ts'),
  diaryTests: read('apps/app/src/features/diary/diary.test.ts'),
  diaryServiceWorker: read('apps/app/public/diary/sw.js'),
  diary: read('apps/app/src/diary/DiaryApp.tsx'),
  diaryMain: read('apps/app/src/diary/main.tsx'),
  vite: read('apps/app/vite.config.ts'),
  appPackage: read('apps/app/package.json'),
  notesCss: read('apps/app/src/styles/notes-polish.css'),
  drawing: read('apps/app/src/features/notes/NoteDrawingEditor.tsx'),
  readingMode: read('apps/app/src/features/library/document-reading-mode.ts'),
  readingModeTests: read('apps/app/src/features/library/document-reading-mode.test.ts'),
  userDocumentReader: read('apps/app/src/features/library/UserDocumentReader.tsx'),
  readerPolishCss: read('apps/app/src/styles/reader-polish.css'),
  userLibraryCss: read('apps/app/src/styles/user-library.css'),
  userReaderCss: read('apps/app/src/styles/user-reader.css'),
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
    files.viewerState.includes('readonly record: NoteFile') &&
      files.viewerState.includes('record,'),
  ],
  ['Whisper word timestamps', files.worker.includes("return_timestamps: 'word'")],
  [
    '10-minute browser ASR guard',
    files.asr.includes('MAX_BROWSER_TRANSCRIPTION_SECONDS = 10 * 60'),
  ],
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
    files.asrAssetCache.includes('minimed-asr-asset-cache-v1') &&
      files.asrAssetCache.includes('admitted: false') &&
      files.asrAssetCache.includes('assets.put({ ...record, admitted: true })') &&
      files.asrAssetCache.includes('requirements: readonly AsrAssetRequirement[]') &&
      files.asr.includes('commitAsrModelCacheManifest('),
  ],
  [
    'Whisper startup restore is cache-only',
    files.asr.includes('hasCompleteCachedAsrModel(id)') &&
      files.asr.includes('activateAsrModel(id, { cachedOnly: true })') &&
      files.asr.includes(
        'if (response === undefined && cachedOnlyActivations.has(request.modelId))',
      ) &&
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
      files.asr.includes('if (selectedAsrModelId() !== id) selectAsrModel(null)'),
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
    ) && !files.noteTranscription.includes("cause.name === 'AbortError'"),
  ],
  [
    'Whisper fetch guard handles Request inputs',
    files.worker.includes('input instanceof Request') &&
      files.worker.includes('request?.url ?? String(input)') &&
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
      files.diarizationModels.includes('minimed-browser-diarization-models-v1') &&
      files.diarizationModels.includes('storeCachedModel(artifact, bytes)'),
  ],
  [
    'verified diarization cache has behavioural coverage',
    files.diarizationModels.includes('export async function getBrowserDiarizationModelBytes(') &&
      files.diarizationModels.includes('const completed = modelCacheTransaction(transaction)') &&
      files.diarizationModels.includes('await completed') &&
      files.diarizationModelTests.includes(
        'reuses a verified IndexedDB model without a second download',
      ) &&
      files.diarizationModelTests.includes(
        'drops a same-size corrupt cached model and downloads the verified artifact again',
      ),
  ],
  [
    'transcript export and speaker roles',
    files.transcriptPanel.includes('Скачать .txt') &&
      files.transcriptPanel.includes("setSpeakerRole(speakerId, 'Врач')") &&
      files.transcriptPanel.includes("setSpeakerRole(speakerId, 'Пациент')"),
  ],
  [
    'manual transcript edits cannot masquerade as aligned timestamps',
    files.transcriptPanel.includes(
      'transcriptTextMatchesSegments(draft(), transcript()?.segments)',
    ) &&
      files.transcriptPanel.includes('Скачать с таймкодами') &&
      files.transcriptEditAlignment.includes('normalizedTranscriptWords') &&
      files.transcriptEditAlignmentTests.includes(
        'keeps timestamps available for punctuation and case-only edits',
      ) &&
      files.transcriptEditAlignmentTests.includes(
        'invalidates timestamp actions when words change',
      ),
  ],
  [
    'transcript rerun protects unsaved edits',
    files.transcriptPanel.includes('const hasUnsavedEdits = (): boolean =>') &&
      files.transcriptPanel.includes('Есть несохранённые правки расшифровки') &&
      files.transcriptPanel.includes('disabled={deleting() || saving()}'),
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
    files.noteFilesTests.includes(
      'deletes the old transcript only after a replacement file is committed',
    ) &&
      files.noteFilesTests.includes(
        'does not delete a transcript when replacement fails before touching the file store',
      ) &&
      files.noteFilesTests.includes(
        "expect(transcripts.get(fileId)?.text).toBe('Нельзя потерять этот текст')",
      ),
  ],
  [
    'cancelled transcription cannot recreate deleted data',
    files.noteTranscription.includes('const cancelledTranscriptions = new Set<string>()') &&
      files.noteTranscription.includes('cancelledTranscriptions.add(fileId)') &&
      files.noteTranscription.includes(
        'const canWrite = (): boolean => !cancelledTranscriptions.has(input.fileId)',
      ) &&
      files.noteTranscription.includes('await putTranscript(next, canWrite)') &&
      files.noteTranscription.includes('await putTranscript({') &&
      files.noteTranscription.includes('}, canWrite)') &&
      files.noteTranscription.includes(
        'if (noteIds.has(active.noteId)) cancelTranscription(fileId)',
      ),
  ],
  [
    'transcript deletion races have behavioural coverage',
    files.noteTranscriptionTests.includes('tombstones an explicitly deleted transcript') &&
      files.noteTranscriptionTests.includes(
        'does not recreate a transcript when an active Whisper job resolves after deletion',
      ) &&
      files.noteTranscriptionTests.includes(
        'allows a fresh transcription after a deleted job has fully stopped',
      ) &&
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
      files.retentionCleanup.includes('minimed-note-retention-cleanup-v1') &&
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
    'notes view reuses shared visible form controls',
    (files.notes.match(/<input\b/gu) ?? []).length === 1 &&
      files.notes.includes('class="visually-hidden"') &&
      files.notes.includes('aria-label="Импорт backup личных заметок"') &&
      files.notes.includes('<UiTextField') &&
      files.notes.includes('inputClass="patient-note-form__categories-input"') &&
      files.notes.includes('<Button type="submit" variant="primary">'),
  ],
  [
    'patient workspace reuses shared visible form controls',
    (files.patientWorkspace.match(/<input\b/gu) ?? []).length === 1 &&
      files.patientWorkspace.includes('class="visually-hidden"') &&
      files.patientWorkspace.includes('type="file"') &&
      !files.patientWorkspace.includes('<textarea') &&
      (files.patientWorkspace.match(/<TextField\b/gu) ?? []).length >= 13 &&
      files.patientWorkspace.includes('<TextArea') &&
      !files.patientWorkspace.includes('inputClass="patient-workspace__control"') &&
      !files.patientWorkspace.includes('textareaClass="patient-workspace__control"') &&
      files.patientWorkspace.includes(
        '<Button\n          class="patient-workspace__quick-action"',
      ) &&
      !files.patientWorkspace.includes(
        '<button\n          class="patient-workspace__quick-action"',
      ) &&
      files.patientWorkspace.includes('class="patient-workspace__event-action"') &&
      files.patientWorkspaceCss.includes('select.patient-workspace__control') &&
      files.patientWorkspaceCss.includes('output.patient-workspace__control') &&
      !files.patientWorkspaceCss.includes('.patient-workspace__event-revision-input'),
  ],
  [
    'personal-notes export preflights encoded size',
    files.personalNotesBackup.includes('export function estimatePersonalNotesBackupBytes(') &&
      files.personalNotesBackup.includes('function assertPersonalNotesBackupFits(') &&
      files.personalNotesBackup.includes("assertPersonalNotesBackupFits(state, { kind: 'all' })") &&
      files.personalNotesBackup.includes(
        "assertPersonalNotesBackupFits(selected, { kind: 'card', cardId })",
      ) &&
      files.personalNotesBackupTests.includes(
        'preflights base64 expansion before allocating large backup blobs',
      ) &&
      files.notes.includes('file.size > MAX_PERSONAL_NOTES_BACKUP_FILE_BYTES'),
  ],
  [
    'whole personal-notes notebook can be deleted independently',
    files.personalNotesBackup.includes('export async function deleteAllPersonalNotes()') &&
      files.personalNotesBackup.includes('clearPatientNoteWorkingState()') &&
      files.notes.includes("id: 'delete-all-personal-notes'") &&
      files.notes.includes('Защищённые карточки пациентов') &&
      files.personalNotesBackupTests.includes(
        'deletes the whole personal-notes notebook without touching patient-vault data',
      ) &&
      files.personalNotesBackupTests.includes(
        "expect(env.local.getItem('minimed.patient-vault.test-fixture')).toBe('keep-me')",
      ),
  ],
  [
    'portable personal-notes backup preserves stable ids',
    files.personalNotesBackup.includes(
      "PERSONAL_NOTES_BACKUP_KIND = 'minimed-personal-notes-backup'",
    ) &&
      files.personalNotesBackup.includes('PERSONAL_NOTES_BACKUP_SCHEMA_VERSION = 1') &&
      files.personalNotesBackup.includes("readonly kind: 'card'; readonly cardId: string") &&
      files.personalNotesBackup.includes('export async function exportPersonalNotesCardBackup(') &&
      files.personalNotesBackup.includes('readonly sha256: string') &&
      files.personalNotesBackup.includes("crypto.subtle.digest('SHA-256'") &&
      files.patientNotes.includes('export async function replacePatientNotesSnapshot(') &&
      files.noteFiles.includes('export async function replaceAllNoteFiles(') &&
      files.noteImages.includes('export async function replaceAllNoteImages(') &&
      files.noteTranscription.includes('export async function replaceAllTranscripts('),
  ],
  [
    'personal-notes import validates links and rolls back',
    files.personalNotesBackup.includes('parsePatientNotesSnapshot(candidate.snapshot)') &&
      files.personalNotesBackup.includes(
        'Расшифровка в backup не связана с исходной аудиозаписью',
      ) &&
      files.personalNotesBackup.includes('Контрольная сумма вложения') &&
      files.personalNotesBackup.includes('const previous = await capturePersonalNotesState()') &&
      files.personalNotesBackup.includes('await applyPersonalNotesState(previous)') &&
      files.personalNotesBackup.includes(
        'mergeCardState(previous, prepared, backup.scope.cardId)',
      ) &&
      files.personalNotesBackup.includes('clearPatientNoteWorkingState(') &&
      files.notes.includes('parsePersonalNotesBackup(JSON.parse(raw) as unknown)') &&
      files.notes.includes('importPersonalNotesBackup(backup)') &&
      files.notes.includes('exportPersonalNotesCardBackup(card.id)'),
  ],
  [
    'backup self-heals orphan transcripts',
    files.personalNotesBackup.includes('const orphanTranscripts: NoteTranscript[] = []') &&
      files.personalNotesBackup.includes('deleteTranscript(transcript.fileId)') &&
      files.personalNotesBackupTests.includes(
        'excludes orphan transcripts from export and cleans them best-effort',
      ) &&
      files.personalNotesBackupTests.includes(
        "expect(backup.transcripts.map((item) => item.fileId)).toEqual(['file-audio'])",
      ),
  ],
  [
    'personal-notes backup round trip is covered',
    files.personalNotesBackupTests.includes(
      'round-trips stable note, attachment, image and transcript ids',
    ) &&
      files.personalNotesBackupTests.includes("bytesBase64: 'AQID'") &&
      files.personalNotesBackupTests.includes(
        '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
      ) &&
      files.personalNotesBackupTests.includes("speakerNames: { 'speaker-1': 'Врач' }") &&
      files.personalNotesBackupTests.includes(
        'rejects same-size attachment corruption before mutating current notes',
      ) &&
      files.personalNotesBackupTests.includes(
        'not linked to its source audio before mutating data',
      ) &&
      files.personalNotesBackupTests.includes(
        'exports one card and imports it without replacing unrelated cards',
      ) &&
      files.personalNotesBackupTests.includes(
        'rejects a card backup whose note id collides with another card',
      ) &&
      files.personalNotesBackupTests.includes('minimed.patient-note-drafts.v1'),
  ],
  [
    'diary transport bounds compressed and QR payloads',
    files.diaryCodec.includes('MAX_DIARY_JSON_BYTES = 1024 * 1024') &&
      files.diaryCodec.includes('async function decompressBounded(') &&
      files.diaryCodec.includes('chunk.length > DIARY_QR_CHUNK') &&
      files.diaryTests.includes(
        'rejects a compressed payload that expands beyond the diary JSON budget',
      ) &&
      files.diaryTests.includes(
        'rejects an individual QR part larger than the advertised chunk size',
      ),
  ],
  [
    'diary storage recovers index and isolates corrupt records',
    files.diaryStorage.includes('function scanDiaryIds(storage: Storage)') &&
      files.diaryStorage.includes('Rebuild the navigation index from the source diary records') &&
      files.diaryTests.includes('rebuilds a damaged index from valid diary records') &&
      files.diaryTests.includes(
        'keeps valid diaries visible when another local diary record is corrupt',
      ),
  ],
  [
    'diary service worker caches only static assets',
    files.diaryServiceWorker.includes(
      "STATIC_DESTINATIONS = new Set(['document', 'script', 'style', 'font', 'worker', 'image'])",
    ) && files.diaryServiceWorker.includes('!STATIC_DESTINATIONS.has(request.destination)'),
  ],
  [
    'stored diary has explicit local deletion',
    files.diary.includes('Удалить этот дневник и все его локальные записи с этого устройства?') &&
      files.diary.includes('current.store.remove(diary.id)') &&
      files.diary.includes('variant="danger"'),
  ],
  [
    'diary QR photos and camera lifecycle are bounded',
    files.diaryPanel.includes('const MAX_QR_PHOTOS = 40') &&
      files.diaryPanel.includes('const MAX_QR_PHOTO_BYTES = 20 * 1024 * 1024') &&
      files.diaryPanel.includes('bitmap?.close()') &&
      files.diaryPanel.includes('let disposed = false') &&
      files.diaryPanel.includes('if (disposed) {') &&
      files.diaryPanel.includes('video.srcObject = null') &&
      files.diaryPanel.includes('disabled={startingCamera()}'),
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
  ['standalone diary dark theme', files.diaryMain.includes('@/styles/theme-dark.css')],
  [
    'Vite multi-page diary entry',
    files.vite.includes("diary: fileURLToPath(new URL('./diary/index.html'"),
  ],
  [
    'diary dependencies',
    files.appPackage.includes('"jsqr": "1.4.0"') && files.appPackage.includes('"qrcode": "1.5.4"'),
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
  [
    'text and Markdown reading scale persists independently of PDF zoom',
    files.readingMode.includes("const TEXT_SCALE_KEY = 'minimed.userDocTextScale'") &&
      files.readingMode.includes('DOCUMENT_TEXT_SCALE_LEVELS = [90, 100, 110, 125, 140]') &&
      files.readingMode.includes('setDocumentTextScale(stepDocumentTextScale') &&
      files.readingModeTests.includes(
        'normalizes arbitrary stored values to the nearest supported level',
      ) &&
      files.readingModeTests.includes('steps without leaving the supported bounds') &&
      files.userDocumentReader.includes("id: 'text-scale-down'") &&
      files.userDocumentReader.includes("id: 'text-scale-reset'") &&
      files.userDocumentReader.includes("id: 'text-scale-up'") &&
      files.userDocumentReader.includes('class="user-document-reader__markdown"') &&
      files.userDocumentReader.includes("'user-document-reader--text-scale-140'") &&
      files.userLibraryCss.includes('--user-document-text-scale: 1.4') &&
      files.userLibraryCss.includes(
        'font-size: calc(0.8125rem * var(--user-document-text-scale, 1))',
      ) &&
      files.readerPolishCss.includes('--safe-markdown-body-size: calc(') &&
      files.readerPolishCss.includes('--safe-markdown-table-size: calc(') &&
      files.userReaderCss.includes('font-size: calc(1rem * var(--user-document-text-scale, 1))'),
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
