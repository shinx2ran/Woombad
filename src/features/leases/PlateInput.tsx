import { Input, type InputProps } from '../../components/ui'
import { PLATE_MAX_LENGTH, normalizePlate } from '../../domain/plate'

type PlateInputProps = Omit<InputProps, 'value' | 'onChange' | 'onBlur'> & { value: string; onChange: (value: string) => void }

/**
 * Nomor kendaraan (SPEC 7.11): the optional plate field, the same in Check-in cepat, Sewa baru and on the lease page.
 * The phone's keyboard types capitals; leaving the field writes the plate the way plates are written ("KB.1442.gz" ->
 * "KB 1442 GZ"), so what is saved is what is shown.
 */
export function PlateInput({ value, onChange, ...rest }: PlateInputProps) {
  return (
    <Input
      label="No. kendaraan (plat)"
      placeholder="mis. KB 1442 GZ"
      hint="Boleh dikosongkan. Lebih dari satu kendaraan: pisahkan dengan koma."
      autoCapitalize="characters"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      maxLength={PLATE_MAX_LENGTH}
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onChange(normalizePlate(value) ?? '')}
    />
  )
}
