import { readPdf } from './read-pdf';
import { groupTextItemsIntoLines } from './group-text-items-into-lines';
import { groupLinesIntoSections } from './group-lines-into-sections';
import { extractResumeFromSections } from './extract-resume-from-sections';
import type { Resume } from './types';

export type { Resume };

export const parseResumeFromPdf = async (fileUrl: string): Promise<Resume> => {
  const textItems = await readPdf(fileUrl);
  const lines = groupTextItemsIntoLines(textItems);
  const sections = groupLinesIntoSections(lines);
  const resume = extractResumeFromSections(sections);
  return resume;
};
