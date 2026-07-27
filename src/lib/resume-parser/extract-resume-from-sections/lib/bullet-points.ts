import type { Lines, TextItem } from '../../types';

export const BULLET_POINTS = ['⋅','∙','🞄','•','⦁','⚫︎','●','⬤','⚬','○'];

export const getBulletPointsFromLines = (lines: Lines): string[] => {
  const firstBulletPointLineIndex = getFirstBulletPointLineIdx(lines);
  if (firstBulletPointLineIndex === undefined) {
    return lines.map((line) => line.map((item) => item.text).join(' '));
  }
  let lineStr = '';
  for (const item of lines.flat()) {
    const text = item.text;
    if (!lineStr.endsWith(' ') && !text.startsWith(' ')) {
      lineStr += ' ';
    }
    lineStr += text;
  }
  const commonBulletPoint = getMostCommonBulletPoint(lineStr);
  const firstBulletPointIndex = lineStr.indexOf(commonBulletPoint);
  if (firstBulletPointIndex !== -1) {
    lineStr = lineStr.slice(firstBulletPointIndex);
  }
  return lineStr
    .split(commonBulletPoint)
    .map((text) => text.trim())
    .filter((text) => !!text);
};

const getMostCommonBulletPoint = (str: string): string => {
  const bulletToCount: Record<string, number> = BULLET_POINTS.reduce(
    (acc, cur) => ({ ...acc, [cur]: 0 }),
    {}
  );
  let bulletWithMostCount = BULLET_POINTS[0];
  let bulletMaxCount = 0;
  for (const char of str) {
    if (Object.prototype.hasOwnProperty.call(bulletToCount, char)) {
      bulletToCount[char]++;
      if (bulletToCount[char] > bulletMaxCount) {
        bulletWithMostCount = char;
        bulletMaxCount = bulletToCount[char];
      }
    }
  }
  return bulletWithMostCount;
};

const getFirstBulletPointLineIdx = (lines: Lines): number | undefined => {
  for (let i = 0; i < lines.length; i++) {
    for (const item of lines[i]) {
      if (BULLET_POINTS.some((bullet) => item.text.includes(bullet))) {
        return i;
      }
    }
  }
  return undefined;
};

const isWord = (str: string) => /^[^0-9]+$/.test(str);
const hasAtLeast8Words = (item: TextItem) =>
  item.text.split(/\s/).filter(isWord).length >= 8;

export const getDescriptionsLineIdx = (lines: Lines): number | undefined => {
  let idx = getFirstBulletPointLineIdx(lines);
  if (idx === undefined) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length === 1 && hasAtLeast8Words(line[0])) {
        idx = i;
        break;
      }
    }
  }
  return idx;
};
