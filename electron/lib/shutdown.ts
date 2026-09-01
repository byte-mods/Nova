/**
 * One place that knows the app is quitting, and waits for the things that must
 * finish before it does.
 *
 * `before-quit` is synchronous. Electron reads it, tears the process down, and
 * anything the handler started with `void teardown()` is abandoned mid-promise.
 * That was survivable for the pieces whose teardown only frees memory; it was
 * not survivable for the share tunnel, whose child process is what holds a
 * public URL open. Quitting Nova during a share left `cloudflared` running and
 * the project readable from the internet, with no window left to notice.
 *
 * So quitting is a two-step now: the first `before-quit` is cancelled, every
 * registered task is run to completion, and only then does the app exit for
 * real. The guard matters as much as the wait — without it, `app.exit()` would
 * raise `before-quit` again and re-enter the teardown it is finishing.
 */
import { app } from 'electron'

type Task = { name: string; run: () => Promise<unknown> | unknown }

const tasks: Task[] = []
let quitting = false

/**
 * A teardown to run before the app exits.
 *
 * Order is registration order for the start of each task, but they run
 * concurrently: they are independent, and a slow one should not delay the rest.
 */
export function onShutdown(name: string, run: Task['run']): void {
  tasks.push({ name, run })
}

/**
 * Longer than a well-behaved teardown needs, short enough that a wedged child
 * process cannot make the app unquittable. Exiting late is a bug; refusing to
 * exit is a much worse one, so this is a ceiling rather than a target.
 */
const TEARDOWN_TIMEOUT_MS = 5_000

export function installShutdownHandler(): void {
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()

    const settled = Promise.allSettled(
      tasks.map(async (task) => {
        try {
          await task.run()
        } catch {
          /* a teardown that fails must not stop the others from running */
        }
      }),
    )

    const deadline = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, TEARDOWN_TIMEOUT_MS)
      // Not `unref`ed: this timer has to keep the loop alive long enough to
      // fire, since the whole point is that nothing else is holding it open.
      void settled.then(() => clearTimeout(timer))
    })

    void Promise.race([settled, deadline]).then(() => app.exit(0))
  })
}

/** Whether teardown has begun, for code that should stop starting new work. */
export function isQuitting(): boolean {
  return quitting
}
