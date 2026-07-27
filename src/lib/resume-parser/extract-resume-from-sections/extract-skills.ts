import type { ResumeSectionToLines, ResumeSkills, FeaturedSkill } from '../../types';
import { getSectionLinesByKeywords } from './lib/get-section-lines';
import { getBulletPointsFromLines, getDescriptionsLineIdx } from './lib/bullet-points';

const initialFeaturedSkills: FeaturedSkill[] = Array(6).fill({ skill: '', rating: 4 });

export const extractSkills = (sections: ResumeSectionToLines) => {
  const lines = getSectionLinesByKeywords(sections, ['skill']);
  const descriptionsLineIdx = getDescriptionsLineIdx(lines) ?? 0;
  const descriptionsLines = lines.slice(descriptionsLineIdx);
  const descriptions = getBulletPointsFromLines(descriptionsLines);
  const featuredSkills: FeaturedSkill[] = structuredClone(initialFeaturedSkills);
  if (descriptionsLineIdx !== 0) {
    const featuredSkillsTextItems = lines
      .slice(0, descriptionsLineIdx)
      .flat()
      .filter((item) => item.text.trim())
      .slice(0, 6);
    for (let i = 0; i < featuredSkillsTextItems.length; i++) {
      featuredSkills[i] = { skill: featuredSkillsTextItems[i].text, rating: 4 };
    }
  }
  const skills: ResumeSkills = { featuredSkills, descriptions };
  return { skills };
};
