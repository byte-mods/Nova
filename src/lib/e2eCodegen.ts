/**
 * Turning a recorded session into a Playwright test.
 *
 * Playwright's syntax rather than a format of Nova's own, because the point of
 * recording is to get a test into the suite the project already runs. A
 * bespoke format would need a bespoke runner, and then the recording would only
 * be useful inside this editor — which is the opposite of what it is for.
 *
 * The generator is deliberately dull. Its one job is producing something a
 * person will read and edit, so it prefers a readable locator over a clever
 * one and leaves the result formatted the way a human would have written it.
 */
import type { Locator, RecordedAction } from '@shared/e2e'

export interface CodegenOptions {
  /** The `test(...)` title. */
  title?: string
  /** Dropped from navigations, so the test reads against a configured baseURL. */
  baseUrl?: string
}

export function toPlaywright(actions: RecordedAction[], options: CodegenOptions = {}): string {
  const title = options.title?.trim() || 'records a user flow'
  const body = actions.flatMap((action) => renderAction(action, options))

  if (!body.length) {
    return [
      "import { test, expect } from '@playwright/test'",
      '',
      `test(${quote(title)}, async ({ page }) => {`,
      '  // Nothing was recorded.',
      '})',
      '',
    ].join('\n')
  }

  return [
    "import { test, expect } from '@playwright/test'",
    '',
    `test(${quote(title)}, async ({ page }) => {`,
    ...body.map((line) => `  ${line}`),
    '})',
    '',
  ].join('\n')
}

function renderAction(action: RecordedAction, options: CodegenOptions): string[] {
  switch (action.type) {
    case 'navigate':
      return [`await page.goto(${quote(relativeUrl(action.url, options.baseUrl))})`]

    case 'click':
      return [`await ${locate(action.locator)}.click()`]

    case 'fill':
      return [`await ${locate(action.locator)}.fill(${quote(action.value)})`]

    case 'check':
      return [`await ${locate(action.locator)}.${action.checked ? 'check' : 'uncheck'}()`]

    case 'select':
      return [`await ${locate(action.locator)}.selectOption(${quote(action.value)})`]

    case 'press':
      return [`await page.keyboard.press(${quote(action.key)})`]

    case 'expectText':
      return [`await expect(${locate(action.locator)}).toHaveText(${quote(action.text)})`]

    case 'expectVisible':
      return [`await expect(${locate(action.locator)}).toBeVisible()`]

    case 'expectUrl':
      return [`await expect(page).toHaveURL(${quote(action.url)})`]
  }
}

/**
 * Renders a locator in Playwright's own vocabulary.
 *
 * The ordering is Playwright's recommended one, and it is a durability
 * ordering rather than a stylistic one: a test id survives a redesign, a role
 * and an accessible name survive a class rename, and a CSS path survives
 * almost nothing. A locator that was not unique when recorded gets `.first()`,
 * because a strict-mode violation at replay time is a worse failure than
 * picking the same element the user did.
 */
export function locate(locator: Locator): string {
  const suffix = locator.unique ? '' : '.first()'

  switch (locator.kind) {
    case 'testid':
      return `page.getByTestId(${quote(locator.value)})${suffix}`
    case 'role':
      return locator.name
        ? `page.getByRole(${quote(locator.value)}, { name: ${quote(locator.name)} })${suffix}`
        : `page.getByRole(${quote(locator.value)})${suffix}`
    case 'label':
      return `page.getByLabel(${quote(locator.value)})${suffix}`
    case 'placeholder':
      return `page.getByPlaceholder(${quote(locator.value)})${suffix}`
    case 'text':
      return `page.getByText(${quote(locator.value)})${suffix}`
    case 'id':
      return `page.locator(${quote(`#${locator.value}`)})${suffix}`
    case 'css':
      return `page.locator(${quote(locator.value)})${suffix}`
  }
}

/**
 * A path relative to the configured base, so the test is not pinned to the
 * host it happened to be recorded against.
 */
function relativeUrl(url: string, baseUrl?: string): string {
  if (!baseUrl) return url
  if (!url.startsWith(baseUrl)) return url
  const rest = url.slice(baseUrl.length)
  return rest.startsWith('/') ? rest : `/${rest}`
}

/** Single quotes, as Playwright's own codegen emits. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

/* ---------------- tidying a recording ---------------- */

/**
 * Collapses a recording into what a person would have written.
 *
 * Two things dominate a raw capture and neither belongs in a test: every
 * keystroke arriving as its own `fill`, and the click that focuses a field
 * immediately before typing into it. Removing both is what makes the output
 * readable rather than a transcript.
 */
export function tidy(actions: RecordedAction[]): RecordedAction[] {
  const out: RecordedAction[] = []

  for (const action of actions) {
    const previous = out[out.length - 1]

    // Successive fills of one field are one field being typed into.
    if (
      action.type === 'fill' &&
      previous?.type === 'fill' &&
      sameTarget(previous.locator, action.locator)
    ) {
      out[out.length - 1] = action
      continue
    }

    // A click that only focused the field about to be filled says nothing.
    if (
      action.type === 'fill' &&
      previous?.type === 'click' &&
      sameTarget(previous.locator, action.locator)
    ) {
      out[out.length - 1] = action
      continue
    }

    // Two navigations in a row means the first never settled.
    if (action.type === 'navigate' && previous?.type === 'navigate') {
      out[out.length - 1] = action
      continue
    }

    out.push(action)
  }

  return out
}

function sameTarget(a: Locator, b: Locator): boolean {
  return a.kind === b.kind && a.value === b.value && a.name === b.name
}
