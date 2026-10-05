import { describe, expect, it } from 'vitest';

import {
  isNotesFullscreenRoute,
  notesFormsPath,
  notesNewPatientPath,
  notesPath,
  notesPatientsPath,
  notesTemplatesPath,
  noteTemplatePath,
  readNotesRoute,
  withNotesFullscreen,
} from '@/features/notes/notes-routing';

describe('notes routing', () => {
  it('parses index, templates, card, new-record, and record routes', () => {
    expect(readNotesRoute('#/notes')).toEqual({ kind: 'index' });
    expect(readNotesRoute('#/notes/templates')).toEqual({ kind: 'templates' });
    expect(readNotesRoute('#/notes/templates?create=1')).toEqual({
      kind: 'templates',
      create: true,
    });
    expect(readNotesRoute('#/notes/templates/template%2F1')).toEqual({
      kind: 'template',
      documentId: 'template/1',
    });
    expect(readNotesRoute('#/notes/card%2F1')).toEqual({
      kind: 'card',
      cardId: 'card/1',
    });
    expect(readNotesRoute('#/notes/card-1/records/new')).toEqual({
      kind: 'new-record',
      cardId: 'card-1',
    });
    expect(readNotesRoute('#/notes/card-1/records/note%2F1')).toEqual({
      kind: 'record',
      cardId: 'card-1',
      noteId: 'note/1',
    });
    expect(readNotesRoute('#/notes/card-1/records/note-1?fullscreen=1')).toEqual({
      kind: 'record',
      cardId: 'card-1',
      noteId: 'note-1',
    });
  });

  it('parses protected patient and dynamics routes without mixing ordinary notes', () => {
    expect(readNotesRoute('#/notes/patients')).toEqual({ kind: 'patients' });
    expect(readNotesRoute('#/notes/patients/new')).toEqual({ kind: 'new-patient' });
    expect(readNotesRoute('#/notes/patients/patient%2F1')).toEqual({
      kind: 'patient',
      patientId: 'patient/1',
    });
    expect(readNotesRoute('#/notes/patients/patient%2F1?episode=episode%2F1')).toEqual({
      kind: 'patient',
      patientId: 'patient/1',
      episodeId: 'episode/1',
    });
    expect(readNotesRoute('#/notes/patients/patient%2F1/dynamics')).toEqual({
      kind: 'patient-dynamics',
      patientId: 'patient/1',
    });
  });

  it('parses the official forms routes with the patient and episode they were opened from', () => {
    expect(readNotesRoute('#/notes/forms')).toEqual({ kind: 'forms' });
    expect(readNotesRoute('#/notes/forms/ru.minzdrav.274n.070u')).toEqual({
      kind: 'form',
      formId: 'ru.minzdrav.274n.070u',
    });
    expect(readNotesRoute('#/notes/forms/form%2F1?patient=p%2F1&episode=e1')).toEqual({
      kind: 'form',
      formId: 'form/1',
      patientId: 'p/1',
      episodeId: 'e1',
    });
    expect(readNotesRoute('#/notes/forms?patient=p1&episode=e1')).toEqual({
      kind: 'forms',
      patientId: 'p1',
      episodeId: 'e1',
    });
    expect(notesFormsPath(undefined, { patientId: 'p 1' })).toBe('#/notes/forms?patient=p+1');
    expect(readNotesRoute('#/notes/forms/%')).toEqual({ kind: 'forms' });
    expect(readNotesRoute('#/notes/forms/a/b')).toEqual({ kind: 'forms' });
    expect(notesFormsPath()).toBe('#/notes/forms');
    expect(notesFormsPath('f1', { patientId: 'p/1', episodeId: 'e1' })).toBe(
      '#/notes/forms/f1?patient=p%2F1&episode=e1',
    );
    expect(readNotesRoute(notesFormsPath('f 1', { patientId: 'p 1' }))).toEqual({
      kind: 'form',
      formId: 'f 1',
      patientId: 'p 1',
    });
  });

  it('falls back safely for malformed or incomplete routes', () => {
    expect(readNotesRoute('#/search')).toEqual({ kind: 'index' });
    expect(readNotesRoute('#/notes/card-1/other')).toEqual({
      kind: 'card',
      cardId: 'card-1',
    });
    expect(readNotesRoute('#/notes/templates/extra/path')).toEqual({ kind: 'templates' });
    expect(readNotesRoute('#/notes/%')).toEqual({ kind: 'index' });
  });

  it('builds encoded notes paths', () => {
    expect(notesPath()).toBe('#/notes');
    expect(notesPath('card/1')).toBe('#/notes/card%2F1');
    expect(notesPath('card/1', 'note/1')).toBe('#/notes/card%2F1/records/note%2F1');
    expect(notesPatientsPath()).toBe('#/notes/patients');
    expect(notesPatientsPath('patient/1')).toBe('#/notes/patients/patient%2F1');
    expect(notesPatientsPath('patient/1', false, 'episode/1')).toBe(
      '#/notes/patients/patient%2F1?episode=episode%2F1',
    );
    expect(notesPatientsPath('patient/1', true)).toBe('#/notes/patients/patient%2F1/dynamics');
    expect(notesNewPatientPath()).toBe('#/notes/patients/new');
    expect(notesTemplatesPath()).toBe('#/notes/templates');
    expect(notesTemplatesPath(true)).toBe('#/notes/templates?create=1');
    expect(noteTemplatePath('template/1')).toBe('#/notes/templates/template%2F1');
  });

  it('round-trips the fullscreen editor flag without changing the note route', () => {
    const path = notesPath('card-1', 'note-1');
    const fullscreenPath = withNotesFullscreen(path, true);
    expect(fullscreenPath).toBe(`${path}?fullscreen=1`);
    expect(isNotesFullscreenRoute(fullscreenPath)).toBe(true);
    expect(withNotesFullscreen(fullscreenPath, false)).toBe(path);
  });
});
