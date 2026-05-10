import { test, expect } from '@playwright/test'

test.describe('Route navigation', () => {
  test('home redirects to projection map', async ({ page }) => {
    await page.goto('/')
    await expect(page).not.toHaveURL(/error/)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('/projection-map loads without error', async ({ page }) => {
    await page.goto('/projection-map')
    await expect(page).not.toHaveURL(/error/)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('unknown route shows error boundary', async ({ page }) => {
    await page.goto('/does-not-exist')
    await expect(page.getByText('Unable to load this view')).toBeVisible()
  })
})
