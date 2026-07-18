"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import {
  applyNextEvent,
  createInitialState,
  demoScenarios,
  quoteRows,
  statusLabel,
  type AuditEntry,
  type EngineState,
  type EngineStatus,
  type Outcome,
} from "./simulation";
import LiveDashboard from "./live-dashboard";

type ApplicationView = "demo" | "live";

const statusTone: Record<EngineStatus, string> = {
  BOOTSTRAPPING: "info",
  QUOTING: "healthy",
  SUSPENDED: "danger",
  REPRICING: "warning",
  STALE: "danger",
  CLOSED: "neutral",
};

const stages = [
  "Monitor feed",
  "Detect event",
  "Cancel quotes",
  "Reprice safely",
  "Reopen market",
];

const trackFitCards = [
  {
    tone: "primary",
    label: "Primary submission track",
    title: "Trading Tools and Agents",
    detail:
      "The core product is an autonomous paper-trading agent that ingests odds, scores and stream health, detects signals, applies a risk policy and executes quote decisions without manual input.",
  },
  {
    tone: "secondary",
    label: "Secondary judging angle",
    title: "Consumer and Fan Experiences",
    detail:
      "The judge walkthrough, timeline and synthetic public summary make live World Cup market movement understandable, but the app is not primarily a fan game, bot or social experience.",
  },
  {
    tone: "not-claimed",
    label: "Not claimed in this build",
    title: "Prediction Markets and Settlement",
    detail:
      "ProofSwitch does not create outcome markets or settle positions on-chain yet. This becomes a fit only after adding market resolution, oracle tooling or settlement proof integration.",
  },
];

const txlineCoverageCards = [
  {
    label: "TxLINE data ingestion",
    title: "Normalised odds and scores",
    detail:
      "The live path is built around TxLINE-shaped fixture, StablePrice odds, score snapshot and SSE events, with synthetic data using the same reducer until sponsor credentials are added.",
  },
  {
    label: "Autonomous strategy",
    title: "Sharp movement detector + in-play market maker",
    detail:
      "ProofSwitch detects consensus odds shocks, score events and stale feeds, then automatically cancels, holds, reprices and reopens paper quotes under a deterministic strategy.",
  },
  {
    label: "Solana proof boundary",
    title: "Anchoring-aware, not overclaimed",
    detail:
      "The project preserves the score sequence, proof query and validateStatV2 path, but only labels a run verified after a genuine TxLINE proof and read-only Solana validation succeed.",
  },
  {
    label: "Submission readiness",
    title: "Demo, repo and endpoint checklist",
    detail:
      "The app now surfaces the exact screening story judges need: working agent/tool, track fit, endpoints used, demo-video flow, live-credential gap and sponsor feedback to collect.",
  },
];

type DemoScenarioId = keyof typeof demoScenarios;
type JudgeCheckpoint = "running" | "cancellation" | "recovery" | "complete";

interface DecisionReceipt {
  id: string;
  at: string;
  trigger: string;
  action: string;
  result: string;
}

const scenarioMeta: Record<
  DemoScenarioId,
  { label: string; trigger: string; action: string; result: string }
> = {
  goalShock: {
    label: "Goal shock + safe reopen",
    trigger: "Two providers move consensus by at least 4pp",
    action: "Cancel six quotes, hold, then derive a new fair regime",
    result: "Reopen only after score confirmation and three stable frames",
  },
  outlierResilience: {
    label: "Single-source outlier",
    trigger: "One provider diverges while the median remains stable",
    action: "Quarantine the outlier and suppress unnecessary quote churn",
    result: "Market stays guarded with no cancellation commands",
  },
  staleFeedRecovery: {
    label: "Stale feed + recovery",
    trigger: "No valid price frame for more than 2,500ms",
    action: "Withdraw every quote and rebuild feed confidence",
    result: "Reopen only after three independently stable updates",
  },
};

function currentStage(status: EngineStatus, cursor: number, quoteEpoch: number) {
  if (status === "QUOTING" && quoteEpoch > 1) return 4;
  if (status === "REPRICING" || (status === "BOOTSTRAPPING" && quoteEpoch > 0)) return 3;
  if (status === "SUSPENDED" || status === "STALE") return 2;
  if (cursor >= 3) return 1;
  return 0;
}

function formatProbability(value: number) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

function formatPrice(value: number | null) {
  return value === null ? "WITHDRAWN" : `${(value * 100).toFixed(2)}%`;
}

function sourceClass(source: AuditEntry["source"]) {
  return `source source-${source.toLowerCase()}`;
}

function maxFairMovement(current: Record<Outcome, number>, previous: Record<Outcome, number>) {
  return Math.max(
    Math.abs(current.HOME - previous.HOME),
    Math.abs(current.DRAW - previous.DRAW),
    Math.abs(current.AWAY - previous.AWAY),
  );
}

function latestDecisionReceipt(
  engine: EngineState,
  scenarioId: DemoScenarioId,
): DecisionReceipt | null {
  const reopened = engine.audit.find((entry) => entry.title === "Market reopened");
  if (reopened) {
    return {
      id: `PS-${scenarioId}-REOPEN-${engine.quoteEpoch}`,
      at: reopened.clock,
      trigger: "Three stable frames, score confirmation and the minimum hold all passed",
      action: "Released six newly priced paper orders",
      result: "Market open with the post-event reference",
    };
  }

  const recovery = engine.audit.find(
    (entry) => entry.title === "Repricing conditions satisfied",
  );
  if (recovery) {
    return {
      id: `PS-${scenarioId}-RECOVERY-${engine.quoteEpoch + 1}`,
      at: recovery.clock,
      trigger: `${engine.stableFrames}/3 stable observations and every hold condition passed`,
      action: "Prepared a replacement paper quote set; release still awaits freshness",
      result: "Repricing authorised, no order released yet",
    };
  }

  const cancellation = engine.audit.find((entry) =>
    ["Circuit breaker fired", "Feed timeout derived", "Goal guard active"].includes(entry.title),
  );
  if (cancellation) {
    const trigger =
      cancellation.title === "Feed timeout derived"
        ? "Feed age exceeded the 2,500ms policy limit"
        : cancellation.title === "Circuit breaker fired"
          ? `${engine.providerConfirmations}/3 providers confirmed a ${(engine.triggerMovement * 100).toFixed(2)}pp move`
          : "A material score event arrived before confirmation";
    return {
      id: `PS-${scenarioId}-PROTECT-${engine.quoteEpoch}`,
      at: cancellation.clock,
      trigger,
      action: `Withdrew ${engine.cancelledOrders} paper orders and suppressed duplicate cancellation`,
      result: "Market protected; no paper order remains open",
    };
  }

  const outlier = engine.audit.find((entry) => entry.title === "Outlier rejected by provider quorum");
  if (outlier) {
    return {
      id: `PS-${scenarioId}-QUORUM-${engine.quoteEpoch}`,
      at: outlier.clock,
      trigger: "Only one of three providers diverged",
      action: "Quarantined the outlier and emitted no cancellation command",
      result: "Guarded paper quotes remained open",
    };
  }

  const initialQuote = engine.audit.find((entry) => entry.title === "Six paper quotes placed");
  if (initialQuote) {
    return {
      id: `PS-${scenarioId}-OPEN-${engine.quoteEpoch}`,
      at: initialQuote.clock,
      trigger: "A complete, valid three-provider reference was accepted",
      action: "Placed six deterministic paper bid and ask orders",
      result: "Market open under the configured risk policy",
    };
  }

  return null;
}

function SyntheticDashboard({ onViewChange }: { onViewChange: (view: ApplicationView) => void }) {
  const [engine, setEngine] = useState(createInitialState);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [scenarioId, setScenarioId] = useState<DemoScenarioId>("goalShock");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [eventFilter, setEventFilter] = useState<"ALL" | AuditEntry["source"]>("ALL");
  const [judgeMode, setJudgeMode] = useState(false);
  const [judgeCheckpoint, setJudgeCheckpoint] = useState<JudgeCheckpoint>("running");
  const [judgeStops, setJudgeStops] = useState({ cancellation: false, recovery: false });
  const evidenceDialogRef = useRef<HTMLDialogElement>(null);
  const evidenceTriggerRef = useRef<HTMLButtonElement | null>(null);

  const activeScenario = demoScenarios[scenarioId];
  const activeScenarioMeta = scenarioMeta[scenarioId];
  const finished = engine.cursor >= activeScenario.length - 1;
  const quotes = useMemo(() => quoteRows(engine), [engine]);
  const activeStage = currentStage(engine.status, engine.cursor, engine.quoteEpoch);
  const currentStep = Math.max(0, engine.cursor + 1);
  const observedMovement =
    engine.triggerMovement || maxFairMovement(engine.fair, engine.previousFair);
  const feedAge =
    engine.lastOddsAtMs === null ? null : Math.max(0, engine.nowMs - engine.lastOddsAtMs);
  const visibleAudit = engine.audit.filter(
    (entry) => eventFilter === "ALL" || entry.source === eventFilter,
  );
  const quotedCapacity =
    engine.quoteEpoch === 0
      ? 0
      : quotes.reduce((total, quote) => total + quote.quantity * 2, 0);
  const decisionReceipt = latestDecisionReceipt(engine, scenarioId);
  const judgeStep = engine.cursor < 4 ? 1 : engine.cursor < 10 ? 2 : 3;
  const judgeTitle =
    judgeCheckpoint === "cancellation"
      ? "Checkpoint: cancellation proven"
      : judgeCheckpoint === "recovery"
        ? "Checkpoint: controlled recovery proven"
        : judgeCheckpoint === "complete"
          ? "Walkthrough complete"
          : engine.cursor < 4
            ? "Watch the provider-quorum trigger"
            : engine.cursor < 10
              ? "Observe the protected hold"
              : "Release the replacement quotes";
  const judgeCopy =
    judgeCheckpoint === "cancellation"
      ? "The second confirming provider breached policy. Six paper orders were withdrawn before the score confirmation arrived."
      : judgeCheckpoint === "recovery"
        ? "Three stable observations, score confirmation and the hold have passed. Repricing is ready, but freshness still gates release."
        : judgeCheckpoint === "complete"
          ? "Fresh replacement paper quotes are open. Continue to the production-path rehearsal to exercise the same live reducer and streaming adapters with synthetic inputs."
          : engine.cursor < 4
            ? "The replay first establishes a reference, then rejects one outlier. It pauses when the second provider turns the move into a policy breach."
            : engine.cursor < 10
              ? "No order is live while the agent waits for score confirmation, a three-second hold and three independently stable price frames."
              : "A final freshness check is the last condition before the replacement paper orders are released.";

  useEffect(() => {
    if (!running || finished) return;
    const nextEvent = activeScenario[engine.cursor + 1];
    if (!nextEvent) return;
    const previousAt = engine.cursor >= 0 ? activeScenario[engine.cursor].atMs : nextEvent.atMs;
    const virtualGap = Math.max(0, nextEvent.atMs - previousAt);
    const delay = Math.max(240, Math.min(1400, virtualGap / speed));
    const timer = window.setTimeout(() => {
      const nextCursor = engine.cursor + 1;
      setEngine((current) => applyNextEvent(current, activeScenario));
      if (judgeMode && nextCursor === 4 && !judgeStops.cancellation) {
        setRunning(false);
        setJudgeCheckpoint("cancellation");
        setJudgeStops((current) => ({ ...current, cancellation: true }));
        return;
      }
      if (judgeMode && nextCursor === 10 && !judgeStops.recovery) {
        setRunning(false);
        setJudgeCheckpoint("recovery");
        setJudgeStops((current) => ({ ...current, recovery: true }));
        return;
      }
      if (nextCursor >= activeScenario.length - 1) {
        setRunning(false);
        if (judgeMode) setJudgeCheckpoint("complete");
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    activeScenario,
    engine.cursor,
    finished,
    judgeMode,
    judgeStops.cancellation,
    judgeStops.recovery,
    running,
    speed,
  ]);

  useEffect(() => {
    const dialog = evidenceDialogRef.current;
    if (!dialog) return;
    if (evidenceOpen && !dialog.open) dialog.showModal();
    if (!evidenceOpen && dialog.open) dialog.close();
  }, [evidenceOpen]);

  function reset() {
    setRunning(false);
    setJudgeMode(false);
    setJudgeCheckpoint("running");
    setEngine(createInitialState());
  }

  function replay() {
    if (judgeMode) {
      if (finished) {
        startJudgeMode();
        return;
      }
      setJudgeCheckpoint("running");
      setRunning(true);
      return;
    }
    if (finished) setEngine(createInitialState());
    setRunning(true);
  }

  function step() {
    setRunning(false);
    setEngine((current) => applyNextEvent(current, activeScenario));
  }

  function selectScenario(nextScenario: DemoScenarioId) {
    setRunning(false);
    setJudgeMode(false);
    setJudgeCheckpoint("running");
    setScenarioId(nextScenario);
    setEngine(createInitialState());
  }

  function startJudgeMode() {
    setScenarioId("goalShock");
    setSpeed(4);
    setEventFilter("ALL");
    setEngine(createInitialState());
    setJudgeStops({ cancellation: false, recovery: false });
    setJudgeCheckpoint("running");
    setJudgeMode(true);
    setRunning(true);
  }

  function toggleJudgePlayback() {
    if (running) {
      setRunning(false);
      return;
    }
    replay();
  }

  function openEvidence(event: MouseEvent<HTMLButtonElement>) {
    evidenceTriggerRef.current = event.currentTarget;
    setEvidenceOpen(true);
  }

  function closeEvidence() {
    setEvidenceOpen(false);
    window.setTimeout(() => evidenceTriggerRef.current?.focus(), 0);
  }

  function exportAudit() {
    const payload = {
      schema: "proofswitch.audit.v1",
      mode: "synthetic",
      fixtureId: "WC26-SYN-001",
      scenario: scenarioId,
      state: {
        status: engine.status,
        reason: engine.reason,
        score: engine.score,
        fair: engine.fair,
        openOrders: engine.openOrders,
        cancelledOrders: engine.cancelledOrders,
        counterfactualLoss: engine.counterfactualLoss,
        proofStatus: engine.proofStatus,
      },
      events: [...engine.audit].reverse(),
    };
    const href = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `proofswitch-${scenarioId}-audit.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            PS
          </div>
          <div>
            <p className="brand-name">ProofSwitch</p>
            <p className="brand-subtitle">World Cup in-play risk operator</p>
          </div>
        </div>
        <div className="header-status" aria-label="Demo application status">
          <span className={`status-chip operational-state ${statusTone[engine.status]}`}>
            {statusLabel(engine.status)}
          </span>
          <span className="status-chip track-primary">Trading Tools and Agents</span>
          <span className="status-chip synthetic">Synthetic feed</span>
          <span className="status-chip">Paper execution</span>
          <span className="status-chip disconnected">Solana not connected</span>
          <span className="status-chip world-cup">World Cup 2026</span>
        </div>
        <div className="topbar-actions">
          <div className="view-switch" role="group" aria-label="Application mode">
            <button className="active" aria-pressed="true">
              Demo lab
            </button>
            <button aria-pressed="false" onClick={() => onViewChange("live")}>
              Live control room
            </button>
          </div>
          <button className="button secondary" onClick={openEvidence}>
            TxLINE + Solana path
          </button>
          <a className="button secondary button-link" href="/submission">
            Judge pack
          </a>
        </div>
      </header>

      <section
        className={`prototype-notice ${judgeMode ? "judge-active" : ""}`}
        aria-label="Local demonstration boundary"
      >
        <span className="notice-label">Primary track: Trading Tools and Agents</span>
        <p id="demo-boundary">
          Autonomous circuit breaking and safe requoting for in-play markets. This independent
          local demo uses a deterministic synthetic World Cup fixture. It is not affiliated with
          a tournament organiser and does not connect to TxLINE, submit Solana transactions or
          place real orders.
        </p>
        <button
          className="button judge-launch"
          onClick={startJudgeMode}
          aria-describedby="demo-boundary"
        >
          {judgeMode ? "Restart judge walkthrough" : "Start 90-second judge walkthrough"}
        </button>
      </section>

      <section className="track-fit-grid" aria-label="Submission track fit">
        {trackFitCards.map((track) => (
          <article className={`track-fit-card ${track.tone}`} key={track.title}>
            <p className="eyebrow">{track.label}</p>
            <h2>{track.title}</h2>
            <p>{track.detail}</p>
          </article>
        ))}
      </section>

      <section className="panel sponsor-coverage-panel" aria-label="TxLINE sponsor coverage">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">TxLINE track coverage</p>
            <h2>Covers the agent/tool brief, with the live-input gap stated plainly</h2>
          </div>
          <span className="status-chip track-primary">Built for autonomous operation</span>
        </div>
        <div className="sponsor-coverage-grid">
          {txlineCoverageCards.map((item) => (
            <article className="sponsor-coverage-card" key={item.title}>
              <span>{item.label}</span>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
        <p className="sponsor-coverage-note">
          Current status: working local agent with simulated TxLINE-shaped feeds. Final eligibility
          still requires adding the sponsor token, running one genuine live TxLINE session, publishing
          the repo, deploying an app or API endpoint, and recording the five-minute demo video.
        </p>
        <a className="button secondary button-link sponsor-pack-link" href="/submission">
          Open technical documentation and submission pack
        </a>
      </section>

      {judgeMode ? (
        <section
          className={`judge-guide panel checkpoint-${judgeCheckpoint}`}
          aria-label="Guided judge walkthrough"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="judge-guide-copy">
            <p className="eyebrow">
              Guided judge mode · checkpoint {judgeStep} of 3 · locked to 4×
            </p>
            <h2>{judgeTitle}</h2>
            <p>{judgeCopy}</p>
            <div className="judge-boundaries" aria-label="Demonstration boundaries">
              <span>Synthetic fixture</span>
              <span>Paper orders only</span>
              <span>No TxLINE claim</span>
              <span>No Solana verification claim</span>
            </div>
          </div>
          <div className="judge-guide-actions">
            {judgeCheckpoint === "complete" ? (
              <>
                <button className="button secondary" onClick={startJudgeMode}>
                  Replay walkthrough
                </button>
                <button className="button primary" onClick={() => onViewChange("live")}>
                  Open production-path rehearsal
                </button>
              </>
            ) : (
              <button className="button primary" onClick={toggleJudgePlayback}>
                {running ? "Pause walkthrough" : "Continue walkthrough"}
              </button>
            )}
            <small>Designed for a narrated demonstration of about 90 seconds.</small>
          </div>
        </section>
      ) : null}

      <section
        className={`command-bar panel ${judgeCheckpoint !== "running" && judgeMode ? "judge-checkpoint-focus" : ""}`}
      >
        <div className="fixture-context">
          <p className="eyebrow">World Cup 2026 · Synthetic group-stage replay</p>
          <div className="scoreline">
            <span>AUR</span>
            <strong>{engine.score.home}</strong>
            <span className="score-divider">–</span>
            <strong>{engine.score.away}</strong>
            <span>PAC</span>
          </div>
          <p className="fixture-meta">
            <span className="mono">{engine.matchClock}</span>
            <span>World Cup match winner</span>
            <span>Synthetic group stage</span>
            <span className="mono">WC26-SYN-001</span>
          </p>
        </div>

        <div className="agent-state" aria-live="polite">
          <div className={`state-pill ${statusTone[engine.status]}`}>
            <span className="state-dot" aria-hidden="true" />
            {statusLabel(engine.status)}
          </div>
          <p>{engine.reason}</p>
        </div>

        <div className="replay-controls">
          <div className="scenario-select">
            <label htmlFor="scenario">Test scenario</label>
            <select
              id="scenario"
              value={scenarioId}
              disabled={judgeMode}
              onChange={(event) => selectScenario(event.target.value as DemoScenarioId)}
            >
              {(Object.keys(demoScenarios) as DemoScenarioId[]).map((id) => (
                <option key={id} value={id}>
                  {scenarioMeta[id].label}
                </option>
              ))}
            </select>
          </div>
          <div className="speed-control" role="group" aria-label="Replay speed">
            {[1, 2, 4].map((value) => (
              <button
                key={value}
                className={speed === value ? "active" : ""}
                onClick={() => setSpeed(value)}
                aria-pressed={speed === value}
                disabled={judgeMode}
              >
                {value}×
              </button>
            ))}
          </div>
          <button className="button primary" onClick={judgeMode ? toggleJudgePlayback : running ? () => setRunning(false) : replay}>
            {judgeMode
              ? running
                ? "Pause judge walkthrough"
                : finished
                  ? "Replay judge walkthrough"
                  : "Continue judge walkthrough"
              : running
                ? "Pause replay"
                : finished
                  ? "Replay again"
                  : "Run replay"}
          </button>
          <button
            className="button secondary"
            onClick={step}
            disabled={judgeMode || running || finished}
          >
            Step
          </button>
          <button className="button quiet" onClick={reset}>
            Reset
          </button>
        </div>

        <div className="progress-meta">
          <strong>
            Step {currentStep} of {activeScenario.length}
          </strong>
          <span>{engine.lastEvent?.title ?? activeScenarioMeta.label}</span>
        </div>
        <progress
          className="replay-progress"
          value={currentStep}
          max={activeScenario.length}
          aria-label={`Replay progress: step ${currentStep} of ${activeScenario.length}`}
        />
      </section>

      <section className="scenario-thesis panel" aria-label="What this replay demonstrates">
        <div className="thesis-item">
          <span>Trigger</span>
          <strong>{activeScenarioMeta.trigger}</strong>
        </div>
        <div className="thesis-item">
          <span>Autonomous action</span>
          <strong>{activeScenarioMeta.action}</strong>
        </div>
        <div className="thesis-item">
          <span>Testable result</span>
          <strong>{activeScenarioMeta.result}</strong>
        </div>
      </section>

      {decisionReceipt ? (
        <section
          className={`decision-receipt panel ${judgeMode && (judgeCheckpoint === "cancellation" || judgeCheckpoint === "recovery") ? "judge-highlight" : ""}`}
          aria-label="Latest material decision receipt"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="receipt-heading">
            <div>
              <p className="eyebrow">Latest material decision · in-session and unsigned</p>
              <h2>Decision receipt</h2>
            </div>
            <div className="receipt-id">
              <span className="mono">{decisionReceipt.id}</span>
              <time className="mono">{decisionReceipt.at}</time>
            </div>
          </div>
          <dl className="receipt-facts">
            <div>
              <dt>Trigger</dt>
              <dd>{decisionReceipt.trigger}</dd>
            </div>
            <div>
              <dt>Action</dt>
              <dd>{decisionReceipt.action}</dd>
            </div>
            <div>
              <dt>Result</dt>
              <dd>{decisionReceipt.result}</dd>
            </div>
            <div>
              <dt>Boundary</dt>
              <dd>Synthetic input · paper execution · not a TxLINE or Solana proof</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="kpi-grid" aria-label="Agent performance summary">
        <article className="kpi-card panel">
          <span>Market state</span>
          <strong className={`metric-${statusTone[engine.status]}`}>
            {statusLabel(engine.status)}
          </strong>
          <small>{engine.openOrders} live paper orders</small>
        </article>
        <article className="kpi-card panel">
          <span>Quotes cancelled</span>
          <strong>{engine.cancelledOrders}</strong>
          <small>Deterministic commands</small>
        </article>
        <article className="kpi-card panel">
          <span>Live quoted notional</span>
          <strong>{engine.status === "QUOTING" ? `${quotedCapacity.toLocaleString()} live` : "0 live"}</strong>
          <small>
            {engine.status === "QUOTING"
              ? `Across ${engine.openOrders} paper orders`
              : `${quotedCapacity.toLocaleString()} paper units withdrawn`}
          </small>
        </article>
        <article className="kpi-card panel">
          <span>Modelled counterfactual loss</span>
          <strong>{engine.counterfactualLoss.toFixed(2)} SIM USDC</strong>
          <small>Worst-side stale fills; not realised savings</small>
        </article>
      </section>

      <section className="workspace">
        <div className="workspace-main">
          <section className="panel market-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Consensus engine</p>
                <h1>Protected World Cup match-winner quotes</h1>
              </div>
              <div className="panel-heading-meta">
                <span>Median of 3 synthetic books</span>
                <span>Margin removed before quoting</span>
              </div>
            </div>

            <div className="probability-grid">
              {quotes.map((quote) => (
                <article className="probability-card" key={quote.outcome}>
                  <div className="probability-topline">
                    <span>{quote.label}</span>
                    <span className="mono">{formatProbability(quote.fair)}</span>
                  </div>
                  <div
                    className="probability-track"
                    style={{ "--probability": `${quote.fair * 100}%` } as CSSProperties}
                  >
                    <span />
                  </div>
                  <div className="probability-change">
                    <span>Fair probability</span>
                    <span>{quote.state}</span>
                  </div>
                </article>
              ))}
            </div>

            <div className="table-wrap">
              <table className="quote-table">
                <caption className="sr-only">Synthetic paper quote book</caption>
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th>Fair %</th>
                    <th>Bid %</th>
                    <th>Ask %</th>
                    <th>Paper size</th>
                    <th>Paper inventory</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.outcome}>
                      <td>
                        <strong>{quote.label}</strong>
                        <span className="outcome-code">{quote.outcome}</span>
                      </td>
                      <td className="mono">{formatProbability(quote.fair)}</td>
                      <td className="mono price-bid">{formatPrice(quote.bid)}</td>
                      <td className="mono price-ask">{formatPrice(quote.ask)}</td>
                      <td className="mono">{quote.quantity}</td>
                      <td className="mono">{engine.inventory[quote.outcome as Outcome]}</td>
                      <td>
                        <span className={`order-state ${quote.state.toLowerCase()}`}>
                          {quote.state}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel event-stream">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Audit trace</p>
                <h2>Deterministic event stream</h2>
              </div>
              <div className="filter-control" aria-label="Filter event stream">
                {(["ALL", "FEED", "AGENT", "EXECUTION", "PROOF"] as const).map((filter) => (
                  <button
                    key={filter}
                    className={eventFilter === filter ? "active" : ""}
                    onClick={() => setEventFilter(filter)}
                    aria-pressed={eventFilter === filter}
                  >
                    {filter}
                  </button>
                ))}
                <button onClick={exportAudit} disabled={engine.audit.length === 0}>
                  Export JSON
                </button>
              </div>
            </div>
            {visibleAudit.length === 0 ? (
              <div className="empty-state">
                <strong>Replay armed</strong>
                <p>Run or step through the scenario to inspect every decision.</p>
              </div>
            ) : (
              <ol className="audit-list">
                {visibleAudit.map((entry) => (
                  <li key={entry.id} className={`audit-row tone-${entry.tone}`}>
                    <time className="mono">{entry.clock}</time>
                    <span className={sourceClass(entry.source)}>{entry.source}</span>
                    <div>
                      <strong>{entry.title}</strong>
                      <p>{entry.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="workspace-side">
          <section
            className={`panel decision-card decision-${statusTone[engine.status]} ${judgeMode && (judgeCheckpoint === "cancellation" || judgeCheckpoint === "recovery") ? "judge-highlight" : ""}`}
          >
            <p className="eyebrow">Current decision</p>
            <h2>{statusLabel(engine.status)}</h2>
            <p className="decision-copy">
              {engine.lastEvent?.detail ??
                "The agent is ready to consume a deterministic synthetic incident."}
            </p>
            <div className="evidence-metrics" aria-label="Decision evidence">
              <div className="evidence-metric">
                <span>Observed movement</span>
                <strong>{observedMovement ? `${(observedMovement * 100).toFixed(2)}pp` : "—"}</strong>
              </div>
              <div className="evidence-metric">
                <span>Provider agreement</span>
                <strong>{engine.providerConfirmations} / 3</strong>
              </div>
              <div className="evidence-metric">
                <span>Feed age</span>
                <strong>{feedAge === null ? "—" : `${feedAge.toLocaleString()}ms`}</strong>
              </div>
              <div className="evidence-metric">
                <span>Stable observations</span>
                <strong>{engine.stableFrames} / 3</strong>
              </div>
            </div>
            <dl className="decision-facts">
              <div>
                <dt>Policy</dt>
                <dd>4pp + 2 providers / material event / 2.5s timeout</dd>
              </div>
              <div>
                <dt>Action</dt>
                <dd>Cancel → suspend → reprice → reopen</dd>
              </div>
              <div>
                <dt>Execution</dt>
                <dd>Paper adapter only</dd>
              </div>
              <div>
                <dt>Proof</dt>
                <dd>{engine.proofStatus.replaceAll("_", " ")}</dd>
              </div>
            </dl>
            <button className="button secondary full" onClick={openEvidence}>
              Inspect policy and evidence
            </button>
          </section>

          <section className="panel state-machine">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Autonomy</p>
                <h2>Decision loop</h2>
              </div>
            </div>
            <ol>
              {stages.map((stage, index) => (
                <li
                  key={stage}
                  className={index === activeStage ? "active" : index < activeStage ? "done" : ""}
                >
                  <span className="stage-index mono">0{index + 1}</span>
                  <span>{stage}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel comparison-card">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Counterfactual</p>
                <h2>Protected vs always-on</h2>
              </div>
            </div>
            <div className="comparison-row protected">
              <div>
                <span>ProofSwitch</span>
                <strong>0.00 SIM USDC</strong>
              </div>
              <p>Simulated toxic fills after cancellation</p>
            </div>
            <div className="comparison-row exposed">
              <div>
                <span>Always-on baseline</span>
                <strong>−{engine.counterfactualLoss.toFixed(2)} SIM USDC</strong>
              </div>
              <p>Worst-side fills at stale pre-event prices</p>
            </div>
            {engine.counterfactualLoss > 0 ? (
              <dl className="loss-breakdown" aria-label="Counterfactual loss by outcome">
                {(["HOME", "DRAW", "AWAY"] as Outcome[]).map((outcome) => (
                  <div key={outcome}>
                    <dt>{outcome}</dt>
                    <dd>{engine.counterfactualBreakdown[outcome].toFixed(2)} SIM USDC</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <p className="comparison-formula">
              <span className="mono">Σ size × worst stale-side price gap</span>. Modelled from the
              displayed paper quotes; never a realised saving.
            </p>
          </section>

          <section className="panel readiness-card">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Integration readiness</p>
                <h2>Adapter status</h2>
              </div>
            </div>
            <ul>
              <li>
                <span>World Cup replay feed</span>
                <strong className="ready">Active</strong>
              </li>
              <li>
                <span>TxLINE World Cup SSE</span>
                <strong>Awaiting credentials</strong>
              </li>
              <li>
                <span>Solana validation</span>
                <strong>Not configured</strong>
              </li>
              <li>
                <span>Execution adapter</span>
                <strong>Paper only</strong>
              </li>
            </ul>
          </section>
        </aside>
      </section>

      <section className="architecture-strip panel" aria-label="Application architecture">
        {[
          "World Cup feed",
          "Normaliser",
          "Risk policy",
          "Quote engine",
          "Paper execution",
          "Audit trace",
        ].map((item, index, all) => (
          <div key={item}>
            <span>{item}</span>
            {index < all.length - 1 ? <b aria-hidden="true">→</b> : null}
          </div>
        ))}
      </section>

      <dialog
        ref={evidenceDialogRef}
        className="evidence-dialog"
        aria-labelledby="evidence-title"
        onCancel={() => setEvidenceOpen(false)}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeEvidence();
        }}
      >
          <section>
            <div className="dialog-header">
              <div>
                <p className="eyebrow">Integration boundary</p>
                <h2 id="evidence-title">World Cup policy and live evidence path</h2>
              </div>
              <button className="dialog-close" onClick={closeEvidence} aria-label="Close dialog">
                Close
              </button>
            </div>

            <div className="dialog-section">
              <h3>Current deterministic policy</h3>
              <ul className="policy-list">
                <li>Suspend when consensus moves by at least four percentage points.</li>
                <li>Suspend immediately on a material score event.</li>
                <li>Withdraw quotes when the feed is stale for more than 2,500ms.</li>
                <li>Reopen only after three stable frames and a fresh timer check.</li>
              </ul>
            </div>

            <div className="evidence-grid">
              <div>
                <span>Feed mode</span>
                <strong>SYNTHETIC</strong>
              </div>
              <div>
                <span>Verification mode</span>
                <strong>MOCK ONLY</strong>
              </div>
              <div>
                <span>Target endpoint</span>
                <strong className="mono">/api/scores/stat-validation</strong>
              </div>
              <div>
                <span>Target method</span>
                <strong className="mono">validateStatV2</strong>
              </div>
            </div>

            <div className="dialog-section">
              <h3>TxLINE World Cup and Solana integration</h3>
              <ol className="integration-steps">
                <li>Open the live control room and load the current covered fixture catalogue.</li>
                <li>Connect through the server-side TxLINE odds and scores SSE adapters.</li>
                <li>Apply StablePrice, score-sequence and heartbeat events to the live policy.</li>
                <li>Fetch the score-stat proof for the preserved real sequence.</li>
                <li>Run the matching read-only validateStatV2 simulation before claiming Solana verification.</li>
              </ol>
              <p className="dialog-warning">
                This screen intentionally does not claim that any current event is verified on Solana.
              </p>
            </div>

            <div className="dialog-section">
              <h3>World Cup match-day operator sequence</h3>
              <ol className="integration-steps">
                <li>Connect the covered fixture before kick-off.</li>
                <li>Confirm that both streams are open and the initial score is accepted.</li>
                <li>Observe the autonomous guard, repricing and controlled recovery decisions.</li>
                <li>Request the score proof matching the latest accepted sequence.</li>
                <li>Export the evidence before changing fixture or starting another session.</li>
              </ol>
            </div>
          </section>
      </dialog>
    </main>
  );
}

export default function Home() {
  const [view, setView] = useState<ApplicationView>("demo");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const preferred = window.localStorage.getItem("proofswitch.application-view");
        const hasPaperSession =
          window.localStorage.getItem("proofswitch.live.paper-session") !== null;
        if (preferred === "live" || hasPaperSession) setView("live");
      } catch {
        // Storage can be unavailable in hardened browser contexts; the demo is a
        // safe default and the live screen reports its own persistence boundary.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function changeView(next: ApplicationView) {
    setView(next);
    try {
      window.localStorage.setItem("proofswitch.application-view", next);
    } catch {
      // View preference is non-essential and must not block either mode.
    }
  }

  return view === "demo" ? (
    <SyntheticDashboard onViewChange={changeView} />
  ) : (
    <LiveDashboard onSelectDemo={() => changeView("demo")} />
  );
}
