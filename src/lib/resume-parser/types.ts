// --- PDF Parser Types ---

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

export type TextItems = TextItem[];
export type Line = TextItem[];
export type Lines = Line[];
export type Subsections = Lines[];

export type ResumeKey = keyof Resume;

export type ResumeSectionToLines = { [sectionName in ResumeKey]?: Lines } & {
  [otherSectionName: string]: Lines;
};

export type FeatureSet = [
  (item: TextItem) => boolean | RegExpMatchArray | null,
  -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4,
  boolean?,
];

export interface TextScore {
  text: string;
  score: number;
  match: boolean;
}
export type TextScores = TextScore[];

// --- Resume Domain Types ---

export interface ResumeProfile {
  name: string;
  summary: string;
  email: string;
  phone: string;
  location: string;
  url: string;
}

export interface ResumeWorkExperience {
  company: string;
  jobTitle: string;
  date: string;
  descriptions: string[];
}

export interface ResumeEducation {
  school: string;
  degree: string;
  gpa: string;
  date: string;
  descriptions: string[];
}

export interface ResumeProject {
  project: string;
  date: string;
  descriptions: string[];
}

export interface FeaturedSkill {
  skill: string;
  rating: number;
}

export interface ResumeSkills {
  featuredSkills: FeaturedSkill[];
  descriptions: string[];
}

export interface Resume {
  profile: ResumeProfile;
  workExperiences: ResumeWorkExperience[];
  educations: ResumeEducation[];
  projects: ResumeProject[];
  skills: ResumeSkills;
  custom: { descriptions: string[] };
}
