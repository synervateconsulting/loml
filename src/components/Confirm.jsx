import { useState } from 'react';

/**
 * Two-step confirmation. Nothing sends or gets thrown away on a single tap.
 * `steps` is an array of { title, body, confirm, tone }.
 */
export default function Confirm({ steps, onResolve }) {
  const [index, setIndex] = useState(0);
  const step = steps[index];

  const next = () => {
    if (index + 1 < steps.length) setIndex(index + 1);
    else onResolve(true);
  };

  return (
    <div className="scrim scrim--confirm" role="dialog" aria-modal="true">
      <div className="confirm">
        <p className="confirm__step">
          Step {index + 1} of {steps.length}
        </p>
        <h3 className="confirm__title">{step.title}</h3>
        <p className="confirm__body">{step.body}</p>
        <div className="confirm__actions">
          <button type="button" className="btn btn--ghost" onClick={() => onResolve(false)}>
            Go back
          </button>
          <button
            type="button"
            className={step.tone === 'danger' ? 'btn btn--danger' : 'btn btn--primary'}
            onClick={next}
          >
            {step.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

export const discardSteps = (what) => [
  {
    title: `Discard this ${what}?`,
    body: 'Nothing you have typed here will be kept.',
    confirm: 'Discard it',
    tone: 'danger',
  },
  {
    title: 'Certain?',
    body: 'This is the last stop. Tap again and the draft is gone.',
    confirm: 'Yes, discard',
    tone: 'danger',
  },
];

export const sendSteps = (title, body) => [
  { title, body, confirm: 'Yes, continue' },
  { title: 'Certain?', body: 'One more tap and it goes.', confirm: 'Yes, send it' },
];
