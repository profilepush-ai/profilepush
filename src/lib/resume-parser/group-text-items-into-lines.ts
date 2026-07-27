import { BULLET_POINTS } from './extract-resume-from-sections/lib/bullet-points';
import type { TextItems, Line, Lines } from './types';

export const groupTextItemsIntoLines = (textItems: TextItems): Lines => {
  const lines: Lines = [];
  let line: Line = [];

  for (const item of textItems) {
    if (item.hasEOL) {
      if (item.text.trim() !== '') {
        line.push({ ...item });
      }
      lines.push(line);
      line = [];
    } else if (item.text.trim() !== '') {
      line.push({ ...item });
    }
  }
  if (line.length > 0) {
    lines.push(line);
  }

  const typicalCharWidth = getTypicalCharWidth(lines.flat());
  for (const line of lines) {
    for (let i = line.length - 1; i > 0; i--) {
      const currentItem = line[i];
      const leftItem = line[i - 1];
      const leftItemXEnd = leftItem.x + leftItem.width;
      const distance = currentItem.x - leftItemXEnd;
      if (distance <= typicalCharWidth) {
        if (shouldAddSpaceBetweenText(leftItem.text, currentItem.text)) {
          leftItem.text += ' ';
        }
        leftItem.text += currentItem.text;
        const currentItemXEnd = currentItem.x + currentItem.width;
        leftItem.width = currentItemXEnd - leftItem.x;
        line.splice(i, 1);
      }
    }
  }
  return lines;
};

const shouldAddSpaceBetweenText = (leftText: string, rightText: string) => {
  const leftTextEnd = leftText[leftText.length - 1];
  const rightTextStart = rightText[0];
  return (
    [':', ',', '|', '.', ...BULLET_POINTS].includes(leftTextEnd) && rightTextStart !== ' '
  ) || (
    leftTextEnd !== ' ' && ['|', ...BULLET_POINTS].includes(rightTextStart)
  );
};

const getTypicalCharWidth = (textItems: TextItems): number => {
  const filtered = textItems.filter((item) => item.text.trim() !== '');
  const heightToCount: Record<number, number> = {};
  let commonHeight = 0;
  let heightMaxCount = 0;
  const fontNameToCount: Record<string, number> = {};
  let commonFontName = '';
  let fontNameMaxCount = 0;

  for (const item of filtered) {
    heightToCount[item.height] = (heightToCount[item.height] ?? 0) + 1;
    if (heightToCount[item.height] > heightMaxCount) {
      commonHeight = item.height;
      heightMaxCount = heightToCount[item.height];
    }
    fontNameToCount[item.fontName] = (fontNameToCount[item.fontName] ?? 0) + item.text.length;
    if (fontNameToCount[item.fontName] > fontNameMaxCount) {
      commonFontName = item.fontName;
      fontNameMaxCount = fontNameToCount[item.fontName];
    }
  }

  const commonItems = filtered.filter(
    (item) => item.fontName === commonFontName && item.height === commonHeight
  );
  const [totalWidth, numChars] = commonItems.reduce(
    ([w, c], item) => [w + item.width, c + item.text.length],
    [0, 0]
  );
  return numChars > 0 ? totalWidth / numChars : 0;
};
