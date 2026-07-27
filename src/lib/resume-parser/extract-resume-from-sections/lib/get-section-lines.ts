import type { ResumeSectionToLines, Lines } from '../../types';

export const getSectionLinesByKeywords = (
  sections: ResumeSectionToLines,
  keywords: string[]
): Lines => {
  for (const sectionName of Object.keys(sections)) {
    const lower = sectionName.toLowerCase();
    if (keywords.some((kw) => lower.includes(kw))) {
      return sections[sectionName] ?? [];
    }
  }
  return [];
};
