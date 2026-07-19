import type { HTMLAttributes, ReactNode } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  inverted?: boolean
  padded?: boolean
}

export default function Card({
  children,
  inverted = false,
  padded = true,
  className = '',
  ...rest
}: Props) {
  return (
    <div
      className={`rounded-card border ${
        inverted
          ? 'surface-brand border-transparent shadow-lg shadow-brand/20'
          : 'bg-paper-raised border-line'
      } ${padded ? 'p-6' : ''} ${className}`}
      style={inverted ? undefined : { boxShadow: '0 1px 2px rgba(20,26,48,0.04)' }}
      {...rest}
    >
      {children}
    </div>
  )
}
