/**
 * Electron ships its runtime as a separate download. Two things commonly stop it
 * landing on disk: npm >= 10.9 blocks dependency install scripts by default, and
 * the bundled extraction step can leave `dist/` half-populated. Both leave the
 * app unrunnable with a confusing error, so repair it here from the download
 * cache that `@electron/get` already maintains.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = path.join(root, 'node_modules', 'electron')

if (!fs.existsSync(electronDir)) process.exit(0)

const version = JSON.parse(
  fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'),
).version

const platformPath =
  process.platform === 'darwin'
    ? 'Electron.app/Contents/MacOS/Electron'
    : process.platform === 'win32'
      ? 'electron.exe'
      : 'electron'

const binary = path.join(electronDir, 'dist', platformPath)

if (fs.existsSync(binary) && fs.existsSync(path.join(electronDir, 'path.txt'))) {
  process.exit(0)
}

const zipName = `electron-v${version}-${process.platform}-${process.arch}.zip`
const cached = findCached(zipName)

if (!cached) {
  console.error(
    `\n  Electron ${version} is not installed and no cached download was found.\n` +
      '  Run:  npm install-scripts approve electron  &&  npm rebuild electron\n',
  )
  process.exit(0)
}

console.log(`  Repairing Electron ${version} from cached download…`)
fs.rmSync(path.join(electronDir, 'dist'), { recursive: true, force: true })
fs.mkdirSync(path.join(electronDir, 'dist'), { recursive: true })

try {
  const dist = path.join(electronDir, 'dist')
  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${cached}' -DestinationPath '${dist}' -Force`,
    ])
  } else if (process.platform === 'darwin') {
    // ditto preserves the .app bundle's symlinks and metadata; plain unzip
    // mangles them and leaves the code signature unverifiable.
    execFileSync('ditto', ['-x', '-k', cached, dist])
  } else {
    execFileSync('unzip', ['-q', '-o', cached, '-d', dist])
  }
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath)
  console.log('  Electron runtime is ready.')
} catch (err) {
  console.error(`  Could not extract ${cached}: ${err.message}`)
}

/** Walks the @electron/get cache, whose entries are hash-named directories. */
function findCached(name) {
  const cacheRoot =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Caches', 'electron')
      : process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache')
        : path.join(os.homedir(), '.cache', 'electron')

  if (!fs.existsSync(cacheRoot)) return null
  for (const entry of fs.readdirSync(cacheRoot)) {
    const candidate = path.join(cacheRoot, entry, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}
