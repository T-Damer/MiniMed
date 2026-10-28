/**
 * The patient's phone as the doctor wrote it down: a call link and a contact card the phone's
 * address book can import. Nothing leaves the device except through the doctor's own share sheet.
 */
/** The doctor's own name for a patient and the phone to call them back. */
export interface DiaryPatient {
  readonly name: string;
  readonly phone: string;
}

export function telHref(phone: string): string {
  return `tel:${phone.replaceAll(/[^\d+]/gu, '')}`;
}

function vcardText(value: string): string {
  return value.replaceAll(/[\\;,]/gu, (match) => `\\${match}`).replaceAll('\n', ' ');
}

/** A vCard 3.0 with the name and one phone. */
export function patientVCard(patient: DiaryPatient): string {
  const name = vcardText(patient.name);
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${name}`,
    `N:${name};;;;`,
    `TEL;TYPE=CELL:${patient.phone.replaceAll(/[^\d+]/gu, '')}`,
    'NOTE:Пациент · дневник лечения',
    'END:VCARD',
    '',
  ].join('\r\n');
}

/**
 * Hands the contact card to the system: the share sheet on phones (Contacts is one of the
 * targets), a `.vcf` download elsewhere, which the address book opens.
 */
export async function savePatientContact(patient: DiaryPatient): Promise<void> {
  const file = new File([patientVCard(patient)], 'patient.vcf', { type: 'text/vcard' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: patient.name });
      return;
    } catch (cause) {
      // The doctor closed the sheet: nothing to do.
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      throw cause;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${patient.name.replaceAll(/[^\p{L}\p{N} ._-]/gu, '').trim() || 'patient'}.vcf`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
