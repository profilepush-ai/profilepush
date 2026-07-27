import type { TextItem, FeatureSet } from '../../types';

export const isBold = (item: TextItem) =>
  item.fontName.toLowerCase().includes('bold');

export const hasLetter = (item: TextItem) => /[a-zA-Z]/.test(item.text);

export const hasNumber = (item: TextItem) => /[0-9]/.test(item.text);

export const hasComma = (item: TextItem) => item.text.includes(',');

export const getHasText = (text: string) => (item: TextItem) =>
  item.text.includes(text);

export const hasOnlyLettersSpacesAmpersands = (item: TextItem) =>
  /^[A-Za-z\s&]+$/.test(item.text);

export const hasLetterAndIsAllUpperCase = (item: TextItem) =>
  hasLetter(item) && item.text.toUpperCase() === item.text;

const hasYear = (item: TextItem) => /(?:19|20)\d{2}/.test(item.text);

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const hasMonth = (item: TextItem) =>
  MONTHS.some((m) => item.text.includes(m) || item.text.includes(m.slice(0, 4)));

const SEASONS = ['Summer', 'Fall', 'Spring', 'Winter'];
const hasSeason = (item: TextItem) =>
  SEASONS.some((s) => item.text.includes(s));

const hasPresent = (item: TextItem) => item.text.includes('Present');

export const DATE_FEATURE_SETS: FeatureSet[] = [
  [hasYear, 1],
  [hasMonth, 1],
  [hasSeason, 1],
  [hasPresent, 1],
  [hasComma, -1],
];
