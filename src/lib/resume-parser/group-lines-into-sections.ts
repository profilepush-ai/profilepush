import type { ResumeKey, Line, Lines, ResumeSectionToLines } from './types';
import {
  hasLetterAndIsAllUpperCase,
  hasOnlyLettersSpacesAmpersands,
  isBold,
} from './extract-resume-from-sections/lib/common-features';

const PROFILE_SECTION: ResumeKey = 'profile';

const SECTION_TITLE_KEYWORDS = [
  'experience', 'education', 'project', 'skill',
  'job', 'course', 'extracurricular', 'objective', 'summary', 'award', 'honor',
];

const isSectionTitle = (line: Line, lineNumber: number): boolean => {
  if (lineNumber < 2 || line.length > 1 || line.length === 0) return false;
  const textItem = line[0];
  if (isBold(textItem) && hasLetterAndIsAllUpperCase(textItem)) return true;
  const text = textItem.text.trim();
  const textHasAtMost2Words = text.split(' ').filter((s) => s !== '&').length <= 2;
  const startsWithCapitalLetter = /[A-Z]/.test(text.slice(0, 1));
  if (
    textHasAtMost2Words &&
    hasOnlyLettersSpacesAmpersands(textItem) &&
    startsWithCapitalLetter &&
    SECTION_TITLE_KEYWORDS.some((kw) => text.toLowerCase().includes(kw))
  ) {
    return true;
  }
  return false;
};

export const groupLinesIntoSections = (lines: Lines): ResumeSectionToLines => {
  const sections: ResumeSectionToLines = {};
  let sectionName: string = PROFILE_SECTION;
  let sectionLines: Lines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line[0]?.text.trim();
    if (isSectionTitle(line, i)) {
      sections[sectionName] = [...sectionLines];
      sectionName = text;
      sectionLines = [];
    } else {
      sectionLines.push(line);
    }
  }
  if (sectionLines.length > 0) {
    sections[sectionName] = [...sectionLines];
  }
  return sections;
};
