import { ArrowRight, Binary, ClipboardCheck, GitBranch, Layers, Network, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Layout.jsx';

const PIPELINE = [
  { icon: Binary, title: 'Parse', sub: 'AST', text: 'COBOL, VB6, Java and C++ become abstract syntax trees through pluggable grammars.' },
  { icon: Network, title: 'Analyze', sub: 'Semantics', text: 'Control-flow graphs, call graphs, data flow and a data dictionary in a language-agnostic IR.' },
  { icon: Sparkles, title: 'Generate', sub: 'AI / LLM', text: 'Claude writes idiomatic Java, Python, TypeScript or C#, grounded in the AST analysis.' },
  { icon: ShieldCheck, title: 'Validate', sub: 'Tests', text: 'Syntax checks, procedure mapping, complexity parity and generated characterization tests.' },
  { icon: ClipboardCheck, title: 'Review', sub: 'Human', text: 'Engineers edit, comment, approve or request changes before anything is merged.' },
];

const FEATURES = [
  { icon: Layers, title: 'Multi-language', text: 'Hand-written COBOL and VB6 grammars plus Tree-sitter for Java and C/C++ feed one intermediate representation.' },
  { icon: GitBranch, title: 'Semantic-aware', text: 'Reasons over control flow and data flow, not raw text: dead paragraphs, GO TO, fall-through and fixed-point fields are found before translation.' },
  { icon: UserRound, title: 'Human-in-the-loop', text: 'Every generated file is reviewable: diff against the AI output, comment on lines, and regenerate with feedback.' },
];

const COMPARISON = [
  ['Manual rewriting', 'Accurate but slow, and depends on scarce legacy experts'],
  ['Rule-based transpilers', 'Fast but brittle when code deviates from expected patterns'],
  ['Pattern-matching scripts', 'Fail on complex or undocumented logic'],
  ['AST-guided AI (this platform)', 'Structure-aware translation, validated and reviewed before merge'],
];

export function Landing() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Brand light />
        <div className="landing-nav-actions">
          <Link to="/login" className="btn btn-ghost">
            Sign in
          </Link>
          <Link to="/register" className="btn btn-primary">
            Get started
          </Link>
        </div>
      </header>

      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">AI-assisted legacy application modernization</span>
          <h1>Turn decades-old COBOL, VB6 and legacy Java into maintainable modern code</h1>
          <p>
            Upload legacy sources, watch the platform parse them into syntax trees, map their control and data flow, generate a modern implementation with AI, and
            validate it before your engineers approve the merge.
          </p>
          <div className="hero-actions">
            <Link to="/register" className="btn btn-primary btn-lg">
              Create an account <ArrowRight size={18} />
            </Link>
            <Link to="/login" className="btn btn-ghost btn-lg">
              I already have one
            </Link>
          </div>
          <div className="hero-stats">
            <div>
              <strong>4</strong>
              <span>legacy languages</span>
            </div>
            <div>
              <strong>4</strong>
              <span>modern targets</span>
            </div>
            <div>
              <strong>60%+</strong>
              <span>potential cut in rewrite effort</span>
            </div>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="code-card legacy">
            <div className="code-card-title">PAYROLL.cbl</div>
            <pre>{`COMPUTE WS-TAX ROUNDED =
    WS-GROSS-PAY * WS-TAX-RATE.
IF OVERTIME-WORKED
   PERFORM PAY-OVERTIME
END-IF.`}</pre>
          </div>
          <div className="hero-arrow">
            <Sparkles size={18} />
          </div>
          <div className="code-card modern">
            <div className="code-card-title">PayrollService.java</div>
            <pre>{`tax = grossPay.multiply(taxRate)
    .setScale(2, HALF_UP);
if (overtimeWorked) {
    payOvertime();
}`}</pre>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <h2>One pipeline, five auditable stages</h2>
        <ol className="pipeline-strip">
          {PIPELINE.map((p, i) => (
            <li key={p.title}>
              <div className="pipe-icon">
                <p.icon size={20} />
              </div>
              <div className="pipe-title">
                {i + 1}. {p.title} <span>({p.sub})</span>
              </div>
              <p>{p.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section features">
        {FEATURES.map((f) => (
          <div key={f.title} className="feature">
            <div className="feature-icon">
              <f.icon size={20} />
            </div>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </section>

      <section className="landing-section">
        <h2>Why not a transpiler or a manual rewrite?</h2>
        <div className="compare">
          {COMPARISON.map(([name, text], i) => (
            <div key={name} className={`compare-row${i === COMPARISON.length - 1 ? ' highlight' : ''}`}>
              <strong>{name}</strong>
              <span>{text}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <div>AI-Assisted Legacy Application Modernization Platform · MERN stack</div>
        <div className="muted">Full Stack Development (2311CSC503R) · Department of Information Technology · Easwari Engineering College</div>
      </footer>
    </div>
  );
}
