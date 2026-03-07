import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

export type StepStatus = 'pending' | 'complete' | 'error' | 'active';

export interface StepStatuses {
  [step: number]: StepStatus;
}

export interface StepData {
  [key: string]: unknown;
}

interface SetupContextValue {
  currentStep: number;
  stepStatuses: StepStatuses;
  stepData: StepData;
  setStepData: (data: Partial<StepData>) => void;
  goNext: () => void;
  goPrev: () => void;
  goToStep: (step: number) => void;
  setStepComplete: (step?: number) => void;
  setStepError: (step?: number) => void;
}

const SetupContext = createContext<SetupContextValue | null>(null);

const TOTAL_STEPS = 9;

export function SetupProvider({ children }: { children: React.ReactNode }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [stepStatuses, setStepStatuses] = useState<StepStatuses>({
    0: 'active',
    1: 'pending',
    2: 'pending',
    3: 'pending',
    4: 'pending',
    5: 'pending',
    6: 'pending',
    7: 'pending',
    8: 'pending',
  });
  const [stepData, setStepDataState] = useState<StepData>({});

  const setStepComplete = useCallback((step?: number) => {
    const s = step ?? currentStep;
    setStepStatuses((prev) => ({ ...prev, [s]: 'complete' }));
    if (step === undefined && s < TOTAL_STEPS - 1) {
      setStepStatuses((prev) => ({ ...prev, [s + 1]: 'active' }));
    }
  }, [currentStep]);

  const setStepError = useCallback((step?: number) => {
    const s = step ?? currentStep;
    setStepStatuses((prev) => ({ ...prev, [s]: 'error' }));
  }, [currentStep]);

  const goNext = useCallback(() => {
    if (currentStep < TOTAL_STEPS - 1) {
      setStepStatuses((prev) => ({ ...prev, [currentStep]: 'complete', [currentStep + 1]: 'active' }));
      setCurrentStep(currentStep + 1);
    }
  }, [currentStep]);

  const goPrev = useCallback(() => {
    if (currentStep > 0) {
      setStepStatuses((prev) => ({ ...prev, [currentStep]: 'pending', [currentStep - 1]: 'active' }));
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep]);

  const setStepData = useCallback((data: Partial<StepData>) => {
    setStepDataState((prev) => ({ ...prev, ...data }));
  }, []);

  const goToStep = useCallback((step: number) => {
    if (step >= 0 && step < TOTAL_STEPS) {
      setStepStatuses((prev) => {
        const next = { ...prev };
        for (let i = 0; i < TOTAL_STEPS; i++) {
          if (i < step) next[i] = prev[i] === 'complete' ? 'complete' : 'pending';
          else if (i === step) next[i] = 'active';
          else next[i] = 'pending';
        }
        return next;
      });
      setCurrentStep(step);
    }
  }, []);

  const value = useMemo(
    () => ({
      currentStep,
      stepStatuses,
      stepData,
      setStepData,
      goNext,
      goPrev,
      goToStep,
      setStepComplete,
      setStepError,
    }),
    [currentStep, stepStatuses, stepData, setStepData, goNext, goPrev, goToStep, setStepComplete, setStepError]
  );

  return (
    <SetupContext.Provider value={value}>
      {children}
    </SetupContext.Provider>
  );
}

export function useSetupState() {
  const ctx = useContext(SetupContext);
  if (!ctx) throw new Error('useSetupState must be used within SetupProvider');
  return ctx;
}
