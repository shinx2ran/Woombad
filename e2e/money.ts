import { expect, type Locator } from '@playwright/test'

/**
 * Fill a MoneyInput and make sure the amount is what the field holds. The check-in form refills "Total bayar" with
 * rate × nights a moment after the nights change; when that lands between fill's select-all and its insert, the typed
 * digits are appended to the default ("200.000360.000"). Seen about once in 40 runs, also in CI. A person cannot type
 * that fast, so the form is right and the test waits: fill again until the field shows the amount.
 */
export async function fillMoney(input: Locator, digits: string): Promise<void> {
  const shown = Number(digits).toLocaleString('id-ID')
  await expect(async () => {
    await input.fill(digits)
    await expect(input).toHaveValue(shown, { timeout: 500 })
  }).toPass({ timeout: 10_000 })
}
