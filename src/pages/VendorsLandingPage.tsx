import { memo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import LandingHeader from './landing/LandingHeader';
import { useLandingEngine } from './landing/useLandingEngine';
import { startVendors } from './landing/vendorsEngine';
import { fmt, fmtDate } from './landing/engine';
import { composeStoryData, initialSnapshot } from '../lib/marketSnapshot';
import type { StoryData } from '../lib/marketSnapshot';
import './landing/landing-shared.css';
import './landing/vendors.css';

// /vendors: ported from the approved demo (website-demos/profilepush-ai/vendors).
// The markup is static JSX; the motion runs from vendorsEngine on the root
// element and stops on unmount.

const TITLE = 'ProfilePush for Vendors — Matching Consultants, Live, for Every Requirement';
const DESCRIPTION = 'ProfilePush is the AI copilot for vendor teams. Paste a requirement and the form fills itself. Matching bench consultants land in your Tracker all day, and one tap sends an AI Request for the resume, rate, visa and availability, from your own Gmail.';
const CANONICAL = 'https://profilepush.ai/vendors';

const FAQS = [
  { q: "How do matching consultants reach me?", a: "Add a requirement and the AI Copilot matches it against bench consultants every day. Strong matches land in your Tracker, and you get a notification." },
  { q: "What is an AI Request?", a: "An email to the bench recruiter asking for the consultant’s resume, rate, visa status and availability. The draft is free, and it sends from your own Gmail." },
  { q: "Is video screening available?", a: "Yes, as an option. Tick “include a video screening link” on any request. The consultant records a short adaptive interview, and you get a recording, a score and a summary." },
  { q: "What costs credits?", a: "A post costs 1 credit. AI Request drafts and editing are free. Sending from your Gmail costs 1 credit, refunded if the send fails. A finished screening costs 10 credits. Credit packs start at ₹249." },
  { q: "Is my data safe?", a: "Yes. All data is encrypted, and it is never sold or shared. Emails send from your connected Gmail address." },
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
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://profilepush.ai/' },
        { '@type': 'ListItem', position: 2, name: 'Vendors', item: CANONICAL },
      ],
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQS.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ],
};

export default function VendorsLandingPage() {
  const [data] = useState(() => composeStoryData(initialSnapshot()));
  return (
    <>
      <SEO title={TITLE} description={DESCRIPTION} canonical={CANONICAL} jsonLd={PAGE_JSONLD} />
      <PageBody data={data} />
    </>
  );
}

// Memoised with stable props: the engine owns this DOM after mount, so React
// must not re-render it (auth changes only re-render the header).
const PageBody = memo(function PageBody({ data }: { data: StoryData }) {
  const { rootRef, footRef } = useLandingEngine(startVendors, data);
  const st = data.stats;
  const date = fmtDate(data.asOf);
  return (
    <>
    <div ref={rootRef} className="pp-lp pp-vendors">
          <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
            <defs>
              <symbol id="chev" viewBox="0 0 10 16">
                <path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"></path>
              </symbol>
            </defs>
          </svg>
          <LandingHeader active={'vendors'} startPath="vendor" />
    <main id="top">
            <section className="hero" aria-labelledby="h1">
              <canvas id="torrent" aria-hidden="true"></canvas>
              <div className="wrap hero-in">
                <span className="live intro">
                  <span className="pulse"></span>
                  <span>{"AI Copilot for vendors · "}<span data-asof="">{date}</span></span>
                </span>
                <h1 id="h1" className="intro d1">
                  <span className="num grad" id="hnum" data-stat="hot30d" data-n={st.hot30d}>
                    {fmt(st.hot30d)}
                  </span>
                  <span className="rest">
                    {"bench consultants in 30 days."}<br />Your AI Copilot finds the fits.
                  </span>
                </h1>
                <p className="sub intro d2">
                  Post your requirement. Your AI Copilot pushes the ones who fit into its column.
                </p>
                <div className="ctas intro d3">
                  <Link className="btn btn-p" to="/signup" data-path="vendor">
                    {"Match my requirement "}
                    <svg className="chev" aria-hidden="true">
                      <use href="#chev"></use>
                    </svg>
                  </Link>
                  <Link className="btn btn-g" to="/bench-sales">
                    {"Have consultants instead? "}
                    <svg className="chev" aria-hidden="true">
                      <use href="#chev"></use>
                    </svg>
                  </Link>
                </div>
                <a className="cue intro d4" href="#req">
                  {"Watch it sort "}
                  <span className="ddc" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <svg viewBox="0 0 10 16">
                      <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"></path>
                    </svg>
                  </span>
                </a>
              </div>
            </section>
            <section className="sec" id="req" aria-labelledby="reqh" style={{ paddingBottom: "clamp(40px,6vw,80px)" }}>
              <div className="wrap">
                <div className="rv">
                  <span className="step">
                    <b>
                      1
                    </b>
                    Your requirement
                  </span>
                  <h2 id="reqh" style={{ marginTop: "14px" }}>
                    {"Paste it. "}
                    <span className="grad">
                      The form fills itself.
                    </span>
                  </h2>
                  <p className="lede">
                    <span className="dk">
                      Skills, visa, rate and experience, pulled straight from the text you already have.
                    </span>
                    <span className="ph">
                      Skills, visa, rate and experience, pulled out.
                    </span>
                  </p>
                </div>
                <div className="parse-grid">
                  <figure className="paste rv" id="paste" aria-label="A requirement pasted as plain text">
                    <span className="pl">
                      Pasted, as you have it
                    </span>
                    <span id="pasteT"></span>
                  </figure>
                  <div className="bigchev" id="bigchev" aria-hidden="true">
                    <svg viewBox="0 0 40 112">
                      <path d="M7 7 33 56 7 105" fill="none" stroke="#2563eb" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"></path>
                    </svg>
                  </div>
                  <div className="col req" id="reqCard" aria-label="The requirement, structured"></div>
                </div>
                <p className="parse-note rv">
                  Posting costs 1 credit, and your first post earns 10 free credits.
                </p>
              </div>
            </section>
            <section className="filter" id="filter" aria-label="How ProfilePush sorts the bench for your requirement">
              {/* pinned, scroll-driven (desktop) */}
              <div className="fx-pin" id="fxPin">
                <div className="fx-stage">
                  <div className="wrap">
                    <div className="fx-bar">
                      <div className="caps" style={{ flex: "1" }}>
                        <div className="cap" data-cap="0">
                          <h2>
                            <span data-stat="hot24h">{fmt(st.hot24h)}</span>
                            {" today. "}
                            <span className="grad">
                              All at once.
                            </span>
                          </h2>
                          <p data-t="c0"></p>
                        </div>
                        <div className="cap" data-cap="1">
                          <h2>
                            {"Every profile, "}
                            <span className="grad">
                              read for you.
                            </span>
                          </h2>
                          <p>
                            Who doesn’t fit falls away. Who fits gets pushed forward.
                          </p>
                        </div>
                        <div className="cap" data-cap="2">
                          <h2>
                            {"Only "}
                            <span className="grad">
                              who fits.
                            </span>
                          </h2>
                          <p data-t="c2"></p>
                        </div>
                      </div>
                      <div>
                        <div className="fx-legend" aria-hidden="true">
                          <span className="kd c">
                            Consultant
                          </span>
                          <span>
                            ·
                          </span>
                          <span>
                            Columns are your requirements
                          </span>
                        </div>
                        <div className="fx-progress" aria-hidden="true">
                          {"Fits: "}
                          <b id="fxFit">
                            0
                          </b>
                          {" of "}
                          <b id="fxAll">
                            40
                          </b>
                        </div>
                      </div>
                    </div>
                    <div className="board" id="board"></div>
                  </div>
                </div>
              </div>
              {/* stacked scenes (phones and reduced motion): vertical ticker, vertical pull */}
              <div className="fx-stack" id="fxStack">
                <div className="wrap">
                  <div className="scene">
                    <div className="scene-l">
                      <b>
                        2
                      </b>
                      The bench
                    </div>
                    <h3>
                      <span data-stat="hot24h">{fmt(st.hot24h)}</span>
                      {" today."}                </h3>
                    <p className="fx-note">
                      Real hotlist rows from today, still arriving.
                    </p>
                    <div className="tk tk-big" id="tk1" aria-hidden="true"></div>
                  </div>
                  <div className="scene">
                    <div className="scene-l">
                      <b>
                        3
                      </b>
                      The push
                    </div>
                    <h3>
                      Only who fits.
                    </h3>
                    <p className="fx-note" data-t="c2m"></p>
                    <div className="seg" id="seg" role="tablist" aria-label="Your requirements"></div>
                    <div className="tk tk-sm" id="tk2" aria-hidden="true"></div>
                    <div className="pullchev" id="pullchev" aria-hidden="true">
                      <svg viewBox="0 0 32 20">
                        <path d="M4 4l12 12L28 4" fill="none" stroke="#2563eb" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"></path>
                      </svg>
                    </div>
                    <div className="scol" id="scol"></div>
                  </div>
                </div>
              </div>
            </section>
            <div className="divider" aria-hidden="true">
              <span className="ddc">
                <i></i>
                <i></i>
                <svg viewBox="0 0 10 16">
                  <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"></path>
                </svg>
              </span>
            </div>
            <section className="sec mailsec" aria-labelledby="mailh">
              <div className="wrap mail-grid">
                <div className="rv">
                  <span className="step">
                    <b>
                      5
                    </b>
                    AI Request
                  </span>
                  <h2 id="mailh" style={{ marginTop: "14px" }}>
                    {"The ask "}
                    <span className="grad">
                      writes itself.
                    </span>
                  </h2>
                  <p className="lede">
                    <span className="dk">
                      One tap asks the bench recruiter for resume, rate, visa and availability.
                    </span>
                    <span className="ph">
                      One tap asks for resume, rate, visa, availability.
                    </span>
                  </p>
                  <div className="pair" aria-label="The match">
                    <div className="pc" id="pair"></div>
                    <svg className="pushchev" viewBox="0 0 34 96" aria-hidden="true">
                      <path d="M6 6 28 48 6 90" fill="none" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"></path>
                    </svg>
                  </div>
                  <div className="facts">
                    <span className="fact">
                      Draft: free
                    </span>
                    <span className="fact">
                      Sends from your own Gmail
                    </span>
                    <span className="fact">
                      Send: 1 credit, refunded if it fails
                    </span>
                  </div>
                </div>
                <figure className="mail rv" id="mail" aria-label="The AI Request ProfilePush writes from this match" style={{ margin: "0" }}>
                  <div className="row">
                    <span className="k">
                      To
                    </span>
                    <span className="v mu" id="mTo"></span>
                  </div>
                  <div className="row">
                    <span className="k">
                      Subject
                    </span>
                    <span className="v" id="mSub"></span>
                  </div>
                  <div className="body" id="mBody"></div>
                  <div id="mExtra"></div>
                  <div className="pushrow" id="pushrow">
                    <span className="ddc" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <svg viewBox="0 0 10 16">
                        <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"></path>
                      </svg>
                    </span>
                    <span id="mFoot">
                      Sends from your own Gmail
                    </span>
                  </div>
                </figure>
              </div>
            </section>
            <section className="sec" id="tracker" aria-labelledby="trkh">
              <div className="wrap trk-grid">
                <div className="live-col rv" id="liveWrap" aria-label="Your requirement's Tracker column, updating">
                  <div className="col" id="liveCol"></div>
                  <div className="toast" id="toast" aria-hidden="true">
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
                      <span id="toastT"></span>
                    </div>
                  </div>
                </div>
                <div className="rv trk-head">
                  <span className="step">
                    <b>
                      6
                    </b>
                    The Tracker
                  </span>
                  <h2 id="trkh" style={{ marginTop: "14px" }}>
                    {"Your column "}
                    <span className="grad">
                      keeps filling.
                    </span>
                  </h2>
                  <p className="lede">
                    <span className="dk">
                      Matching consultants land all day. You pick who goes to the client.
                    </span>
                    <span className="ph">
                      Matches land all day. You pick.
                    </span>
                  </p>
                </div>
                <ul className="feat trk-feat rv">
                  <li>
                    <span className="ddc" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <svg viewBox="0 0 10 16">
                        <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round"></path>
                      </svg>
                    </span>
                    An alert when a strong one lands
                  </li>
                  <li>
                    <span className="ddc" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <svg viewBox="0 0 10 16">
                        <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round"></path>
                      </svg>
                    </span>
                    Nothing asked twice
                  </li>
                  <li>
                    <span className="ddc" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <svg viewBox="0 0 10 16">
                        <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round"></path>
                      </svg>
                    </span>
                    AI Match: ranked fit and skill gaps
                  </li>
                  <li>
                    <span className="ddc" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <svg viewBox="0 0 10 16">
                        <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round"></path>
                      </svg>
                    </span>
                    Reposts merged into one card
                  </li>
                  <li>
                    <span className="ddc" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <svg viewBox="0 0 10 16">
                        <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round"></path>
                      </svg>
                    </span>
                    “Not a match” never comes back
                  </li>
                  <li>
                    <span className="ddc" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <svg viewBox="0 0 10 16">
                        <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round"></path>
                      </svg>
                    </span>
                    Team accounts, unlimited members
                  </li>
                </ul>
              </div>
            </section>
            <section className="sec mailsec" id="screening" aria-labelledby="scrh">
              <div className="wrap scr-grid">
                <div className="rv">
                  <span className="step">
                    <b>
                      7
                    </b>
                    Video screening · optional
                  </span>
                  <h2 id="scrh" style={{ marginTop: "14px" }}>
                    {"Meet them "}
                    <span className="grad">
                      before you call.
                    </span>
                  </h2>
                  <p className="lede">
                    <span className="dk">
                      Tick one box on any request. The consultant records a short adaptive interview; you get the recording, a score and a summary.
                    </span>
                    <span className="ph">
                      One tick. Recording, score, summary.
                    </span>
                  </p>
                  <div className="facts">
                    <span className="fact">
                      Optional on any request
                    </span>
                    <span className="fact">
                      10 credits per finished screening
                    </span>
                  </div>
                </div>
                <figure className="scard rv" id="scard" aria-label="What a finished screening gives you: recording, score and summary">
                  <div className="sc-top">
                    <span className="ava" aria-hidden="true">
                      <span className="ddc">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <path d="M2 2l6 6-6 6" fill="none" stroke="#60a5fa" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </span>
                    </span>
                    <div>
                      <b id="scT"></b>
                      <span id="scS"></span>
                    </div>
                    <span className="dtag">
                      Screening finished
                    </span>
                  </div>
                  <div className="sc-sec">
                    <div className="sc-l">
                      {"Adaptive interview "}
                      <em>
                        each question follows the last answer
                      </em>
                    </div>
                    <div className="qs" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                  </div>
                  <div className="sc-sec">
                    <div className="sc-l">
                      Recording
                    </div>
                    <div className="rec">
                      <span className="play" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="#fff">
                          <path d="M7 4.5v15l12.5-7.5Z"></path>
                        </svg>
                      </span>
                      <div className="wave" id="wave" aria-hidden="true"></div>
                    </div>
                  </div>
                  <div className="sc-sec">
                    <div className="sc-row">
                      <div>
                        <div className="sc-l" style={{ marginBottom: "8px" }}>
                          Score
                        </div>
                        <div className="ring" aria-hidden="true">
                          <svg viewBox="0 0 84 84">
                            <defs>
                              <linearGradient id="rg" x1="0" x2="1" y1="0" y2="1">
                                <stop offset="0" stopColor="#2563eb"></stop>
                                <stop offset=".6" stopColor="#f97316"></stop>
                                <stop offset="1" stopColor="#facc15"></stop>
                              </linearGradient>
                            </defs>
                            <circle cx="42" cy="42" r="36" fill="none" stroke="#e2e8f0" strokeWidth="8"></circle>
                            <circle className="arc" cx="42" cy="42" r="36" fill="none" stroke="url(#rg)" strokeWidth="8" strokeLinecap="round"></circle>
                          </svg>
                          <span className="ddc">
                            <i></i>
                            <i></i>
                            <svg viewBox="0 0 10 16">
                              <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"></path>
                            </svg>
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="sc-l" style={{ marginBottom: "12px" }}>
                          Summary
                        </div>
                        <div className="lns" aria-hidden="true">
                          <div className="ln" style={{ "--w": "96%" } as CSSProperties}></div>
                          <div className="ln" style={{ "--w": "84%" } as CSSProperties}></div>
                          <div className="ln" style={{ "--w": "90%" } as CSSProperties}></div>
                          <div className="ln" style={{ "--w": "58%" } as CSSProperties}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="sc-f">
                    <span>
                      Added to the request with one tick
                    </span>
                    <span>
                      <b>
                        10 credits
                      </b>
                      , only when finished
                    </span>
                  </div>
                </figure>
              </div>
            </section>
            <section className="sec numsec" aria-labelledby="numh">
              <div className="wrap">
                <span className="eyebrow">
                  The live bench
                </span>
                <h2 id="numh" style={{ marginTop: "14px" }}>
                  {"The bench, "}
                  <span className="grad">
                    counted.
                  </span>
                </h2>
                <div className="nums three rv" id="nums">
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
                  <div className="lab h">
                    <i></i>
                    Hotlist consultants
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
                </div>
                <p className="asof">
                  <span>{"New bench consultants added to ProfilePush, from the database on "}<span data-asof="">{date}</span>{". Each one is matched against your requirements the day they become available."}</span>
                </p>
              </div>
            </section>
            <section className="sec" aria-labelledby="priceh">
              <div className="wrap">
                <span className="eyebrow">
                  Pricing
                </span>
                <h2 id="priceh" style={{ marginTop: "14px" }}>
                  {"Credits, "}
                  <span className="grad">
                    not contracts.
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
                      +10 more on your first post.
                    </div>
                    <div className="ctas">
                      <Link className="btn btn-p" to="/signup" data-path="vendor">
                        {"Match my requirement "}
                        <svg className="chev" aria-hidden="true">
                          <use href="#chev"></use>
                        </svg>
                      </Link>
                    </div>
                  </div>
                  <div className="rv">
                    <ul className="plist">
                      <li>
                        Match a requirement
                        <span className="c">
                          1 credit
                        </span>
                      </li>
                      <li>
                        AI Request draft
                        <span className="c f">
                          Free
                        </span>
                      </li>
                      <li>
                        Editing
                        <span className="c f">
                          Free
                        </span>
                      </li>
                      <li>
                        Send from your Gmail
                        <span className="c">
                          1 credit
                          <small>
                            refunded if it fails
                          </small>
                        </span>
                      </li>
                      <li>
                        Video screening
                        <span className="c">
                          10 credits
                          <small>
                            per finished screening
                          </small>
                        </span>
                      </li>
                      <li>
                        Credit packs
                        <span className="c">
                          from ₹249
                          <small>
                            no subscription
                          </small>
                        </span>
                      </li>
                    </ul>
                    <div className="trust">
                      <span className="fact">
                        Unlimited team members
                      </span>
                      <span className="fact">
                        Encrypted, never sold or shared
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            <div className="divider" aria-hidden="true">
              <span className="ddc">
                <i></i>
                <i></i>
                <svg viewBox="0 0 10 16">
                  <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"></path>
                </svg>
              </span>
            </div>
            <section className="sec" aria-labelledby="alsoh">
              <div className="wrap">
                <span className="eyebrow">
                  Also on ProfilePush
                </span>
                <h2 id="alsoh" style={{ marginTop: "14px" }}>
                  {"Other side? "}
                  <span className="grad">
                    Other doors.
                  </span>
                </h2>
                <div className="also" style={{ gridTemplateColumns: "1fr", maxWidth: "640px" }}>
                  <div className="acard b rv">
                    <h3>
                      Have consultants instead?
                    </h3>
                    <p>
                      Paste your hotlist and every consultant gets a live column of matching requirements. Submissions are free and unlimited.
                    </p>
                    <Link className="btn btn-o" to="/bench-sales">
                      {"Bench sales "}
                      <svg className="chev" aria-hidden="true">
                        <use href="#chev"></use>
                      </svg>
                    </Link>
                  </div>
                </div>
              </div>
            </section>
            <section className="sec" aria-labelledby="faqh" style={{ paddingTop: "0" }}>
              <div className="wrap">
                <h2 id="faqh">
                  Before you post.
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
            <section className="sec final" aria-labelledby="finh">
              <div className="wrap">
                <span className="ddc" aria-hidden="true" style={{ transform: "scale(1.6)", marginBottom: "34px" }}>
                  <i></i>
                  <i></i>
                  <svg viewBox="0 0 10 16">
                    <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"></path>
                  </svg>
                </span>
                <h2 id="finh">
                  <span>
                    Fill the requirement
                  </span>
                  <span className="grad">
                    faster.
                  </span>
                </h2>
                <p className="fsub">
                  Let the AI Copilot bring you the consultants.
                </p>
                <div className="ctas">
                  <Link className="btn btn-p" to="/signup" data-path="vendor">
                    {"Match my requirement "}
                    <svg className="chev" aria-hidden="true">
                      <use href="#chev"></use>
                    </svg>
                  </Link>
                </div>
                <Link className="tlink" to="/bench-sales">
                  {"Have consultants instead? "}
                  <svg className="chev" aria-hidden="true">
                    <use href="#chev"></use>
                  </svg>
                </Link>
              </div>
            </section>
          </main>
          <div className="mbar away" id="mbar">
            <Link className="btn btn-p" to="/signup" data-path="vendor">
              {"Match my requirement "}
              <svg className="chev" aria-hidden="true">
                <use href="#chev"></use>
              </svg>
            </Link>
            <Link className="mlink" to="/bench-sales">
              Have consultants?
            </Link>
          </div>
    </div>
    <div ref={footRef}>
      <SiteFooter />
    </div>
    </>
  );
});
