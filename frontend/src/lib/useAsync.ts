import { useCallback, useEffect, useState } from 'react'

interface State<T> {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * Runs an async loader and exposes graceful loading/error state so screens
 * never crash when the backend is offline.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
): State<T> & { reload: () => void } {
  const [state, setState] = useState<State<T>>({
    data: null,
    loading: true,
    error: null,
  })

  const run = useCallback(() => {
    let active = true
    setState((s) => ({ ...s, loading: true, error: null }))
    loader()
      .then((data) => {
        if (active) setState({ data, loading: false, error: null })
      })
      .catch((err: unknown) => {
        const msg =
          (err as { message?: string })?.message ?? 'Request failed'
        if (active) setState({ data: null, loading: false, error: msg })
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => run(), [run])

  return { ...state, reload: () => run() }
}
