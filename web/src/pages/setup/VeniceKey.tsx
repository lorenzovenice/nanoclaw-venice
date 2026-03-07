import React, { useState } from 'react';
import { setupApi } from '../../lib/api';

interface VeniceKeyProps {
  stepData: Record<string, unknown>;
  setStepComplete: (step?: number) => void;
  setStepData: (data: Record<string, unknown>) => void;
  onCanProceed: (v: boolean) => void;
}

export default function VeniceKey({ stepData, setStepComplete, setStepData, onCanProceed }: VeniceKeyProps) {
  const [key, setKey] = useState((stepData.veniceKey as string) || '');
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [valid, setValid] = useState<boolean | null>(stepData.veniceKeyValid === true ? true : null);
  const [error, setError] = useState<string | null>(null);
  const wasValidated = stepData.veniceKeyValid === true;

  const handleValidate = async () => {
    if (!key.trim()) return;
    setValidating(true);
    setError(null);
    try {
      const res = await setupApi.validateVeniceKey(key.trim());
      if (res.valid) {
        setValid(true);
        setStepData({ veniceKey: key.trim(), veniceKeyValid: true });
        setStepComplete(2);
        onCanProceed(true);
      } else {
        setValid(false);
        setError(res.error || 'Invalid key');
      }
    } catch (err) {
      setValid(false);
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setValidating(false);
    }
  };

  if (wasValidated && stepData.veniceKey) {
    onCanProceed(true);
    return (
      <div className="space-y-6">
        <p className="text-venice-marble">
          Enter your Venice AI API key. Get one at{' '}
          <a href="https://venice.ai/settings/api" target="_blank" rel="noreferrer" className="text-venice-gold underline">
            venice.ai/settings/api
          </a>
        </p>
        <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-venice-blue-light p-6 shadow-lg shadow-black/20">
          <div className="flex-1">
            <p className="text-venice-chrome">API key is configured</p>
            <p className="mt-1 font-mono text-sm text-venice-marble">{(stepData.veniceKey as string).slice(0, 8)}...</p>
          </div>
          <svg className="h-8 w-8 text-venice-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-venice-marble">
        Enter your Venice AI API key. Get one at{' '}
        <a href="https://venice.ai/settings/api" target="_blank" rel="noreferrer" className="text-venice-gold underline">
          venice.ai/settings/api
        </a>
      </p>
      <div className="flex gap-3">
        <div className="relative flex-1">
          <input
            type={showKey ? 'text' : 'password'}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setValid(null);
              setError(null);
            }}
            placeholder="ven_..."
            className="w-full rounded-xl border border-white/10 bg-venice-blue px-4 py-3 font-mono text-venice-marble placeholder:text-venice-chrome focus:border-venice-gold focus:ring-1 focus:ring-venice-gold/50 outline-none"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-venice-chrome hover:text-venice-marble"
          >
            {showKey ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.12 12.996l3.841-3.841m-6.738 6.738l3.841 3.841" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7" />
              </svg>
            )}
          </button>
        </div>
        <button
          type="button"
          onClick={handleValidate}
          disabled={!key.trim() || validating}
          className="rounded-xl bg-venice-gold px-6 py-3 font-semibold text-venice-blue transition hover:brightness-110 disabled:opacity-50"
        >
          {validating ? 'Validating...' : 'Validate'}
        </button>
      </div>
      {valid === true && (
        <div className="flex items-center gap-2 text-venice-success">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>API key valid</span>
        </div>
      )}
      {(valid === false || error) && (
        <div className="flex items-center gap-2 text-venice-error">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span>{error || 'Invalid API key'}</span>
        </div>
      )}
    </div>
  );
}
