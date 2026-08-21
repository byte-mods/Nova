/**
 * Android emulators and iOS simulators, against whatever this machine has.
 *
 * The interesting failures here are all environmental — an SDK that is present
 * but not on PATH, a simulator runtime that was removed, a device that answers
 * adb before it can draw — so this checks against the real tools rather than a
 * mock. A mock would agree with the implementation and prove nothing about the
 * one thing that actually varies.
 *
 * Missing tooling is reported and skipped, never silently passed: a machine
 * without Xcode has not proved that iOS support works, and saying otherwise
 * would be the most useless outcome available.
 *
 * Start the app first:  bash tests/restart-app.sh
 */
import { connect } from './cdp.mjs'

let pass = 0
let fail = 0
let skipped = 0

function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function skip(name, why) {
  skipped++
  console.log(`  SKIP  ${name} — ${why}`)
}

const cdp = await connect()
const j = (v) => JSON.stringify(v)

console.log('\n-- what this machine has --')

const status = await cdp.evaluate(`return await window.nova.devices.status()`, 60000)
const android = status.find((s) => s.platform === 'android')
const ios = status.find((s) => s.platform === 'ios')

check('both platforms are reported on', status.length === 2, j(status.map((s) => s.platform)))
check(
  'each one either works or says why not',
  status.every((s) => s.available || s.detail.length > 20),
  j(status.map((s) => [s.platform, s.available, s.detail.slice(0, 40)])),
)
console.log(`        android: ${android.available ? android.version : android.detail}`)
console.log(`        ios:     ${ios.available ? ios.version : ios.detail}`)

// The SDK on this machine is not on PATH, which is the normal case and the
// whole reason discovery exists.
if (android.available) {
  check('the Android SDK was found even though adb is not on PATH', android.binary.includes('platform-tools'), android.binary)
}

console.log('\n-- capabilities are declared, not guessed --')

const caps = await cdp.evaluate(`
  return {
    android: await window.nova.devices.capabilities('android'),
    ios: await window.nova.devices.capabilities('ios'),
  }`)
check('Android reports full control', caps.android.input && caps.android.logs, j(caps.android))
check(
  'iOS admits it cannot send taps through simctl',
  caps.ios.input === false && (caps.ios.note ?? '').length > 20,
  j(caps.ios),
)
check('and still offers what it can do', caps.ios.mirror && caps.ios.install, j(caps.ios))

console.log('\n-- the device list --')

const devices = await cdp.evaluate(`return await window.nova.devices.list()`, 120000)
console.log(`        ${devices.length} device(s): ${devices.map((d) => `${d.name}[${d.platform}/${d.state}]`).join(', ') || 'none'}`)

check(
  'every entry is fully described',
  devices.every((d) => d.id && d.name && d.platform && d.state),
  j(devices.slice(0, 3)),
)
check(
  'an emulator that is not running is still offered, so it can be started',
  devices.every((d) => ['booted', 'booting', 'shutdown', 'unknown'].includes(d.state)),
  j(devices.map((d) => d.state)),
)

if (android.available) {
  check('the Android AVDs on this machine are listed', devices.some((d) => d.platform === 'android'), j(devices.map((d) => d.platform)))
} else {
  skip('the Android AVDs on this machine are listed', android.detail)
}

if (!ios.available) {
  skip('iOS simulators are listed', ios.detail)
  check(
    'and no iOS devices are invented when simctl is absent',
    devices.every((d) => d.platform !== 'ios'),
    j(devices.filter((d) => d.platform === 'ios')),
  )
}

console.log('\n-- booting a real emulator, and mirroring it --')

/*
 * An emulator, deliberately, never a physical device.
 *
 * A phone plugged into this machine shows up in `adb devices` exactly like an
 * emulator does, and the input checks below press Home and swipe. Doing that to
 * someone's actual phone because it happened to be connected is not a test
 * result, it is an accident — so a real device is listed and left alone.
 */
const physical = devices.filter((d) => d.platform === 'android' && d.kind === 'physical')
if (physical.length) {
  console.log(`        (leaving ${physical.length} physical device(s) alone: ${physical.map((d) => d.name).join(', ')})`)
}
const target = devices.find((d) => d.platform === 'android' && d.kind === 'emulator')
if (!target) {
  skip('an Android emulator boots', 'no Android AVD on this machine')
  skip('frames arrive from the device', 'no Android AVD on this machine')
} else {
  const booted = await cdp.evaluate(
    `
    const device = ${j(target)}
    if (device.state !== 'booted') {
      const r = await window.nova.devices.boot(device)
      if (!r.ok) return { ok: false, error: r.error }
    }
    // Booting an emulator cold is slow; wait for it to report itself ready.
    let seen = null
    for (let i = 0; i < 150; i++) {
      const list = await window.nova.devices.list()
      seen = list.find((d) => d.state === 'booted' && d.platform === 'android' && d.kind === 'emulator')
      if (seen) break
      await new Promise((r) => setTimeout(r, 2000))
    }
    return { ok: Boolean(seen), device: seen }
  `,
    360000,
  )

  check('an Android emulator boots and reports itself ready', booted.ok, j(booted.error ?? booted))

  if (!booted.ok) {
    skip('frames arrive from the device', 'the emulator never finished booting')
  } else {
    const frames = await cdp.evaluate(
      `
      const device = JSON.parse(${j(JSON.stringify(booted.device))})
      const seen = []
      const off = window.nova.devices.onFrame((f) => seen.push(f))
      await window.nova.devices.startMirror(device)
      await new Promise((r) => setTimeout(r, 6000))
      await window.nova.devices.stopMirror(device.id)
      off()
      return seen.map((f) => ({ len: (f.image || '').length, w: f.width, h: f.height, error: f.error }))
    `,
      120000,
    )

    check('frames arrive from the device', frames.length > 0, `${frames.length} frames`)
    check(
      'each frame is a real image',
      frames.some((f) => f.len > 5000),
      j(frames.slice(0, 2)),
    )
    check(
      'and carries the device pixel size, so a click can be mapped to a tap',
      frames.some((f) => f.w > 100 && f.h > 100),
      j(frames.find((f) => f.w) ?? frames[0]),
    )

    const stopped = await cdp.evaluate(
      `
      const seen = []
      const off = window.nova.devices.onFrame((f) => seen.push(f))
      await new Promise((r) => setTimeout(r, 2500))
      off()
      return seen.length`,
      60000,
    )
    check('stopping the mirror stops the frames', stopped === 0, `${stopped} frames after stop`)

    console.log('\n-- input reaches the device --')

    const tapped = await cdp.evaluate(
      `
      const device = JSON.parse(${j(JSON.stringify(booted.device))})
      return await window.nova.devices.input(device, { kind: 'key', key: 'home' })`,
      60000,
    )
    check('a key event is accepted', tapped === true, j(tapped))

    const swiped = await cdp.evaluate(
      `
      const device = JSON.parse(${j(JSON.stringify(booted.device))})
      return await window.nova.devices.input(device, { kind: 'swipe', x: 300, y: 900, toX: 300, toY: 300, durationMs: 200 })`,
      60000,
    )
    check('a swipe is accepted', swiped === true, j(swiped))

    console.log('\n-- the logs --')
    const logs = await cdp.evaluate(
      `
      const device = JSON.parse(${j(JSON.stringify(booted.device))})
      const lines = []
      const off = window.nova.devices.onLog((l) => lines.push(l))
      const started = await window.nova.devices.startLogs(device)
      await new Promise((r) => setTimeout(r, 5000))
      await window.nova.devices.stopLogs(device.id)
      off()
      return { started, count: lines.length, sample: (lines[0] || {}).text || '' }`,
      120000,
    )
    check('logcat streams', logs.started && logs.count > 0, j({ started: logs.started, count: logs.count }))
    console.log(`        ${(logs.sample || '').slice(0, 90)}`)
  }
}

console.log('\n-- the panel --')

const panel = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.setState({ panelVisible: true })
  s.getState().showPanel('devices')
  await new Promise((r) => setTimeout(r, 1500))
  const view = document.querySelector('.devices-view')
  if (!view) return { missing: true }
  return {
    missing: false,
    rows: document.querySelectorAll('.device-row').length,
    text: (view.textContent || '').slice(0, 300),
    tab: [...document.querySelectorAll('.pane-tab')].some((t) => (t.textContent || '').includes('Devices')),
  }`)
check('the Devices panel has a tab of its own', panel.tab === true, j(panel.tab))
check('and renders', panel.missing === false, j(panel))
check(
  'listing what this machine has, or saying there is nothing',
  panel.rows > 0 || /No emulators found|Android Studio/.test(panel.text ?? ''),
  (panel.text ?? '').slice(0, 120),
)

console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped`)
await cdp.close()
process.exit(fail ? 1 : 0)
