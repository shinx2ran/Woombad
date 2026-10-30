import { useState } from 'react'
import { Button, Modal, useToast } from '../../components/ui'
import { normalizePlate } from '../../domain/plate'
import type { Lease } from '../../types/db'
import { PlateInput } from './PlateInput'
import type { LeaseActions } from './useLeaseActions'

export interface VehiclePlateModalProps {
  lease: Lease
  tenantName: string
  roomName: string
  actions: Pick<LeaseActions, 'setVehiclePlate'>
  onClose: () => void
}

/**
 * Nomor kendaraan (SPEC 7.11): fill in, change or clear the tenant's plate(s) on this lease; shown on the room board.
 * Every member may do it (front-desk work). Opened from "Info sewa" on the lease page.
 */
export function VehiclePlateModal({ lease, tenantName, roomName, actions, onClose }: VehiclePlateModalProps) {
  const toast = useToast()
  const current = lease.vehicle_plate ?? null
  const [plate, setPlate] = useState(current ?? '')
  const [saving, setSaving] = useState(false)
  const next = normalizePlate(plate)

  const save = async () => {
    setSaving(true)
    try {
      await actions.setVehiclePlate(lease, next)
      toast.success(next ? `No. kendaraan ${tenantName}: ${next}.` : `No. kendaraan ${tenantName} dikosongkan.`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan nomor kendaraan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`No. kendaraan · Kamar ${roomName}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="lg" onClick={onClose}>
            Batal
          </Button>
          <Button size="lg" onClick={() => void save()} loading={saving} disabled={saving || next === current}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-3" data-testid="vehicle-plate-sheet">
        <p className="text-sm text-slate-600">
          Kendaraan <strong className="text-slate-900">{tenantName}</strong> selama menyewa kamar ini; tampil di Papan kamar. Kosongkan bila tidak ada.
        </p>
        <PlateInput value={plate} onChange={setPlate} autoFocus />
      </div>
    </Modal>
  )
}
