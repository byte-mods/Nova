import { pathToFileURL } from 'node:url'
import { BUILD, TMP } from './env.mjs'
const { DebugSession } = await import(pathToFileURL(`${BUILD}/debugSession.js`).href)
import fs from 'node:fs/promises'

const D=`${TMP}/pydbg`
// Build the fixture so the suite is self-contained.
await fs.rm(D, { recursive: true, force: true })
await fs.mkdir(D, { recursive: true })
await fs.writeFile(`${D}/app.py`, `def add(a, b):
    total = a + b
    return total


def main():
    x = 7
    y = 5
    result = add(x, y)
    print(f"total={result}")


if __name__ == "__main__":
    main()
`)
let fails=0
const check=(l,ok,d='')=>{ if(ok)console.log(`  PASS  ${l}`); else {fails++;console.log(`  FAIL  ${l} ${d}`)} }
let output=''
const session=new DebugSession({ onState:()=>{}, onOutput:(t)=>{output+=t}, onStopped:()=>{} })
const adapters=await session.detect()
const dp=adapters.find(a=>a.id==='debugpy')
check('debugpy adapter detected', dp?.installed, JSON.stringify(dp))

session.toggleBreakpoint(`${D}/app.py`, 3)   // `return total`
await session.launch({ language:'python', program:`${D}/app.py`, cwd:D })
for(let i=0;i<40;i++){ if(session.state().status==='paused')break; await new Promise(r=>setTimeout(r,500)) }
const st=session.state()
check('paused at breakpoint', st.status==='paused', `status=${st.status} err=${st.error}`)
check('stack has add() on top', st.frames[0]?.name?.includes('add'), JSON.stringify(st.frames.slice(0,3).map(f=>`${f.name}:${f.line}`)))
check('stopped on line 3', st.frames[0]?.line===3, `line=${st.frames[0]?.line}`)
check('breakpoint verified', (st.breakpoints[0]?.verified??[]).includes(3), JSON.stringify(st.breakpoints))
check('caller frame present', st.frames.some(f=>f.name.includes('main')), JSON.stringify(st.frames.map(f=>f.name)))

const scopes=await session.scopes(st.currentFrameId)
check('scopes returned', scopes.length>0, JSON.stringify(scopes.map(s=>s.name)))
const vars=scopes[0] ? await session.variables(scopes[0].variablesReference) : []
check('locals a=7 b=5 total=12', vars.find(v=>v.name==='a')?.value==='7' && vars.find(v=>v.name==='b')?.value==='5' && vars.find(v=>v.name==='total')?.value==='12', JSON.stringify(vars.map(v=>`${v.name}=${v.value}`)))

const ev=await session.evaluate('a * b', st.currentFrameId)
check('evaluate a * b = 35', ev.result==='35', JSON.stringify(ev))

// step out back into main, then continue
await session.stepOut()
for(let i=0;i<20;i++){ if(session.state().status==='paused')break; await new Promise(r=>setTimeout(r,300)) }
check('step out lands in main()', session.state().frames[0]?.name?.includes('main'), JSON.stringify(session.state().frames.slice(0,2).map(f=>`${f.name}:${f.line}`)))

await session.continue_()
for(let i=0;i<30;i++){ if(session.state().status==='inactive')break; await new Promise(r=>setTimeout(r,400)) }
check('program ran to completion', session.state().status==='inactive', session.state().status)
check('stdout captured', output.includes('total=12'), JSON.stringify(output.slice(0,200)))
await session.stop()
console.log(fails?`\n${fails} failed`:'\nall debugger checks passed')
process.exit(fails?1:0)
