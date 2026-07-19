import Link from "next/link";
import {
  publicJudgeEndpoints,
  submissionLinks,
  txlineEndpoints,
} from "../../lib/submission";

const technicalHighlights = [
  "The live reducer handles snapshots, SSE updates and the synthetic production-path rehearsal; the Demo Lab is a separate deterministic simulator.",
  "The sharp-movement detector reacts to consensus shocks, confirmed score events and stale data.",
  "The paper market maker cancels unsafe quotes, enforces a hold, then reopens only after stable recovery evidence.",
  "Live mode fails closed: missing credentials or invalid contracts never fall back to synthetic data.",
  "TxLINE credentials remain server-side, and Solana verification is never claimed without a genuine successful validation.",
];

const videoRunSheet = [
  ["0:00–0:30", "Problem", "Goals, odds shocks and stale feeds can leave unsafe quotes exposed."],
  ["0:30–0:55", "Product", "ProofSwitch is an autonomous in-play risk operator for trading teams and market makers."],
  ["0:55–2:20", "Working app", "Run the goal-shock walkthrough: detect, cancel, hold, stabilise and reopen."],
  ["2:20–3:35", "TxLINE backend", "Show the fixture, snapshot and SSE adapters around the production reducer; identify the recording as a synthetic rehearsal rather than a credential-backed session."],
  ["3:35–4:20", "Evidence", "Review the scorecard, audit trail, paper execution and guarded Solana boundary."],
  ["4:20–4:48", "Close", "Explain the business value, Trading Tools and Agents fit, public app and repository."],
] as const;

const screeningRequirements = [
  {
    title: "Demo video",
    evidence: "Published · 4:48",
    detail: "Problem, working product, backend path and evidence boundary.",
    href: submissionLinks.demoVideo,
  },
  {
    title: "Public repository",
    evidence: "Published",
    detail: "Source, architecture, tests and safety documentation.",
    href: submissionLinks.repository,
  },
  {
    title: "Application access",
    evidence: "Working deployment",
    detail: "Interactive agent, JSON endpoints and resumable synthetic SSE.",
    href: submissionLinks.application,
  },
  {
    title: "Technical documentation",
    evidence: "Complete",
    detail: "Core idea, business case, architecture and exact endpoint mapping.",
    href: "#technical-overview",
  },
  {
    title: "TxLINE feedback",
    evidence: "Complete with boundary",
    detail: "What worked, friction and the observations still unknown before live access.",
    href: "#txline-feedback",
  },
] as const;

const judgePath = [
  {
    step: "01",
    title: "Watch the complete demo",
    detail: "4 minutes 48 seconds",
    href: submissionLinks.demoVideo,
    action: "Play video",
  },
  {
    step: "02",
    title: "Run the autonomous scenario",
    detail: "About 90 seconds · two evidence checkpoints",
    href: "/?judge=1",
    action: "Start walkthrough",
  },
  {
    step: "03",
    title: "Inspect source and contracts",
    detail: "Public repository plus machine-readable manifest",
    href: "/api/submission",
    action: "Open manifest",
  },
] as const;

const trackEvidence = [
  {
    verb: "Ingest",
    title: "TxLINE-shaped odds and scores",
    detail: "Fixture discovery, snapshot bootstrap and two SSE streams feed one normalised event contract.",
  },
  {
    verb: "Detect",
    title: "Material trading signals",
    detail: "Consensus movement, score confirmation and stale transport are evaluated by a deterministic risk policy.",
  },
  {
    verb: "Execute",
    title: "Autonomous paper decisions",
    detail: "The agent cancels every unsafe quote, holds, reprices and reopens only after recovery gates pass.",
  },
] as const;

const strategyMetrics = [
  ["≥4 pp", "Consensus-shock threshold"],
  ["6", "Paper quotes cancelled on breach"],
  ["3", "Stable observations before recovery"],
  ["Fail closed", "When live credentials are absent"],
] as const;

function ArtifactLink({
  href,
  children,
}: Readonly<{ href: string; children: React.ReactNode }>) {
  if (!href) return <span className="submission-pending">Pending publication</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export default function SubmissionPage() {
  return (
    <main className="submission-shell">
      <nav className="submission-nav" aria-label="Submission navigation">
        <Link className="brand-block" href="/">
          <span className="brand-mark" aria-hidden="true">PS</span>
          <span>
            <strong className="brand-name">ProofSwitch</strong>
            <span className="brand-subtitle">World Cup in-play risk operator</span>
          </span>
        </Link>
        <Link className="button secondary submission-back" href="/">Open working application</Link>
      </nav>

      <header className="submission-hero panel">
        <div>
          <p className="eyebrow">TxOdds × Solana World Cup Hackathon · Judge pack</p>
          <h1>Autonomous circuit breaking for in-play football markets</h1>
          <p className="submission-lede">
            ProofSwitch watches consensus odds, scores and stream health, withdraws unsafe paper
            quotes, then reopens only after deterministic recovery evidence. It is built for the
            Trading Tools and Agents track and the London local judging context.
          </p>
          <div className="submission-hero-actions" aria-label="Primary submission actions">
            <Link className="button primary" href="/?judge=1">Run 90-second walkthrough</Link>
            <a className="button secondary" href={submissionLinks.demoVideo} target="_blank" rel="noreferrer">
              Watch 4:48 demo
            </a>
            <a className="button quiet" href={submissionLinks.repository} target="_blank" rel="noreferrer">
              View source
            </a>
          </div>
        </div>
        <div className="submission-status-stack" aria-label="Submission status">
          <span className="status-chip track-primary">5/5 screening artefacts ready</span>
          <span className="status-chip world-cup">Primary track · Trading agents</span>
          <span className="status-chip synthetic">Synthetic judge mode</span>
          <span className="status-chip disconnected">Live TxLINE evidence pending</span>
        </div>
      </header>

      <section className="panel submission-video" aria-labelledby="demo-video-title">
        <div className="submission-video-copy">
          <p className="eyebrow">Primary screening evidence · 4:48</p>
          <h2 id="demo-video-title">Problem, working agent and TxLINE backend path</h2>
          <p>
            The demonstration covers the market-risk problem, an autonomous goal-shock run,
            deterministic reopening, the production-path rehearsal and the exact TxLINE integration
            boundary.
          </p>
          <p className="submission-boundary">
            The recorded run is explicitly synthetic and paper-only. It demonstrates working product
            behaviour without misrepresenting it as a credential-backed TxLINE session.
          </p>
          <ArtifactLink href={submissionLinks.demoVideo}>Open video on YouTube</ArtifactLink>
        </div>
        <div className="submission-video-frame">
          <iframe
            src={submissionLinks.demoVideoEmbed}
            title="ProofSwitch hackathon demo video"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      </section>

      <section className="submission-screening-grid">
        <article className="panel submission-section submission-screening" aria-labelledby="screening-title">
          <div className="submission-section-heading">
            <div>
              <p className="eyebrow">Initial screening</p>
              <h2 id="screening-title">Every required artefact is public</h2>
            </div>
            <div className="submission-score" aria-label="Five of five artefacts ready">
              <strong>5/5</strong>
              <span>ready</span>
            </div>
          </div>
          <ul className="submission-checklist">
            {screeningRequirements.map((item) => (
              <li key={item.title}>
                <span className="submission-check" aria-hidden="true">Ready</span>
                <div><strong>{item.title}</strong><p>{item.detail}</p></div>
                <a href={item.href} target={item.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                  {item.evidence}
                </a>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel submission-section submission-judge-path" aria-labelledby="judge-path-title">
          <p className="eyebrow">Fast judge path</p>
          <h2 id="judge-path-title">Understand and test ProofSwitch in under seven minutes</h2>
          <ol>
            {judgePath.map((item) => (
              <li key={item.step}>
                <span className="mono">{item.step}</span>
                <div><strong>{item.title}</strong><p>{item.detail}</p></div>
                <a href={item.href} target={item.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                  {item.action}
                </a>
              </li>
            ))}
          </ol>
          <p className="submission-boundary">
            Sponsor eligibility still requires one genuine fixture, odds and score-stream run after
            an activated TxLINE token is supplied.
          </p>
        </article>
      </section>

      <section className="submission-artifacts" aria-label="Submission links">
        <article className="panel submission-artifact ready">
          <p className="eyebrow">Application access</p>
          <h2>Working judge experience</h2>
          <p>Run the deterministic demo and the production-path synthetic rehearsal in this deployment.</p>
          <Link href="/">Open ProofSwitch</Link>
        </article>
        <article className="panel submission-artifact">
          <p className="eyebrow">Public repository</p>
          <h2>Source and tests</h2>
          <p>Implementation, architecture, safety boundaries and automated validation.</p>
          <ArtifactLink href={submissionLinks.repository}>Open GitHub repository</ArtifactLink>
        </article>
        <article className="panel submission-artifact">
          <p className="eyebrow">Demo video · under five minutes</p>
          <h2>Problem, product and backend</h2>
          <p>Scripted walkthrough covering the working agent and the TxLINE integration boundary.</p>
          <ArtifactLink href={submissionLinks.demoVideo}>Watch demo video</ArtifactLink>
        </article>
      </section>

      <section className="submission-grid">
        <article className="panel submission-section">
          <p className="eyebrow">Business case</p>
          <h2>Protect market makers during the seconds that matter</h2>
          <dl className="submission-facts">
            <div><dt>User</dt><dd>Sports trading teams, market makers and risk operators.</dd></div>
            <div><dt>Problem</dt><dd>Price shocks, goals and feed failures can leave stale quotes exposed.</dd></div>
            <div><dt>Value</dt><dd>Fast, deterministic protection with an audit trail for every automated decision.</dd></div>
            <div><dt>Model</dt><dd>Paper execution for the hackathon; production integrations can connect the guarded command layer to an execution venue.</dd></div>
          </dl>
        </article>

        <article className="panel submission-section">
          <p className="eyebrow">What judges can test now</p>
          <h2>Working UI and functional synthetic API</h2>
          <ul className="submission-link-list">
            {publicJudgeEndpoints.map(({ label, path, purpose }) => (
              <li key={path}>
                <a href={path} target="_blank" rel="noreferrer">{label}</a>
                <div><code>{path}</code><small>{purpose}</small></div>
              </li>
            ))}
          </ul>
          <p className="submission-boundary">
            These public endpoints intentionally return labelled synthetic data. They prove the
            running application and reducer path, not a genuine TxLINE session.
          </p>
        </article>
      </section>

      <section className="panel submission-section" aria-labelledby="track-fit-title">
        <p className="eyebrow">Primary track evidence</p>
        <h2 id="track-fit-title">Ingest signals, detect risk, execute decisions</h2>
        <div className="submission-track-evidence">
          {trackEvidence.map((item) => (
            <article key={item.verb}>
              <span>{item.verb}</span>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
        <p className="submission-novelty">
          <strong>Novelty:</strong> ProofSwitch treats safe recovery as a first-class autonomous
          decision. Detecting a shock is only the start; the market remains withdrawn until score
          confirmation, transport freshness, a minimum hold and stable consensus evidence all agree.
        </p>
      </section>

      <section className="submission-metrics" aria-label="Deterministic demonstration policy">
        {strategyMetrics.map(([value, label]) => (
          <article className="panel" key={label}><strong>{value}</strong><span>{label}</span></article>
        ))}
      </section>

      <section className="panel submission-section" id="technical-overview">
        <p className="eyebrow">Technical highlights</p>
        <h2>One guarded strategy path from data to paper execution</h2>
        <ul className="submission-highlight-list">
          {technicalHighlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
        </ul>
      </section>

      <section className="panel submission-section" id="txline-integration">
        <p className="eyebrow">TxLINE integration</p>
        <h2>Integrated upstream endpoints</h2>
        <p className="submission-intro">
          The server adapters implement the following TxLINE surface. They are contract-tested and
          credential-ready; “used live” must not be claimed until a sponsor token is supplied and a
          genuine session is recorded.
        </p>
        <div className="submission-table-wrap" role="region" aria-label="Integrated TxLINE endpoint table" tabIndex={0}>
          <table className="submission-table">
            <thead><tr><th>Method</th><th>Endpoint</th><th>Purpose</th></tr></thead>
            <tbody>
              {txlineEndpoints.map((endpoint) => (
                <tr key={endpoint.path}>
                  <td><span className="mono">{endpoint.method}</span></td>
                  <td><code>{endpoint.path}</code></td>
                  <td>{endpoint.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="submission-grid">
        <article className="panel submission-section" id="txline-feedback">
          <p className="eyebrow">TxLINE API feedback</p>
          <h2>Pre-credential integration experience</h2>
          <p>
            The integration design benefits from the separation between initial snapshots and SSE
            updates, the normalised fixture, odds and score families, and StablePrice consensus values
            that map cleanly into a shock policy.
            The same normalised contract lets the synthetic production-path rehearsal exercise the
            intended live reducer without being represented as genuine TxLINE traffic.
          </p>
          <p>
            The main friction was the multi-part live setup: activated API-token access, guest-session
            authentication and matching configuration across API host, Solana network, RPC and programme
            ID. A compact end-to-end devnet example covering authentication, stream resumption, score
            sequences and the stat-validation lifecycle would reduce integration time.
          </p>
          <p className="submission-boundary">
            This feedback reflects implementation against the documented contracts and adapter tests.
            No credential-backed TxLINE call has been made in this workspace, so live reliability and
            payload observations remain unknown.
          </p>
        </article>

        <article className="panel submission-section">
          <p className="eyebrow">Demo video run sheet</p>
          <h2>Complete in under five minutes</h2>
          <ol className="video-run-sheet">
            {videoRunSheet.map(([time, title, detail]) => (
              <li key={time}><time>{time}</time><div><strong>{title}</strong><p>{detail}</p></div></li>
            ))}
          </ol>
        </article>
      </section>

      <section className="panel submission-decision">
        <div>
          <p className="eyebrow">Evidence boundary</p>
            <h2>Working synthetic system — live-input eligibility blocked</h2>
          <p>
            The UI, synthetic API, strategy engine, paper execution, documentation and tests work now.
            Final sponsor eligibility still depends on receiving a TxLINE token and recording at least
            one genuine live fixture, odds and score-stream session. Solana validation remains optional
            and unclaimed until genuine proof material succeeds.
          </p>
        </div>
        <Link className="button primary" href="/">Run the judge walkthrough</Link>
      </section>
    </main>
  );
}
