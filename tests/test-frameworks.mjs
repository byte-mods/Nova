import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'
const { detectFrameworks, findTestDeclarations, FRAMEWORKS } = await import(pathToFileURL(`${BUILD}/testFrameworks.js`).href)
let fails=0
const check=(l,ok,d='')=>{ if(ok)console.log(`  PASS  ${l}`); else {fails++;console.log(`  FAIL  ${l} ${d}`)} }
const ctx=(files,pkg=null)=>({root:'/p',rootFiles:new Set(files),packageJson:pkg,relative:(f)=>f.replace('/p/','')})

check('go detected from go.mod', detectFrameworks(ctx(['go.mod'])).some(f=>f.id==='go'))
check('cargo detected from Cargo.toml', detectFrameworks(ctx(['Cargo.toml'])).some(f=>f.id==='cargo'))
check('pytest detected from pyproject.toml', detectFrameworks(ctx(['pyproject.toml'])).some(f=>f.id==='pytest'))
check('vitest detected from devDependencies', detectFrameworks(ctx(['package.json'],{devDependencies:{vitest:'^1'}})).some(f=>f.id==='vitest'))
check('npm test is the fallback', detectFrameworks(ctx(['package.json'],{scripts:{test:'echo'}})).some(f=>f.id==='npm'))

const go=FRAMEWORKS.find(f=>f.id==='go')
check('go command for a single test', JSON.stringify(go.command({kind:'name',name:'TestAdd'},ctx(['go.mod'])).args).includes('^TestAdd$'))

// go -json parsing
const goEvents=[
 '{"Action":"run","Package":"acme/orders","Test":"TestAdd"}',
 '{"Action":"output","Package":"acme/orders","Test":"TestAdd","Output":"    ok\\n"}',
 '{"Action":"pass","Package":"acme/orders","Test":"TestAdd","Elapsed":0.02}',
 '{"Action":"fail","Package":"acme/orders","Test":"TestSub","Elapsed":0.01}',
].flatMap(l=>go.parseLine(l))
check('go parses run/pass/fail', goEvents.filter(e=>e.type==='result').length===2 && goEvents.find(e=>e.id==='acme/orders.TestAdd'&&e.status==='pass'), JSON.stringify(goEvents))

const cargo=FRAMEWORKS.find(f=>f.id==='cargo')
const rustEvents=['test tests::adds_two ... ok','test tests::fails_here ... FAILED','test tests::ignored_one ... ignored'].flatMap(l=>cargo.parseLine(l))
check('cargo parses ok/FAILED/ignored', rustEvents.length===3 && rustEvents[0].status==='pass' && rustEvents[1].status==='fail' && rustEvents[2].status==='skip', JSON.stringify(rustEvents))

const pytest=FRAMEWORKS.find(f=>f.id==='pytest')
const pyEvents=['tests/test_orders.py::test_create PASSED  [ 50%]','tests/test_orders.py::test_delete FAILED [100%]'].flatMap(l=>pytest.parseLine(l))
check('pytest parses PASSED/FAILED', pyEvents.length===2 && pyEvents[0].status==='pass' && pyEvents[1].status==='fail', JSON.stringify(pyEvents))

const jest=FRAMEWORKS.find(f=>f.id==='jest')
const jestOut='some noise\n'+JSON.stringify({testResults:[{name:'/p/a.test.ts',assertionResults:[{fullName:'adds numbers',status:'passed',duration:3},{fullName:'breaks',status:'failed',failureMessages:['boom']}]}]})
const jestEvents=jest.parseFinal(jestOut)
check('jest parses its JSON report', jestEvents.length===2 && jestEvents[0].status==='pass' && jestEvents[1].message==='boom', JSON.stringify(jestEvents))

// declaration detection
check('go test declarations', JSON.stringify(findTestDeclarations('go','func TestAdd(t *testing.T) {\n}\nfunc helper() {}\nfunc BenchmarkX(b *testing.B){}'))==='[{"name":"TestAdd","line":1},{"name":"BenchmarkX","line":4}]', JSON.stringify(findTestDeclarations('go','func TestAdd(t *testing.T) {}')))
check('rust needs #[test]', findTestDeclarations('rust','#[test]\nfn adds() {}\nfn helper() {}').length===1)
check('python test_ prefix', findTestDeclarations('python','def test_a():\n    pass\ndef helper():\n    pass').length===1)
check('js it/describe blocks', findTestDeclarations('typescript', "describe('suite', () => {\n  it('does a thing', () => {})\n})").length===2)

console.log(fails?`\n${fails} failed`:'\nall framework checks passed')
process.exit(fails?1:0)
