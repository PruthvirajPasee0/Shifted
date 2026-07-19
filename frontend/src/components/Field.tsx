import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react'

const inputBase =
  'w-full bg-paper-raised border border-line rounded-[10px] px-4 py-2.5 text-[15px] text-ink placeholder:text-g-400 font-body outline-none transition-colors focus:border-line-strong'

export function Label({
  children,
  htmlFor,
}: {
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <label htmlFor={htmlFor} className="eyebrow mb-2 block">
      {children}
    </label>
  )
}

const errorBorder = 'border-danger focus:border-danger'

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
}

export function Input({ label, hint, error, id, className = '', ...rest }: FieldProps) {
  return (
    <div className="w-full">
      {label && <Label htmlFor={id}>{label}</Label>}
      <input
        id={id}
        className={`${inputBase} ${error ? errorBorder : ''} ${className}`}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {error ? (
        <p className="mt-1.5 font-mono text-[11px] text-danger">{error}</p>
      ) : (
        hint && <p className="mt-1.5 font-mono text-[11px] text-g-500">{hint}</p>
      )}
    </div>
  )
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
  error?: string
  children: ReactNode
}

export function Select({
  label,
  hint,
  error,
  id,
  className = '',
  children,
  ...rest
}: SelectProps) {
  return (
    <div className="w-full">
      {label && <Label htmlFor={id}>{label}</Label>}
      <select
        id={id}
        className={`${inputBase} appearance-none ${error ? errorBorder : ''} ${className}`}
        aria-invalid={error ? true : undefined}
        {...rest}
      >
        {children}
      </select>
      {error ? (
        <p className="mt-1.5 font-mono text-[11px] text-danger">{error}</p>
      ) : (
        hint && <p className="mt-1.5 font-mono text-[11px] text-g-500">{hint}</p>
      )}
    </div>
  )
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

export function Textarea({ label, id, className = '', ...rest }: TextareaProps) {
  return (
    <div className="w-full">
      {label && <Label htmlFor={id}>{label}</Label>}
      <textarea id={id} className={`${inputBase} min-h-[96px] resize-y ${className}`} {...rest} />
    </div>
  )
}
