import { Link } from 'react-router-dom';
import { ArrowRight, Clock, User, Zap, Target, FileText, Search, BarChart2, Mail } from 'lucide-react';
import Logo from '../components/Logo';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';

const READING_TIME = '12 min read';

export default function WhyAICopilot() {
  return (
    <div className="min-h-screen bg-white">
      <SEO title="Why AI Co-pilot | ProfilePush" description="The truth about AI in bench sales and why the machines are not coming for your job." />

      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-blue-600 font-bold text-base">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/signin" className="hidden sm:block text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              Sign in
            </Link>
            <Link
              to="/signup"
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Start free <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="relative pt-24 md:pt-32 pb-12 md:pb-16 px-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-50 to-white" />
        <div className="relative max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold mb-6">
            <Zap size={12} />
            Product Deep Dive
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-[2.75rem] font-extrabold text-gray-900 leading-tight tracking-tight">
            The Truth About AI in Bench Sales: Why The Machines Aren't Coming For Your Job
          </h1>
          <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed max-w-2xl mx-auto">
            (But other recruiters are.)
          </p>
          <div className="mt-8 flex items-center justify-center gap-6 text-xs text-gray-400">
            <span className="flex items-center gap-1.5"><User size={12} /> ProfilePush Team</span>
            <span className="flex items-center gap-1.5"><Clock size={12} /> {READING_TIME}</span>
          </div>
        </div>
      </header>

      {/* Article Body */}
      <article className="max-w-3xl mx-auto px-6 pb-20">
        <div className="prose prose-gray prose-lg max-w-none
          prose-headings:font-extrabold prose-headings:tracking-tight prose-headings:text-gray-900
          prose-h2:text-2xl prose-h2:mt-14 prose-h2:mb-4 prose-h2:border-b prose-h2:border-gray-100 prose-h2:pb-3
          prose-h3:text-lg prose-h3:mt-8 prose-h3:mb-3
          prose-p:text-gray-600 prose-p:leading-[1.8] prose-p:text-[15px]
          prose-strong:text-gray-800
          prose-li:text-gray-600 prose-li:text-[15px]
          prose-blockquote:border-l-blue-400 prose-blockquote:bg-blue-50/50 prose-blockquote:py-3 prose-blockquote:px-5 prose-blockquote:rounded-r-xl prose-blockquote:not-italic
        ">

          {/* Intro */}
          <p>
            If you spend more than five minutes scrolling through LinkedIn or reading staffing industry blogs, you will inevitably hit the same apocalyptic headline: <strong>Artificial Intelligence is going to replace recruiters.</strong> The narrative is everywhere. Pundits claim that within a few years, LLMs will autonomously source candidates, negotiate rates, and close placements without a single human touching the keyboard.
          </p>
          <p>
            It is a terrifying prospect if you are grinding out the night shift, relying on your desk to feed your family and build your career.
          </p>
          <p>
            But as a Product Architect who spends every waking hour building AI systems specifically for IT Bench Sales, I am here to tell you the absolute truth: <strong>The industry is lying to you.</strong>
          </p>

          <blockquote>
            <p>AI is not going to replace your desk. It cannot do what you do.</p>
          </blockquote>

          <p>
            However, if you do not fundamentally change how you execute your daily workflow, you <em>will</em> lose your job. You won't lose it to a machine -- you will lose it to a competing recruiter who is using an AI co-pilot to work ten times faster than you.
          </p>
          <p>
            In this deep dive, we are going to unpack the reality of AI in the staffing sector, expose the robotic tasks that are currently burning you out, and show you exactly how a true AI Co-pilot transforms your desk from a manual data-entry hub into a high-speed execution machine.
          </p>

          {/* Part 1 */}
          <h2>Part 1: The Human Element of Recruiting</h2>
          <p className="text-sm font-semibold text-blue-600 -mt-2 mb-4">What AI Cannot Do</p>
          <p>
            To understand why AI won't replace you, we first need to look at what actually drives revenue in IT Bench Sales.
          </p>
          <p>
            Staffing is, at its core, a business of <strong>human friction and trust</strong>. When you are placing a highly skilled IT consultant into a high-stakes enterprise project via a Prime Vendor, you are navigating a minefield of human emotions, corporate politics, and logistical hurdles.
          </p>
          <p>Here is exactly what an AI <em>cannot</em> do:</p>

          <div className="not-prose grid gap-4 my-8">
            {[
              { icon: <User size={16} />, title: 'Read the Hesitation', desc: "An AI cannot hear the slight pause in a consultant's voice when they say they are \"fine\" with relocating, allowing you to pivot the strategy before they back out." },
              { icon: <Target size={16} />, title: 'Negotiate the Nuance', desc: "An AI cannot get on a call with a stubborn Prime Vendor and leverage a pre-existing relationship to squeeze an extra $5/hour on a C2C rate." },
              { icon: <FileText size={16} />, title: 'Navigate Visa Complexities', desc: "While AI can read a visa status, it lacks the human intuition to creatively structure a deal or reassure a client about the realities of an H1B transfer timeline." },
              { icon: <Zap size={16} />, title: 'Build Trust', desc: "Hiring managers do business with people they trust. They answer your call because you delivered for them last time, not because an algorithm sent them an email." },
            ].map((item) => (
              <div key={item.title} className="flex gap-4 p-4 rounded-xl bg-gray-50 border border-gray-100">
                <div className="mt-0.5 w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-blue-600 shrink-0">
                  {item.icon}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-900 mb-1">{item.title}</h4>
                  <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <p>
            This is the <strong>human side of the desk</strong>. This is the art of recruiting. It requires empathy, emotional intelligence, and strategic negotiation. It is the most valuable part of your job.
          </p>
          <p>
            The problem? You aren't spending enough of your shift doing it.
          </p>

          {/* Part 2 */}
          <h2>Part 2: The Robotic Reality of the Night Shift</h2>
          <p>
            If the human element is so valuable, why are so many recruiters burnt out and struggling to hit their submittal targets?
          </p>
          <p>
            Because the modern staffing industry forces highly intelligent, capable professionals to <strong>act like robots</strong>.
          </p>
          <p>
            Let's look at the reality of the offshore IT Bench Sales "night shift." You log on at 10:00 PM IST. Your goal is to clear your bench. But before you can even make a single phone call or send a strategic pitch, you have to wade through a swamp of manual administrative work:
          </p>

          <div className="not-prose space-y-4 my-8 pl-4 border-l-2 border-orange-200">
            {[
              { label: 'The Tab-Switching Ping-Pong', text: 'You have LinkedIn, Dice, Indeed, and Monster open in 15 different tabs. You are copying and pasting the same boolean search string into four different UIs.' },
              { label: 'The JD Translation', text: "You find a job. It is a 3-page, horribly formatted Job Description. You have to manually read through it, cross-referencing it with your consultant's 5-page resume to see if there is a match." },
              { label: 'The MS Word Nightmare', text: 'The ultimate time-killer. Download the resume, open Word, adjust margins, bold keywords, delete irrelevant projects, close the skill gaps. This takes 15-20 minutes alone.' },
              { label: 'The Tracking Mess', text: "Once you finally send the email, you open a massive, messy Excel spreadsheet to log the submittal so your team doesn't accidentally double-submit tomorrow." },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-sm font-bold text-gray-800">{item.label}</p>
                <p className="text-xs text-gray-500 leading-relaxed mt-1">{item.text}</p>
              </div>
            ))}
          </div>

          <p>
            This process takes anywhere from <strong>15 to 30 minutes per submission</strong>.
          </p>
          <p>
            This is not recruiting. This is manual data entry. It is robotic, mind-numbing grunt work. And this is <em>exactly</em> what AI is built to destroy.
          </p>

          {/* Part 3 */}
          <h2>Part 3: The Paradigm Shift</h2>
          <p className="text-sm font-semibold text-blue-600 -mt-2 mb-4">Autopilot vs. Co-pilot</p>
          <p>
            The fear of AI stems from a fundamental misunderstanding of product architecture. People assume tech companies are trying to build an "Autopilot" -- a system where you push a button, walk away, and the software runs your business.
          </p>
          <p>That doesn't work in staffing. The future of software is the <strong>Co-pilot</strong>.</p>

          <blockquote>
            <p>A Co-pilot is an intelligent system that sits alongside you. It doesn't make the final strategic decisions, but it handles 100% of the heavy lifting.</p>
          </blockquote>

          <p>
            We built ProfilePush on this exact philosophy. We looked at the Bench Sales workflow and realized that recruiters were losing placements simply because they couldn't type, format, and search fast enough. We didn't build software to replace the recruiter; we built an AI command center to <strong>weaponize them</strong>.
          </p>

          {/* Part 4 */}
          <h2>Part 4: The Old Way vs. The ProfilePush Way</h2>

          <div className="not-prose space-y-8 my-8">
            {[
              {
                icon: <FileText size={16} />,
                num: '1',
                title: 'Centralizing the Talent (The Bench)',
                old: "Your candidates' resumes are scattered across local folders, shared Google Drives, and messy email threads.",
                newWay: 'Drop a raw PDF. In 30 seconds, the AI parses every skill, role, education history, and visa detail into a structured, searchable database.',
                ai: 'Auto-generates "Priority Skills" based on work history, giving you an instant marketing angle.',
              },
              {
                icon: <Search size={16} />,
                num: '2',
                title: 'Sourcing Requirements (Omni-Board)',
                old: 'Log into Dice, run a search. Log into Monster, run the same search. Check LinkedIn. Constantly fighting session timeouts.',
                newWay: 'Type your search once. ProfilePush simultaneously sweeps LinkedIn, Dice, Indeed, and Monster in real-time.',
                ai: '"AI Search Ideas" reads your candidate profile and suggests the best job titles and boolean strings.',
              },
              {
                icon: <Target size={16} />,
                num: '3',
                title: 'Qualifying the Fit (AI Match Scoring)',
                old: 'Spend 10 minutes reading the JD, trying to figure out if your candidate can pass for the role.',
                newWay: 'Click "Get Match Score." AI reads the live JD and cross-references it against your parsed candidate profile instantly.',
                ai: 'A definitive percentage match with exact strengths and skill gaps highlighted.',
              },
              {
                icon: <Zap size={16} />,
                num: '4',
                title: 'Bypassing MS Word (Resume AI)',
                old: 'Spend 20 minutes copying, pasting, bolding, and formatting a resume to align keywords with the JD.',
                newWay: 'AI offers to rewrite the resume based on identified skill gaps. Instantly aligns keywords and structures bullet points.',
                ai: 'A perfectly tailored, ATS-optimized resume generated in 10 seconds. Never open Word again.',
              },
              {
                icon: <Mail size={16} />,
                num: '5',
                title: 'Executing the Pitch (Submission Queue)',
                old: 'Open Outlook. Write a generic "Please find attached..." email. Attach the PDF. Hit send.',
                newWay: 'Push the matched job into your Submission Queue. One click drafts a tailored pitch email with the AI-rewritten resume attached.',
                ai: 'The JD and resume context are inherently understood, making the pitch bespoke and relevant.',
              },
              {
                icon: <BarChart2 size={16} />,
                num: '6',
                title: 'Securing the Pipeline (Tracker & Desk)',
                old: 'Manually type every submission, rate, and vendor contact into a shared Excel sheet. Mistakes lead to double-submissions.',
                newWay: 'Every search, match score, and submission is logged and timestamped automatically. Live CRM builds on autopilot.',
                ai: 'Total visibility. Your Desk shows exactly which job boards are converting and where your pipeline is bottlenecked.',
              },
            ].map((item) => (
              <div key={item.num} className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-50 flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                    {item.icon}
                  </div>
                  <h3 className="text-sm font-bold text-gray-900">{item.num}. {item.title}</h3>
                </div>
                <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-50">
                  <div className="p-5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-red-400 mb-2">The Old Way</p>
                    <p className="text-xs text-gray-500 leading-relaxed">{item.old}</p>
                  </div>
                  <div className="p-5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-500 mb-2">The ProfilePush Way</p>
                    <p className="text-xs text-gray-500 leading-relaxed">{item.newWay}</p>
                  </div>
                </div>
                <div className="px-5 py-3 bg-blue-50/50 border-t border-blue-100/50">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-blue-500 mb-1">AI Advantage</p>
                  <p className="text-xs text-blue-700/70 leading-relaxed">{item.ai}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Part 5 */}
          <h2>Part 5: The Economics of Speed</h2>
          <p>
            Prime Vendors and end-clients are using automated VMS and AI-driven ATS platforms to screen candidates faster than ever before. When a hot requirement hits the market, the window to submit a winning candidate is often measured in <strong>hours, not days</strong>.
          </p>

          <div className="not-prose my-8 rounded-2xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white p-6">
            <div className="grid sm:grid-cols-2 gap-6">
              <div className="text-center p-4 rounded-xl bg-white border border-gray-100">
                <p className="text-3xl font-extrabold text-gray-300">15-20</p>
                <p className="text-xs text-gray-400 mt-1">submissions/shift (manual)</p>
                <p className="text-[10px] text-gray-400 mt-0.5">25 min per submission</p>
              </div>
              <div className="text-center p-4 rounded-xl bg-blue-50 border border-blue-100">
                <p className="text-3xl font-extrabold text-blue-600">50+</p>
                <p className="text-xs text-blue-600/70 mt-1">submissions/shift (with AI)</p>
                <p className="text-[10px] text-blue-500/60 mt-0.5">Under 2 min per submission</p>
              </div>
            </div>
          </div>

          <p>
            <strong>Speed to inbox is the ultimate competitive advantage in Bench Sales.</strong> The recruiter using AI is going to submit their candidate first. Their resume will be perfectly optimized for the vendor's keywords. Their pitch email will be concise and relevant. And while you are still fighting with Microsoft Word margins, they are already on the phone negotiating the C2C rate.
          </p>

          {/* Verdict */}
          <h2>The Verdict: Evolve or Get Left Behind</h2>
          <p>
            It is time to stop letting fear dictate your career strategy.
          </p>
          <p>
            The machines are not coming for your desk. They do not want to talk to your candidates. They do not want to negotiate with your clients. They are simply here to take away the repetitive, mind-numbing data entry that you hate doing anyway.
          </p>

          <blockquote>
            <p>The era of manual SaaS and Excel spreadsheets is dead. The era of the Co-pilot is here.</p>
          </blockquote>

          <p>
            You have a choice to make on your next shift. You can continue to act like a robot, jumping between tabs and fighting with formatting, hoping your hustle is enough to beat the market. Or, you can embrace the technology, offload the grunt work to an AI, and focus 100% of your energy on <strong>closing deals</strong>.
          </p>

        </div>

        {/* CTA */}
        <div className="mt-16 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 p-8 md:p-12 text-center">
          <h3 className="text-xl md:text-2xl font-extrabold text-white mb-3">
            Ready to see the Co-pilot in action?
          </h3>
          <p className="text-sm text-slate-300 mb-6 max-w-md mx-auto leading-relaxed">
            Create a free account, claim your $5 in free AI credits, load up your bench, and watch how fast you can clear it.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 transition-colors text-white text-sm font-semibold px-6 py-3 rounded-xl shadow-lg shadow-blue-600/20"
            >
              Start Free <ArrowRight size={15} />
            </Link>
            <Link
              to="/book-demo"
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 border border-white/20 transition-colors text-white text-sm font-medium px-6 py-3 rounded-xl"
            >
              Book a Demo
            </Link>
          </div>
        </div>
      </article>

      <SiteFooter />
    </div>
  );
}
