import { TMP } from './env.mjs'
import { connect } from './cdp.mjs'
const P=`${TMP}/demo-project`
const cdp = await connect()
let fails=0
const check=(l,ok,d='')=>{ console.log(ok?`  PASS  ${l}`:`  FAIL  ${l} — ${d}`); if(!ok) fails++ }

await cdp.evaluate(`
  const s=(await import('/src/state/store.ts')).useStore
  await s.getState().openProject(${JSON.stringify(P)}); return true`)
await new Promise(r=>setTimeout(r,3000))

// Real Codex turn that edits a file — this is a genuine end-to-end AI coding run.
const run = await cdp.evaluate(`
  const s=(await import('/src/state/store.ts')).useStore
  s.getState().clearConversation()
  const id='codex-real'
  s.getState().addMessage({ id, role:'assistant', parts:[], changes:[], provider:'codex', running:true, createdAt:Date.now() })
  const { runId } = await window.nova.ai.start({
    provider:'codex',
    prompt:"In src/util.go add a new exported function 'DoubleCoupon(c Coupon) Coupon' that returns a Coupon with the same Code and twice the Percent. Keep it simple and change nothing else.",
    cwd:${JSON.stringify(P)},
    permissionMode:'acceptEdits',
  })
  s.getState().patchMessage(id, m=>({...m, runId}))
  await window.nova.ai.ack(runId)
  for (let i=0;i<150;i++){
    const m=s.getState().messages.find(x=>x.id===id)
    if (m && !m.running) break
    await new Promise(r=>setTimeout(r,1000))
  }
  const m=s.getState().messages.find(x=>x.id===id)
  return {
    finished: m?.running===false,
    firstLog: m?.parts.find(p=>p.kind==='log')?.text?.split('\\n')[0],
    text: m?.parts.filter(p=>p.kind==='text').map(p=>p.text).join(' ').slice(0,220),
    tools: m?.parts.filter(p=>p.kind==='tool').map(p=>p.toolName),
    changes: m?.changes.map(c=>({ file:c.path.split('/').pop(), kind:c.kind, add:c.additions, del:c.deletions })),
    errors: m?.parts.filter(p=>p.kind==='error').map(p=>p.text.slice(0,140)),
  }
`, 200000)

console.log('  info  first log :', run.firstLog)
console.log('  info  reply    :', (run.text||'').slice(0,150))
console.log('  info  tools    :', JSON.stringify(run.tools))
console.log('  info  changes  :', JSON.stringify(run.changes))
if (run.errors?.length) console.log('  info  errors   :', JSON.stringify(run.errors))

check('command line logged with correct flags',
  (run.firstLog??'').includes('codex exec --json') && (run.firstLog??'').includes('--sandbox workspace-write'),
  run.firstLog)
check('run finished', run.finished, String(run.finished))
check('assistant reply captured', (run.text?.length ?? 0) > 0, JSON.stringify(run.text))
check('tool calls captured (command/patch)', (run.tools?.length ?? 0) > 0, JSON.stringify(run.tools))
check('file change captured as a reviewable diff',
  (run.changes?.length ?? 0) > 0 && run.changes.some(c=>c.file==='util.go'), JSON.stringify(run.changes))

const disk = await cdp.evaluate(`
  const r = await window.nova.fs.read(${JSON.stringify(P + '/src/util.go')})
  return r.content`)
check('edit actually landed on disk', disk.includes('DoubleCoupon'), disk.slice(0,200))

const diffTab = await cdp.evaluate(`
  const s=(await import('/src/state/store.ts')).useStore
  const m=s.getState().messages.find(x=>x.id==='codex-real')
  const { openChangeDiff } = await import('/src/components/ai/AiConsole.tsx')
  openChangeDiff(m.changes[0], ${JSON.stringify(P)})
  await new Promise(r=>setTimeout(r,1200))
  const t=s.getState().tabs.find(t=>t.kind==='diff')
  return { title:t?.title, hasDiffEditor: !!document.querySelector('.monaco-diff-editor') }
`)
check('AI change opens as a diff in the editor', diffTab.hasDiffEditor, JSON.stringify(diffTab))

console.log(fails?`\n${fails} failed`:'\nreal AI coding run verified end to end')
cdp.close(); process.exit(0)
