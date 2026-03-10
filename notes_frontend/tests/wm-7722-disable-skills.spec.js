const { test, expect } = require('@playwright/test');

/**
 * WM-7722: Disabling skills shows error toast "Failed to sync skills" even though changes persist.
 *
 * This test:
 *  1) Opens a provided session link.
 *  2) Locates the Skills section and disables one or more skills (best-effort).
 *  3) Clicks Save.
 *  4) Asserts whether the error toast appears (captures actual behavior).
 *  5) Reloads and verifies the change persisted (expected behavior per ticket report).
 *
 * Notes:
 *  - UI selectors are best-effort because the target app is external to this repo.
 *  - If your DOM differs, update the selector heuristics in this file.
 */

// PUBLIC_INTERFACE
function sessionUrlFromEnv() {
  /**
   * Resolve the session URL to open.
   *
   * Env precedence:
   *  - WM7722_SESSION_URL (full URL)
   *  - E2E_BASE_URL + WM7722_SESSION_PATH
   *  - default hard-coded path from ticket
   */
  const full = process.env.WM7722_SESSION_URL;
  if (full) return full;

  const base = process.env.E2E_BASE_URL || 'https://qa.chat.kavia.ai';
  const path = process.env.WM7722_SESSION_PATH || '/T0002/218671/code/cg271d9351';
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
}

// PUBLIC_INTERFACE
async function openSkillsPanel(page) {
  /**
   * Best-effort navigation to the Skills section/panel.
   * Many apps label it "Skills" or have a sidebar tab.
   */
  const skillsNavCandidates = [
    page.getByRole('tab', { name: /skills/i }),
    page.getByRole('button', { name: /skills/i }),
    page.getByRole('link', { name: /skills/i }),
    page.getByText(/^skills$/i),
  ];

  for (const loc of skillsNavCandidates) {
    try {
      if (await loc.first().isVisible({ timeout: 2000 })) {
        await loc.first().click();
        return;
      }
    } catch {
      // try next candidate
    }
  }
  // If not found, assume skills are already visible on the page.
}

// PUBLIC_INTERFACE
async function disableSomeSkills(page) {
  /**
   * Attempts to disable at least one skill.
   *
   * Heuristics:
   *  - Prefer toggles/checkboxes/switches within a region containing "Skills".
   *  - Toggle the first "on/checked" control to off if possible.
   *
   * Returns an object with info used for persistence verification.
   */
  const skillsRegion = page
    .getByRole('region', { name: /skills/i })
    .or(page.locator('[data-testid*="skill" i], [class*="skill" i]'))
    .first();

  // Collect candidate controls in the region first, then globally if needed.
  const scopedCheckboxes = skillsRegion.getByRole('checkbox');
  const scopedSwitches = skillsRegion.getByRole('switch');
  const globalCheckboxes = page.getByRole('checkbox');
  const globalSwitches = page.getByRole('switch');

  // Prefer switches, then checkboxes.
  const candidates = [
    { locator: scopedSwitches, type: 'switch', scope: 'skillsRegion' },
    { locator: scopedCheckboxes, type: 'checkbox', scope: 'skillsRegion' },
    { locator: globalSwitches, type: 'switch', scope: 'global' },
    { locator: globalCheckboxes, type: 'checkbox', scope: 'global' },
  ];

  for (const { locator, type } of candidates) {
    const count = await locator.count();
    for (let i = 0; i < Math.min(count, 10); i++) {
      const control = locator.nth(i);
      try {
        if (!(await control.isVisible({ timeout: 1000 }))) continue;

        // Determine current state (checked = enabled).
        const checked = await control.isChecked().catch(() => null);
        if (checked === null) continue;

        // We want to disable, so only act on checked controls.
        if (checked) {
          // Capture an accessible name if present for later verification.
          const name = (await control.getAttribute('aria-label')) || (await control.getAttribute('name')) || '';
          await control.click({ timeout: 5000 });
          await expect(control).not.toBeChecked({ timeout: 10000 });

          return { controlType: type, index: i, name };
        }
      } catch {
        // try next control
      }
    }
  }

  // If we got here, we couldn't confidently find a skill toggle.
  // Fail with a helpful message so the selector heuristics can be updated.
  throw new Error(
    'Could not find a visible checked skills toggle/checkbox/switch to disable. Update selector heuristics in disableSomeSkills().'
  );
}

// PUBLIC_INTERFACE
async function clickSave(page) {
  /**
   * Click Save button (or equivalent) after changing skills.
   */
  const saveCandidates = [
    page.getByRole('button', { name: /^save$/i }),
    page.getByRole('button', { name: /save changes/i }),
    page.getByRole('button', { name: /apply/i }),
    page.getByRole('button', { name: /update/i }),
  ];

  for (const btn of saveCandidates) {
    try {
      if (await btn.first().isVisible({ timeout: 2000 })) {
        await btn.first().click();
        return;
      }
    } catch {
      // try next candidate
    }
  }

  throw new Error('Could not find a visible Save/Apply/Update button to click.');
}

// PUBLIC_INTERFACE
async function findFailedToSyncToast(page) {
  /**
   * Locates the WM-7722 error toast/message.
   * Returns locator (may be empty).
   */
  // Common patterns: toast container, role=alert, snackbar, etc.
  const candidates = [
    page.getByRole('alert').filter({ hasText: /failed to sync skills/i }),
    page.locator('[role="status"]').filter({ hasText: /failed to sync skills/i }),
    page.locator('[class*="toast" i], [class*="snackbar" i], [data-testid*="toast" i]').filter({
      hasText: /failed to sync skills/i,
    }),
    page.getByText(/failed to sync skills/i),
  ];

  for (const loc of candidates) {
    if (await loc.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      return loc.first();
    }
  }
  return null;
}

test.describe('WM-7722 reproduction', () => {
  test('disable skills → Save shows toast but persists changes after reload', async ({ page }, testInfo) => {
    const url = sessionUrlFromEnv();

    await testInfo.attach('session_url', {
      body: Buffer.from(url, 'utf-8'),
      contentType: 'text/plain',
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Let the app settle; session pages may do initial hydration.
    await page.waitForTimeout(2000);

    await openSkillsPanel(page);

    const disabled = await disableSomeSkills(page);

    await testInfo.attach('disabled_control', {
      body: Buffer.from(JSON.stringify(disabled, null, 2), 'utf-8'),
      contentType: 'application/json',
    });

    await clickSave(page);

    // Check for the toast. Ticket says it appears (actual) but should not (expected).
    const toast = await findFailedToSyncToast(page);

    const toastVisible = toast ? await toast.isVisible().catch(() => false) : false;

    await testInfo.attach('toast_observation', {
      body: Buffer.from(
        `Observed toast "Failed to sync skills" visible: ${toastVisible}\n(Expected: false; Actual per ticket: true)\n`,
        'utf-8'
      ),
      contentType: 'text/plain',
    });

    // Assert "actual" behavior to reproduce WM-7722 reliably in automation.
    // If/when bug is fixed, flip this expectation to `toBeFalsy()`.
    expect(toastVisible, 'WM-7722 reproduction: error toast should appear after Save').toBeTruthy();

    // Reload and verify the control remains disabled (persistence).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await openSkillsPanel(page);

    // Re-find the same control by index heuristics.
    // Prefer role=switch, then checkbox. Use global search because the region can vary post-reload.
    const role = disabled.controlType === 'switch' ? 'switch' : 'checkbox';
    const control = page.getByRole(role).nth(disabled.index);

    await expect(
      control,
      'After reload, the previously disabled control should still be present for persistence check'
    ).toBeVisible({ timeout: 15000 });

    await expect(
      control,
      'Expected persistence: disabled skill control remains unchecked after reload'
    ).not.toBeChecked({ timeout: 15000 });
  });
});
