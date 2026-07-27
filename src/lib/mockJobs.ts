export interface MockJob {
  id: string;
  job_title: string;
  company: string;
  board: 'LinkedIn' | 'Dice' | 'Indeed' | 'CareerBuilder';
  location: string;
  job_url: string;
  description: string;
  salary: string;
  posted: string;
  skills: string[];
}

const COMPANIES = [
  'Accenture', 'Deloitte', 'Cognizant', 'Infosys', 'TCS', 'Wipro',
  'IBM', 'Capgemini', 'HCL Technologies', 'Unisys', 'DXC Technology',
  'EPAM Systems', 'Luxoft', 'Globant', 'CIBC', 'JP Morgan Chase',
  'Bank of America', 'Wells Fargo', 'Goldman Sachs', 'Microsoft',
  'Amazon', 'Meta', 'Apple', 'Netflix', 'Salesforce', 'Oracle',
  'SAP America', 'Adobe', 'ServiceNow', 'Workday',
];

const LOCATIONS = [
  'Austin, TX', 'Dallas, TX', 'New York, NY', 'Jersey City, NJ',
  'Chicago, IL', 'Atlanta, GA', 'Seattle, WA', 'San Francisco, CA',
  'Charlotte, NC', 'Phoenix, AZ', 'Denver, CO', 'Boston, MA',
  'Remote', 'Hybrid - Austin, TX', 'Hybrid - New York, NY',
  'Hybrid - Chicago, IL', 'Remote (US Only)',
];

const BOARDS: Array<MockJob['board']> = ['LinkedIn', 'Dice', 'Indeed', 'CareerBuilder'];

const SALARY_RANGES = [
  '$80K - $100K/yr', '$90K - $120K/yr', '$100K - $130K/yr',
  '$110K - $140K/yr', '$120K - $150K/yr', '$130K - $160K/yr',
  '$65 - $80/hr (C2C)', '$70 - $90/hr (C2C)', '$75 - $95/hr (C2C)',
  '$80 - $100/hr (W2)', 'DOE', 'Competitive',
];

const POSTED_TIMES = [
  '1 hour ago', '3 hours ago', '5 hours ago', '12 hours ago',
  '1 day ago', '2 days ago', '3 days ago', '5 days ago', '1 week ago',
];

const SKILL_POOLS: Record<string, string[]> = {
  react: ['React', 'TypeScript', 'JavaScript', 'Redux', 'Node.js', 'REST APIs', 'Git', 'Tailwind CSS', 'Next.js', 'GraphQL'],
  java: ['Java', 'Spring Boot', 'Microservices', 'SQL', 'AWS', 'Docker', 'Kubernetes', 'REST APIs', 'Maven', 'JUnit'],
  python: ['Python', 'Django', 'FastAPI', 'SQL', 'PostgreSQL', 'AWS', 'Docker', 'Machine Learning', 'Pandas', 'REST APIs'],
  dotnet: ['.NET', 'C#', 'ASP.NET Core', 'SQL Server', 'Azure', 'Entity Framework', 'REST APIs', 'Git', 'LINQ', 'MVC'],
  devops: ['AWS', 'Kubernetes', 'Docker', 'Terraform', 'CI/CD', 'Jenkins', 'Linux', 'Python', 'Ansible', 'GitLab'],
  data: ['SQL', 'Python', 'Tableau', 'Power BI', 'ETL', 'Spark', 'Hadoop', 'Azure', 'AWS Redshift', 'Data Modeling'],
  angular: ['Angular', 'TypeScript', 'JavaScript', 'RxJS', 'REST APIs', 'Git', 'HTML/CSS', 'NgRx', 'Jest', 'Node.js'],
  default: ['JavaScript', 'TypeScript', 'SQL', 'REST APIs', 'Git', 'Agile', 'AWS', 'Docker', 'Linux', 'CI/CD'],
};

function pickSkills(keyword: string): string[] {
  const kw = keyword.toLowerCase();
  let pool = SKILL_POOLS.default;
  for (const [key, skills] of Object.entries(SKILL_POOLS)) {
    if (kw.includes(key)) { pool = skills; break; }
  }
  if (kw.includes('react') || kw.includes('frontend') || kw.includes('front end')) pool = SKILL_POOLS.react;
  if (kw.includes('angular')) pool = SKILL_POOLS.angular;
  if (kw.includes('java') && !kw.includes('javascript')) pool = SKILL_POOLS.java;
  if (kw.includes('python') || kw.includes('data engineer')) pool = SKILL_POOLS.python;
  if (kw.includes('.net') || kw.includes('dotnet') || kw.includes('c#')) pool = SKILL_POOLS.dotnet;
  if (kw.includes('devops') || kw.includes('cloud') || kw.includes('aws')) pool = SKILL_POOLS.devops;
  const count = 4 + Math.floor(Math.random() * 4);
  return [...pool].sort(() => Math.random() - 0.5).slice(0, count);
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const JOB_TITLE_PREFIXES = ['Senior', 'Lead', 'Staff', 'Principal', '', '', 'Mid-Level', 'Junior'];
const JOB_TITLE_SUFFIXES = ['Engineer', 'Developer', 'Architect', 'Consultant', 'Specialist'];

function generateTitle(keyword: string): string {
  const kw = keyword.trim();
  if (!kw) return `${randomFrom(JOB_TITLE_PREFIXES)} Software ${randomFrom(JOB_TITLE_SUFFIXES)}`.trim();
  const prefix = randomFrom(JOB_TITLE_PREFIXES);
  return `${prefix} ${kw} ${randomFrom(JOB_TITLE_SUFFIXES)}`.replace(/\s+/g, ' ').trim();
}

let jobCounter = 1000;

export function generateMockJobs(keyword: string, location: string, count = 20): MockJob[] {
  const jobs: MockJob[] = [];
  for (let i = 0; i < count; i++) {
    jobCounter++;
    const skills = pickSkills(keyword || 'software');
    const loc = location.trim() ? location : randomFrom(LOCATIONS);
    jobs.push({
      id: `mock-${jobCounter}-${Math.random().toString(36).slice(2)}`,
      job_title: generateTitle(keyword || 'Software'),
      company: randomFrom(COMPANIES),
      board: BOARDS[i % BOARDS.length],
      location: loc,
      job_url: '#',
      salary: randomFrom(SALARY_RANGES),
      posted: randomFrom(POSTED_TIMES),
      skills,
      description: `We are looking for a talented ${keyword || 'Software Developer'} to join our team. You will work on ${skills.slice(0, 3).join(', ')} and contribute to enterprise-scale solutions. ${skills.length > 3 ? `Experience with ${skills.slice(3).join(', ')} is a plus.` : ''}`,
    });
  }
  return jobs;
}
