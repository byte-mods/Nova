/**
 * Stands in for `electron` when the suites bundle main-process modules.
 *
 * `debugSession.ts` imports `app` to find the per-project breakpoint store.
 * The real `electron` package exports the *path to the binary* rather than the
 * API — that only exists inside a running Electron process — so bundling it for
 * a plain `node` run fails, and externalising it fails differently ("does not
 * provide an export named 'app'"). A stub is the honest answer: the suites test
 * the session logic, not Electron's path resolution.
 */
import os from 'node:os'
import path from 'node:path'

const USER_DATA = path.join(os.tmpdir(), 'nova-ide-tests', 'userData')

export const app = {
  getPath: (name) => (name === 'home' ? os.homedir() : USER_DATA),
  getName: () => 'Nova',
  getVersion: () => '0.0.0-test',
  isPackaged: false,
}

export default { app }
