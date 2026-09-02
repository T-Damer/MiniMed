import type { MedicalDocument } from '@localmed/contracts';

export interface MedicationPackage {
  readonly description: string;
  readonly prescriptionStatus: string | null;
}

export interface MedicationPresentation {
  readonly dosageForm: string;
  readonly strength: string | null;
  readonly route: string | null;
  readonly packages: readonly MedicationPackage[];
}

export interface MedicationProduct {
  readonly sourceKind: 'allmed' | 'esklp' | 'grls';
  readonly registrationDocumentId: string;
  readonly grlsRegistrationDocumentId: string | null;
  readonly instructionDocumentId: string | null;
  readonly mnnDocumentId: string | null;
  readonly linkedMnnDocumentId: string | null;
  readonly smnnCode: string | null;
  readonly smnnCodes: readonly string[];
  readonly klpCodes: readonly string[];
  readonly registrationNumber: string;
  readonly tradeName: string;
  readonly inn: string;
  readonly imageReference?: string;
  readonly shortDescription: string | null;
  readonly supplementalDescription: string | null;
  readonly registrationStatus: string;
  readonly prescriptionStatus: string | null;
  readonly holder: string | null;
  readonly manufacturer: string | null;
  readonly registrationDate: string | null;
  readonly pharmacotherapeuticGroups: readonly string[];
  readonly presentations: readonly MedicationPresentation[];
}

interface MedicationMetadata extends Readonly<Record<string, unknown>> {
  readonly contentMode?: unknown;
  readonly registrationNumber?: unknown;
  readonly tradeName?: unknown;
  readonly inn?: unknown;
  readonly registrationStatus?: unknown;
  readonly prescriptionStatus?: unknown;
  readonly holder?: unknown;
  readonly manufacturer?: unknown;
  readonly registrationDate?: unknown;
  readonly sourceReviewedAt?: unknown;
  readonly pharmacotherapeuticGroups?: unknown;
  readonly presentations?: unknown;
  readonly description?: unknown;
  readonly shortDescription?: unknown;
  readonly dosageForm?: unknown;
  readonly strength?: unknown;
  readonly route?: unknown;
  readonly packages?: unknown;
  readonly allmedId?: unknown;
  readonly nameLat?: unknown;
  readonly productionForm?: unknown;
  readonly mnnDocumentId?: unknown;
  readonly linkedMnnDocumentId?: unknown;
  readonly smnnCode?: unknown;
  readonly smnnCodes?: unknown;
  readonly standardizedInn?: unknown;
  readonly smnnNodes?: unknown;
  readonly klpCodes?: unknown;
  readonly img?: unknown;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.flatMap((item) => stringValue(item) ?? []) : [];
}

function parsePackages(value: unknown): readonly MedicationPackage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const row = item as MedicationMetadata;
    const description = stringValue(row.description);
    if (!description) return [];
    return [{ description, prescriptionStatus: stringValue(row.prescriptionStatus) }];
  });
}

function parsePresentations(value: unknown): readonly MedicationPresentation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const row = item as MedicationMetadata;
    const dosageForm = stringValue(row.dosageForm);
    if (!dosageForm) return [];
    return [
      {
        dosageForm,
        strength: stringValue(row.strength),
        route: stringValue(row.route),
        packages: parsePackages(row.packages),
      },
    ];
  });
}

type MedicationRecord = Readonly<Record<string, unknown>>;

function recordValue(value: unknown): MedicationRecord | null {
  return typeof value === 'object' && value !== null ? (value as MedicationRecord) : null;
}

function scalarStringValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return stringValue(value);
}

function scalarStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => scalarStringValue(item) ?? []);
}

function identifierList(values: unknown, singleValue: unknown): readonly string[] {
  const single = scalarStringValue(singleValue);
  return [...new Set([...scalarStringList(values), ...(single ? [single] : [])])];
}

function recordString(record: MedicationRecord, key: string): string | null {
  return scalarStringValue(record[key]);
}

function recordField(record: MedicationRecord, key: string): unknown {
  return record[key];
}

function recordList(value: unknown): readonly MedicationRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = recordValue(item);
    return record ? [record] : [];
  });
}

function normalizedIdentity(value: string | null): string {
  return (value ?? '').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
}

export function safePackagingImageReference(value: unknown): string | null {
  const reference = stringValue(value);
  if (
    !reference ||
    reference.length > 2048 ||
    !reference.startsWith('img/preparations/') ||
    reference.startsWith('/') ||
    reference.includes('\\') ||
    reference.includes('://') ||
    reference.includes('?') ||
    reference.includes('#')
  ) {
    return null;
  }
  const parts = reference.split('/');
  if (
    parts.some(
      (part) =>
        part.length === 0 ||
        part === '.' ||
        part === '..' ||
        [...part].some((character) => character < ' ' || character === '\u007f'),
    )
  ) {
    return null;
  }
  return reference;
}

function normalizedStrength(value: string | null): string {
  return normalizedIdentity(value).replace(/\d+(?:[.,]\d+)?/gu, (number) => {
    const normalized = Number(number.replace(',', '.'));
    return Number.isFinite(normalized) ? String(normalized) : number;
  });
}

interface EsklpVariant {
  readonly tradeName: string;
  readonly registrationNumber: string;
  readonly smnnCode: string;
  readonly dosageForm: string;
  readonly strength: string | null;
  readonly pharmacotherapeuticGroup: string | null;
  readonly registrationStatus: string;
  readonly prescriptionStatus: string | null;
  holder: string | null;
  manufacturer: string | null;
  readonly registrationDate: string | null;
  readonly instructionDocumentId: string | null;
  readonly klpCodes: Set<string>;
  readonly packages: Map<string, MedicationPackage>;
}

function esklpVariantKey(
  smnnCode: string,
  tradeName: string,
  registrationNumber: string,
  dosageForm: string,
  strength: string | null,
): string {
  return [smnnCode, tradeName, registrationNumber, dosageForm, strength]
    .map(normalizedIdentity)
    .join('\u001f');
}

function esklpBaseKey(tradeName: string, registrationNumber: string, dosageForm: string): string {
  return [tradeName, registrationNumber, dosageForm].map(normalizedIdentity).join('\u001f');
}

function esklpKlpMatchesVariant(position: MedicationRecord, variant: EsklpVariant): boolean {
  const tradeName = recordString(position, 'tradeName');
  const registrationNumber = recordString(position, 'registrationNumber');
  const dosageForm = recordString(position, 'dosageForm');
  if (
    normalizedIdentity(tradeName) !== normalizedIdentity(variant.tradeName) ||
    normalizedIdentity(registrationNumber) !== normalizedIdentity(variant.registrationNumber) ||
    normalizedIdentity(dosageForm) !== normalizedIdentity(variant.dosageForm)
  ) {
    return false;
  }
  const strength = recordString(position, 'strength');
  return (
    (strength === null && variant.strength === null) ||
    (strength !== null &&
      variant.strength !== null &&
      normalizedStrength(strength) === normalizedStrength(variant.strength))
  );
}

function esklpPackageDescription(position: MedicationRecord, fallback: string): string {
  const parts = [
    recordString(position, 'primaryPackage'),
    recordString(position, 'secondaryPackage'),
    recordString(position, 'packageContents'),
    recordString(position, 'unitCount'),
    recordString(position, 'unit'),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : fallback;
}

function addEsklpKlpPosition(variant: EsklpVariant, position: MedicationRecord): void {
  const klpCode = recordString(position, 'klpCode');
  if (klpCode) variant.klpCodes.add(klpCode);
  const holder = recordString(position, 'holder');
  if (holder && !variant.holder) variant.holder = holder;
  const manufacturer = recordString(position, 'manufacturer');
  if (manufacturer && !variant.manufacturer) variant.manufacturer = manufacturer;
  const description = esklpPackageDescription(position, variant.dosageForm);
  if (!variant.packages.has(description)) {
    variant.packages.set(description, {
      description,
      prescriptionStatus: recordString(position, 'prescriptionStatus'),
    });
  }
}

export function parseEsklpMedicationProducts(
  document: MedicalDocument,
  instructions: ReadonlyMap<string, string> = new Map(),
): readonly MedicationProduct[] {
  const metadata = document.metadata as MedicationMetadata;
  if (metadata.contentMode !== 'esklp-mnn') return [];

  const inn =
    stringValue(metadata.standardizedInn) ??
    stringList(metadata.inn)[0] ??
    stringValue(document.shortTitle) ??
    document.title.split('—')[0]?.trim() ??
    document.title.trim();
  if (!inn) return [];

  const nodes = recordList(metadata.smnnNodes);
  const variants = new Map<string, EsklpVariant>();
  const registrationStatus = stringValue(metadata.registrationStatus) ?? 'Государственный реестр';

  for (const node of nodes) {
    const smnnCode = recordString(node, 'smnnCode');
    if (!smnnCode) continue;
    const nodeDosageForm = recordString(node, 'dosageForm');
    const nodeStrength = recordString(node, 'strength');
    const pharmacotherapeuticGroup = recordString(node, 'pharmacotherapeuticGroup');
    const tradeNames = recordList(recordField(node, 'tradeNames'));
    const klpPositions = recordList(recordField(node, 'klpPositions'));
    const nodeVariants = new Map<string, EsklpVariant[]>();

    for (const trade of tradeNames) {
      const tradeName = recordString(trade, 'tradeName');
      const registrationNumber = recordString(trade, 'registrationNumber');
      const dosageForm = recordString(trade, 'dosageForm') ?? nodeDosageForm;
      const strength = recordString(trade, 'strength') ?? nodeStrength;
      if (!tradeName || !registrationNumber || !dosageForm) continue;
      const key = esklpVariantKey(smnnCode, tradeName, registrationNumber, dosageForm, strength);
      let variant = variants.get(key);
      if (!variant) {
        variant = {
          tradeName,
          registrationNumber,
          smnnCode,
          dosageForm,
          strength,
          pharmacotherapeuticGroup,
          registrationStatus,
          prescriptionStatus: recordString(trade, 'prescriptionStatus'),
          holder: null,
          manufacturer: null,
          registrationDate: recordString(trade, 'registrationDate'),
          instructionDocumentId:
            recordString(trade, 'instructionDocumentId') ??
            instructions.get(registrationNumber) ??
            null,
          klpCodes: new Set(),
          packages: new Map(),
        };
        variants.set(key, variant);
      }
      const baseKey = esklpBaseKey(tradeName, registrationNumber, dosageForm);
      const baseVariants = nodeVariants.get(baseKey) ?? [];
      if (!baseVariants.includes(variant)) baseVariants.push(variant);
      nodeVariants.set(baseKey, baseVariants);
    }

    for (const position of klpPositions) {
      const tradeName = recordString(position, 'tradeName');
      const registrationNumber = recordString(position, 'registrationNumber');
      const dosageForm = recordString(position, 'dosageForm');
      if (!tradeName || !registrationNumber || !dosageForm) continue;
      const candidates = nodeVariants.get(esklpBaseKey(tradeName, registrationNumber, dosageForm));
      if (!candidates || candidates.length === 0) continue;
      const exact = candidates.find((candidate) => esklpKlpMatchesVariant(position, candidate));
      const base = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (!base) continue;
      addEsklpKlpPosition(base, position);
    }
  }

  return [...variants.values()].map((variant) => ({
    sourceKind: 'esklp',
    registrationDocumentId: document.id,
    grlsRegistrationDocumentId: null,
    instructionDocumentId: variant.instructionDocumentId,
    mnnDocumentId: document.id,
    linkedMnnDocumentId: null,
    smnnCode: variant.smnnCode,
    smnnCodes: [variant.smnnCode],
    klpCodes: [...variant.klpCodes],
    registrationNumber: variant.registrationNumber,
    tradeName: variant.tradeName,
    inn,
    shortDescription: null,
    supplementalDescription: null,
    registrationStatus: variant.registrationStatus,
    prescriptionStatus: variant.prescriptionStatus,
    holder: variant.holder,
    manufacturer: variant.manufacturer,
    registrationDate: variant.registrationDate,
    pharmacotherapeuticGroups: variant.pharmacotherapeuticGroup
      ? [variant.pharmacotherapeuticGroup]
      : [],
    presentations: [
      {
        dosageForm: variant.dosageForm,
        strength: variant.strength,
        route: null,
        packages:
          variant.packages.size > 0
            ? [...variant.packages.values()]
            : [{ description: variant.dosageForm, prescriptionStatus: variant.prescriptionStatus }],
      },
    ],
  }));
}

export function mergeAllmedSupplementalText(
  product: MedicationProduct,
  supplements: readonly MedicationProduct[],
): MedicationProduct {
  if (product.sourceKind === 'allmed' || !product.mnnDocumentId) return product;
  const texts = supplements
    .filter(
      (supplement) =>
        supplement.sourceKind === 'allmed' &&
        supplement.linkedMnnDocumentId === product.mnnDocumentId &&
        normalizedIdentity(supplement.tradeName) === normalizedIdentity(product.tradeName),
    )
    .map((supplement) => supplement.shortDescription)
    .filter((text): text is string => Boolean(text));
  const imageReference = supplements.find(
    (supplement) =>
      supplement.sourceKind === 'allmed' &&
      supplement.linkedMnnDocumentId === product.mnnDocumentId &&
      normalizedIdentity(supplement.tradeName) === normalizedIdentity(product.tradeName) &&
      supplement.imageReference,
  )?.imageReference;
  if (texts.length === 0 && !imageReference) return product;
  return {
    ...product,
    ...(texts.length > 0 ? { supplementalDescription: [...new Set(texts)].join('\n\n') } : {}),
    ...(imageReference ? { imageReference } : {}),
  };
}

function sameMedicationRegistration(esklp: MedicationProduct, grls: MedicationProduct): boolean {
  if (
    esklp.sourceKind !== 'esklp' ||
    grls.sourceKind !== 'grls' ||
    !esklp.mnnDocumentId ||
    esklp.mnnDocumentId !== grls.mnnDocumentId ||
    normalizedIdentity(esklp.registrationNumber) !== normalizedIdentity(grls.registrationNumber) ||
    normalizedIdentity(esklp.tradeName) !== normalizedIdentity(grls.tradeName)
  ) {
    return false;
  }
  if (esklp.smnnCodes.length === 0 || grls.smnnCodes.length === 0) return true;
  const grlsCodes = new Set(grls.smnnCodes);
  return esklp.smnnCodes.some((code) => grlsCodes.has(code));
}

function mergeGrlsRegistration(
  esklp: MedicationProduct,
  grls: MedicationProduct,
): MedicationProduct {
  return {
    ...esklp,
    grlsRegistrationDocumentId: grls.registrationDocumentId,
    instructionDocumentId: grls.instructionDocumentId ?? esklp.instructionDocumentId,
    registrationStatus: grls.registrationStatus,
    prescriptionStatus: grls.prescriptionStatus ?? esklp.prescriptionStatus,
    holder: grls.holder ?? esklp.holder,
    manufacturer: grls.manufacturer ?? esklp.manufacturer,
    registrationDate: grls.registrationDate ?? esklp.registrationDate,
    pharmacotherapeuticGroups: [
      ...new Set([...esklp.pharmacotherapeuticGroups, ...grls.pharmacotherapeuticGroups]),
    ],
  };
}

export function composeMedicationProducts(
  registryProducts: readonly MedicationProduct[],
  allmedProducts: readonly MedicationProduct[],
): readonly MedicationProduct[] {
  const esklpProducts = registryProducts.filter((product) => product.sourceKind === 'esklp');
  const grlsProducts = registryProducts.filter((product) => product.sourceKind === 'grls');
  const consumedGrls = new Set<MedicationProduct>();
  const unified = esklpProducts.map((esklp) => {
    const matches = grlsProducts.filter((grls) => sameMedicationRegistration(esklp, grls));
    if (matches.length !== 1) return esklp;
    const grls = matches[0];
    if (!grls) return esklp;
    consumedGrls.add(grls);
    return mergeGrlsRegistration(esklp, grls);
  });
  const registry = [
    ...unified,
    ...grlsProducts.filter((product) => !consumedGrls.has(product)),
  ].map((product) => mergeAllmedSupplementalText(product, allmedProducts));
  const registryMnnIds = new Set(
    registry
      .map((product) => product.mnnDocumentId)
      .filter((documentId): documentId is string => Boolean(documentId)),
  );
  const standaloneAllmed = allmedProducts.filter(
    (product) => !product.linkedMnnDocumentId || !registryMnnIds.has(product.linkedMnnDocumentId),
  );
  return [...registry, ...standaloneAllmed];
}

function parseSourceLinkedRegistryProduct(
  document: MedicalDocument,
  instructionDocumentId: string | null,
): MedicationProduct | null {
  const metadata = document.metadata as MedicationMetadata;
  const registrationNumber = stringValue(metadata.registrationNumber);
  if (!registrationNumber) return null;
  const title = document.shortTitle?.trim() || document.title;
  const separator = title.indexOf('—');
  const tradeName = (separator >= 0 ? title.slice(0, separator) : title).trim();
  const form = (separator >= 0 ? title.slice(separator + 1) : '').trim();
  if (!tradeName) return null;
  const dosageForm = form || 'Форма не указана';
  return {
    sourceKind: 'grls',
    registrationDocumentId: document.id,
    grlsRegistrationDocumentId: document.id,
    instructionDocumentId,
    mnnDocumentId: stringValue(metadata.mnnDocumentId),
    linkedMnnDocumentId: null,
    smnnCode: stringValue(metadata.smnnCode),
    smnnCodes: identifierList(metadata.smnnCodes, metadata.smnnCode),
    klpCodes: scalarStringList(metadata.klpCodes),
    registrationNumber,
    tradeName,
    inn: stringValue(metadata.inn) ?? tradeName,
    shortDescription: stringValue(metadata.description),
    supplementalDescription: null,
    registrationStatus: stringValue(metadata.registrationStatus) ?? 'Государственный реестр',
    prescriptionStatus: stringValue(metadata.prescriptionStatus),
    holder: stringValue(metadata.holder),
    manufacturer: stringValue(metadata.manufacturer),
    registrationDate:
      stringValue(metadata.registrationDate) ?? stringValue(metadata.sourceReviewedAt),
    pharmacotherapeuticGroups: stringList(metadata.pharmacotherapeuticGroups),
    presentations: [
      {
        dosageForm,
        strength: stringValue(metadata.strength),
        route: stringValue(metadata.route),
        packages: [{ description: dosageForm, prescriptionStatus: null }],
      },
    ],
  };
}

export function parseMedicationProduct(
  document: MedicalDocument,
  instructionDocumentId: string | null,
): MedicationProduct | null {
  const metadata = document.metadata as MedicationMetadata;
  if (metadata.contentMode === 'registry-normalized') {
    const registrationNumber = stringValue(metadata.registrationNumber);
    const tradeName = stringValue(metadata.tradeName);
    const inn = stringValue(metadata.inn);
    const registrationStatus = stringValue(metadata.registrationStatus);
    const presentations = parsePresentations(metadata.presentations);
    if (!registrationNumber || !tradeName || !inn || !registrationStatus || !presentations.length) {
      return null;
    }
    return {
      sourceKind: 'grls',
      registrationDocumentId: document.id,
      grlsRegistrationDocumentId: document.id,
      instructionDocumentId,
      mnnDocumentId: stringValue(metadata.mnnDocumentId),
      linkedMnnDocumentId: null,
      smnnCode: stringValue(metadata.smnnCode),
      smnnCodes: identifierList(metadata.smnnCodes, metadata.smnnCode),
      klpCodes: scalarStringList(metadata.klpCodes),
      registrationNumber,
      tradeName,
      inn,
      shortDescription: stringValue(metadata.description),
      supplementalDescription: null,
      registrationStatus,
      prescriptionStatus: stringValue(metadata.prescriptionStatus),
      holder: stringValue(metadata.holder),
      manufacturer: stringValue(metadata.manufacturer),
      registrationDate: stringValue(metadata.registrationDate),
      pharmacotherapeuticGroups: stringList(metadata.pharmacotherapeuticGroups),
      presentations,
    };
  }
  if (document.sourceType === 'official_registry_summary') {
    return parseSourceLinkedRegistryProduct(document, instructionDocumentId);
  }
  return null;
}

export function parseAllmedMedicationProduct(document: MedicalDocument): MedicationProduct | null {
  const metadata = document.metadata as MedicationMetadata;
  if (document.sourceType !== 'allmed_reference' || metadata.contentMode !== 'allmed-snapshot') {
    return null;
  }
  const allmedId = typeof metadata.allmedId === 'number' ? metadata.allmedId : null;
  const tradeName = stringValue(document.title);
  if (allmedId === null || !tradeName) return null;
  const dosageForm = stringValue(metadata.productionForm) ?? 'Не указана';
  const imageReference = safePackagingImageReference(metadata.img);
  return {
    sourceKind: 'allmed',
    registrationDocumentId: document.id,
    grlsRegistrationDocumentId: null,
    instructionDocumentId: document.id,
    mnnDocumentId: null,
    linkedMnnDocumentId: stringValue(metadata.linkedMnnDocumentId),
    smnnCode: null,
    smnnCodes: [],
    klpCodes: [],
    registrationNumber: `allmed:${allmedId}`,
    tradeName,
    inn: stringValue(metadata.nameLat) ?? 'Не указано',
    ...(imageReference ? { imageReference } : {}),
    shortDescription: stringValue(metadata.shortDescription) ?? stringValue(metadata.description),
    supplementalDescription: null,
    registrationStatus: 'Справочник Allmed',
    prescriptionStatus: null,
    holder: null,
    manufacturer: null,
    registrationDate: null,
    pharmacotherapeuticGroups: [],
    presentations: [
      {
        dosageForm,
        strength: null,
        route: null,
        packages: [{ description: dosageForm, prescriptionStatus: null }],
      },
    ],
  };
}

export interface TradeNameSupplement {
  readonly document: MedicalDocument;
  readonly product: MedicationProduct;
}

export function parseTradeNameSupplement(document: MedicalDocument): TradeNameSupplement | null {
  const product = parseAllmedMedicationProduct(document);
  return product ? { document, product } : null;
}

export function medicationDocumentRegistration(document: MedicalDocument): string | null {
  return stringValue((document.metadata as MedicationMetadata).registrationNumber);
}

export function readableMedicationDocumentId(product: MedicationProduct): string | null {
  return (
    product.mnnDocumentId ?? product.instructionDocumentId ?? product.registrationDocumentId ?? null
  );
}
