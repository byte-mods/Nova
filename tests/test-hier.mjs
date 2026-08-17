import { pathToFileURL } from 'node:url'
import { BUILD, TMP } from './env.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
const { LspManager } = await import(pathToFileURL(`${BUILD}/lspManager.js`).href)
const SB=`${TMP}/lsptest`
let fails=0
const check=(l,ok,d='')=>{ if(ok)console.log(`  PASS  ${l}`); else {fails++;console.log(`  FAIL  ${l} ${d}`)} }
const manager=new LspManager({onDiagnostics:()=>{},onStatus:()=>{},onLog:()=>{},onApplyEdit:()=>{}})

const root=path.join(SB,'rustproj2')
await fs.rm(root,{recursive:true,force:true})
await fs.mkdir(path.join(root,'src'),{recursive:true})
await fs.writeFile(path.join(root,'Cargo.toml'),'[package]\nname="demo2"\nversion="0.1.0"\nedition="2021"\n')
const f=path.join(root,'src','main.rs')
const text=`trait Shape {
    fn area(&self) -> f64;
}

struct Circle { r: f64 }

impl Shape for Circle {
    fn area(&self) -> f64 {
        3.14 * self.r * self.r
    }
}

fn total(shapes: &[Circle]) -> f64 {
    let mut sum = 0.0;
    for s in shapes {
        sum += s.area();
    }
    sum
}

fn main() {
    let shapes = vec![Circle { r: 1.0 }];
    let t = total(&shapes);
    println!("{}", t);
}
`
await fs.writeFile(f,text)
manager.setRoot(root)
await manager.detect()
await manager.openDocument(f,'rust',text)

// wait until rust-analyzer answers
for(let i=0;i<45;i++){ const d=await manager.definition(f,'rust',22,13); if((Array.isArray(d)?d:d?[d]:[]).length)break; await new Promise(r=>setTimeout(r,2000)) }

/**
 * Answering `definition` only means the file parsed. Call hierarchy needs the
 * crate graph, which lands later — so poll rather than asking once and reading
 * an empty array as "the feature is broken".
 */
async function settle(query, ok, tries = 20) {
  let last
  for (let i = 0; i < tries; i++) {
    last = await query()
    if (ok(last)) return last
    await new Promise(r => setTimeout(r, 1500))
  }
  return last
}

// inlay hints over the whole file
const hints=await manager.inlayHints(f,'rust',{start:{line:0,character:0},end:{line:24,character:0}})
check('inlay hints returned', Array.isArray(hints)&&hints.length>0, `${Array.isArray(hints)?hints.length:0} hints`)
if(Array.isArray(hints)&&hints.length) console.log('        sample:', JSON.stringify(hints.slice(0,3).map(h=>typeof h.label==='string'?h.label:h.label.map(p=>p.value).join(''))))

// call hierarchy: prepare on `total` (line 12, char 3)
const prep=await manager.prepareCallHierarchy(f,'rust',12,3)
const items=Array.isArray(prep)?prep:prep?[prep]:[]
check('prepareCallHierarchy returns an item', items.length>0 && items[0].name==='total', JSON.stringify(items[0]??{}).slice(0,140))
if(items.length){
  const incoming=await settle(
    () => manager.incomingCalls('rust',items[0]),
    r => Array.isArray(r) && r.some(c => c.from.name === 'main'),
  )
  check('incoming calls find main()', Array.isArray(incoming)&&incoming.some(c=>c.from.name==='main'), JSON.stringify(incoming?.map?.(c=>c.from.name)))
  const outgoing=await settle(
    () => manager.outgoingCalls('rust',items[0]),
    r => Array.isArray(r) && r.some(c => c.to.name === 'area'),
  )
  check('outgoing calls find area()', Array.isArray(outgoing)&&outgoing.some(c=>c.to.name==='area'), JSON.stringify(outgoing?.map?.(c=>c.to.name)))
}

// type hierarchy: prepare on Circle (line 4, char 7)
// rust-analyzer does not implement typeHierarchy; the app gates on capability.
const caps=(await manager.capabilitiesFor('rust'))?.capabilities??{}
check('call hierarchy capability advertised', caps.callHierarchyProvider===true, JSON.stringify(caps.callHierarchyProvider))
check('type hierarchy correctly reported unsupported', !caps.typeHierarchyProvider, JSON.stringify(caps.typeHierarchyProvider))
await manager.stopAll()
console.log(fails?`\n${fails} failed`:'\nall hierarchy checks passed')
process.exit(fails?1:0)
