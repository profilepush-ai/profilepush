import type { ResumeSectionToLines, TextItem, FeatureSet } from '../../types';
import { getSectionLinesByKeywords } from './lib/get-section-lines';
import {
  isBold,
  hasNumber,
  hasComma,
  hasLetter,
  hasLetterAndIsAllUpperCase,
} from './lib/common-features';
import { getTextWithHighestFeatureScore } from './lib/feature-scoring-system';

const matchOnlyLetterSpaceOrPeriod = (item: TextItem) =>
  item.text.match(/^[a-zA-Z\s\.]+$/);

const matchEmail = (item: TextItem) => item.text.match(/\S+@\S+\.\S+/);
const hasAt = (item: TextItem) => item.text.includes('@');

const matchPhone = (item: TextItem) =>
  item.text.match(/\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/);
const hasParenthesis = (item: TextItem) => /\([0-9]+\)/.test(item.text);

const matchCityAndState = (item: TextItem) =>
  item.text.match(/[A-Z][a-zA-Z\s]+, [A-Z]{2}/);

const matchUrl = (item: TextItem) => item.text.match(/\S+\.[a-z]+\/\S+/);
const matchUrlHttpFallback = (item: TextItem) =>
  item.text.match(/https?:\/\/\S+\.\S+/);
const matchUrlWwwFallback = (item: TextItem) =>
  item.text.match(/www\.\S+\.\S+/);
const hasSlash = (item: TextItem) => item.text.includes('/');

const has4OrMoreWords = (item: TextItem) => item.text.split(' ').length >= 4;

const NAME_FEATURE_SETS: FeatureSet[] = [
  [matchOnlyLetterSpaceOrPeriod, 3, true],
  [isBold, 2],
  [hasLetterAndIsAllUpperCase, 2],
  [hasAt, -4],
  [hasNumber, -4],
  [hasParenthesis, -4],
  [hasComma, -4],
  [hasSlash, -4],
  [has4OrMoreWords, -2],
];

const EMAIL_FEATURE_SETS: FeatureSet[] = [
  [matchEmail, 4, true],
  [isBold, -1],
  [hasLetterAndIsAllUpperCase, -1],
  [hasParenthesis, -4],
  [hasComma, -4],
  [hasSlash, -4],
  [has4OrMoreWords, -4],
];

const PHONE_FEATURE_SETS: FeatureSet[] = [
  [matchPhone, 4, true],
  [hasLetter, -4],
];

const LOCATION_FEATURE_SETS: FeatureSet[] = [
  [matchCityAndState, 4, true],
  [isBold, -1],
  [hasAt, -4],
  [hasParenthesis, -3],
  [hasSlash, -4],
];

const URL_FEATURE_SETS: FeatureSet[] = [
  [matchUrl, 4, true],
  [matchUrlHttpFallback, 3, true],
  [matchUrlWwwFallback, 3, true],
  [isBold, -1],
  [hasAt, -4],
  [hasParenthesis, -3],
  [hasComma, -4],
  [has4OrMoreWords, -4],
];

const SUMMARY_FEATURE_SETS: FeatureSet[] = [
  [has4OrMoreWords, 4],
  [isBold, -1],
  [hasAt, -4],
  [hasParenthesis, -3],
  [matchCityAndState, -4],
];

export const extractProfile = (sections: ResumeSectionToLines) => {
  const lines = sections.profile || [];
  const textItems = lines.flat();
  const [name] = getTextWithHighestFeatureScore(textItems, NAME_FEATURE_SETS);
  const [email] = getTextWithHighestFeatureScore(textItems, EMAIL_FEATURE_SETS);
  const [phone] = getTextWithHighestFeatureScore(textItems, PHONE_FEATURE_SETS);
  const [location] = getTextWithHighestFeatureScore(textItems, LOCATION_FEATURE_SETS);
  const [url] = getTextWithHighestFeatureScore(textItems, URL_FEATURE_SETS);
  const [summary] = getTextWithHighestFeatureScore(
    textItems,
    SUMMARY_FEATURE_SETS,
    undefined,
    true
  );
  const summaryLines = getSectionLinesByKeywords(sections, ['summary']);
  const summarySection = summaryLines.flat().map((item) => item.text).join(' ');
  const objectiveLines = getSectionLinesByKeywords(sections, ['objective']);
  const objectiveSection = objectiveLines.flat().map((item) => item.text).join(' ');
  return {
    profile: {
      name,
      email,
      phone,
      location,
      url,
      summary: summarySection || objectiveSection || summary,
    },
  };
};
