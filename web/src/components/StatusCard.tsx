import { ReactNode } from 'react'

type Status = 'success' | 'warning' | 'error' | 'neutral'

const statusColors: Record<Status, { dot: string; icon: string }> = {
  success: { dot: 'bg-venice-success', icon: 'text-venice-success' },
  warning: { dot: 'bg-venice-lantern', icon: 'text-venice-lantern' },
  error: { dot: 'bg-venice-error', icon: 'text-venice-error' },
  neutral: { dot: 'bg-venice-chrome', icon: 'text-venice-chrome' },
}

const dotPulse: Record<Status, boolean> = {
  success: true,
  warning: true,
  error: true,
  neutral: false,
}

export interface StatusCardProps {
  title: string
  value: string | number
  subtitle?: string
  status?: Status
  icon?: ReactNode
}

export function StatusCard({
  title,
  value,
  subtitle,
  status = 'neutral',
  icon,
}: StatusCardProps) {
  const { dot, icon: iconColor } = statusColors[status]
  const pulse = dotPulse[status]

  return (
    <div className="relative bg-venice-blue-light border border-white/10 rounded-2xl p-6 shadow-lg shadow-black/20">
      {status !== 'neutral' && (
        <span
          className={`absolute top-4 right-4 w-2 h-2 rounded-full ${dot} ${
            pulse ? 'animate-pulse' : ''
          }`}
        />
      )}
      {icon && (
        <div className={`mb-3 ${iconColor}`}>{icon}</div>
      )}
      <p className="text-venice-chrome text-xs uppercase tracking-wide mb-1">
        {title}
      </p>
      <p className="text-venice-marble text-3xl font-semibold">{value}</p>
      {subtitle && (
        <p className="text-venice-chrome text-sm mt-1">{subtitle}</p>
      )}
    </div>
  )
}
