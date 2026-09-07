/**
 * Puts Nova's name, version and icon onto the built Windows executable.
 *
 * electron-builder does this itself, with a copy of `rcedit` that lives inside
 * its code-signing bundle — and that bundle contains macOS symlinks, so
 * extracting it fails outright on any Windows machine without permission to
 * create symlinks. Neither this laptop nor a GitHub runner has that permission
 * by default.
 *
 * The failure is quiet in the worst way: the build still succeeds and still
 * produces a working Nova.exe, but the executable keeps Electron's own name,
 * version and icon. That is how two Novas ended up in the Start menu, one of
 * them wearing the Electron logo, with nothing to say which was which.
 *
 * So the stamping is done here instead, with `rcedit` taken as an ordinary
 * dependency that needs no extraction at all.
 *
 *   node scripts/stamp-windows.mjs [path/to/Nova.exe]
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rcedit } from 'rcedit'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const exe = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'release', 'win-unpacked', `${pkg.build.productName}.exe`)

const name = pkg.build.productName

await rcedit(exe, {
  'version-string': {
    ProductName: name,
    FileDescription: name,
    CompanyName: name,
    InternalName: name,
    OriginalFilename: `${name}.exe`,
    LegalCopyright: name,
  },
  'file-version': pkg.version,
  'product-version': pkg.version,
  icon: path.join(ROOT, 'build', 'icon.ico'),
})

process.stdout.write(`stamped ${path.relative(ROOT, exe)} as ${name} ${pkg.version}\n`)
