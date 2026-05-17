export function buildStructuralPrompt(
  url: string,
  dataType: string,
  requiredFields: string[],
  html: string,
): string {
  return `You are an expert at web scraping and data extraction. Analyze the HTML below and return extraction guidance.

URL: ${url}
Data type to extract: ${dataType}
Required fields: ${requiredFields.join(', ')}

HTML:
${html}

Return ONLY valid JSON with these exact keys — no markdown fences, no explanation:
{
  "pageType": "detail" or "listing",
  "contentGoal": "one clear sentence naming every field to extract and any construction rules",
  "hints": ["up to 5 specific observations about HTML structure — class names, element patterns, selectors"],
  "detectedFields": {
    "fieldName": {
      "cssSelector": "CSS selector string",
      "evidence": "short text snippet from HTML confirming the field",
      "confidence": "high" or "medium" or "low"
    }
  }
}

Rules:
- pageType "listing" = multiple records in a list or table; "detail" = single record page
- contentGoal must name specific fields from the required list
- hints must reference actual class names or HTML structure you observe
- detectedFields: only include fields where you found evidence in the HTML
- externalId: always set confidence "low" and evidence "requires explicit construction rule in contentGoal"
- If images have relative URLs: note "add absolutization hint" in that field's evidence
- Return 3–5 hints maximum`;
}
