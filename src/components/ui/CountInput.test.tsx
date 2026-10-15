// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { CountInput, parseCount } from './CountInput'

afterEach(cleanup)

describe('parseCount', () => {
  it('keeps digits only, at most four', () => {
    expect(parseCount('3')).toBe(3)
    expect(parseCount('12 bulan')).toBe(12)
    expect(parseCount('1.5')).toBe(15)
    expect(parseCount('123456')).toBe(1234)
    expect(parseCount('')).toBeNull()
    expect(parseCount('abc')).toBeNull()
  })
})

/** The field inside a parent that owns the count, like the lease form. */
function Harness({ onChange }: { onChange?: (n: number) => void }) {
  const [n, setN] = useState(1)
  return (
    <>
      <CountInput
        label="Jumlah periode (bulan)"
        value={n}
        onChange={(v) => {
          setN(v)
          onChange?.(v)
        }}
      />
      <output data-testid="count">{n}</output>
    </>
  )
}

const box = () => screen.getByLabelText('Jumlah periode (bulan)') as HTMLInputElement

describe('CountInput', () => {
  it('lets the default 1 be deleted, then takes the new number', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.change(box(), { target: { value: '' } })
    expect(box().value).toBe('')
    // the parent keeps the last valid count meanwhile, so totals do not drop to 0
    expect(screen.getByTestId('count').textContent).toBe('1')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(box(), { target: { value: '3' } })
    expect(box().value).toBe('3')
    expect(screen.getByTestId('count').textContent).toBe('3')
  })

  it('puts the last valid count back when left empty', () => {
    render(<Harness />)
    fireEvent.change(box(), { target: { value: '6' } })
    fireEvent.change(box(), { target: { value: '' } })
    fireEvent.blur(box())
    expect(box().value).toBe('6')
  })

  it('keeps 0 out of the count and ignores letters', () => {
    render(<Harness />)
    fireEvent.change(box(), { target: { value: '0' } })
    expect(screen.getByTestId('count').textContent).toBe('1')
    fireEvent.blur(box())
    expect(box().value).toBe('1')
    fireEvent.change(box(), { target: { value: '2x' } })
    expect(box().value).toBe('2')
  })

  it('selects the number on focus so typing replaces it', () => {
    render(<Harness />)
    const select = vi.spyOn(box(), 'select')
    fireEvent.focus(box())
    expect(select).toHaveBeenCalled()
  })

  it('shows a count set by the parent (e.g. from "sampai tanggal")', () => {
    const { rerender } = render(<CountInput label="Jumlah" value={1} onChange={() => {}} />)
    rerender(<CountInput label="Jumlah" value={4} onChange={() => {}} />)
    expect((screen.getByLabelText('Jumlah') as HTMLInputElement).value).toBe('4')
  })

  it('opens the number keyboard on phones', () => {
    render(<Harness />)
    expect(box().getAttribute('inputmode')).toBe('numeric')
  })
})
