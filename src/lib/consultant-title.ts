// Hotlists never show who the consultant is. Some posts put the consultant's
// name where the role goes ("Name: Tejaswi P", "Ravi Kumar"), so every
// hotlist title shown in the app goes through here: a title that reads as a
// person's name becomes "Available Consultant".

const ROLE_WORDS = /\b(developer|engineer|engineering|analyst|architect|architecture|manager|admin|administrator|lead|consultant|tester|qa|sdet|devops|mlops|sre|dba|sap|salesforce|java|python|net|dotnet|data|cloud|aws|azure|gcp|scrum|master|product|project|business|ba|bi|etl|full\s*stack|front\s*end|back\s*end|ui|ux|designer|specialist|support|security|cybersecurity|network|oracle|sql|mainframe|tableau|power\s*bi|react|angular|node|mobile|ios|android|ai|ml|aiml|genai|scientist|recruiter|coordinator|director|officer|technician|programmer|automation|guidewire|workday|servicenow|service\s*now|peoplesoft|snowflake|informatica|hadoop|spark|kafka|golang|ruby|php|sharepoint|dynamics|crm|erp|hr|payroll|finance|accountant|operations|it|devsecops|platform|system|software|application|integration|testing|performance|cyber|identity|iam|infrastructure|linux|unix|windows|vmware|citrix|embedded|firmware|hardware|electrical|mechanical|civil|structural|manufacturing|controls|healthcare|clinical|medical|pharma|validation|epic|cerner|pega|appian|mulesoft|tibco|webmethods|abap|fico|hana|basis|cobol|db2|jcl|qlik|looker|alteryx|sas|matlab|blockchain|web|stack|ocm|professional|profile|team|partner|staffing|development|hotlist|consultants?|senior|sr|jr|junior|mid|principal|staff|technical|tech|level|kind|other|all|updated|resource|candidate|bench|available|openings?)s?\b/i;

export function looksLikePersonName(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (/^(name|candidate(\s+name)?|consultant\s+name)\s*[:\-]/i.test(t)) return true;
  if (/[0-9@+#/()&]/.test(t)) return false;
  if (ROLE_WORDS.test(t)) return false;
  // Two to four words, letters only (initials allowed): reads as a name.
  const words = t.replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z'-]*$/.test(w));
}

export function consultantTitle(title: string | null | undefined, fallback = 'Available Consultant'): string {
  const t = (title ?? '').trim();
  return !t || looksLikePersonName(t) ? fallback : t;
}
