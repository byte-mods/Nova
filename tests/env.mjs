/** Shared paths for the test suites. */
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** Scratch space for fixtures the suites build (rust/c/python projects). */
export const TMP = process.env.NOVA_TEST_TMP ?? path.join(os.tmpdir(), 'nova-ide-tests')
/** Where `npm run build:tests` puts the bundled main-process modules. */
export const BUILD = path.join(TMP, 'build')
