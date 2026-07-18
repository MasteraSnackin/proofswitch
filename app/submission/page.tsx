import Link from "next/link";
import {
  submissionLinks,
  syntheticJudgeFixtureId,
  txlineEndpoints,
} from "../../lib/submission";

const technicalHighlights = [
  "One deterministic reducer handles snapshots, streams, synthetic rehearsal and replay.",
  "The sharp-movement detector reacts to consensus shocks, confirmed score events and stale data.",
  "The paper market maker cancels unsafe quotes, enforces a hold, then reopens only after stable recovery evidence.",
  "Live mode fails closed: missing credentials or invalid contracts never fall back to synthetic data.",
  "TxLINE credentials remain server-side, and Solana verification is never claimed without a genuine successful validation.",
];

const videoRunSheet = [
  ["0:00–0:30", "Problem", "Goals, odds shocks and stale feeds can leave unsafe quotes exposed."],
  ["0:30–0:55", "Product", "ProofSwitch is an autonomous in-play risk operator for trading teams and market makers."],
  ["0:55–2:20", "Working app", "Run the goal-shock walkthrough: detect, cancel, hold, stabilise and reopen."],
  ["2:20–3:35", "TxLINE backend", "Show the fixture, snapshot and SSE adapters feeding the same reducer; state whether the session is synthetic or credential-backed."],
  ["3:35–4:20", "Evidence", "Review the scorecard, audit trail, paper execution and guarded Solana boundary."],
  ["4:20–4:55", "Close", "Explain the business value, Trading Tools and Agents fit, public app and repository."],
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
  const judgeApiLinks = [
    ["Runtime status", "/api/status"],
    ["Synthetic fixtures", "/api/fixtures"],
    ["Synthetic odds", `/api/odds?fixtureId=${syntheticJudgeFixtureId}`],
    ["Synthetic score", `/api/scores?fixtureId=${syntheticJudgeFixtureId}`],
  ] as const;

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
        </div>
        <div className="submission-status-stack" aria-label="Submission status">
          <span className="status-chip track-primary">Working application</span>
          <span className="status-chip synthetic">Synthetic judge mode</span>
          <span className="status-chip disconnected">Live token not configured</span>
        </div>
      </header>

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
            {judgeApiLinks.map(([label, href]) => (
              <li key={href}><a href={href} target="_blank" rel="noreferrer">{label}</a><code>{href}</code></li>
            ))}
          </ul>
          <p className="submission-boundary">
            These public endpoints intentionally return labelled synthetic data. They prove the
            running application and reducer path, not a genuine TxLINE session.
          </p>
        </article>
      </section>

      <section className="panel submission-section">
        <p className="eyebrow">Technical highlights</p>
        <h2>One guarded strategy path from data to paper execution</h2>
        <ul className="submission-highlight-list">
          {technicalHighlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
        </ul>
      </section>

      <section className="panel submission-section">
        <p className="eyebrow">TxLINE integration</p>
        <h2>Integrated upstream endpoints</h2>
        <p className="submission-intro">
          The server adapters implement the following TxLINE surface. They are contract-tested and
          credential-ready; “used live” must not be claimed until a sponsor token is supplied and a
          genuine session is recorded.
        </p>
        <div className="submission-table-wrap">
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
        <article className="panel submission-section">
          <p className="eyebrow">TxLINE API feedback</p>
          <h2>Pre-credential integration experience</h2>
          <p>
            We liked the separation between initial snapshots and SSE updates, the normalised fixture,
            odds and score families, and StablePrice consensus values that map cleanly into a shock policy.
            This allowed one reducer to power both deterministic rehearsal and the intended live path.
          </p>
          <p>
            The main friction was the multi-part live setup: sponsor token access, guest-session
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
          <h2>Working submission, with one sponsor dependency still unresolved</h2>
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
