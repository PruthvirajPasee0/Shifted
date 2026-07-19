import type { ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}

interface Props<T> {
  columns: Column<T>[]
  rows: T[]
  keyField: (row: T, i: number) => string | number
  empty?: ReactNode
  onRowClick?: (row: T) => void
}

export default function Table<T>({
  columns,
  rows,
  keyField,
  empty = 'No records',
  onRowClick,
}: Props<T>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line-strong">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`eyebrow whitespace-nowrap px-4 py-3 ${
                  c.align === 'right'
                    ? 'text-right'
                    : c.align === 'center'
                      ? 'text-center'
                      : 'text-left'
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center font-mono text-[13px] text-g-500"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={keyField(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-line last:border-0 ${
                  onRowClick ? 'cursor-pointer hover:bg-paper' : ''
                }`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-4 text-[14px] ${
                      c.align === 'right'
                        ? 'text-right'
                        : c.align === 'center'
                          ? 'text-center'
                          : 'text-left'
                    } ${c.className ?? ''}`}
                  >
                    {c.render ? c.render(row) : (row as Record<string, ReactNode>)[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
