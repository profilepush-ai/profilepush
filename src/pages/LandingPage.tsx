import { memo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import RatingBlock from '../components/landing/RatingBlock';
import LandingHeader from './landing/LandingHeader';
import AndroidApp from './landing/AndroidApp';
import { useLandingEngine } from './landing/useLandingEngine';
import { startHome } from './landing/homeEngine';
import { fmt, fmtDate } from './landing/engine';
import { composeStoryData, initialSnapshot } from '../lib/marketSnapshot';
import type { StoryData } from '../lib/marketSnapshot';
import './landing/landing-shared.css';
import './landing/home.css';

// The homepage: both sides of the deal. Ported from the approved demo
// (website-demos/profilepush-ai/both-sides-v2). The markup is static JSX; the
// motion (hero torrent, the side switch and its auto-toggle, the pinned filter,
// the phone ticker, the emails and the live Tracker) runs from homeEngine on
// the root element and stops on unmount.

const TITLE = 'ProfilePush — AI Copilot for US IT Staffing';
const DESCRIPTION = 'AI Copilot for US IT staffing. Vendors get matching bench consultants; bench sales get matching C2C requirements, live all day. Free to start. On Android.';
const CANONICAL = 'https://profilepush.ai/';

// Every answer here is checked against the app (credit costs: BillingPage
// CREDIT_COST_ITEMS and the migrations/functions it cites). The FAQPage
// JSON-LD below is built from this same list, so the two cannot drift.
const FAQS = [
  { q: "What is ProfilePush?", a: "ProfilePush is an AI Copilot for US IT staffing. It reads the live flow of requirements and hotlist consultants, matches them to what you post, and pushes the fits into a live Tracker. AI Request and AI Submit write the email, sent from your own Gmail." },
  { q: "Who is ProfilePush for?", a: "US IT staffing, both sides. Vendors post requirements and get matching bench consultants. Bench sales paste a hotlist and get matching requirements for every consultant." },
  { q: "How do bench sales recruiters find C2C requirements?", a: "Paste your hotlist. Every consultant gets a live column of matching requirements from the thousands posted each month, with an alert when a strong match lands. One tap submits, resume attached." },
  { q: "How do vendors find bench consultants?", a: "Post your requirement, or paste it as text. It is matched against the hotlist consultants posted every day, and the fits land in your Tracker. One tap sends an AI Request for the resume, rate, visa and availability." },
  { q: "Whose email does it send from?", a: "Yours. AI Request and AI Submit drafts go out from your own Gmail, after you review them." },
  { q: "Will my consultant be contacted?", a: "Never. Your data is encrypted and never sold." },
  { q: "What does it cost?", a: "You pay for one thing: matches. Each new match costs ₹0.25, so ₹250 buys 1,000, and you start with 100 free. Opening jobs, AI Submit, bulk send from your Gmail and Apply are free. No subscription." },
  { q: "Is there a ProfilePush app?", a: "Yes. ProfilePush is on Google Play for Android, with match alerts on your phone. It also runs in any web browser." },
  { q: "Can my whole team use it?", a: "Yes. Team accounts have unlimited members." },
];

const PAGE_JSONLD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebPage',
      '@id': `${CANONICAL}#webpage`,
      url: CANONICAL,
      name: TITLE,
      description: DESCRIPTION,
      isPartOf: { '@id': 'https://profilepush.ai/#website' },
      about: { '@id': 'https://profilepush.ai/#organization' },
      mainEntity: { '@id': 'https://profilepush.ai/#software' },
    },
    {
      '@type': 'FAQPage',
      '@id': `${CANONICAL}#faq`,
      isPartOf: { '@id': `${CANONICAL}#webpage` },
      mainEntity: FAQS.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ],
};

export default function LandingPage() {
  const [data] = useState(() => composeStoryData(initialSnapshot()));
  return (
    <>
      <SEO title={TITLE} description={DESCRIPTION} canonical={CANONICAL} jsonLd={PAGE_JSONLD} />
      <HomeBody data={data} />
    </>
  );
}

// Memoised with stable props: the engine owns this DOM after mount, so React
// must not re-render it (auth changes only re-render the header).
const HomeBody = memo(function HomeBody({ data }: { data: StoryData }) {
  const { rootRef, footRef } = useLandingEngine(startHome, data);
  const st = data.stats;
  const date = fmtDate(data.asOf);
  return (
    <>
    <div ref={rootRef} className="pp-lp pp-home" data-side="both" data-pick="vendor">
          <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
            <defs>
              <symbol id="chev" viewBox="0 0 10 16">
                <path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"></path>
              </symbol>
              <symbol id="ddchev" viewBox="0 0 10 16">
                <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"></path>
              </symbol>
              <symbol id="mark" viewBox="0 0 24 24">
                <circle cx="5" cy="6.4" r="3.6" fill="#facc15"></circle>
                <circle cx="5" cy="17.6" r="3.6" fill="#f97316"></circle>
                <path d="M12.6 3.4 20.4 12l-7.8 8.6" fill="none" stroke="#2563eb" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"></path>
              </symbol>
            </defs>
          </svg>
          <LandingHeader active={null} startPath="start" />
    <main id="top">
            <section className="hero" aria-labelledby="h1">
              <canvas id="torrent" aria-hidden="true"></canvas>
              <div className="tint" aria-hidden="true">
                <i className="tv"></i>
                <i className="tb"></i>
              </div>
              <div className="seam" aria-hidden="true"></div>
              <div className="wrap hero-in">
                <span className="live intro">
                  <span className="pulse"></span>
                  <span>{"Live market · "}<span data-asof="">{date}</span></span>
                </span>
                <h1 id="h1" className="intro d1">
                  {' '}
                  <span className="x-both">
                    AI Copilot for
                    <br />
                    <span className="grad">
                      US IT Staffing.
                    </span>
                  </span>
                  {' '}
                  <span className="x-v swapin" style={{ "--push": "-30px" } as CSSProperties}>
                    AI Copilot for
                    <br />
                    <span className="gv">
                      Vendors.
                    </span>
                  </span>
                  {' '}
                  <span className="x-b swapin" style={{ "--push": "30px" } as CSSProperties}>
                    AI Copilot for
                    <br />
                    <span className="gb">
                      Bench Sales.
                    </span>
                  </span>
                  {' '}
                </h1>
                <p className="sub intro d2">
                  {' '}
                  <span className="x-both">
                    <span className="phx">
                      Requirements on one side, consultants on the other. Your AI Copilot reads the flood and pushes only what fits.
                    </span>
                    <span className="pho">
                      Two sides. One AI Copilot.
                    </span>
                  </span>
                  {' '}
                  <span className="x-v">
                    <span className="phx">
                      Matching bench consultants land in your Tracker all day. One tap asks for the resume.
                    </span>
                    <span className="pho">
                      Matching consultants land all day.
                    </span>
                  </span>
                  {' '}
                  <span className="x-b">
                    <span className="phx">
                      Every consultant gets a live column of matching reqs. One tap submits, resume attached.
                    </span>
                    <span className="pho">
                      Matching reqs for every consultant.
                    </span>
                  </span>
                  {' '}
                </p>
                <div className="switch intro d2" role="radiogroup" aria-label="Show the page for">
                  <span className="knob" aria-hidden="true"></span>
                  <input type="radio" name="side1" id="s1v" value="vendor" />
                  <label className="lv" htmlFor="s1v">
                    <svg className="sw-ico" aria-hidden="true">
                      <use href="#chev"></use>
                    </svg>
                    Vendor
                  </label>
                  <input type="radio" name="side1" id="s1x" value="both" defaultChecked />
                  <label className="mid" htmlFor="s1x">
                    <span className="sr">
                      Both sides
                    </span>
                    <span className="dotpair" aria-hidden="true">
                      <i></i>
                      <i></i>
                    </span>
                  </label>
                  <input type="radio" name="side1" id="s1b" value="bench" />
                  <label className="lb" htmlFor="s1b">
                    Bench sales
                    <svg className="sw-ico" aria-hidden="true" style={{ transform: "scaleX(-1)" }}>
                      <use href="#chev"></use>
                    </svg>
                  </label>
                </div>
                <div className="zones intro d3" id="zones">
                  <div className="zone v side-v">
                    <span className="side-label v">
                      <i></i>
                      I have a requirement
                    </span>
                    <span className="big gv" id="nV" data-stat="hot30d" data-n={st.hot30d}>
                      {fmt(st.hot30d)}
                    </span>
                    <span className="what">
                      {"hotlist consultants posted in the last 30 days"}
                    </span>
                    <Link className="btn btn-p" to="/signup" data-path="vendor">
                      {"Match my requirement "}
                      <svg className="chev" aria-hidden="true">
                        <use href="#chev"></use>
                      </svg>
                    </Link>
                  </div>
                  <div className="zone b side-b">
                    <span className="side-label b">
                      <i></i>
                      I have consultants
                    </span>
                    <span className="big gb" id="nB" data-stat="jobs30d" data-n={st.jobs30d}>
                      {fmt(st.jobs30d)}
                    </span>
                    <span className="what">
                      {"new requirements posted in the last 30 days"}
                    </span>
                    <Link className="btn btn-b" to="/signup" data-path="bench">
                      {"Match my bench "}
                      <svg className="chev" aria-hidden="true">
                        <use href="#chev"></use>
                      </svg>
                    </Link>
                  </div>
                </div>
                <AndroidApp source="home-hero" className="intro d3" />
                <a className="cue intro d4" href="#filter">
                  <span className="x-both">
                    Watch both sides filter
                  </span>
                  <span className="x-v">
                    Watch your req fill
                  </span>
                  <span className="x-b">
                    Watch your bench match
                  </span>
                  {' '}
                  <span className="ddc" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <svg viewBox="0 0 10 16">
                      <use href="#ddchev"></use>
                    </svg>
                  </span>
                </a>
              </div>
            </section>
            <section className="filter" id="filter" aria-label="How ProfilePush filters the market for both sides">
              {/* pinned, scroll-driven (desktop) */}
              <div className="fx-pin" id="fxPin">
                <div className="fx-stage">
                  <div className="wrap">
                    <div className="fx-bar">
                      <div className="caps">
                        <div className="cap" data-cap="0">
                          <h2>
                            {"Everything. "}
                            <span className="grad">
                              All at once.
                            </span>
                          </h2>
                          <p data-t="c0"></p>
                        </div>
                        <div className="cap" data-cap="1">
                          <h2>
                            {"The AI Copilot "}
                            <span className="grad">
                              reads every one.
                            </span>
                          </h2>
                          <p>
                            Noise falls away. What fits gets pushed forward.
                          </p>
                        </div>
                        <div className="cap" data-cap="2">
                          <h2>
                            {"Only "}
                            <span className="grad">
                              what fits.
                            </span>
                          </h2>
                          <p data-t="c2"></p>
                        </div>
                      </div>
                      <div className="switch" role="radiogroup" aria-label="Show the story for">
                        <span className="knob" aria-hidden="true"></span>
                        <input type="radio" name="side2" id="s2v" value="vendor" />
                        <label className="lv" htmlFor="s2v">
                          <svg className="sw-ico" aria-hidden="true">
                            <use href="#chev"></use>
                          </svg>
                          Vendor
                        </label>
                        <input type="radio" name="side2" id="s2x" value="both" defaultChecked />
                        <label className="mid" htmlFor="s2x">
                          <span className="sr">
                            Both sides
                          </span>
                          <span className="dotpair" aria-hidden="true">
                            <i></i>
                            <i></i>
                          </span>
                        </label>
                        <input type="radio" name="side2" id="s2b" value="bench" />
                        <label className="lb" htmlFor="s2b">
                          Bench sales
                          <svg className="sw-ico" aria-hidden="true" style={{ transform: "scaleX(-1)" }}>
                            <use href="#chev"></use>
                          </svg>
                        </label>
                      </div>
                    </div>
                    <div className="boards" id="boards"></div>
                  </div>
                </div>
              </div>
              {/* stacked scenes (phones, reduced motion) */}
              <div className="fx-stack" id="fxStack">
                <div className="wrap">
                  <h2>
                    {"Signal from "}
                    <span className="grad">
                      the noise.
                    </span>
                  </h2>
                  <div className="pick always" role="group" aria-label="Show the story for">
                    <button type="button" data-pick="vendor" aria-pressed="true">
                      <i></i>
                      Vendor
                    </button>
                    <button type="button" data-pick="bench" aria-pressed="false">
                      <i></i>
                      Bench sales
                    </button>
                  </div>
                  <p className="fx-note" data-t="s0"></p>
                  <div className="tk" id="tk" aria-hidden="true">
                    <div className="tk-cap">
                      <span className="pulse"></span>
                      <span id="tkCap"></span>
                    </div>
                    <div className="tk-win">
                      <div className="tk-track" id="tkTrack"></div>
                    </div>
                  </div>
                  <div className="gate" id="gate" aria-hidden="true">
                    <span className="ddc">
                      <i></i>
                      <i></i>
                      <svg viewBox="0 0 10 16">
                        <use href="#ddchev"></use>
                      </svg>
                    </span>
                  </div>
                  <div className="scol" id="scol"></div>
                </div>
              </div>
            </section>
            <div className="divider" aria-hidden="true">
              <span className="ddc">
                <i></i>
                <i></i>
                <svg viewBox="0 0 10 16">
                  <use href="#ddchev"></use>
                </svg>
              </span>
            </div>
            <section className="sec mailsec" aria-labelledby="mailh">
              <div className="wrap">
                <div className="rv">
                  <span className="eyebrow">
                    <span className="x-both">
                      AI Request · AI Submit
                    </span>
                    <span className="x-v">
                      AI Request
                    </span>
                    <span className="x-b">
                      AI Submit
                    </span>
                  </span>
                  <h2 id="mailh" style={{ marginTop: "14px" }}>
                    {"The email "}
                    <span className="grad">
                      writes itself.
                    </span>
                  </h2>
                  <p className="lede phx">
                    <span className="x-both">
                      One real match, written up from both ends. Sent from your own Gmail.
                    </span>
                    <span className="x-v">
                      From the match, one tap asks the recruiter for the resume. Sent from your own Gmail.
                    </span>
                    <span className="x-b">
                      From the match, with the resume attached. Sent from your own Gmail.
                    </span>
                  </p>
                </div>
                <div className="pick" role="group" aria-label="Show the email for">
                  <button type="button" data-pick="vendor" aria-pressed="true">
                    <i></i>
                    AI Request
                  </button>
                  <button type="button" data-pick="bench" aria-pressed="false">
                    <i></i>
                    AI Submit
                  </button>
                </div>
                <div className="mails">
                  <div className="mg v side-v pk-v" data-mode="vendor">
                    <div className="rv info">
                      <span className="side-label v">
                        <i></i>
                        Vendor
                      </span>
                      <h3>
                        AI Request
                      </h3>
                      <p className="lede">
                        Asks for resume, rate, visa and availability.
                      </p>
                      <div className="pair" aria-label="The match">
                        <div className="pc"></div>
                        <svg className="pushchev" viewBox="0 0 34 96" aria-hidden="true">
                          <path d="M6 6 28 48 6 90" fill="none" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </div>
                      <div className="facts"></div>
                    </div>
                    <figure className="mail rv" aria-label="The AI Request email ProfilePush writes from this match">
                      <div className="row">
                        <span className="k">
                          To
                        </span>
                        <span className="v mu m-to"></span>
                      </div>
                      <div className="row">
                        <span className="k">
                          Subject
                        </span>
                        <span className="v m-sub"></span>
                      </div>
                      <div className="mbody"></div>
                      <div className="m-extra"></div>
                      <div className="pushrow">
                        <span className="ddc" aria-hidden="true">
                          <i></i>
                          <i></i>
                          <svg viewBox="0 0 10 16">
                            <use href="#ddchev"></use>
                          </svg>
                        </span>
                        <span>
                          Pushed from your own Gmail
                        </span>
                      </div>
                    </figure>
                  </div>
                  <div className="mg b side-b pk-b" data-mode="bench">
                    <div className="rv info">
                      <span className="side-label b">
                        <i></i>
                        Bench sales
                      </span>
                      <h3>
                        AI Submit
                      </h3>
                      <p className="lede">
                        Writes the submission, resume attached.
                      </p>
                      <div className="pair" aria-label="The match">
                        <div className="pc"></div>
                        <svg className="pushchev" viewBox="0 0 34 96" aria-hidden="true">
                          <path d="M6 6 28 48 6 90" fill="none" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </div>
                      <div className="facts"></div>
                    </div>
                    <figure className="mail rv" aria-label="The AI Submit email ProfilePush writes from this match">
                      <div className="row">
                        <span className="k">
                          To
                        </span>
                        <span className="v mu m-to"></span>
                      </div>
                      <div className="row">
                        <span className="k">
                          Subject
                        </span>
                        <span className="v m-sub"></span>
                      </div>
                      <div className="mbody"></div>
                      <div className="m-extra"></div>
                      <div className="pushrow">
                        <span className="ddc" aria-hidden="true">
                          <i></i>
                          <i></i>
                          <svg viewBox="0 0 10 16">
                            <use href="#ddchev"></use>
                          </svg>
                        </span>
                        <span>
                          Pushed from your own Gmail
                        </span>
                      </div>
                    </figure>
                  </div>
                </div>
              </div>
            </section>
            <section className="sec" id="tracker" aria-labelledby="trkh">
              <div className="wrap">
                <div className="rv">
                  <span className="eyebrow">
                    The Tracker
                  </span>
                  <h2 id="trkh" style={{ marginTop: "14px" }}>
                    {"Then it "}
                    <span className="grad">
                      keeps collecting.
                    </span>
                  </h2>
                  <p className="lede">
                    <span className="phx">
                      New matches land in the column all day. You just decide.
                    </span>
                    <span className="pho">
                      Matches land all day. You decide.
                    </span>
                  </p>
                </div>
                <div className="pick" role="group" aria-label="Show the Tracker for">
                  <button type="button" data-pick="vendor" aria-pressed="true">
                    <i></i>
                    Vendor
                  </button>
                  <button type="button" data-pick="bench" aria-pressed="false">
                    <i></i>
                    Bench sales
                  </button>
                </div>
                <div className="trk-grid">
                  <div className="lw v side-v pk-v rv" data-mode="vendor">
                    <span className="side-label v">
                      <i></i>
                      Vendor · your requirement
                    </span>
                    <div className="live-col" aria-label="Vendor Tracker column, updating">
                      <div className="col-host"></div>
                      <div className="toast" aria-hidden="true">
                        <span className="bell">
                          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path>
                            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>
                          </svg>
                        </span>
                        <div>
                          <b>
                            Strong match landed
                          </b>
                          <span className="toast-t"></span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="lw b side-b pk-b rv" data-mode="bench">
                    <span className="side-label b">
                      <i></i>
                      Bench sales · your consultant
                    </span>
                    <div className="live-col" aria-label="Bench sales Tracker column, updating">
                      <div className="col-host"></div>
                      <div className="toast" aria-hidden="true">
                        <span className="bell">
                          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path>
                            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>
                          </svg>
                        </span>
                        <div>
                          <b>
                            Strong match landed
                          </b>
                          <span className="toast-t"></span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <ul className="feat rv">
                    <li className="phx">
                      <span className="ddc" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <use href="#ddchev"></use>
                        </svg>
                      </span>
                      Alerts when a strong match lands
                    </li>
                    <li>
                      <span className="ddc" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <use href="#ddchev"></use>
                        </svg>
                      </span>
                      AI Match: ranked fit and skill gaps
                    </li>
                    <li className="phx">
                      <span className="ddc" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <use href="#ddchev"></use>
                        </svg>
                      </span>
                      Reposts merged into one card
                    </li>
                    <li className="phx">
                      <span className="ddc" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <use href="#ddchev"></use>
                        </svg>
                      </span>
                      “Not a match” never comes back
                    </li>
                    <li className="side-b">
                      <span className="ddc" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <use href="#ddchev"></use>
                        </svg>
                      </span>
                      Inbound resume requests in one list
                    </li>
                    <li className="side-v">
                      <span className="ddc" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <use href="#ddchev"></use>
                        </svg>
                      </span>
                      Optional video screening
                    </li>
                    <li>
                      <span className="ddc" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <use href="#ddchev"></use>
                        </svg>
                      </span>
                      Team accounts, unlimited members
                    </li>
                  </ul>
                </div>
              </div>
            </section>
            <section className="sec numsec" aria-labelledby="numh">
              <div className="wrap">
                <span className="eyebrow">
                  The live market
                </span>
                <h2 id="numh" style={{ marginTop: "14px" }}>
                  {"Both floods, "}
                  <span className="grad">
                    counted.
                  </span>
                </h2>
                <div className="nums rv" id="nums">
                  <div className="hd"></div>
                  <div className="hd">
                    Last 24h
                  </div>
                  <div className="hd">
                    Last 7 days
                  </div>
                  <div className="hd">
                    Last 30 days
                  </div>
                  <div className="hd">
                    All time
                  </div>
                  <div className="lab">
                    <span>
                      <i></i>
                      Requirements posted
                    </span>
                    <em className="b side-b">
                      For bench sales
                    </em>
                  </div>
                  <div className="n" data-stat="jobs24h" data-n={st.jobs24h}>
                    {fmt(st.jobs24h)}
                    <small>
                      24 hours
                    </small>
                  </div>
                  <div className="n" data-stat="jobs7d" data-n={st.jobs7d}>
                    {fmt(st.jobs7d)}
                    <small>
                      7 days
                    </small>
                  </div>
                  <div className="n" data-stat="jobs30d" data-n={st.jobs30d}>
                    {fmt(st.jobs30d)}
                    <small>
                      30 days
                    </small>
                  </div>
                  <div className="n" data-stat="jobsAll" data-n={st.jobsAll}>
                    {fmt(st.jobsAll)}
                    <small>
                      All time
                    </small>
                  </div>
                  <div className="lab h">
                    <span>
                      <i></i>
                      Hotlist consultants
                    </span>
                    <em className="v side-v">
                      For vendors
                    </em>
                  </div>
                  <div className="n" data-stat="hot24h" data-n={st.hot24h}>
                    {fmt(st.hot24h)}
                    <small>
                      24 hours
                    </small>
                  </div>
                  <div className="n" data-stat="hot7d" data-n={st.hot7d}>
                    {fmt(st.hot7d)}
                    <small>
                      7 days
                    </small>
                  </div>
                  <div className="n" data-stat="hot30d" data-n={st.hot30d}>
                    {fmt(st.hot30d)}
                    <small>
                      30 days
                    </small>
                  </div>
                  <div className="n" data-stat="hotAll" data-n={st.hotAll}>
                    {fmt(st.hotAll)}
                    <small>
                      All time
                    </small>
                  </div>
                </div>
                <p className="asof">
                  <span>{"From the ProfilePush database, "}<span data-asof="">{date}</span>{"."}</span>
                </p>
              </div>
            </section>
            <div className="divider" aria-hidden="true">
              <span className="ddc">
                <i></i>
                <i></i>
                <svg viewBox="0 0 10 16">
                  <use href="#ddchev"></use>
                </svg>
              </span>
            </div>
            <section className="sec" id="pricing" aria-labelledby="priceh">
              <div className="wrap">
                <span className="eyebrow">
                  Pricing
                </span>
                <h2 id="priceh" style={{ marginTop: "14px" }}>
                  {"Pay in credits. "}
                  <span className="grad">
                    Start free.
                  </span>
                </h2>
                <div className="price-grid">
                  <div className="free rv">
                    <div className="big grad">
                      100
                    </div>
                    <div className="u">
                      free credits that never expire
                    </div>
                    <div className="x">
                      +10 on your first post. +10 on your first submission.
                    </div>
                    <div className="ctas">
                      <Link className="btn btn-p side-v" to="/signup" data-path="vendor">
                        {"Match my requirement "}
                        <svg className="chev" aria-hidden="true">
                          <use href="#chev"></use>
                        </svg>
                      </Link>
                      <Link className="btn btn-b side-b" to="/signup" data-path="bench">
                        {"Match my bench "}
                        <svg className="chev" aria-hidden="true">
                          <use href="#chev"></use>
                        </svg>
                      </Link>
                    </div>
                  </div>
                  <div className="rv">
                    <ul className="plist">
                      <li className="side-b">
                        <span className="w">
                          <i className="b"></i>
                          In-app submissions
                        </span>
                        <span className="c f">
                          Free
                        </span>
                      </li>
                      <li className="side-v">
                        <span className="w">
                          <i className="v"></i>
                          AI Request draft
                        </span>
                        <span className="c f">
                          Free
                        </span>
                      </li>
                      <li>
                        <span className="w">
                          <i></i>
                          Posting
                        </span>
                        <span className="c f">
                          Free
                          <small>
                            3 open on the free plan
                          </small>
                        </span>
                      </li>
                      <li>
                        <span className="w">
                          <i></i>
                          Each new Tracker match
                        </span>
                        <span className="c">
                          ₹0.25
                        </span>
                      </li>
                      <li className="side-b">
                        <span className="w">
                          <i className="b"></i>
                          AI Submit draft
                        </span>
                        <span className="c">
                          Free
                        </span>
                      </li>
                      <li>
                        <span className="w">
                          <i></i>
                          Send from Gmail
                        </span>
                        <span className="c">
                          Free
                          <small>
                            refunded if it fails
                          </small>
                        </span>
                      </li>
                      <li className="side-v">
                        <span className="w">
                          <i className="v"></i>
                          Video screening
                        </span>
                        <span className="c">
                          10 credits
                        </span>
                      </li>
                      <li>
                        <span className="w">
                          <i></i>
                          Credit packs
                        </span>
                        <span className="c">
                          from ₹249
                          <small>
                            no subscription
                          </small>
                        </span>
                      </li>
                    </ul>
                    <div className="plegend x-both" aria-hidden="true">
                      <span>
                        <i style={{ background: "var(--blue)" }}></i>
                        Vendor
                      </span>
                      <span>
                        <i style={{ background: "var(--orange)" }}></i>
                        Bench sales
                      </span>
                      <span>
                        <i style={{ background: "var(--dim)" }}></i>
                        Both
                      </span>
                    </div>
                    <div className="trust">
                      <span className="fact">
                        Unlimited team members
                      </span>
                      <span className="fact">
                        Encrypted, never sold
                      </span>
                      <span className="fact">
                        The consultant is never contacted
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            <section className="sec" aria-labelledby="faqh" style={{ paddingTop: "0" }}>
              <div className="wrap">
                <h2 id="faqh">
                  Quick answers.
                </h2>
                <div className="faq">
                  {FAQS.map((f) => (
                    <details key={f.q}>
                      <summary>
                        {f.q + ' '}
                        <svg className="chev" aria-hidden="true">
                          <use href="#chev"></use>
                        </svg>
                      </summary>
                      <p>{f.a}</p>
                    </details>
                  ))}
                </div>
              </div>
            </section>
            <section aria-labelledby="finh">
              <h2 id="finh" className="sr">
                Pick your side
              </h2>
              <div className="final">
                <div className="fin v">
                  <span className="side-label">
                    <i></i>
                    I have a requirement
                  </span>
                  <h2>
                    Post a req.
                    <br />
                    Get consultants.
                  </h2>
                  <Link className="btn" to="/signup" data-path="vendor">
                    {"Match my requirement "}
                    <svg className="chev" aria-hidden="true">
                      <use href="#chev"></use>
                    </svg>
                  </Link>
                </div>
                <div className="fin b">
                  <span className="side-label">
                    <i></i>
                    I have consultants
                  </span>
                  <h2>
                    Paste a hotlist.
                    <br />
                    Get reqs.
                  </h2>
                  <Link className="btn" to="/signup" data-path="bench">
                    {"Match my bench "}
                    <svg className="chev" aria-hidden="true">
                      <use href="#chev"></use>
                    </svg>
                  </Link>
                </div>
                <div className="fin-core" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <use href="#mark"></use>
                  </svg>
                </div>
              </div>
              <AndroidApp source="home-final" label="Match alerts on your phone" className="fin-app" lazy />
            </section>
          </main>
          <div className="mbar away" id="mbar">
            <Link className="btn btn-p side-v" to="/signup" data-path="vendor">
              {"Match my requirement "}
              <svg className="chev" aria-hidden="true">
                <use href="#chev"></use>
              </svg>
            </Link>
            <Link className="btn btn-b x-b" to="/signup" data-path="bench">
              {"Match my bench "}
              <svg className="chev" aria-hidden="true">
                <use href="#chev"></use>
              </svg>
            </Link>
            <Link className="mlink x-both" to="/signup" data-path="bench">
              or match my bench
            </Link>
            <Link className="mlink x-v" to="/signup" data-path="bench">
              Have consultants?
            </Link>
            <Link className="mlink x-b" to="/signup" data-path="vendor">
              Have a req?
            </Link>
          </div>
    </div>
    <RatingBlock />
    <div ref={footRef}>
      <SiteFooter />
    </div>
    </>
  );
});
