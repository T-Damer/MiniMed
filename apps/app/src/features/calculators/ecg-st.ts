import { candidateRegions, pointsIn, rPeak, single } from './ecg-editor-numeric';
import { ECG_STANDARD_LEADS, type EcgLeadName } from './ecg-model-contract';
import {
  ECG_ST_CRITERIA,
  type EcgAdultAgeBand,
  type EcgContiguousGroup,
  type EcgSex,
  type EcgStCriteria,
} from './ecg-st-criteria';
import { type EcgEditorDraft, ecgCalibrationScale, ecgRegionLabel } from './ecgEditor';

export interface EcgLeadSt {
  readonly lead: EcgLeadName;
  /** ST level at the J point relative to the lead's isoelectric baseline, in mV. */
  readonly stMv: number;
  readonly rMv?: number;
  readonly sMv?: number;
  readonly tMv?: number;
  readonly region: string;
  readonly edited: boolean;
}

export interface EcgStMeasurement {
  readonly leads: readonly EcgLeadSt[];
  readonly missing: Partial<Record<EcgLeadName, string>>;
}

export interface EcgStFinding {
  readonly id: string;
  readonly severity: 'urgent' | 'review' | 'info';
  readonly text: string;
  readonly leads: readonly EcgLeadName[];
}

export interface EcgStEvaluation {
  readonly findings: readonly EcgStFinding[];
  readonly scope: string;
  readonly sources: EcgStCriteria['sources'];
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** Per-lead ST at the J point (the confirmed QRS end) from the editor's reviewed points. */
export function measureEcgStByLead(
  draft: EcgEditorDraft,
  measuredRegionId: string,
): EcgStMeasurement {
  const scale = ecgCalibrationScale(draft.calibration);
  const leads: EcgLeadSt[] = [];
  const missing: Partial<Record<EcgLeadName, string>> = {};
  for (const lead of ECG_STANDARD_LEADS) {
    if (!scale) {
      missing[lead] = 'нет подтверждённой калибровки';
      continue;
    }
    const regions = candidateRegions(draft, lead, measuredRegionId);
    if (!regions.length) {
      missing[lead] = `нет рамки отведения ${lead}`;
      continue;
    }
    let firstError: string | undefined;
    for (const region of regions) {
      const points = pointsIn(draft, region);
      const baseline = single(points, 'baseline');
      const j = single(points, 'qrsOffset');
      if (!baseline.point || !j.point) {
        firstError ??= `${ecgRegionLabel(region)}: ${baseline.error ?? j.error}`;
        continue;
      }
      const toMv = (y: number): number => round((baseline.point.y - y) / scale.y / scale.gain);
      const r = rPeak(points).point;
      const s = single(points, 'sPeak').point;
      const t = single(points, 'tPeak').point;
      leads.push({
        lead,
        stMv: toMv(j.point.y),
        ...(r ? { rMv: toMv(r.y) } : {}),
        ...(s ? { sMv: toMv(s.y) } : {}),
        ...(t ? { tMv: toMv(t.y) } : {}),
        region: ecgRegionLabel(region),
        edited: [baseline.point, j.point].some((p) => p.source === 'manual'),
      });
      firstError = undefined;
      break;
    }
    if (firstError) missing[lead] = firstError;
  }
  return { leads, missing };
}

/** Leads that satisfy a predicate in at least two contiguous leads of one declared group. */
function contiguousLeads(
  group: EcgContiguousGroup,
  matches: ReadonlySet<EcgLeadName>,
): readonly EcgLeadName[] {
  if (group.adjacency === 'any-pair') {
    const hit = group.leads.filter((lead) => matches.has(lead));
    return hit.length >= 2 ? hit : [];
  }
  const result = new Set<EcgLeadName>();
  group.leads.forEach((lead, index) => {
    const next = group.leads[index + 1];
    if (next && matches.has(lead) && matches.has(next)) {
      result.add(lead);
      result.add(next);
    }
  });
  return group.leads.filter((lead) => result.has(lead));
}

function formatMm(mv: number): string {
  return `${(mv * 10).toFixed(1).replace('.', ',')} мм`;
}

function describe(leads: readonly EcgLeadName[], values: ReadonlyMap<EcgLeadName, number>): string {
  return leads.map((lead) => `${lead} ${formatMm(values.get(lead) ?? 0)}`).join(', ');
}

/**
 * Applies the declared adult ST/T criteria to measured leads. Findings are review prompts, never a
 * diagnosis; a wide QRS suppresses automatic ST interpretation entirely.
 */
export function evaluateEcgSt(
  input: {
    readonly measurement: EcgStMeasurement;
    readonly sex?: EcgSex;
    readonly ageBand?: EcgAdultAgeBand;
    readonly qrsMs?: number;
  },
  criteria: EcgStCriteria = ECG_ST_CRITERIA,
): EcgStEvaluation {
  const findings: EcgStFinding[] = [];
  const st = new Map(input.measurement.leads.map((lead) => [lead.lead, lead.stMv]));
  const missingLeads = ECG_STANDARD_LEADS.filter((lead) => input.measurement.missing[lead]);
  const withMissing = (): EcgStEvaluation => {
    if (missingLeads.length)
      findings.push({
        id: 'st-missing',
        severity: 'info',
        text: criteria.texts.missing.replace('{leads}', missingLeads.join(', ')),
        leads: missingLeads,
      });
    return { findings, scope: criteria.texts.scope, sources: criteria.sources };
  };

  if (input.qrsMs !== undefined && input.qrsMs >= criteria.wideQrsMs) {
    findings.push({
      id: 'st-wide-qrs',
      severity: 'review',
      text: criteria.texts.wideQrs.replace('{qrs}', String(Math.round(input.qrsMs))),
      leads: [],
    });
    return withMissing();
  }

  const special = criteria.elevation.specialCutPoints.find(
    (cut) => cut.sex === input.sex && (cut.ageBand === undefined || cut.ageBand === input.ageBand),
  );
  const lowest = Math.min(...criteria.elevation.specialCutPoints.map((cut) => cut.thresholdMv));
  const threshold = (lead: EcgLeadName): number =>
    criteria.elevation.specialLeads.includes(lead)
      ? (special?.thresholdMv ?? lowest)
      : criteria.elevation.defaultThresholdMv;
  const elevated = new Set(
    input.measurement.leads
      .filter((lead) => lead.stMv >= threshold(lead.lead) - 1e-9)
      .map((lead) => lead.lead),
  );
  const depressed = new Set(
    input.measurement.leads
      .filter((lead) => lead.stMv <= criteria.depressionThresholdMv + 1e-9)
      .map((lead) => lead.lead),
  );
  const tInverted = new Set(
    input.measurement.leads
      .filter(
        (lead) =>
          lead.tMv !== undefined &&
          lead.tMv < criteria.tInversion.thresholdMv &&
          lead.rMv !== undefined &&
          lead.sMv !== undefined &&
          lead.rMv > criteria.tInversion.minimumRToS * Math.abs(lead.sMv),
      )
      .map((lead) => lead.lead),
  );

  const byGroup = (matches: ReadonlySet<EcgLeadName>) =>
    new Map(criteria.contiguousGroups.map((group) => [group.id, contiguousLeads(group, matches)]));
  const elevatedGroups = byGroup(elevated);
  const elevationLeads = [...elevatedGroups.values()].flat();
  if (elevationLeads.length) {
    const usesSpecial = elevationLeads.some((lead) =>
      criteria.elevation.specialLeads.includes(lead),
    );
    findings.push({
      id: 'st-elevation',
      severity: 'urgent',
      text: `${criteria.texts.elevation.replace('{leads}', describe(elevationLeads, st))}${
        usesSpecial && !special ? ` ${criteria.texts.elevationLowestCutPoint}` : ''
      }`,
      leads: elevationLeads,
    });
  }

  const depressionLeads = [...byGroup(depressed).values()].flat();
  if (depressionLeads.length)
    findings.push({
      id: 'st-depression',
      severity: 'review',
      text: criteria.texts.depression.replace('{leads}', describe(depressionLeads, st)),
      leads: depressionLeads,
    });

  for (const pair of criteria.reciprocal) {
    const up = elevatedGroups.get(pair.elevated) ?? [];
    const downGroup = criteria.contiguousGroups.find((group) => group.id === pair.depressed);
    const down = downGroup?.leads.filter((lead) => depressed.has(lead)) ?? [];
    if (up.length && down.length)
      findings.push({
        id: `st-reciprocal-${pair.elevated}-${pair.depressed}`,
        severity: 'review',
        text: criteria.texts.reciprocal
          .replace('{depressed}', describe(down, st))
          .replace('{elevated}', up.join(', ')),
        leads: [...up, ...down],
      });
  }

  const tLeads = [...byGroup(tInverted).values()].flat();
  if (tLeads.length) {
    const t = new Map(input.measurement.leads.map((lead) => [lead.lead, lead.tMv ?? 0]));
    findings.push({
      id: 't-inversion',
      severity: 'review',
      text: criteria.texts.tInversion.replace('{leads}', describe(tLeads, t)),
      leads: tLeads,
    });
  }
  return withMissing();
}
