export type UserLibraryFileKind =
  | 'questionnaire'
  | 'pdf'
  | 'dicom'
  | 'volume'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'presentation'
  | 'sheet'
  | 'doc'
  | 'ebook'
  | 'text'
  | 'binary';

export type UserLibraryReaderAction = 'print' | 'fullscreen' | 'reading-mode' | 'two-page' | 'zoom';

type UserLibraryReaderRenderer =
  | 'pdf'
  | 'image'
  | 'dicom'
  | 'volume'
  | 'markdown'
  | 'text'
  | 'epub'
  | 'docx'
  | 'sheet'
  | 'presentation'
  | 'download';

type UserLibraryTextExtraction =
  | 'plain'
  | 'rtf'
  | 'html'
  | 'fb2'
  | 'docx'
  | 'pptx'
  | 'epub'
  | 'spreadsheet'
  | 'none';

export interface UserLibraryFileCapability {
  readonly kind: UserLibraryFileKind;
  readonly extensions: readonly string[];
  readonly mimeTypes: readonly string[];
  readonly mimeTypeByExtension?: Readonly<Record<string, string>>;
  readonly filePicker: boolean;
  readonly textExtraction: UserLibraryTextExtraction;
  readonly reader: {
    readonly renderer: UserLibraryReaderRenderer;
    readonly actions: readonly UserLibraryReaderAction[];
    readonly search: 'none' | 'text' | 'visual';
    readonly print: 'none' | 'original' | 'rendered';
    readonly printOrientation: 'portrait' | 'landscape';
    readonly ocr: boolean;
  };
}

type UserLibraryFileCapabilityId =
  | 'questionnaire'
  | 'pdf'
  | 'dicom'
  | 'volume'
  | 'image'
  | 'markdown'
  | 'text'
  | 'rtf'
  | 'html'
  | 'csv'
  | 'xlsx'
  | 'xls'
  | 'docx'
  | 'doc'
  | 'pptx'
  | 'ppt'
  | 'epub'
  | 'fb2'
  | 'pages'
  | 'binary';

const PDF_READING_ACTIONS = ['print', 'fullscreen', 'two-page', 'zoom'] as const;
const TEXT_READING_ACTIONS = ['print', 'fullscreen', 'reading-mode'] as const;
const RICH_READING_ACTIONS = ['print', 'fullscreen'] as const;

export const USER_LIBRARY_FILE_CAPABILITIES = {
  questionnaire: {
    kind: 'questionnaire',
    extensions: ['minimed-questionnaire'],
    mimeTypes: ['application/vnd.minimed.questionnaire+json'],
    filePicker: false,
    textExtraction: 'none',
    reader: {
      renderer: 'download',
      actions: [],
      search: 'none',
      print: 'none',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
  pdf: {
    kind: 'pdf',
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
    filePicker: true,
    textExtraction: 'none',
    reader: {
      renderer: 'pdf',
      actions: [...PDF_READING_ACTIONS],
      search: 'visual',
      print: 'original',
      printOrientation: 'portrait',
      ocr: true,
    },
  },
  dicom: {
    kind: 'dicom',
    extensions: ['dcm', 'dicom'],
    mimeTypes: ['application/dicom'],
    filePicker: true,
    textExtraction: 'none',
    reader: {
      renderer: 'dicom',
      actions: [],
      search: 'none',
      print: 'none',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
  volume: {
    kind: 'volume',
    extensions: [
      'nii',
      'nii.gz',
      'nrrd',
      'nhdr',
      'mif',
      'mih',
      'mgh',
      'mgz',
      'mha',
      'mhd',
      'head',
      'brik',
      'hdr',
      'img',
      'npy',
      'npz',
    ],
    mimeTypes: [
      'application/x-nifti',
      'application/x-nrrd',
      'application/x-mrtrix',
      'application/x-mgh',
      'application/x-metaimage',
      'application/x-afni',
      'application/x-analyze',
      'application/x-numpy',
    ],
    mimeTypeByExtension: {
      nii: 'application/x-nifti',
      'nii.gz': 'application/x-nifti',
      nrrd: 'application/x-nrrd',
      nhdr: 'application/x-nrrd',
      mif: 'application/x-mrtrix',
      mih: 'application/x-mrtrix',
      mgh: 'application/x-mgh',
      mgz: 'application/x-mgh',
      mha: 'application/x-metaimage',
      mhd: 'application/x-metaimage',
      head: 'application/x-afni',
      brik: 'application/x-afni',
      hdr: 'application/x-analyze',
      img: 'application/x-analyze',
      npy: 'application/x-numpy',
      npz: 'application/x-numpy',
    },
    filePicker: true,
    textExtraction: 'none',
    reader: {
      renderer: 'volume',
      actions: [],
      search: 'none',
      print: 'none',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
  image: {
    kind: 'image',
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif'],
    mimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/bmp',
      'image/tiff',
      'image/heic',
      'image/heif',
    ],
    filePicker: true,
    textExtraction: 'none',
    reader: {
      renderer: 'image',
      actions: ['print', 'fullscreen'],
      search: 'none',
      print: 'rendered',
      printOrientation: 'portrait',
      ocr: true,
    },
  },
  markdown: {
    kind: 'text',
    extensions: ['md', 'markdown'],
    mimeTypes: ['text/markdown'],
    filePicker: true,
    textExtraction: 'plain',
    reader: {
      renderer: 'markdown',
      actions: [...TEXT_READING_ACTIONS],
      search: 'text',
      print: 'rendered',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
  text: {
    kind: 'text',
    extensions: ['txt'],
    mimeTypes: ['text/plain'],
    filePicker: true,
    textExtraction: 'plain',
    reader: {
      renderer: 'text',
      actions: [...TEXT_READING_ACTIONS],
      search: 'text',
      print: 'rendered',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
  rtf: {
    kind: 'text',
    extensions: ['rtf'],
    mimeTypes: ['text/rtf', 'application/rtf'],
    filePicker: true,
    textExtraction: 'rtf',
    reader: {
      renderer: 'text',
      actions: [...TEXT_READING_ACTIONS],
      search: 'text',
      print: 'rendered',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
  html: {
    kind: 'text',
    extensions: ['html', 'htm'],
    mimeTypes: ['text/html'],
    filePicker: true,
    textExtraction: 'html',
    reader: {
      renderer: 'text',
      actions: [...TEXT_READING_ACTIONS],
      search: 'text',
      print: 'rendered',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
  csv: {
    kind: 'sheet',
    extensions: ['csv'],
    mimeTypes: ['text/csv'],
    filePicker: true,
    textExtraction: 'spreadsheet',
    reader: {
      renderer: 'sheet',
      actions: [...RICH_READING_ACTIONS],
      search: 'text',
      print: 'rendered',
      printOrientation: 'landscape',
      ocr: false,
    },
  },
  xlsx: {
    kind: 'sheet',
    extensions: ['xlsx', 'xlsm'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel.sheet.macroenabled.12',
    ],
    mimeTypeByExtension: {
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12',
    },
    filePicker: true,
    textExtraction: 'spreadsheet',
    reader: {
      renderer: 'sheet',
      actions: [...RICH_READING_ACTIONS],
      search: 'text',
      print: 'rendered',
      printOrientation: 'landscape',
      ocr: false,
    },
  },
  xls: {
    kind: 'sheet',
    extensions: ['xls'],
    mimeTypes: ['application/vnd.ms-excel'],
    filePicker: true,
    textExtraction: 'spreadsheet',
    reader: {
      renderer: 'sheet',
      actions: [...RICH_READING_ACTIONS],
      search: 'text',
      print: 'rendered',
      printOrientation: 'landscape',
      ocr: false,
    },
  },
  docx: {
    kind: 'doc',
    extensions: ['docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    filePicker: true,
    textExtraction: 'docx',
    reader: {
      renderer: 'docx',
      actions: [...RICH_READING_ACTIONS],
      search: 'text',
      print: 'rendered',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
  doc: {
    kind: 'doc',
    extensions: ['doc'],
    mimeTypes: ['application/msword'],
    filePicker: true,
    textExtraction: 'none',
    reader: {
      renderer: 'download',
      actions: [],
      search: 'none',
      print: 'none',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
  pptx: {
    kind: 'presentation',
    extensions: ['pptx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    filePicker: true,
    textExtraction: 'pptx',
    reader: {
      renderer: 'presentation',
      actions: [...RICH_READING_ACTIONS],
      search: 'text',
      print: 'rendered',
      printOrientation: 'landscape',
      ocr: false,
    },
  },
  ppt: {
    kind: 'presentation',
    extensions: ['ppt'],
    mimeTypes: ['application/vnd.ms-powerpoint'],
    filePicker: true,
    textExtraction: 'none',
    reader: {
      renderer: 'download',
      actions: [],
      search: 'none',
      print: 'none',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
  epub: {
    kind: 'ebook',
    extensions: ['epub'],
    mimeTypes: ['application/epub+zip'],
    filePicker: true,
    textExtraction: 'epub',
    reader: {
      renderer: 'epub',
      actions: [...RICH_READING_ACTIONS],
      search: 'text',
      print: 'rendered',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
  fb2: {
    kind: 'ebook',
    extensions: ['fb2'],
    mimeTypes: ['application/x-fictionbook+xml'],
    filePicker: true,
    textExtraction: 'fb2',
    reader: {
      renderer: 'text',
      actions: [...TEXT_READING_ACTIONS],
      search: 'text',
      print: 'rendered',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
  pages: {
    kind: 'doc',
    extensions: ['pages'],
    mimeTypes: ['application/vnd.apple.pages'],
    filePicker: true,
    textExtraction: 'none',
    reader: {
      renderer: 'download',
      actions: [],
      search: 'none',
      print: 'none',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
  binary: {
    kind: 'binary',
    extensions: [],
    mimeTypes: [],
    filePicker: false,
    textExtraction: 'none',
    reader: {
      renderer: 'download',
      actions: [],
      search: 'none',
      print: 'none',
      printOrientation: 'portrait',
      ocr: false,
    },
  },
} as const satisfies Record<UserLibraryFileCapabilityId, UserLibraryFileCapability>;

const CAPABILITY_BY_MIME = new Map<string, UserLibraryFileCapability>();
const CAPABILITY_BY_EXTENSION = new Map<string, UserLibraryFileCapability>();

for (const capability of Object.values(USER_LIBRARY_FILE_CAPABILITIES)) {
  for (const mimeType of capability.mimeTypes) CAPABILITY_BY_MIME.set(mimeType, capability);
  for (const extension of capability.extensions) {
    CAPABILITY_BY_EXTENSION.set(extension, capability);
  }
}

export function userLibraryFileExtension(fileName: string): string {
  const lower = fileName.toLocaleLowerCase('ru-RU');
  if (lower.endsWith('.nii.gz')) return 'nii.gz';
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot + 1) : '';
}

export function userLibraryFileCapability(
  mimeType: string,
  fileName = '',
): UserLibraryFileCapability {
  return (
    CAPABILITY_BY_EXTENSION.get(userLibraryFileExtension(fileName)) ??
    CAPABILITY_BY_MIME.get(mimeType.toLocaleLowerCase('en-US')) ??
    USER_LIBRARY_FILE_CAPABILITIES.binary
  );
}

export function userLibraryFileMimeType(mimeType: string, fileName = ''): string {
  const extension = userLibraryFileExtension(fileName);
  const capability = userLibraryFileCapability(mimeType, fileName);
  return capability.mimeTypeByExtension?.[extension] ?? capability.mimeTypes[0] ?? mimeType;
}

export function userLibraryFilePickerCapabilities(): readonly UserLibraryFileCapability[] {
  return Object.values(USER_LIBRARY_FILE_CAPABILITIES).filter(
    (capability) => capability.filePicker,
  );
}
