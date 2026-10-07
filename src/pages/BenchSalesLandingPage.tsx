import { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import LandingHeader from './landing/LandingHeader';
import { useLandingEngine } from './landing/useLandingEngine';
import { startBench } from './landing/benchEngine';
import { fmt, fmtDate } from './landing/engine';
import { composeStoryData, initialSnapshot } from '../lib/marketSnapshot';
import type { StoryData } from '../lib/marketSnapshot';
import './landing/landing-shared.css';
import './landing/bench.css';

// /bench-sales: ported from the approved demo (website-demos/profilepush-ai/bench-sales).
// The markup is static JSX; the motion runs from benchEngine on the root
// element and stops on unmount.

const TITLE = 'ProfilePush for Bench Sales — Live Requirements Matched to Every Consultant';
const DESCRIPTION = 'ProfilePush is the AI copilot for bench sales recruiters. Paste your hotlist and every consultant gets a live column of matching requirements. AI Submit writes the email, attaches the resume and sends it from your Gmail. Submissions are free and unlimited.';
const CANONICAL = 'https://profilepush.ai/bench-sales';

const FAQS = [
  { q: "How do I find the prime vendors?", a: "Every new requirement is matched against your consultants. The vendors posting what your bench fits show up first, in each consultant’s column." },
  { q: "Do I need to keep checking?", a: "No. You get a notification when strong matches land, and an email if new matches are waiting and you haven’t been back." },
  { q: "Can I post the whole bench at once?", a: "Yes. Paste the hotlist table. Every consultant on it is read and posted together." },
  { q: "What does submitting cost?", a: "Nothing. Submissions are free and unlimited. Optional screening credits are charged to the vendor who owns the requirement." },
  { q: "Does my consultant need an account?", a: "No, and we never contact them. The screening link goes to you only." },
  { q: "Can I see which skills are in demand?", a: "Yes. Filter every live requirement by skill, rate, visa and location, with a live count on each." },
  { q: "Is my data safe?", a: "Yes. It is encrypted, and never sold or shared. Vendors get no way to contact the consultants on your hotlist." },
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
        { '@type': 'ListItem', position: 2, name: 'Bench Sales', item: CANONICAL },
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

export default function BenchSalesLandingPage() {
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
  const { rootRef, footRef } = useLandingEngine(startBench, data);
  const st = data.stats;
  const date = fmtDate(data.asOf);
  return (
    <>
    <div ref={rootRef} className="pp-lp pp-bench">
          <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
            <defs>
              <symbol id="chev" viewBox="0 0 10 16">
                <path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"></path>
              </symbol>
              <symbol id="ddc" viewBox="0 0 10 16">
                <path d="M2 2l6 6-6 6" fill="none" stroke="#2563eb" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"></path>
              </symbol>
            </defs>
          </svg>
          <LandingHeader active={'bench-sales'} startPath="bench" />
    <main id="top">
            <section className="hero" aria-labelledby="h1">
              <canvas id="torrent" aria-hidden="true"></canvas>
              <div className="wrap hero-in">
                <span className="live intro">
                  <span className="pulse"></span>
                  <span>{"For bench sales · Live market, "}<span data-asof="">{date}</span></span>
                </span>
                <h1 id="h1" className="intro d1">
                  <span className="num grad" id="hnum" data-stat="jobs30d" data-n={st.jobs30d}>
                    {fmt(st.jobs30d)}
                  </span>
                  <span className="rest">
                    <span>
                      {"requirements in 30 days."}
                    </span>
                    <span>
                      Your bench fits some.
                    </span>
                  </span>
                </h1>
                <p className="sub intro d2">
                  Paste your hotlist. Each consultant gets a live column of reqs that fit.
                </p>
                <div className="ctas intro d3">
                  <Link className="btn btn-p" to="/signup" data-path="bench">
                    {"Match my bench "}
                    <svg className="chev" aria-hidden="true">
                      <use href="#chev"></use>
                    </svg>
                  </Link>
                  <Link className="btn btn-g" to="/vendors">
                    {"Have requirements instead? "}
                    <svg className="chev" aria-hidden="true">
                      <use href="#chev"></use>
                    </svg>
                  </Link>
                </div>
                <a className="cue intro d4" href="#paste">
                  {"See how it works "}
                  <span className="ddc" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <svg viewBox="0 0 10 16">
                      <use href="#ddc"></use>
                    </svg>
                  </span>
                </a>
              </div>
            </section>
            {/* 1. paste the hotlist */}
            <section className="sec" id="paste" aria-labelledby="pasteh">
              <div className="wrap paste-grid">
                <div className="rv">
                  <span className="eyebrow">
                    <b>
                      1
                    </b>
                    Post the bench
                  </span>
                  <h2 id="pasteh" style={{ marginTop: "14px" }}>
                    One paste.
                    <br />
                    <span className="grad">
                      A column each.
                    </span>
                  </h2>
                  <p className="lede">
                    <span className="dk">
                      Paste the hotlist table exactly as it is. Every consultant on it gets a column of their own.
                    </span>
                    <span className="ph">
                      Paste it as is. One column per consultant.
                    </span>
                  </p>
                  <div className="ptag">
                    <span className="fact">
                      The whole bench at once
                    </span>
                    <span className="fact">
                      Editing is always free
                    </span>
                  </div>
                </div>
                <div className="pbox" id="pbox" aria-label="A pasted hotlist turning into one column per consultant">
                  <div className="sheet">
                    <div className="sheet-l">
                      <span>
                        Your hotlist
                      </span>
                      <span className="kbd">
                        Paste
                      </span>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">
                            Consultant
                          </th>
                          <th scope="col">
                            Exp
                          </th>
                          <th scope="col">
                            Visa
                          </th>
                          <th scope="col">
                            Location
                          </th>
                        </tr>
                      </thead>
                      <tbody id="ptab"></tbody>
                    </table>
                    <div className="scan" aria-hidden="true"></div>
                  </div>
                  <div className="heads" id="heads" aria-hidden="true"></div>
                </div>
              </div>
            </section>
            {/* 2. the flood and the push */}
            <section className="filter" id="filter" aria-label="Today's requirements, pushed into each consultant's column">
              <div className="fx-pin" id="fxPin">
                <div className="fx-stage">
                  <div className="wrap">
                    <div className="fx-bar">
                      <div className="caps">
                        <div className="cap" data-cap="0">
                          <h2>
                            {"Today’s flood. "}
                            <span className="grad">
                              All at once.
                            </span>
                          </h2>
                          <p>
                            <span data-stat="jobs24h">{fmt(st.jobs24h)}</span>
                            {" requirements in 24 hours. Here are 40 real ones from the last few minutes."}                      </p>
                        </div>
                        <div className="cap" data-cap="1">
                          <h2>
                            {"Read against "}
                            <span className="grad">
                              every consultant.
                            </span>
                          </h2>
                          <p>
                            What doesn’t fit falls away. What fits gets pushed.
                          </p>
                        </div>
                        <div className="cap" data-cap="2">
                          <h2>
                            {"Each consultant, "}
                            <span className="grad">
                              their own column.
                            </span>
                          </h2>
                          <p>
                            8 of 40 fit. A repost merged into one card. Submit first, not fiftieth.
                          </p>
                        </div>
                      </div>
                      <div className="fx-side">
                        <span className="eyebrow">
                          <b>
                            2
                          </b>
                          The push
                        </span>
                        <br />
                        <div className="fx-progress" aria-hidden="true">
                          {"Fits: "}
                          <b id="fxFit">
                            0
                          </b>
                          {" of "}
                          <b>
                            40
                          </b>
                        </div>
                      </div>
                    </div>
                    <div className="board" id="board"></div>
                  </div>
                </div>
              </div>
              <div className="fx-stack" id="fxStack">
                <div className="wrap">
                  <span className="eyebrow">
                    <b>
                      2
                    </b>
                    The push
                  </span>
                  <h2 style={{ marginTop: "14px" }}>
                    {"Today’s reqs, "}
                    <span className="grad">
                      sorted.
                    </span>
                  </h2>
                  <p className="fx-lede">
                    What fits gets pulled into a column.
                  </p>
                  <div className="seg" id="seg" role="tablist" aria-label="Consultant columns"></div>
                  <div className="tick" aria-hidden="true">
                    <div className="tick-h">
                      <span className="pulse"></span>
                      Live requirements
                      <em>
                        <span data-stat="jobs24h">{fmt(st.jobs24h)}</span>
                        {" in 24h"}                  </em>
                    </div>
                    <div className="tick-l" id="tickL"></div>
                  </div>
                  <div className="pull" id="pull" aria-hidden="true">
                    <span className="ddc">
                      <i></i>
                      <i></i>
                      <svg viewBox="0 0 10 16">
                        <use href="#ddc"></use>
                      </svg>
                    </span>
                  </div>
                  <div className="scol" id="scol" role="tabpanel"></div>
                  <p className="fx-note">
                    Reposts merge into one card. Submit first, not fiftieth.
                  </p>
                </div>
              </div>
            </section>
            <div className="divider" aria-hidden="true">
              <span className="ddc">
                <i></i>
                <i></i>
                <svg viewBox="0 0 10 16">
                  <use href="#ddc"></use>
                </svg>
              </span>
            </div>
            {/* 3. AI Submit */}
            <section className="sec mailsec" aria-labelledby="mailh">
              <div className="wrap mail-grid">
                <div className="rv">
                  <span className="eyebrow">
                    <b>
                      3
                    </b>
                    AI Submit
                  </span>
                  <h2 id="mailh" style={{ marginTop: "14px" }}>
                    The pitch
                    <br />
                    <span className="grad">
                      writes itself.
                    </span>
                  </h2>
                  <p className="lede">
                    <span className="dk">
                      Drafted from the match, resume attached, sent from your own Gmail.
                    </span>
                    <span className="ph">
                      Resume attached. Sent from your Gmail.
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
                      Submissions: free, unlimited
                    </span>
                    <span className="fact">
                      Attach the resume once
                    </span>
                    <span className="fact">
                      AI Submit draft: 1 credit
                    </span>
                  </div>
                </div>
                <figure className="mail rv" id="mail" aria-label="The submission email AI Submit writes from this match">
                  <div className="row">
                    <span className="k">
                      To
                    </span>
                    <span className="v mu">
                      The recruiter on this requirement
                    </span>
                  </div>
                  <div className="row">
                    <span className="k">
                      Subject
                    </span>
                    <span className="v" id="mSub"></span>
                  </div>
                  <div className="body" id="mBody"></div>
                  <span className="att">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path>
                      <path d="M14 2v6h6"></path>
                    </svg>
                    Resume.pdf
                  </span>
                  <div className="pushrow" id="pushrow">
                    <span className="ddc" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <svg viewBox="0 0 10 16">
                        <use href="#ddc"></use>
                      </svg>
                    </span>
                    <span>
                      Sends from your Gmail · 1 credit, refunded if it fails
                    </span>
                  </div>
                </figure>
              </div>
            </section>
            {/* 4. inbound requests */}
            <section className="sec" id="inbound" aria-labelledby="inh" style={{ paddingTop: "clamp(56px,8vw,110px)" }}>
              <div className="wrap in-grid">
                <div className="reqs rv" id="reqs" aria-label="Inbound resume requests">
                  <div className="reqs-h">
                    <b>
                      Resume requests
                    </b>
                    <span className="tag am" id="reqOpen">
                      1 open
                    </span>
                  </div>
                  <div id="rqList"></div>
                  <div className="reqs-f">
                    <span className="ddc" aria-hidden="true">
                      <i></i>
                      <i></i>
                      <svg viewBox="0 0 10 16">
                        <use href="#ddc"></use>
                      </svg>
                    </span>
                    Replying never costs a credit
                  </div>
                </div>
                <div className="rv">
                  <span className="eyebrow">
                    <b>
                      4
                    </b>
                    Inbound
                  </span>
                  <h2 id="inh" style={{ marginTop: "14px" }}>
                    Vendors ask.
                    <br />
                    <span className="grad">
                      One list.
                    </span>
                  </h2>
                  <p className="lede">
                    <span className="dk">
                      When a vendor wants a resume from your hotlist, it lands here with a clear status. Upload the resume, add a note, done.
                    </span>
                    <span className="ph">
                      Upload the resume, add a note. No credit.
                    </span>
                  </p>
                  <div className="facts">
                    <span className="fact">
                      No credit charge
                    </span>
                    <span className="fact">
                      Clear status on every request
                    </span>
                  </div>
                </div>
              </div>
            </section>
            {/* 5. live tracker */}
            <section className="sec" id="tracker" aria-labelledby="trkh" style={{ paddingTop: "0" }}>
              <div className="wrap trk-grid">
                <div className="live-col rv" id="liveWrap" aria-label="A consultant's Tracker column, updating">
                  <div className="col c0" id="liveCol"></div>
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
                <div className="rv">
                  <span className="eyebrow">
                    <b>
                      5
                    </b>
                    The Tracker
                  </span>
                  <h2 id="trkh" style={{ marginTop: "14px" }}>
                    It never
                    <br />
                    <span className="grad">
                      stops filling.
                    </span>
                  </h2>
                  <p className="lede">
                    <span className="dk">
                      New matches land in every consultant’s column all day. You pick and submit.
                    </span>
                    <span className="ph">
                      New matches land all day, with alerts.
                    </span>
                  </p>
                  <ul className="feat">
                    <li>
                      <span className="ddc" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <use href="#ddc"></use>
                        </svg>
                      </span>
                      An alert when a strong match lands
                    </li>
                    <li>
                      <span className="ddc" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <use href="#ddc"></use>
                        </svg>
                      </span>
                      An email if matches wait while you’re away
                    </li>
                    <li>
                      <span className="ddc" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <use href="#ddc"></use>
                        </svg>
                      </span>
                      AI Match: ranked fit and skill gaps
                    </li>
                    <li>
                      <span className="ddc" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <use href="#ddc"></use>
                        </svg>
                      </span>
                      “Not a match” never comes back
                    </li>
                    <li>
                      <span className="ddc" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <use href="#ddc"></use>
                        </svg>
                      </span>
                      Filter live reqs by skill, rate, visa, location
                    </li>
                    <li>
                      <span className="ddc" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <svg viewBox="0 0 10 16">
                          <use href="#ddc"></use>
                        </svg>
                      </span>
                      Team accounts, unlimited members
                    </li>
                  </ul>
                </div>
              </div>
            </section>
            <div className="divider" aria-hidden="true">
              <span className="ddc">
                <i></i>
                <i></i>
                <svg viewBox="0 0 10 16">
                  <use href="#ddc"></use>
                </svg>
              </span>
            </div>
            {/* 6. screening */}
            <section className="sec" aria-labelledby="scrh">
              <div className="wrap scr-grid">
                <div className="rv">
                  <span className="eyebrow">
                    <b>
                      6
                    </b>
                    Optional
                  </span>
                  <h2 id="scrh" style={{ marginTop: "14px" }}>
                    Screening,
                    <br />
                    <span className="grad">
                      if it helps.
                    </span>
                  </h2>
                  <ol className="steps">
                    <li>
                      Add a short video screening link to a submission.
                    </li>
                    <li>
                      You share it with your consultant.
                    </li>
                    <li>
                      The vendor sees a real person, a score and a recording.
                    </li>
                  </ol>
                  <div className="never">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path>
                    </svg>
                    <div>
                      <b>
                        We never contact your consultant.
                      </b>
                      <span>
                        <span className="dk">
                          The link goes only to you. No emails, no account, no marketing. Nobody comes between you and your bench.
                        </span>
                        <span className="ph">
                          The link goes only to you.
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="scr rv" id="scr" aria-label="Example screening result card">
                  <div className="scr-top">
                    <span className="ava" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <circle cx="5" cy="6.4" r="3.6" fill="#facc15"></circle>
                        <circle cx="5" cy="17.6" r="3.6" fill="#f97316"></circle>
                        <path d="M12.6 3.4 20.4 12l-7.8 8.6" fill="none" stroke="#2563eb" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"></path>
                      </svg>
                    </span>
                    <div>
                      <b>
                        Video screening
                      </b>
                      <span id="scrWho"></span>
                    </div>
                    <span className="tag ok">
                      Complete
                    </span>
                  </div>
                  <div className="rec">
                    <span className="play" aria-hidden="true">
                      <svg viewBox="0 0 12 14">
                        <path d="M1 1l10 6-10 6z" fill="#fff"></path>
                      </svg>
                    </span>
                    <div className="wave" id="wave" aria-hidden="true"></div>
                    <small>
                      Recording
                    </small>
                  </div>
                  <div className="srows">
                    <div className="srow">
                      <span className="k">
                        Score
                      </span>
                      <span className="v">
                        Ready for the vendor
                      </span>
                    </div>
                    <div className="srow">
                      <span className="k">
                        Recording
                      </span>
                      <span className="v">
                        Ready
                      </span>
                    </div>
                    <div className="srow">
                      <span className="k">
                        Link sent to
                      </span>
                      <span className="v">
                        You only
                      </span>
                    </div>
                    <div className="srow">
                      <span className="k">
                        Cost
                      </span>
                      <span className="v">
                        10 credits, paid by the vendor
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            {/* the market, counted */}
            <section className="sec numsec" aria-labelledby="numh">
              <div className="wrap">
                <span className="eyebrow">
                  The live market
                </span>
                <h2 id="numh" style={{ marginTop: "14px" }}>
                  {"Requirements, "}
                  <span className="grad">
                    counted.
                  </span>
                </h2>
                <div className="big3 rv" id="nums">
                  <div>
                    <div className="n" data-stat="jobs24h" data-n={st.jobs24h}>
                      {fmt(st.jobs24h)}
                    </div>
                    <div className="l">
                      <i></i>
                      Last 24 hours
                    </div>
                  </div>
                  <div>
                    <div className="n" data-stat="jobs7d" data-n={st.jobs7d}>
                      {fmt(st.jobs7d)}
                    </div>
                    <div className="l">
                      <i></i>
                      Last 7 days
                    </div>
                  </div>
                  <div>
                    <div className="n" data-stat="jobs30d" data-n={st.jobs30d}>
                      {fmt(st.jobs30d)}
                    </div>
                    <div className="l">
                      <i></i>
                      Last 30 days
                    </div>
                  </div>
                </div>
                <p className="asof">
                  <span>{"Requirements posted on ProfilePush. From our database, "}<span data-asof="">{date}</span>{"."}</span>
                </p>
              </div>
            </section>
            {/* pricing */}
            <section className="sec" aria-labelledby="priceh">
              <div className="wrap">
                <span className="eyebrow">
                  Pricing
                </span>
                <h2 id="priceh" style={{ marginTop: "14px" }}>
                  {"Submit free. "}
                  <span className="grad">
                    Forever.
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
                      <Link className="btn btn-p" to="/signup" data-path="bench">
                        {"Match my bench "}
                        <svg className="chev" aria-hidden="true">
                          <use href="#chev"></use>
                        </svg>
                      </Link>
                    </div>
                  </div>
                  <div className="rv">
                    <ul className="plist">
                      <li>
                        Submissions
                        <span className="c f">
                          Free, unlimited
                        </span>
                      </li>
                      <li>
                        Replying to resume requests
                        <span className="c f">
                          Free
                        </span>
                      </li>
                      <li>
                        A post
                        <span className="c">
                          1 credit
                        </span>
                      </li>
                      <li>
                        AI Submit draft
                        <span className="c">
                          1 credit
                        </span>
                      </li>
                      <li>
                        Send from Gmail
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
                            charged to the vendor
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
                        Encrypted, never sold
                      </span>
                      <span className="fact">
                        Your consultant is never contacted
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            {/* faq */}
            <section className="sec" aria-labelledby="faqh" style={{ paddingTop: "0" }}>
              <div className="wrap">
                <h2 id="faqh">
                  Fair questions.
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
            {/* final */}
            <section className="sec final" aria-labelledby="finh">
              <div className="wrap">
                <span className="ddc" aria-hidden="true" style={{ transform: "scale(1.6)", marginBottom: "34px" }}>
                  <i></i>
                  <i></i>
                  <svg viewBox="0 0 10 16">
                    <use href="#ddc"></use>
                  </svg>
                </span>
                <h2 id="finh">
                  <span>
                    Get the bench in front of
                  </span>
                  <span className="grad">
                    prime vendors.
                  </span>
                </h2>
                <p className="sub2">
                  Stop pasting the same hotlist everywhere.
                </p>
                <div className="ctas">
                  <Link className="btn btn-p" to="/signup" data-path="bench">
                    {"Match my bench "}
                    <svg className="chev" aria-hidden="true">
                      <use href="#chev"></use>
                    </svg>
                  </Link>
                  <Link className="btn btn-g" to="/vendors">
                    {"Have requirements instead? "}
                    <svg className="chev" aria-hidden="true">
                      <use href="#chev"></use>
                    </svg>
                  </Link>
                </div>
              </div>
            </section>
          </main>
          <div className="mbar away" id="mbar">
            <Link className="btn btn-p" to="/signup" data-path="bench">
              {"Match my bench "}
              <svg className="chev" aria-hidden="true">
                <use href="#chev"></use>
              </svg>
            </Link>
            <Link className="mlink" to="/vendors">
              Have reqs?
            </Link>
          </div>
    </div>
    <div ref={footRef}>
      <SiteFooter />
    </div>
    </>
  );
});
