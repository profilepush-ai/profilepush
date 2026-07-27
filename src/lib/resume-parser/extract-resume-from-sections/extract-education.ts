import type { TextItem, FeatureSet, ResumeSectionToLines, ResumeEducation } from '../../types';
import { getSectionLinesByKeywords } from './lib/get-section-lines';
import { divideSectionIntoSubsections } from './lib/subsections';
import { DATE_FEATURE_SETS, hasComma, hasLetter, hasNumber } from './lib/common-features';
import { getTextWithHighestFeatureScore } from './lib/feature-scoring-system';
import { getBulletPointsFromLines, getDescriptionsLineIdx } from './lib/bullet-points';

const SCHOOLS = ['College', 'University', 'Institute', 'School', 'Academy', 'BASIS', 'Magnet'];
const hasSchool = (item: TextItem) => SCHOOLS.some((s) => item.text.includes(s));

const DEGREES = ['Associate', 'Bachelor', 'Master', 'PhD', 'Ph.'];
const hasDegree = (item: TextItem) =>
  DEGREES.some((d) => item.text.includes(d)) || /[ABM][A-Z\.]/.test(item.text);

const matchGPA = (item: TextItem) => item.text.match(/[0-4]\.\d{1,2}/);
const matchGrade = (item: TextItem) => {
  const grade = parseFloat(item.text);
  if (Number.isFinite(grade) && grade <= 110) return [String(grade)] as RegExpMatchArray;
  return null;
};

const SCHOOL_FEATURE_SETS: FeatureSet[] = [
  [hasSchool, 4],
  [hasDegree, -4],
  [hasNumber, -4],
];
const DEGREE_FEATURE_SETS: FeatureSet[] = [
  [hasDegree, 4],
  [hasSchool, -4],
  [hasNumber, -3],
];
const GPA_FEATURE_SETS: FeatureSet[] = [
  [matchGPA, 4, true],
  [matchGrade, 3, true],
  [hasComma, -3],
  [hasLetter, -4],
];

export const extractEducation = (sections: ResumeSectionToLines) => {
  const educations: ResumeEducation[] = [];
  const lines = getSectionLinesByKeywords(sections, ['education']);
  const subsections = divideSectionIntoSubsections(lines);
  for (const subsectionLines of subsections) {
    const textItems = subsectionLines.flat();
    const [school] = getTextWithHighestFeatureScore(textItems, SCHOOL_FEATURE_SETS);
    const [degree] = getTextWithHighestFeatureScore(textItems, DEGREE_FEATURE_SETS);
    const [gpa] = getTextWithHighestFeatureScore(textItems, GPA_FEATURE_SETS);
    const [date] = getTextWithHighestFeatureScore(textItems, DATE_FEATURE_SETS);
    let descriptions: string[] = [];
    const descriptionsLineIdx = getDescriptionsLineIdx(subsectionLines);
    if (descriptionsLineIdx !== undefined) {
      descriptions = getBulletPointsFromLines(subsectionLines.slice(descriptionsLineIdx));
    }
    educations.push({ school, degree, gpa, date, descriptions });
  }
  if (educations.length > 0) {
    const coursesLines = getSectionLinesByKeywords(sections, ['course']);
    if (coursesLines.length > 0) {
      educations[0].descriptions.push(
        'Courses: ' + coursesLines.flat().map((item) => item.text).join(' ')
      );
    }
  }
  return { educations };
};
