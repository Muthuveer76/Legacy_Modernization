import { Binary, Check, CircleX, ClipboardCheck, LoaderCircle, Network, ShieldCheck, Sparkles } from 'lucide-react';
import { duration } from '../lib/format.js';

const STEPS = [
  { id: 'parse', label: 'Parse', sub: 'AST', icon: Binary },
  { id: 'analyze', label: 'Analyze', sub: 'Semantics', icon: Network },
  { id: 'generate', label: 'Generate', sub: 'AI / LLM', icon: Sparkles },
  { id: 'validate', label: 'Validate', sub: 'Tests', icon: ShieldCheck },
  { id: 'review', label: 'Review', sub: 'Human', icon: ClipboardCheck },
];

function reviewStage(job) {
  if (['approved', 'merged'].includes(job.status)) return { status: 'done', message: job.status === 'merged' ? 'Merged into codebase' : 'Approved' };
  if (job.status === 'rejected') return { status: 'failed', message: job.review?.decision === 'changes-requested' ? 'Changes requested' : 'Rejected' };
  if (job.status === 'review') return { status: 'running', message: 'Awaiting reviewer' };
  return { status: 'pending' };
}

export function PipelineStepper({ job }) {
  return (
    <ol className="stepper">
      {STEPS.map((step) => {
        const stage = step.id === 'review' ? reviewStage(job) : job.stages?.[step.id] || { status: 'pending' };
        const Icon = step.icon;
        const state = stage.status;
        return (
          <li key={step.id} className={`step step-${state}`}>
            <div className="step-icon">
              {state === 'done' ? <Check size={18} /> : state === 'failed' ? <CircleX size={18} /> : state === 'running' && step.id !== 'review' ? <LoaderCircle size={18} className="spin" /> : <Icon size={18} />}
            </div>
            <div className="step-text">
              <div className="step-label">
                {step.label} <span className="muted">({step.sub})</span>
              </div>
              <div className="step-meta">
                {stage.message || (state === 'pending' ? 'Waiting' : state)}
                {stage.startedAt && stage.finishedAt ? ` · ${duration(stage.startedAt, stage.finishedAt)}` : ''}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
