import type { FieldDetectionResult } from './field-detector.js';

export type FieldSpec = {
  name: string;
  detection: 'phone' | 'email' | 'date' | 'heading' | 'image' | 'link' | 'manual';
  alwaysWarn?: boolean;
  warnMessage?: string;
};

const FIELDS: Record<string, FieldSpec[]> = {
  representatives: [
    { name: 'externalId', detection: 'manual', alwaysWarn: true, warnMessage: 'NOT inferrable; add explicit construction rule to contentGoal' },
    { name: 'name', detection: 'heading' },
    { name: 'district', detection: 'heading' },
    { name: 'phone', detection: 'phone' },
    { name: 'email', detection: 'email' },
    { name: 'photoUrl', detection: 'image' },
    { name: 'detailUrl', detection: 'link' },
  ],
  meetings: [
    { name: 'externalId', detection: 'manual', alwaysWarn: true, warnMessage: 'NOT inferrable; add explicit construction rule to contentGoal' },
    { name: 'title', detection: 'heading' },
    { name: 'scheduledAt', detection: 'date' },
    { name: 'location', detection: 'manual', warnMessage: 'usually in page text; add hint to contentGoal' },
    { name: 'agendaUrl', detection: 'link' },
    { name: 'minutesUrl', detection: 'link' },
  ],
  propositions: [
    { name: 'externalId', detection: 'manual', alwaysWarn: true, warnMessage: 'NOT inferrable; add explicit construction rule to contentGoal' },
    { name: 'title', detection: 'heading' },
    { name: 'electionDate', detection: 'date' },
    { name: 'measureType', detection: 'manual', warnMessage: 'must be described in contentGoal' },
    { name: 'description', detection: 'manual', warnMessage: 'must be described in contentGoal' },
  ],
  campaign_finance: [
    { name: 'committeeId', detection: 'manual', alwaysWarn: true, warnMessage: 'NOT inferrable; add explicit construction rule to contentGoal' },
    { name: 'committeeName', detection: 'heading' },
    { name: 'filingDate', detection: 'date' },
    { name: 'totalContributions', detection: 'manual', warnMessage: 'usually a currency value on the page' },
    { name: 'totalExpenditures', detection: 'manual', warnMessage: 'usually a currency value on the page' },
  ],
  lobbying: [
    { name: 'externalId', detection: 'manual', alwaysWarn: true, warnMessage: 'NOT inferrable; add explicit construction rule to contentGoal' },
    { name: 'lobbyist', detection: 'heading' },
    { name: 'employer', detection: 'manual', warnMessage: 'usually in page text; add hint to contentGoal' },
    { name: 'periodStart', detection: 'date' },
    { name: 'periodEnd', detection: 'date' },
    { name: 'totalCompensation', detection: 'manual', warnMessage: 'usually a currency value on the page' },
  ],
  civics: [
    { name: 'title', detection: 'heading' },
    { name: 'content', detection: 'manual', warnMessage: 'describe the content structure in contentGoal' },
  ],
  bills: [
    { name: 'externalId', detection: 'manual', alwaysWarn: true, warnMessage: 'NOT inferrable; add explicit construction rule to contentGoal' },
    { name: 'billNumber', detection: 'heading' },
    { name: 'title', detection: 'heading' },
    { name: 'status', detection: 'manual', warnMessage: 'usually in page text; add hint to contentGoal' },
    { name: 'author', detection: 'manual', warnMessage: 'usually in page text; add hint to contentGoal' },
  ],
};

export function getRequiredFields(dataType: string): FieldSpec[] {
  return FIELDS[dataType] ?? [];
}

function checkImageField(detection: FieldDetectionResult): { ok: boolean; note: string } {
  if (detection.imageCount === 0) return { ok: false, note: 'no images found on page' };
  if (detection.hasRelativeImages) return { ok: false, note: 'relative URLs found; add absolutization hint to hints[]' };
  return { ok: true, note: `${detection.imageCount} image(s) found` };
}

export function checkFieldDetection(
  field: FieldSpec,
  detection: FieldDetectionResult,
): { ok: boolean; note: string } {
  if (field.alwaysWarn) {
    return { ok: false, note: field.warnMessage ?? 'requires manual configuration' };
  }

  switch (field.detection) {
    case 'phone':
      return detection.detectedPhone
        ? { ok: true, note: detection.detectedPhone }
        : { ok: false, note: 'no phone pattern found on page' };
    case 'email':
      return detection.detectedEmail
        ? { ok: true, note: detection.detectedEmail }
        : { ok: false, note: 'no email pattern found on page' };
    case 'date':
      return detection.detectedDates.length > 0
        ? { ok: true, note: detection.detectedDates[0] }
        : { ok: false, note: 'no date patterns found on page' };
    case 'heading':
      return detection.headings.length > 0
        ? { ok: true, note: 'found in heading structure' }
        : { ok: false, note: 'no headings found on page' };
    case 'image':
      return checkImageField(detection);
    case 'link':
      return detection.linkCount > 0
        ? { ok: true, note: `${detection.linkCount} link(s) found` }
        : { ok: false, note: 'no links found on page' };
    default:
      return { ok: false, note: field.warnMessage ?? 'requires manual configuration' };
  }
}
