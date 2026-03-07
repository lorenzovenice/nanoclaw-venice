import React from 'react';

const DEFAULT_STEP_NAMES = [
  'Welcome',
  'Environment',
  'Venice Key',
  'Channels',
  'Build',
  'WhatsApp',
  'Groups',
  'Config',
  'Launch',
];

interface WizardShellProps {
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  stepNames?: string[];
  children: React.ReactNode;
}

export default function WizardShell(props: WizardShellProps) {
  const {
    currentStep,
    totalSteps,
    onNext,
    onBack,
    canProceed,
    stepNames = DEFAULT_STEP_NAMES,
    children,
  } = props;
  const isFirst = currentStep === 0;
  const isLast = currentStep === totalSteps - 1;
  const nextLabel = currentStep === 0 ? 'Get Started' : isLast ? 'Launch Agent' : 'Next';

  return (
    <div className="min-h-screen bg-venice-blue font-body">
      <div className="mx-auto max-w-4xl px-4 py-8 md:py-12">
        <div className="mb-8 md:mb-12">
          <div className="flex items-center justify-between">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <React.Fragment key={i}>
                <div className="flex flex-col items-center">
                  <div
                    className={
                      i < currentStep
                        ? 'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-venice-gold text-venice-blue'
                        : i === currentStep
                          ? 'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-venice-gold bg-transparent text-venice-gold animate-pulse'
                          : 'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-transparent text-venice-chrome'
                    }
                  >
                    {i < currentStep ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className="text-sm font-medium">{i + 1}</span>
                    )}
                  </div>
                  <span className="mt-2 hidden text-xs text-venice-chrome md:block">{stepNames[i]}</span>
                </div>
                {i < totalSteps - 1 && (
                  <div className={`mx-1 h-0.5 flex-1 min-w-[12px] ${i < currentStep ? 'bg-venice-gold' : 'bg-white/10'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
        <h1 className="mb-8 font-heading text-3xl font-semibold text-venice-gold md:text-4xl">
          {stepNames[currentStep]}
        </h1>
        <div className="mb-10">{children}</div>
        <div className="flex items-center justify-between gap-4">
          <div>
            {!isFirst && (
              <button
                type="button"
                onClick={onBack}
                className="flex items-center gap-2 rounded-xl border border-venice-gold bg-transparent px-6 py-3 font-semibold text-venice-gold transition hover:brightness-110"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onNext}
            disabled={!canProceed}
            className="flex items-center gap-2 rounded-xl bg-venice-gold px-6 py-3 font-semibold text-venice-blue transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
          >
            {nextLabel}
            {!isLast && (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
