import type { FeatureSet, ResumeSectionToLines, ResumeProject } from '../../types';
import { getSectionLinesByKeywords } from './lib/get-section-lines';
import { DATE_FEATURE_SETS, getHasText, isBold } from './lib/common-features';
import { divideSectionIntoSubsections } from './lib/subsections';
import { getTextWithHighestFeatureScore } from './lib/feature-scoring-system';
import { getBulletPointsFromLines, getDescriptionsLineIdx } from './lib/bullet-points';

export const extractProject = (sections: ResumeSectionToLines) => {
  const projects: ResumeProject[] = [];
  const lines = getSectionLinesByKeywords(sections, ['project']);
  const subsections = divideSectionIntoSubsections(lines);
  for (const subsectionLines of subsections) {
    const descriptionsLineIdx = getDescriptionsLineIdx(subsectionLines) ?? 1;
    const subsectionInfoTextItems = subsectionLines.slice(0, descriptionsLineIdx).flat();
    const [date] = getTextWithHighestFeatureScore(subsectionInfoTextItems, DATE_FEATURE_SETS);
    const PROJECT_FEATURE_SET: FeatureSet[] = [
      [isBold, 2],
      [getHasText(date), -4],
    ];
    const [project] = getTextWithHighestFeatureScore(
      subsectionInfoTextItems,
      PROJECT_FEATURE_SET,
      false
    );
    const descriptions = getBulletPointsFromLines(subsectionLines.slice(descriptionsLineIdx));
    projects.push({ project, date, descriptions });
  }
  return { projects };
};
