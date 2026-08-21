var ra = Object.defineProperty;
var ia = (r, t, e) => t in r ? ra(r, t, { enumerable: !0, configurable: !0, writable: !0, value: e }) : r[t] = e;
var H = (r, t, e) => ia(r, typeof t != "symbol" ? t + "" : t, e);
import { app as ee, ipcMain as g, shell as kn, safeStorage as Ue, dialog as Xt, BrowserWindow as _n, webContents as sa, screen as Ur, desktopCapturer as oa, nativeTheme as aa } from "electron";
import y from "node:path";
import $t, { constants as ca, existsSync as js } from "node:fs";
import { fileURLToPath as jr, pathToFileURL as la } from "node:url";
import v from "node:fs/promises";
import wt, { createHash as ua } from "node:crypto";
import { execFile as de, spawn as qe, fork as da } from "node:child_process";
import We from "node:os";
import { promisify as he } from "node:util";
import { createRequire as Is } from "node:module";
import { EventEmitter as Ns } from "node:events";
import * as ke from "@grpc/grpc-js";
import qr from "node:vm";
import Rs from "node:http";
import Ms from "node:zlib";
const Ir = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-electron",
  "build",
  "out",
  "release",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  ".gradle",
  ".idea",
  "target",
  "vendor",
  "Pods",
  "DerivedData",
  "coverage",
  ".pytest_cache",
  ".mypy_cache",
  "bin",
  "obj"
]), Ot = /* @__PURE__ */ new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".icns",
  ".svgz",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".rar",
  ".dmg",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".wav",
  ".class",
  ".jar",
  ".pyc",
  ".wasm",
  ".bin",
  ".o",
  ".a"
]);
function Sn(r) {
  const t = Math.min(r.length, 8192);
  for (let e = 0; e < t; e++) if (r[e] === 0) return !0;
  return !1;
}
function fa(r, t) {
  return y.relative(r, t).split(y.sep).some((e) => Ir.has(e));
}
async function* et(r, t) {
  let e = 0;
  const n = [r];
  for (; n.length; ) {
    const i = n.pop();
    let s;
    try {
      s = await v.readdir(i, { withFileTypes: !0 });
    } catch {
      continue;
    }
    for (const o of s) {
      if (Ir.has(o.name)) continue;
      const a = y.join(i, o.name);
      if (o.isDirectory())
        n.push(a);
      else if (o.isFile()) {
        if (++e > t) return;
        yield a;
      }
    }
  }
}
const pa = 60, ha = 30, ma = 2 * 1024 * 1024, ga = 6e4;
function Wr(r) {
  return wt.createHash("sha1").update(r).digest("hex").slice(0, 16);
}
function ya() {
  return y.join(ee.getPath("userData"), "local-history");
}
function En(r, t) {
  return y.join(ya(), Wr(r), Wr(t));
}
async function wa(r, t, e, n = "save") {
  if (e.length > ma) return;
  const i = En(r, t);
  await v.mkdir(i, { recursive: !0 });
  const o = (await Sr(i))[0];
  if (o) {
    if (Date.now() - o.at < ga) return;
    try {
      if (await v.readFile(y.join(i, o.id), "utf8") === e) return;
    } catch {
    }
  }
  const a = `${Date.now()}-${n.replace(/[^a-z]/gi, "")}.snap`;
  await v.writeFile(y.join(i, a), e, "utf8"), await v.writeFile(y.join(i, "source.txt"), t, "utf8").catch(() => {
  });
  const c = await Sr(i), u = Date.now() - ha * 864e5, f = c.filter((d, p) => p >= pa || d.at < u);
  await Promise.all(f.map((d) => v.rm(y.join(i, d.id), { force: !0 })));
}
async function Sr(r) {
  let t;
  try {
    t = await v.readdir(r);
  } catch {
    return [];
  }
  return t.filter((e) => e.endsWith(".snap")).map((e) => {
    const [n, i] = e.replace(".snap", "").split("-");
    return { id: e, at: Number(n) || 0, label: i || "save", size: 0 };
  }).sort((e, n) => n.at - e.at);
}
async function ba(r, t) {
  const e = En(r, t), n = await Sr(e);
  return Promise.all(
    n.map(async (i) => {
      try {
        const s = await v.stat(y.join(e, i.id));
        return { ...i, size: s.size };
      } catch {
        return i;
      }
    })
  );
}
async function va(r, t, e) {
  try {
    return await v.readFile(y.join(En(r, t), e), "utf8");
  } catch {
    return "";
  }
}
async function ka(r, t) {
  await v.rm(En(r, t), { recursive: !0, force: !0 });
}
function Sa(r) {
  const t = [];
  let e = !1, n = null;
  for (const i of r.split(/\r?\n/)) {
    const s = i.trim();
    if (!s || s.startsWith("#") || s.startsWith(";")) continue;
    const o = /^\[(.*)\]$/.exec(s);
    if (o) {
      n = { pattern: o[1], properties: {} }, t.push(n);
      continue;
    }
    const a = s.indexOf("=");
    if (a === -1) continue;
    const c = s.slice(0, a).trim().toLowerCase(), u = s.slice(a + 1).trim();
    if (!n) {
      c === "root" && (e = u.toLowerCase() === "true");
      continue;
    }
    n.properties[c] = u;
  }
  return { root: e, sections: t };
}
function Ls(r) {
  let t = "";
  for (let n = 0; n < r.length; n++) {
    const i = r[n];
    if (i === "*") {
      r[n + 1] === "*" ? (t += ".*", n++, r[n + 1] === "/" && (t += "/?", n++)) : t += "[^/]*";
      continue;
    }
    if (i === "?") {
      t += "[^/]";
      continue;
    }
    if (i === "[") {
      const s = r.indexOf("]", n + 1);
      if (s === -1) {
        t += "\\[";
        continue;
      }
      let o = r.slice(n + 1, s);
      o.startsWith("!") && (o = `^${o.slice(1)}`), t += `[${o}]`, n = s;
      continue;
    }
    if (i === "{") {
      const s = xa(r, n);
      if (s === -1) {
        t += "\\{";
        continue;
      }
      const o = r.slice(n + 1, s);
      /^(-?\d+)\.\.(-?\d+)$/.exec(o) ? t += "-?\\d+" : t += `(?:${o.split(",").map((c) => Ls(c).source.replace(/^\^|\$$/g, "")).join("|")})`, n = s;
      continue;
    }
    t += i.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const e = r.includes("/") ? `^/?${t}$` : `^(?:.*/)?${t}$`;
  return new RegExp(e);
}
function xa(r, t) {
  let e = 0;
  for (let n = t; n < r.length; n++)
    if (r[n] === "{") e++;
    else if (r[n] === "}" && (e--, e === 0))
      return n;
  return -1;
}
async function Aa(r, t) {
  const e = [];
  let n = y.dirname(r);
  const i = t ? y.resolve(t) : y.parse(n).root;
  for (; ; ) {
    try {
      const a = await v.readFile(y.join(n, ".editorconfig"), "utf8"), c = Sa(a);
      if (e.push({ dir: n, parsed: c }), c.root) break;
    } catch {
    }
    if (n === i || n === y.parse(n).root) break;
    const o = y.dirname(n);
    if (o === n) break;
    n = o;
  }
  if (e.length === 0) return null;
  const s = {};
  for (const { dir: o, parsed: a } of e.reverse()) {
    const c = y.relative(o, r).split(y.sep).join("/");
    for (const u of a.sections)
      Ls(u.pattern).test(c) && Object.assign(s, u.properties);
  }
  return s.indent_size === "tab" && s.tab_width && (s.indent_size = s.tab_width), Object.keys(s).length ? s : null;
}
let Ke = "";
const _a = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf"
}, Ea = 8 * 1024 * 1024;
function Ca(r) {
  g.handle("fs:list", async (e, n) => {
    const i = await v.readdir(n, { withFileTypes: !0 }), s = [];
    for (const o of i) {
      if (o.name === ".DS_Store" || o.name === ".git") continue;
      const a = y.join(n, o.name), c = o.isDirectory() || o.isSymbolicLink() && Ta(a);
      let u;
      if (!c)
        try {
          u = (await v.stat(a)).size;
        } catch {
          u = 0;
        }
      s.push({ name: o.name, path: a, isDirectory: c, size: u });
    }
    return s.sort((o, a) => o.isDirectory !== a.isDirectory ? o.isDirectory ? -1 : 1 : o.name.localeCompare(a.name, void 0, { sensitivity: "base" })), s;
  }), g.handle("fs:read", async (e, n) => {
    const i = await v.stat(n), s = y.extname(n).toLowerCase();
    if (i.size > Ea && !Ot.has(s))
      return {
        path: n,
        content: `// File is ${(i.size / 1024 / 1024).toFixed(1)} MB — too large to open in the editor.`,
        binary: !1,
        encoding: "utf8",
        mtimeMs: i.mtimeMs
      };
    const o = await v.readFile(n);
    if (Ot.has(s) || Sn(o)) {
      const a = _a[s] ?? "application/octet-stream";
      return {
        path: n,
        content: `data:${a};base64,${o.toString("base64")}`,
        binary: !0,
        encoding: "base64",
        mtimeMs: i.mtimeMs
      };
    }
    return {
      path: n,
      content: o.toString("utf8"),
      binary: !1,
      encoding: "utf8",
      mtimeMs: i.mtimeMs
    };
  }), g.handle("fs:write", async (e, n, i) => {
    if (Ke)
      try {
        const s = await v.readFile(n, "utf8");
        s !== i && await wa(Ke, n, s);
      } catch {
      }
    await v.mkdir(y.dirname(n), { recursive: !0 }), await v.writeFile(n, i, "utf8");
  }), g.handle("fs:realpath", async (e, n) => {
    try {
      return await v.realpath(n);
    } catch {
      return n;
    }
  }), g.handle(
    "editorconfig:resolve",
    (e, n, i) => Aa(n, i || Ke)
  ), g.handle("history:list", (e, n) => ba(Ke, n)), g.handle(
    "history:read",
    (e, n, i) => va(Ke, n, i)
  ), g.handle("history:clear", (e, n) => ka(Ke, n)), g.handle("fs:create", async (e, n, i) => {
    i ? await v.mkdir(n, { recursive: !0 }) : (await v.mkdir(y.dirname(n), { recursive: !0 }), await (await v.open(n, "wx")).close());
  }), g.handle("fs:rename", async (e, n, i) => {
    await v.mkdir(y.dirname(i), { recursive: !0 }), await v.rename(n, i);
  }), g.handle("fs:trash", async (e, n) => {
    await kn.trashItem(n);
  }), g.handle("fs:exists", async (e, n) => {
    try {
      return await v.access(n), !0;
    } catch {
      return !1;
    }
  }), g.handle(
    "fs:search",
    async (e, n, i, s) => {
      if (!i.trim()) return [];
      const o = (s == null ? void 0 : s.maxHits) ?? 500;
      let a;
      try {
        a = s != null && s.regex ? new RegExp(i, s.caseSensitive ? "g" : "gi") : new RegExp($a(i), s != null && s.caseSensitive ? "g" : "gi");
      } catch {
        return [];
      }
      const c = [];
      for await (const u of et(n, 3e4)) {
        if (c.length >= o) break;
        const f = y.extname(u).toLowerCase();
        if (Ot.has(f)) continue;
        let d;
        try {
          const m = await v.readFile(u);
          if (m.length > 2e6 || Sn(m)) continue;
          d = m.toString("utf8");
        } catch {
          continue;
        }
        if (!a.test(d)) continue;
        a.lastIndex = 0;
        const p = d.split(`
`);
        for (let m = 0; m < p.length && c.length < o; m++) {
          a.lastIndex = 0;
          const w = a.exec(p[m]);
          w && c.push({
            path: u,
            line: m + 1,
            column: w.index + 1,
            preview: p[m].slice(0, 240)
          });
        }
      }
      return c;
    }
  ), g.handle(
    "fs:findFiles",
    async (e, n, i, s = 60) => {
      const o = i.toLowerCase().replace(/\s+/g, ""), a = Math.max(1, Math.min(s, 3e4)), c = [];
      for await (const u of et(n, 3e4)) {
        const f = y.relative(n, u), d = o ? Oa(f.toLowerCase(), o) : 1;
        if (d > 0 && c.push({ file: u, score: d }), c.length > Math.max(4e3, a)) break;
      }
      return c.sort((u, f) => f.score - u.score || u.file.length - f.file.length), c.slice(0, a).map((u) => u.file);
    }
  );
  const t = /* @__PURE__ */ new Map();
  g.handle("fs:watch", async (e, n) => {
    Ke = n;
    for (const [i, s] of t)
      s.close(), t.delete(i);
    try {
      const i = $t.watch(n, { recursive: !0 }, (s, o) => {
        var u;
        if (!o) return;
        const a = o.toString();
        if (a.split(y.sep).some((f) => Ir.has(f))) return;
        const c = y.join(n, a);
        (u = r.onFileChanged) == null || u.call(r, c), r.broadcast("fs:changed", { path: c });
      });
      t.set(n, i);
    } catch {
    }
  });
}
function Ta(r) {
  try {
    return $t.statSync(r).isDirectory();
  } catch {
    return !1;
  }
}
function $a(r) {
  return r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Oa(r, t) {
  let e = 0, n = 0, i = 0;
  for (let s = 0; s < t.length; s++) {
    const o = t[s];
    let a = -1;
    for (let c = n; c < r.length; c++)
      if (r[c] === o) {
        a = c;
        break;
      }
    if (a === -1) return 0;
    i = a === n ? i + 1 : 0, e += 1 + i * 2, (a === 0 || "/-_. ".includes(r[a - 1])) && (e += 4), n = a + 1;
  }
  return e;
}
const Ps = he(de);
function ja(r) {
  return `'${r.replace(/'/g, "'\\''")}'`;
}
async function Ia(r, t) {
  const { stdout: e } = await Ps("git", t, {
    cwd: r,
    maxBuffer: 67108864,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  });
  return e;
}
async function Z(r, t) {
  try {
    return { ok: !0, out: await Ia(r, t) };
  } catch (e) {
    const n = e;
    return { ok: !1, out: n.stderr || n.stdout || n.message || "git failed" };
  }
}
function Zr(r, t) {
  if (r === "??") return "untracked";
  if (r.includes("U") || r === "AA" || r === "DD") return "conflicted";
  switch (t ? r[0] : r[1]) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "added";
    case "T":
      return "modified";
    default:
      return "unknown";
  }
}
function Na(r, t) {
  const e = [], n = r.split("\0");
  for (let i = 0; i < n.length; i++) {
    const s = n[i];
    if (!s) continue;
    const o = s.slice(0, 2);
    let a = s.slice(3), c;
    (o[0] === "R" || o[0] === "C") && (c = n[++i]);
    const u = y.join(t, a);
    if (o === "??") {
      e.push({ path: u, status: "untracked", staged: !1, code: o });
      continue;
    }
    o[0] !== " " && o[0] !== "?" && e.push({
      path: u,
      origPath: c ? y.join(t, c) : void 0,
      status: Zr(o, !0),
      staged: !0,
      code: o
    }), o[1] !== " " && o[1] !== "?" && e.push({
      path: u,
      origPath: c ? y.join(t, c) : void 0,
      status: Zr(o, !1),
      staged: !1,
      code: o
    });
  }
  return e;
}
const Le = "", Se = "";
function Ra() {
  g.handle("git:status", async (e, n) => {
    const i = await Z(n, ["rev-parse", "--show-toplevel"]);
    if (!i.ok)
      return {
        isRepo: !1,
        branch: "",
        upstream: "",
        ahead: 0,
        behind: 0,
        changes: [],
        root: n
      };
    const s = i.out.trim(), [o, a, c] = await Promise.all([
      Z(s, ["rev-parse", "--abbrev-ref", "HEAD"]),
      Z(s, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      Z(s, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
    ]);
    let u = 0, f = 0;
    if (c.ok) {
      const d = await Z(s, [
        "rev-list",
        "--left-right",
        "--count",
        `${c.out.trim()}...HEAD`
      ]);
      if (d.ok) {
        const [p, m] = d.out.trim().split(/\s+/).map(Number);
        f = p || 0, u = m || 0;
      }
    }
    return {
      isRepo: !0,
      branch: o.ok ? o.out.trim() : "HEAD",
      upstream: c.ok ? c.out.trim() : "",
      ahead: u,
      behind: f,
      changes: a.ok ? Na(a.out, s) : [],
      root: s
    };
  }), g.handle(
    "git:log",
    async (e, n, i = 200, s) => {
      const o = ["%H", "%h", "%s", "%b", "%an", "%ae", "%at", "%D", "%P"].join(Se) + Le, a = ["log", `--max-count=${i}`, `--format=${o}`];
      s ? a.push(s) : a.push("--all");
      const c = await Z(n, a);
      return c.ok ? c.out.split(Le).map((u) => u.replace(/^\n/, "")).filter((u) => u.trim().length > 0).map((u) => {
        const [f, d, p, m, w, k, _, x, A] = u.split(Se);
        return {
          hash: f,
          shortHash: d,
          subject: p,
          body: (m ?? "").trim(),
          author: w,
          email: k,
          date: Number(_) || 0,
          refs: x ?? "",
          parents: (A ?? "").trim().split(/\s+/).filter(Boolean)
        };
      }) : [];
    }
  ), g.handle("git:commitFiles", async (e, n, i) => {
    const s = await Z(n, [
      "show",
      "--name-status",
      "--format=",
      "--no-renames",
      i
    ]);
    return s.ok ? s.out.split(`
`).filter(Boolean).map((o) => {
      const [a, ...c] = o.split("	");
      return { path: c.join("	"), code: a };
    }) : [];
  }), g.handle("git:diff", async (e, n, i, s) => {
    const o = y.relative(n, i), a = ["diff", "--no-color"];
    s && a.push("--cached"), a.push("--", o);
    const c = await Z(n, a);
    return c.ok && c.out.trim() ? c.out : (await Z(n, ["diff", "--no-color", "--no-index", "/dev/null", i])).out;
  }), g.handle("git:commitDiff", async (e, n, i, s) => {
    const o = ["show", "--no-color", "--format=", i];
    return s && o.push("--", s), (await Z(n, o)).out;
  }), g.handle("git:showFile", async (e, n, i, s) => {
    const o = y.relative(n, s) || s, a = await Z(n, ["show", `${i}:${o}`]);
    return a.ok ? a.out : "";
  }), g.handle("git:stage", async (e, n, i) => {
    i.length && await Z(n, ["add", "--", ...i.map((s) => y.relative(n, s))]);
  }), g.handle("git:unstage", async (e, n, i) => {
    i.length && await Z(n, ["restore", "--staged", "--", ...i.map((s) => y.relative(n, s))]);
  }), g.handle("git:discard", async (e, n, i) => {
    for (const s of i) {
      const o = y.relative(n, s);
      (await Z(n, ["ls-files", "--error-unmatch", "--", o])).ok ? await Z(n, ["restore", "--worktree", "--", o]) : await Z(n, ["clean", "-fd", "--", o]);
    }
  }), g.handle("git:commit", async (e, n, i, s) => {
    const o = ["commit", "-m", i];
    return s && o.push("--amend"), (await Z(n, o)).out;
  }), g.handle("git:branches", async (e, n) => {
    const i = await Z(n, [
      "for-each-ref",
      "--format=%(refname:short)%09%(HEAD)%09%(refname)",
      "refs/heads",
      "refs/remotes"
    ]);
    return i.ok ? i.out.split(`
`).filter(Boolean).map((s) => {
      const [o, a, c] = s.split("	");
      return { name: o, current: a === "*", remote: c.startsWith("refs/remotes") };
    }).filter((s) => !s.name.endsWith("/HEAD")) : [];
  }), g.handle("git:checkout", async (e, n, i, s) => {
    await Z(n, s ? ["checkout", "-b", i] : ["checkout", i]);
  }), g.handle("git:init", async (e, n) => {
    await Z(n, ["init"]);
  }), g.handle("git:blame", async (e, n, i) => {
    const s = await Z(n, ["blame", "--line-porcelain", "--", y.relative(n, i)]);
    if (!s.ok) return [];
    const o = [], a = /* @__PURE__ */ new Map();
    let c = null, u = "", f = 0, d = "";
    for (const p of s.out.split(`
`)) {
      const m = /^([0-9a-f]{40})\s+\d+\s+(\d+)/.exec(p);
      if (m) {
        c = { hash: m[1], line: Number(m[2]) };
        const w = a.get(m[1]);
        u = (w == null ? void 0 : w.author) ?? "", f = (w == null ? void 0 : w.date) ?? 0, d = (w == null ? void 0 : w.summary) ?? "";
        continue;
      }
      p.startsWith("author ") ? u = p.slice(7) : p.startsWith("author-time ") ? f = Number(p.slice(12)) : p.startsWith("summary ") ? d = p.slice(8) : p.startsWith("	") && c && (a.set(c.hash, { author: u, date: f, summary: d }), o.push({
        line: c.line,
        hash: c.hash,
        shortHash: c.hash.slice(0, 7),
        author: u,
        date: f,
        summary: d,
        /** All-zero hash is git's marker for an uncommitted line. */
        uncommitted: /^0+$/.test(c.hash)
      }), c = null);
    }
    return o;
  }), g.handle("git:fileHistory", async (e, n, i, s = 100) => {
    const o = ["%H", "%h", "%s", "%b", "%an", "%ae", "%at", "%D"].join(Se) + Le, a = await Z(n, [
      "log",
      `--max-count=${s}`,
      `--format=${o}`,
      "--follow",
      "--",
      y.relative(n, i)
    ]);
    return a.ok ? a.out.split(Le).map((c) => c.replace(/^\n/, "")).filter((c) => c.trim()).map((c) => {
      const [u, f, d, p, m, w, k, _] = c.split(Se);
      return {
        hash: u,
        shortHash: f,
        subject: d,
        body: (p ?? "").trim(),
        author: m,
        email: w,
        date: Number(k) || 0,
        refs: _ ?? ""
      };
    }) : [];
  }), g.handle(
    "git:revert",
    (e, n, i) => Z(n, ["revert", "--no-edit", i])
  ), g.handle(
    "git:cherryPick",
    (e, n, i) => Z(n, ["cherry-pick", i])
  ), g.handle(
    "git:resetTo",
    (e, n, i, s) => Z(n, ["reset", `--${s}`, i])
  ), g.handle(
    "git:stash",
    (e, n, i) => Z(n, i ? ["stash", "push", "-u", "-m", i] : ["stash", "push", "-u"])
  ), g.handle("git:stashList", async (e, n) => {
    const i = await Z(n, ["stash", "list", "--format=%gd%x1f%s%x1f%at"]);
    return i.ok ? i.out.split(`
`).filter(Boolean).map((s) => {
      const [o, a, c] = s.split("");
      return { ref: o, subject: a, date: Number(c) || 0 };
    }) : [];
  }), g.handle(
    "git:stashApply",
    (e, n, i, s) => Z(n, s ? ["stash", "pop", i] : ["stash", "apply", i])
  ), g.handle(
    "git:stashDrop",
    (e, n, i) => Z(n, ["stash", "drop", i])
  ), g.handle("git:fetch", (e, n) => Z(n, ["fetch", "--all", "--prune"])), g.handle("git:pull", (e, n) => Z(n, ["pull", "--ff-only"])), g.handle(
    "git:push",
    (e, n, i) => Z(n, i ? ["push", "-u", "origin", "HEAD"] : ["push"])
  ), g.handle("git:raw", (e, n, i) => Z(n, i)), g.handle("git:conflicts", async (e, n) => {
    const i = await Z(n, ["diff", "--name-only", "--diff-filter=U"]);
    return i.ok ? i.out.split(`
`).filter(Boolean).map((s) => y.join(n, s)) : [];
  }), g.handle("git:mergeStages", async (e, n, i) => {
    const s = y.relative(n, i) || i, [o, a, c] = await Promise.all([
      Z(n, ["show", `:1:${s}`]),
      Z(n, ["show", `:2:${s}`]),
      Z(n, ["show", `:3:${s}`])
    ]);
    let u = "";
    try {
      u = await v.readFile(i, "utf8");
    } catch {
    }
    return {
      base: o.ok ? o.out : "",
      ours: a.ok ? a.out : "",
      theirs: c.ok ? c.out : "",
      merged: u
    };
  }), g.handle("git:resolve", async (e, n, i, s) => (await v.writeFile(i, s, "utf8"), Z(n, ["add", "--", y.relative(n, i)])));
  const r = (e) => y.join(e, ".nova", "shelf");
  g.handle("git:shelfList", async (e, n) => {
    try {
      const i = await v.readdir(r(n));
      return (await Promise.all(
        i.filter((o) => o.endsWith(".json")).map(async (o) => {
          const a = await v.readFile(y.join(r(n), o), "utf8");
          return JSON.parse(a);
        })
      )).sort((o, a) => a.createdAt - o.createdAt);
    } catch {
      return [];
    }
  }), g.handle(
    "git:shelve",
    async (e, n, i, s, o) => {
      const a = s.map((p) => y.relative(n, p));
      if (a.length === 0) return { ok: !1, out: "Nothing selected to shelve." };
      const c = [];
      for (const p of a)
        (await Z(n, ["ls-files", "--error-unmatch", "--", p])).ok || c.push(p);
      c.length && await Z(n, ["add", "--intent-to-add", "--", ...c]);
      const u = await Z(n, ["diff", "HEAD", "--binary", "--", ...a]);
      if (!u.ok || !u.out.trim())
        return { ok: !1, out: "Those files have no changes against HEAD." };
      const f = `shelf_${Date.now().toString(36)}`;
      await v.mkdir(r(n), { recursive: !0 }), await v.writeFile(y.join(r(n), `${f}.patch`), u.out, "utf8");
      const d = {
        id: f,
        name: i.trim() || `Shelved ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace("T", " ")}`,
        createdAt: Date.now(),
        files: s,
        size: u.out.length
      };
      if (await v.writeFile(y.join(r(n), `${f}.json`), JSON.stringify(d, null, 2)), o) {
        await Z(n, ["restore", "--staged", "--worktree", "--", ...a]);
        for (const p of c) await Z(n, ["clean", "-fd", "--", p]);
      }
      return { ok: !0, out: d.id };
    }
  ), g.handle("git:unshelve", async (e, n, i, s) => {
    const o = y.join(r(n), `${i}.patch`), a = await Z(n, ["apply", "--3way", o]);
    return a.ok ? (s && (await v.rm(o, { force: !0 }), await v.rm(y.join(r(n), `${i}.json`), { force: !0 })), { ok: !0, out: "Unshelved." }) : a;
  }), g.handle("git:shelfDrop", async (e, n, i) => (await v.rm(y.join(r(n), `${i}.patch`), { force: !0 }), await v.rm(y.join(r(n), `${i}.json`), { force: !0 }), { ok: !0, out: "Deleted." })), g.handle("git:shelfPatch", async (e, n, i) => {
    try {
      return await v.readFile(y.join(r(n), `${i}.patch`), "utf8");
    } catch {
      return "";
    }
  });
  const t = (e) => y.join(e, ".nova", "changelists.json");
  g.handle("git:changelists", async (e, n) => {
    try {
      return JSON.parse(await v.readFile(t(n), "utf8"));
    } catch {
      return [];
    }
  }), g.handle("git:saveChangelists", async (e, n, i) => {
    await v.mkdir(y.dirname(t(n)), { recursive: !0 }), await v.writeFile(t(n), JSON.stringify(i, null, 2));
  }), g.handle(
    "git:rebaseTodo",
    async (e, n, i) => {
      const s = ["%H", "%h", "%s"].join(Se) + Le, o = await Z(n, ["log", `--format=${s}`, `${i}..HEAD`]);
      return o.ok ? o.out.split(Le).map((a) => a.replace(/^\n/, "")).filter((a) => a.trim()).map((a) => {
        const [c, u, f] = a.split(Se);
        return { hash: c, shortHash: u, subject: f, action: "pick" };
      }) : [];
    }
  ), g.handle(
    "git:rebaseRun",
    async (e, n, i, s) => {
      if (s.length === 0) return { ok: !1, out: "Nothing to rebase." };
      const o = [];
      for (const c of [...s].reverse()) {
        if (c.action === "drop") {
          o.push(`drop ${c.hash} ${c.subject}`);
          continue;
        }
        if (c.action === "reword") {
          o.push(`pick ${c.hash} ${c.subject}`), o.push(`exec git commit --amend -m ${ja(c.message ?? c.subject)}`);
          continue;
        }
        o.push(`${c.action} ${c.hash} ${c.subject}`);
      }
      const a = y.join(We.tmpdir(), `nova-rebase-${Date.now()}.txt`);
      await v.writeFile(a, `${o.join(`
`)}
`, "utf8");
      try {
        const { stdout: c, stderr: u } = await Ps("git", ["rebase", "-i", "--autostash", i], {
          cwd: n,
          maxBuffer: 67108864,
          env: {
            ...process.env,
            GIT_OPTIONAL_LOCKS: "0",
            GIT_SEQUENCE_EDITOR: `cp ${JSON.stringify(a)}`,
            // Squash and fixup would otherwise open an editor for the combined
            // message; taking the default keeps the run non-interactive.
            GIT_EDITOR: "true"
          }
        });
        return { ok: !0, out: `${c}${u}` };
      } catch (c) {
        const u = c;
        return { ok: !1, out: u.stderr || u.stdout || u.message || "rebase failed" };
      } finally {
        await v.rm(a, { force: !0 });
      }
    }
  ), g.handle("git:rebaseAbort", (e, n) => Z(n, ["rebase", "--abort"])), g.handle("git:rebaseContinue", (e, n) => Z(n, ["rebase", "--continue"])), g.handle(
    "git:lineHistory",
    async (e, n, i, s, o, a = 40) => {
      const c = y.relative(n, i) || i, u = await Z(n, [
        "log",
        `--max-count=${a}`,
        "--no-color",
        `--format=${Le}%H${Se}%h${Se}%s${Se}%an${Se}%at`,
        `-L${s},${o}:${c}`
      ]);
      return u.ok ? { ok: !0, out: "", entries: u.out.split(Le).filter((d) => d.trim()).map((d) => {
        const p = d.indexOf(`
`), m = p === -1 ? d : d.slice(0, p), [w, k, _, x, A] = m.split(Se);
        return {
          hash: w,
          shortHash: k,
          subject: _,
          author: x,
          date: Number(A) || 0,
          diff: p === -1 ? "" : d.slice(p + 1)
        };
      }) } : { ok: !1, out: u.out, entries: [] };
    }
  );
}
function Jr(r) {
  var e;
  const t = [];
  for (const n of r) {
    if (!n.enabled) continue;
    const i = ((e = n.manifest.contributes) == null ? void 0 : e.mcpServers) ?? [];
    if (i.length && n.grantedPermissions.includes("shell"))
      for (const s of i)
        t.push({
          key: `${Kr(n.manifest.id)}__${Kr(s.name)}`,
          pluginId: n.manifest.id,
          pluginName: n.manifest.name,
          contribution: s,
          command: s.command,
          args: s.args ?? [],
          // The plugin's own directory is on PATH-adjacent env so a server can
          // find files it shipped without hard-coding an absolute path.
          env: { ...s.env ?? {}, NOVA_PLUGIN_DIR: n.dir },
          cwd: s.cwd ? y.join(n.dir, s.cwd) : n.dir
        });
  }
  return t;
}
async function Ma(r) {
  if (!r.length) return null;
  const t = {};
  for (const n of r)
    t[n.key] = { type: "stdio", command: n.command, args: n.args, env: n.env, cwd: n.cwd };
  const e = y.join(ee.getPath("userData"), "plugin-mcp.claude.json");
  return await v.writeFile(e, JSON.stringify({ mcpServers: t }, null, 2), "utf8"), e;
}
function La(r) {
  const t = [];
  for (const e of r) {
    const n = `mcp_servers.${e.key}`;
    t.push("-c", `${n}.command=${Nr(e.command)}`), e.args.length && t.push("-c", `${n}.args=${Pa(e.args)}`), Object.keys(e.env).length && t.push("-c", `${n}.env=${Da(e.env)}`);
  }
  return t;
}
function Kr(r) {
  return r.replace(/[^a-zA-Z0-9_-]/g, "_");
}
function Nr(r) {
  return JSON.stringify(r);
}
function Pa(r) {
  return `[${r.map(Nr).join(",")}]`;
}
function Da(r) {
  return `{${Object.entries(r).map(([e, n]) => `${JSON.stringify(e)}=${Nr(n)}`).join(",")}}`;
}
async function Ln() {
  try {
    const r = new AbortController(), t = setTimeout(() => r.abort(), 1500), e = await fetch("http://127.0.0.1:11434/api/tags", { signal: r.signal });
    return clearTimeout(t), e.ok ? ((await e.json()).models ?? []).map((i) => String(i.name ?? "")).filter(Boolean) : [];
  } catch {
    return [];
  }
}
function Fa(r, t) {
  const e = ["run", "--format", "json", "--thinking", "--dir", r.cwd];
  r.model && e.push("-m", r.model.includes("/") ? r.model : `ollama/${r.model}`), r.permissionMode === "plan" ? e.push("--agent", "plan") : e.push("--auto"), r.resumeSessionId && e.push("--session", r.resumeSessionId);
  for (const n of r.attachments ?? []) e.push("-f", n);
  return e.push("--", t), e;
}
function Ba(r) {
  const t = (r == null ? void 0 : r.filePath) ?? (r == null ? void 0 : r.file_path) ?? (r == null ? void 0 : r.path) ?? (r == null ? void 0 : r.file);
  return typeof t == "string" && t ? t : null;
}
function Ha(r, t, e) {
  var a;
  const n = [];
  let i = null, s = !1;
  r.sessionID && !e && n.push({ type: "session", runId: t, sessionId: String(r.sessionID) });
  const o = r.part ?? {};
  switch (String(r.type ?? "")) {
    case "text": {
      const c = String(o.text ?? "");
      c.trim() && (s = !0, n.push({ type: "assistant-text", runId: t, text: c }));
      break;
    }
    case "reasoning": {
      const c = String(o.text ?? "");
      c.trim() && n.push({ type: "thinking", runId: t, text: c });
      break;
    }
    case "tool_use": {
      const c = String(o.id ?? o.callID ?? ""), u = String(o.tool ?? "tool"), f = o.state ?? {}, d = f.input ?? {};
      i = Ba(d), n.push({ type: "tool-use", runId: t, id: c, name: u, input: d });
      const p = f.status !== "error", m = String(p ? f.output ?? f.title ?? "" : f.error ?? "failed");
      n.push({ type: "tool-result", runId: t, id: c, ok: p, preview: m.slice(0, 4e3) });
      break;
    }
    case "error": {
      const c = r.error ?? {}, u = ((a = c == null ? void 0 : c.data) == null ? void 0 : a.message) ?? (c == null ? void 0 : c.message) ?? (c == null ? void 0 : c.name) ?? JSON.stringify(c).slice(0, 400);
      n.push({ type: "error", runId: t, message: String(u) });
      break;
    }
  }
  return { events: n, file: i, sawText: s };
}
const xr = [
  {
    id: "claude",
    label: "Claude Code",
    binary: "claude",
    dialect: "claude",
    install: "npm i -g @anthropic-ai/claude-code"
  },
  {
    id: "codex",
    label: "Codex",
    binary: "codex",
    dialect: "codex",
    install: "npm i -g @openai/codex"
  },
  {
    id: "opencode",
    label: "OpenCode (local)",
    binary: "opencode",
    dialect: "opencode",
    install: "npm i -g opencode-ai — then a local model runs through Ollama"
  },
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    binary: "claude",
    dialect: "claude",
    compatible: {
      defaultBaseUrl: "https://api.moonshot.ai/anthropic",
      baseUrlEnv: "ANTHROPIC_BASE_URL",
      tokenEnv: "ANTHROPIC_AUTH_TOKEN",
      defaultModel: "kimi-k2-turbo-preview",
      console: "https://platform.moonshot.ai/console/api-keys"
    },
    install: "Needs the Claude Code CLI plus a Moonshot API key in Settings › AI"
  },
  {
    id: "glm",
    label: "GLM (Z.ai)",
    binary: "claude",
    dialect: "claude",
    compatible: {
      defaultBaseUrl: "https://api.z.ai/api/anthropic",
      baseUrlEnv: "ANTHROPIC_BASE_URL",
      tokenEnv: "ANTHROPIC_AUTH_TOKEN",
      defaultModel: "glm-4.6",
      console: "https://z.ai/manage-apikey/apikey-list"
    },
    install: "Needs the Claude Code CLI plus a Z.ai API key in Settings › AI"
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    binary: "claude",
    dialect: "claude",
    compatible: {
      defaultBaseUrl: "https://api.deepseek.com/anthropic",
      baseUrlEnv: "ANTHROPIC_BASE_URL",
      tokenEnv: "ANTHROPIC_AUTH_TOKEN",
      defaultModel: "deepseek-chat",
      console: "https://platform.deepseek.com/api_keys"
    },
    install: "Needs the Claude Code CLI plus a DeepSeek API key in Settings › AI"
  }
];
function Yr(r) {
  return xr.find((t) => t.id === r) ?? xr[0];
}
function za() {
  return xr.filter((r) => r.compatible);
}
function Ds() {
  return y.join(ee.getPath("userData"), "ai-credentials.enc");
}
async function Rr() {
  if (!Ue.isEncryptionAvailable()) return {};
  try {
    return JSON.parse(Ue.decryptString(await v.readFile(Ds())));
  } catch {
    return {};
  }
}
async function Gr(r) {
  return (await Rr())[r] ?? "";
}
async function Ua(r, t) {
  if (!Ue.isEncryptionAvailable()) return !1;
  const e = await Rr();
  t === null || !t.trim() ? delete e[r] : e[r] = t.trim();
  const n = Ds();
  return await v.mkdir(y.dirname(n), { recursive: !0 }), await v.writeFile(n, Ue.encryptString(JSON.stringify(e))), await v.chmod(n, 384).catch(() => {
  }), !0;
}
async function qa() {
  return Object.keys(await Rr()).filter((r) => r);
}
const Cn = he(de);
function Lt() {
  const r = We.homedir(), t = [
    y.join(r, ".local", "bin"),
    y.join(r, ".bun", "bin"),
    y.join(r, ".cargo", "bin"),
    y.join(r, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin"
  ], e = (process.env.PATH ?? "").split(y.delimiter).filter(Boolean), n = [.../* @__PURE__ */ new Set([...e, ...t])].join(y.delimiter);
  return { ...process.env, PATH: n, FORCE_COLOR: "0", NO_COLOR: "1" };
}
async function Wa(r, t, e, n) {
  const i = Lt();
  if (!t.compatible) return i;
  const s = y.join(ee.getPath("userData"), "vendor-cli", r);
  return await v.mkdir(s, { recursive: !0 }).catch(() => {
  }), {
    ...i,
    CLAUDE_CONFIG_DIR: s,
    [t.compatible.baseUrlEnv]: (n == null ? void 0 : n.trim()) || t.compatible.defaultBaseUrl,
    [t.compatible.tokenEnv]: e,
    // Both are set because the CLI accepts either, and leaving the other
    // inherited from the user's shell would reintroduce exactly the problem the
    // config directory is here to prevent.
    ANTHROPIC_API_KEY: e
  };
}
async function Qt(r) {
  try {
    const { stdout: t } = await Cn("/bin/sh", ["-lc", `command -v ${r}`], {
      env: Lt()
    });
    return t.trim().split(`
`)[0] ?? "";
  } catch {
    return "";
  }
}
async function Pn(r) {
  try {
    const { stdout: t } = await Cn(r, ["--version"], { env: Lt(), timeout: 8e3 });
    return t.trim().split(`
`)[0] ?? "";
  } catch {
    return "";
  }
}
const en = /* @__PURE__ */ new Map(), tn = /* @__PURE__ */ new Map(), Ar = /* @__PURE__ */ new Map(), Za = /* @__PURE__ */ new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "str_replace_editor"]);
function Ja(r, t) {
  const e = r ? r.split(`
`) : [], n = t ? t.split(`
`) : [], i = /* @__PURE__ */ new Map();
  for (const a of e) i.set(a, (i.get(a) ?? 0) + 1);
  let s = 0;
  for (const a of n) {
    const c = i.get(a) ?? 0;
    c > 0 ? i.set(a, c - 1) : s++;
  }
  let o = 0;
  for (const a of i.values()) o += a;
  return { additions: s, deletions: o };
}
async function Vr(r) {
  try {
    return await v.readFile(r, "utf8");
  } catch {
    return null;
  }
}
async function Xr(r) {
  try {
    const { stdout: t } = await Cn("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: r,
      env: Lt(),
      maxBuffer: 16777216
    });
    return new Set(
      t.split(`
`).filter(Boolean).map((e) => y.join(r, e.slice(3).split(" -> ").pop().trim()))
    );
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
async function Ka(r, t) {
  try {
    const { stdout: e } = await Cn("git", ["show", `HEAD:${y.relative(r, t)}`], {
      cwd: r,
      env: Lt(),
      maxBuffer: 16777216
    });
    return e;
  } catch {
    return null;
  }
}
function Qr(r, t) {
  Ar.set(r, t);
}
function Ya(r) {
  const t = (d) => r.broadcast("ai:event", d), e = (d, p) => {
    d.acked ? t(p) : d.buffer.push(p);
  };
  async function n(d, p) {
    d.before.has(p) || d.before.set(p, await Vr(p));
  }
  async function i(d, p) {
    const m = d.before.get(p) ?? null, w = await Vr(p);
    if (m === w) return;
    const k = p;
    if (d.reported.has(k) && m === null) return;
    d.reported.add(k);
    const _ = m === null ? "create" : w === null ? "delete" : "modify", { additions: x, deletions: A } = Ja(m ?? "", w ?? "");
    e(d, {
      type: "file-change",
      runId: d.id,
      change: {
        path: p,
        before: m ?? "",
        after: w ?? "",
        kind: _,
        additions: x,
        deletions: A
      }
    });
  }
  g.handle("ai:providers", async () => {
    const [d, p, m] = await Promise.all([
      Qt("claude"),
      Qt("codex"),
      Qt("opencode")
    ]), [w, k, _] = await Promise.all([
      d ? Pn(d) : Promise.resolve(""),
      p ? Pn(p) : Promise.resolve(""),
      m ? Pn(m) : Promise.resolve("")
    ]), x = m ? await Ln() : [];
    return [
      {
        id: "claude",
        label: "Claude Code",
        available: !!d,
        binary: d,
        version: w,
        hint: d ? "Streaming via `claude -p --output-format stream-json`" : "Install with: npm i -g @anthropic-ai/claude-code"
      },
      {
        id: "codex",
        label: "Codex",
        available: !!p,
        binary: p,
        version: k,
        hint: p ? "Streaming via `codex exec --json`" : "Install with: npm i -g @openai/codex"
      },
      {
        id: "opencode",
        label: "OpenCode (local)",
        available: !!m,
        binary: m,
        version: _,
        hint: m ? x.length > 0 ? `Local models: ${x.slice(0, 4).join(", ")}${x.length > 4 ? `, +${x.length - 4}` : ""}` : "No Ollama models found — pull one, e.g. `ollama pull qwen2.5-coder:0.5b`" : "Install with: npm i -g opencode-ai — then a local model runs through Ollama"
      },
      // Vendor endpoints driven through the Claude CLI. "Available" means both
      // halves are present: the binary that will run, and the key without which
      // it would fail on the first request with an authentication error the
      // user would have to go and interpret.
      ...await Promise.all(
        za().map(async (A) => {
          const N = await Gr(A.id);
          return {
            id: A.id,
            label: A.label,
            available: !!(d && N),
            binary: d,
            version: w,
            hint: d ? N ? `Claude Code CLI against ${A.compatible.defaultBaseUrl}` : `Add an API key in Settings › AI — get one at ${A.compatible.console}` : "Needs the Claude Code CLI, which runs this endpoint: npm i -g @anthropic-ai/claude-code"
          };
        })
      )
    ];
  }), g.handle("ai:storedKeys", () => qa()), g.handle(
    "ai:setKey",
    (d, p, m) => Ua(p, m)
  ), g.handle("ai:localModels", () => Ln()), g.handle("ai:start", async (d, p) => {
    var F, K;
    const m = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, w = Yr(p.provider), k = await Qt(w.binary);
    if (!k) {
      const Y = `\`${w.binary}\` CLI was not found on PATH. ${w.install}`;
      return Qr(m, [
        { type: "error", runId: m, message: Y },
        { type: "done", runId: m, ok: !1 }
      ]), { runId: m };
    }
    const _ = w.compatible ? await Gr(p.provider) : "";
    if (w.compatible && !_) {
      const Y = `No API key for ${w.label}. Add one in Settings › AI — keys come from ${w.compatible.console}.`;
      return Qr(m, [
        { type: "error", runId: m, message: Y },
        { type: "done", runId: m, ok: !1 }
      ]), { runId: m };
    }
    let x = p.prompt;
    if ((F = p.attachments) != null && F.length) {
      const Y = p.attachments.map((X) => `- ${y.relative(p.cwd, X) || X}`).join(`
`);
      x = `${x}

Relevant files in this project:
${Y}`;
    }
    const A = await ((K = r.mcpServers) == null ? void 0 : K.call(r)) ?? [], N = w.dialect === "claude" ? Ga(p, x, await Ma(A)) : w.dialect === "opencode" ? Fa(p, x) : Va(p, x, La(A)), j = qe(k, N, {
      cwd: p.cwd,
      env: await Wa(p.provider, w, _, p.baseUrl),
      stdio: ["ignore", "pipe", "pipe"]
    }), P = {
      id: m,
      child: j,
      provider: p.provider,
      cwd: p.cwd,
      cancelled: !1,
      before: /* @__PURE__ */ new Map(),
      reported: /* @__PURE__ */ new Set(),
      pendingEdits: /* @__PURE__ */ new Map(),
      preStatus: await Xr(p.cwd),
      authFailed: !1,
      buffer: [],
      acked: !1
    };
    en.set(m, P), tn.set(m, P), e(P, { type: "log", runId: m, text: `$ ${p.provider} ${N.join(" ")}` });
    let z = "";
    return j.stdout.setEncoding("utf8"), j.stdout.on("data", (Y) => {
      z += Y;
      let X;
      for (; (X = z.indexOf(`
`)) !== -1; ) {
        const J = z.slice(0, X).trim();
        z = z.slice(X + 1), J && o(P, J);
      }
    }), j.stderr.setEncoding("utf8"), j.stderr.on("data", (Y) => {
      const X = Y.trim();
      X && e(P, { type: "log", runId: m, text: X });
    }), j.on("error", (Y) => {
      e(P, { type: "error", runId: m, message: Y.message });
    }), j.on("close", async (Y) => {
      if (z.trim() && await o(P, z.trim()), await s(P), P.authFailed && e(P, {
        type: "error",
        runId: m,
        message: `${p.provider} could not authenticate. Run \`${p.provider} ${p.provider === "claude" ? "auth" : "login"}\` in a terminal, then try again.`
      }), p.provider === "opencode" && Y !== 0 && !P.cancelled) {
        const X = await Ln();
        e(P, {
          type: "error",
          runId: m,
          message: X.length === 0 ? "No local models are available. Start Ollama and pull one — a small one is enough to begin: `ollama pull qwen2.5-coder:0.5b`." : `OpenCode failed with a local model. Available: ${X.join(", ")}. Check the model name in Settings › AI console.`
        });
      }
      e(P, { type: "done", runId: m, ok: Y === 0 && !P.cancelled && !P.authFailed }), en.delete(m), tn.delete(m);
    }), { runId: m };
  }), g.handle("ai:ack", (d, p) => {
    const m = Ar.get(p);
    if (m) {
      Ar.delete(p);
      for (const k of m) t(k);
      return;
    }
    const w = tn.get(p);
    if (w) {
      w.acked = !0, tn.delete(p);
      for (const k of w.buffer) t(k);
      w.buffer = [];
    }
  }), g.handle("ai:cancel", (d, p) => {
    const m = en.get(p);
    m && (m.cancelled = !0, m.child.kill("SIGTERM"), setTimeout(() => {
      en.has(p) && m.child.kill("SIGKILL");
    }, 2500));
  });
  async function s(d) {
    const p = await Xr(d.cwd);
    for (const m of p)
      d.preStatus.has(m) || d.reported.has(m) || (d.before.has(m) || d.before.set(m, await Ka(d.cwd, m)), await i(d, m));
  }
  async function o(d, p) {
    let m;
    try {
      m = JSON.parse(p);
    } catch {
      e(d, { type: "log", runId: d.id, text: p });
      return;
    }
    const w = Yr(d.provider).dialect;
    w === "claude" ? await c(d, m) : w === "opencode" ? await a(d, m) : await u(d, m);
  }
  async function a(d, p) {
    const { events: m, sawText: w } = Ha(p, d.id, d.reportedSession ?? !1);
    m.some((k) => k.type === "session") && (d.reportedSession = !0), w && (d.sawAssistantText = !0);
    for (const k of m) e(d, k);
  }
  async function c(d, p) {
    var m, w, k, _, x;
    switch (p.type) {
      case "system": {
        if (p.subtype === "init" && p.session_id) {
          e(d, { type: "session", runId: d.id, sessionId: String(p.session_id) });
          return;
        }
        if (p.subtype === "api_retry") {
          const A = p.error_status ? ` (HTTP ${p.error_status})` : "", N = p.error ? `: ${p.error}` : "";
          e(d, {
            type: "log",
            runId: d.id,
            text: `Request failed${A}${N} — retrying ${p.attempt}/${p.max_retries}…`
          }), (p.error_status === 401 || p.error_status === 403) && (d.authFailed = !0);
          return;
        }
        return;
      }
      case "assistant": {
        const A = (m = p.message) == null ? void 0 : m.content;
        if (!Array.isArray(A)) return;
        for (const N of A)
          if (N.type === "text" && N.text)
            d.sawAssistantText = !0, e(d, { type: "assistant-text", runId: d.id, text: N.text });
          else if (N.type === "thinking" && N.thinking)
            e(d, { type: "thinking", runId: d.id, text: N.thinking });
          else if (N.type === "tool_use") {
            e(d, {
              type: "tool-use",
              runId: d.id,
              id: String(N.id),
              name: String(N.name),
              input: N.input
            });
            const j = ((w = N.input) == null ? void 0 : w.file_path) ?? ((k = N.input) == null ? void 0 : k.path) ?? ((_ = N.input) == null ? void 0 : _.notebook_path);
            Za.has(N.name) && typeof j == "string" && (d.pendingEdits.set(String(N.id), j), await n(d, j));
          }
        return;
      }
      case "user": {
        const A = (x = p.message) == null ? void 0 : x.content;
        if (!Array.isArray(A)) return;
        for (const N of A) {
          if (N.type !== "tool_result") continue;
          const j = String(N.tool_use_id), P = typeof N.content == "string" ? N.content : Array.isArray(N.content) ? N.content.map((F) => typeof F == "string" ? F : (F == null ? void 0 : F.text) ?? "").join(`
`) : "";
          e(d, {
            type: "tool-result",
            runId: d.id,
            id: j,
            ok: !N.is_error,
            preview: P.slice(0, 4e3)
          });
          const z = d.pendingEdits.get(j);
          z && (d.pendingEdits.delete(j), await i(d, z));
        }
        return;
      }
      case "result": {
        p.subtype !== "success" && p.result ? e(d, { type: "error", runId: d.id, message: String(p.result) }) : !d.sawAssistantText && typeof p.result == "string" && p.result.trim() && e(d, { type: "assistant-text", runId: d.id, text: p.result }), e(d, {
          type: "done",
          runId: d.id,
          ok: p.subtype === "success",
          costUsd: typeof p.total_cost_usd == "number" ? p.total_cost_usd : void 0,
          durationMs: typeof p.duration_ms == "number" ? p.duration_ms : void 0
        });
        return;
      }
      default:
        return;
    }
  }
  async function u(d, p) {
    var _;
    const m = String(p.type ?? "");
    switch (m) {
      case "thread.started":
        p.thread_id && e(d, { type: "session", runId: d.id, sessionId: String(p.thread_id) });
        return;
      case "turn.started":
        return;
      case "turn.completed":
        e(d, { type: "done", runId: d.id, ok: !0 });
        return;
      case "turn.failed":
      case "error":
        e(d, {
          type: "error",
          runId: d.id,
          message: String(((_ = p.error) == null ? void 0 : _.message) ?? p.message ?? "Codex turn failed")
        });
        return;
      case "item.started":
      case "item.completed": {
        await f(d, p.item ?? {}, m === "item.completed");
        return;
      }
    }
    const w = p.msg ?? p, k = String(w.type ?? "");
    if (k === "agent_message" || k === "agent_message_delta") {
      const x = w.message ?? w.delta ?? w.text ?? "";
      x && e(d, { type: "assistant-text", runId: d.id, text: String(x) });
      return;
    }
    if (k === "agent_reasoning" || k === "agent_reasoning_delta") {
      const x = w.text ?? w.delta ?? "";
      x && e(d, { type: "thinking", runId: d.id, text: String(x) });
      return;
    }
    k === "token_count" || k === "task_started" || k === "session_configured" || e(d, { type: "log", runId: d.id, text: JSON.stringify(p).slice(0, 800) });
  }
  async function f(d, p, m) {
    const w = String(p.id ?? Math.random());
    switch (String(p.type ?? "")) {
      case "agent_message": {
        m && p.text && e(d, { type: "assistant-text", runId: d.id, text: String(p.text) });
        return;
      }
      case "reasoning": {
        m && p.text && e(d, { type: "thinking", runId: d.id, text: String(p.text) });
        return;
      }
      case "command_execution": {
        m ? e(d, {
          type: "tool-result",
          runId: d.id,
          id: w,
          ok: (p.exit_code ?? 0) === 0,
          preview: String(p.aggregated_output ?? "").slice(0, 4e3)
        }) : e(d, {
          type: "tool-use",
          runId: d.id,
          id: w,
          name: "Bash",
          input: { command: String(p.command ?? "") }
        });
        return;
      }
      case "file_change": {
        const k = p.changes ?? [];
        if (m) {
          for (const _ of k) await i(d, _.path);
          e(d, {
            type: "tool-result",
            runId: d.id,
            id: w,
            ok: p.status !== "failed",
            preview: k.map((_) => `${_.kind ?? "update"} ${_.path}`).join(`
`)
          });
        } else {
          for (const _ of k) await n(d, _.path);
          e(d, {
            type: "tool-use",
            runId: d.id,
            id: w,
            name: "ApplyPatch",
            input: { files: k.map((_) => _.path) }
          });
        }
        return;
      }
      case "todo_list":
      case "web_search":
        return;
      default:
        m && e(d, { type: "log", runId: d.id, text: JSON.stringify(p).slice(0, 500) });
    }
  }
}
function Ga(r, t, e) {
  const n = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    r.permissionMode ?? "acceptEdits"
  ];
  return r.model && n.push("--model", r.model), r.resumeSessionId && n.push("--resume", r.resumeSessionId), e && n.push("--mcp-config", e), n.push("--", t), n;
}
function Va(r, t, e) {
  const n = ["exec", "--json", "--skip-git-repo-check", "-C", r.cwd];
  switch (r.model && n.push("-m", r.model), n.push(...e), r.permissionMode) {
    case "bypassPermissions":
      n.push("--dangerously-bypass-approvals-and-sandbox");
      break;
    case "plan":
      n.push("--sandbox", "read-only");
      break;
    default:
      n.push("--sandbox", "workspace-write");
  }
  return n.push("--", t), n;
}
function Fs(r, t, e = 0) {
  var a;
  if ((a = r.compound) != null && a.length) {
    if (e > 3) return 'echo "compound configurations nest too deeply"';
    const c = r.compound.map((u) => t.find((f) => f.name === u)).filter((u) => !!u).map((u) => Fs(u, t, e + 1));
    return c.length === 0 ? 'echo "compound configuration has no members"' : `${c.map((u) => `(${u}) &`).join(" ")} wait`;
  }
  const i = [Object.entries(r.env ?? {}).map(([c, u]) => `${c}=${ei(u)}`).join(" "), r.command ?? "", r.args ?? ""].filter(Boolean).join(" "), o = [...(r.before ?? []).filter(Boolean), i].join(" && ");
  return r.cwd ? `(cd ${ei(r.cwd)} && ${o})` : o;
}
function ei(r) {
  return /^[\w./=:-]+$/.test(r) ? r : `'${r.replace(/'/g, "'\\''")}'`;
}
async function Bs(r) {
  try {
    const t = JSON.parse(await v.readFile(y.join(r, ".nova", "run.json"), "utf8"));
    return (Array.isArray(t) ? t : t.configurations ?? []).filter((n) => n && typeof n.name == "string");
  } catch {
    return [];
  }
}
async function Xa(r, t) {
  const e = y.join(r, ".nova");
  await v.mkdir(e, { recursive: !0 }), await v.writeFile(y.join(e, "run.json"), JSON.stringify({ configurations: t }, null, 2));
}
async function Qa(r) {
  var i, s, o;
  const t = [];
  let e = /* @__PURE__ */ new Set();
  try {
    e = new Set(await v.readdir(r));
  } catch {
    return t;
  }
  if (e.has("package.json"))
    try {
      const a = JSON.parse(await v.readFile(y.join(r, "package.json"), "utf8")), c = e.has("pnpm-lock.yaml") ? "pnpm" : e.has("yarn.lock") ? "yarn" : e.has("bun.lockb") ? "bun" : "npm";
      for (const [u, f] of Object.entries(a.scripts ?? {}))
        t.push({
          id: `npm:${u}`,
          label: `${c} run ${u}`,
          command: `${c} run ${u}`,
          detail: String(f).slice(0, 90),
          source: "detected"
        });
    } catch {
    }
  e.has("Cargo.toml") && t.push(
    { id: "cargo:run", label: "cargo run", command: "cargo run", detail: "", source: "detected" },
    { id: "cargo:build", label: "cargo build", command: "cargo build", detail: "", source: "detected" }
  ), e.has("go.mod") && t.push(
    { id: "go:run", label: "go run .", command: "go run .", detail: "", source: "detected" },
    { id: "go:build", label: "go build ./...", command: "go build ./...", detail: "", source: "detected" }
  ), e.has("Makefile") && t.push({ id: "make", label: "make", command: "make", detail: "", source: "detected" }), (e.has("pyproject.toml") || e.has("requirements.txt")) && e.has("main.py") && t.push({ id: "py:main", label: "python main.py", command: "python3 main.py", detail: "", source: "detected" }), (e.has("docker-compose.yml") || e.has("compose.yaml")) && t.push({ id: "compose", label: "docker compose up", command: "docker compose up", detail: "", source: "detected" }), e.has("pom.xml") && t.push({ id: "mvn", label: "mvn spring-boot:run", command: "mvn spring-boot:run", detail: "", source: "detected" }), (e.has("build.gradle") || e.has("build.gradle.kts")) && t.push({ id: "gradle:run", label: "./gradlew run", command: "./gradlew run", detail: "", source: "detected" });
  const n = await Bs(r);
  for (const a of [...n].reverse())
    !a.command && !((i = a.compound) != null && i.length) || t.unshift({
      id: `custom:${a.name}`,
      label: a.name,
      command: Fs(a, n),
      detail: a.detail ?? ((s = a.compound) != null && s.length ? `compound: ${a.compound.join(" + ")}` : (o = a.before) != null && o.length ? `after: ${a.before.join(" && ")}` : ""),
      source: "custom"
    });
  return t;
}
async function ec(r) {
  const t = y.join(r, ".nova");
  await v.mkdir(t, { recursive: !0 });
  const e = y.join(t, "run.json");
  try {
    await v.access(e);
  } catch {
    await v.writeFile(
      e,
      JSON.stringify(
        {
          configurations: [
            { name: "Dev server", command: "npm run dev", detail: "Starts the app in watch mode" }
          ]
        },
        null,
        2
      ),
      "utf8"
    );
  }
  return e;
}
let At, Hs = "";
function tc(r) {
  const t = y.join(r, "prebuilds"), e = [y.join(r, "build", "Release", "spawn-helper")];
  try {
    for (const n of $t.readdirSync(t))
      e.push(y.join(t, n, "spawn-helper"));
  } catch {
  }
  for (const n of e)
    try {
      const i = $t.statSync(n);
      i.mode & 73 || $t.chmodSync(n, i.mode | 493);
    } catch {
    }
}
function zs() {
  if (At !== void 0) return At;
  try {
    const r = Is(import.meta.url), t = r.resolve("node-pty");
    tc(y.dirname(y.dirname(t))), At = r("node-pty");
  } catch (r) {
    Hs = r.message, At = null;
  }
  return At;
}
function ti() {
  return Hs;
}
function nc() {
  return zs() !== null;
}
const Dn = "__NOVA_CWD__", xe = /* @__PURE__ */ new Map(), nn = /* @__PURE__ */ new Map();
function ni() {
  const r = We.homedir(), t = [
    y.join(r, ".local", "bin"),
    y.join(r, ".bun", "bin"),
    y.join(r, ".cargo", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin"
  ], e = (process.env.PATH ?? "").split(y.delimiter).filter(Boolean), n = {
    ...process.env,
    PATH: [.../* @__PURE__ */ new Set([...e, ...t])].join(y.delimiter),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "Nova"
  };
  return delete n.ELECTRON_RUN_AS_NODE, delete n.NODE_OPTIONS, n;
}
function Fn() {
  return process.platform === "win32" ? process.env.COMSPEC || "powershell.exe" : process.env.SHELL || "/bin/zsh";
}
function rc(r) {
  g.handle(
    "shell:open",
    (t, e, n, i = 80, s = 24) => {
      const o = xe.get(e);
      if (o != null && o.pty) return { pty: !0, reason: "" };
      const a = zs();
      if (!a) return { pty: !1, reason: ti() };
      const c = a.spawn(Fn(), process.platform === "win32" ? [] : ["-l"], {
        name: "xterm-256color",
        cols: Math.max(20, i),
        rows: Math.max(4, s),
        cwd: n,
        env: ni()
      });
      return xe.set(e, { id: e, pty: c }), c.onData((u) => r.broadcast("shell:data", { id: e, data: u, stream: "stdout" })), c.onExit(({ exitCode: u }) => {
        xe.delete(e), r.broadcast("shell:exit", { id: e, code: u, cwd: n });
      }), { pty: !0, reason: "" };
    }
  ), g.handle("shell:resize", (t, e, n, i) => {
    const s = xe.get(e);
    if (s != null && s.pty)
      try {
        s.pty.resize(Math.max(20, Math.floor(n)), Math.max(4, Math.floor(i)));
      } catch {
      }
  }), g.handle("shell:spawn", async (t, e, n, i) => {
    var f, d, p, m;
    const s = xe.get(e);
    if (s != null && s.pty) {
      s.pty.write(`${i}\r`);
      return;
    }
    s != null && s.child && s.child.kill("SIGTERM");
    const o = nn.get(e) ?? n, a = `cd ${JSON.stringify(o)} 2>/dev/null || cd ${JSON.stringify(n)}; ${i}
__code=$?; printf "\\n${Dn}%s\\n" "$PWD"; exit $__code`, c = qe(Fn(), ["-lc", a], { cwd: o, env: ni() });
    xe.set(e, { id: e, child: c });
    const u = (w, k) => {
      const _ = w.indexOf(Dn);
      if (_ !== -1) {
        const x = w.slice(_ + Dn.length).trim();
        x && nn.set(e, x.split(`
`)[0]), w = w.slice(0, _);
      }
      w && r.broadcast("shell:data", { id: e, data: w, stream: k });
    };
    (f = c.stdout) == null || f.setEncoding("utf8"), (d = c.stdout) == null || d.on("data", (w) => u(w, "stdout")), (p = c.stderr) == null || p.setEncoding("utf8"), (m = c.stderr) == null || m.on("data", (w) => u(w, "stderr")), c.on("error", (w) => {
      r.broadcast("shell:data", { id: e, data: `${w.message}\r
`, stream: "stderr" });
    }), c.on("close", (w) => {
      xe.delete(e), r.broadcast("shell:exit", { id: e, code: w, cwd: nn.get(e) ?? o });
    });
  }), g.handle("shell:input", (t, e, n) => {
    var s, o;
    const i = xe.get(e);
    i != null && i.pty ? i.pty.write(n) : (o = (s = i == null ? void 0 : i.child) == null ? void 0 : s.stdin) == null || o.write(n);
  }), g.handle("shell:kill", (t, e) => {
    var i;
    const n = xe.get(e);
    if (n) {
      if (n.pty) {
        n.pty.write("");
        return;
      }
      (i = n.child) == null || i.kill("SIGTERM"), setTimeout(() => {
        var s;
        return (s = n.child) == null ? void 0 : s.kill("SIGKILL");
      }, 2e3);
    }
  }), g.handle("shell:dispose", (t, e) => {
    var i, s;
    const n = xe.get(e);
    if (n) {
      try {
        (i = n.pty) == null || i.kill(), (s = n.child) == null || s.kill("SIGKILL");
      } catch {
      }
      xe.delete(e), nn.delete(e);
    }
  }), g.handle("shell:capabilities", () => ({
    pty: nc(),
    reason: ti(),
    shell: Fn()
  })), g.handle("shell:runConfigs", (t, e) => Qa(e)), g.handle("shell:createRunConfig", (t, e) => ec(e)), g.handle("shell:runConfigEntries", (t, e) => Bs(e)), g.handle(
    "shell:saveRunConfigEntries",
    (t, e, n) => Xa(e, n)
  ), g.handle("shell:detectDevServer", async (t, e) => {
    try {
      const i = JSON.parse(await v.readFile(y.join(e, "package.json"), "utf8")).scripts ?? {}, s = ["dev", "start", "serve", "preview"].find((f) => i[f]);
      if (!s) return null;
      const o = i[s];
      let a = 3e3;
      const c = o.match(/--port[= ](\d+)/) ?? o.match(/-p[= ](\d+)/);
      return c ? a = Number(c[1]) : /vite/.test(o) ? a = 5173 : /next/.test(o) ? a = 3e3 : /ng serve/.test(o) ? a = 4200 : /react-scripts/.test(o) ? a = 3e3 : /astro/.test(o) ? a = 4321 : /nuxt/.test(o) && (a = 3e3), { command: `${await ic(e)} run ${s}`, url: `http://localhost:${a}` };
    } catch {
      return null;
    }
  });
}
async function ic(r) {
  const t = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"]
  ];
  for (const [e, n] of t)
    try {
      return await v.access(y.join(r, e)), n;
    } catch {
    }
  return "npm";
}
const Us = he(de);
function we(r) {
  const t = We.homedir(), e = [
    y.join(t, ".local", "bin"),
    y.join(t, ".bun", "bin"),
    y.join(t, ".cargo", "bin"),
    y.join(t, ".npm-global", "bin"),
    y.join(t, "go", "bin"),
    y.join(t, ".dotnet", "tools"),
    y.join(t, "flutter", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin"
  ], n = (process.env.PATH ?? "").split(y.delimiter).filter(Boolean);
  return {
    ...process.env,
    ...r,
    PATH: [.../* @__PURE__ */ new Set([...n, ...e])].join(y.delimiter)
  };
}
async function Re(r) {
  const t = we();
  if (r.includes("/"))
    return await _r(r) ? r : "";
  for (const e of (t.PATH ?? "").split(y.delimiter)) {
    if (!e) continue;
    const n = y.join(e, r);
    if (await _r(n)) return n;
  }
  try {
    const { stdout: e } = await Us("/bin/sh", ["-lc", `command -v ${r}`], { env: t });
    return e.trim().split(`
`)[0] ?? "";
  } catch {
    return "";
  }
}
async function _r(r) {
  try {
    return await v.access(r, ca.X_OK), !0;
  } catch {
    return !1;
  }
}
async function qs(r) {
  if (process.platform !== "darwin") return "";
  try {
    const { stdout: t } = await Us("/usr/bin/xcrun", ["--find", r], { timeout: 4e3 }), e = t.trim();
    return e && await _r(e) ? e : "";
  } catch {
    return "";
  }
}
const ri = he(de), sc = [
  ["next", "Next.js"],
  ["react", "React"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["@angular/core", "Angular"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["electron", "Electron"],
  ["vite", "Vite"],
  ["jest", "Jest"],
  ["vitest", "Vitest"],
  ["typescript", "TypeScript"],
  ["tailwindcss", "Tailwind"],
  ["prisma", "Prisma"],
  ["@nestjs/core", "NestJS"]
], oc = [
  ["django", "Django"],
  ["flask", "Flask"],
  ["fastapi", "FastAPI"],
  ["pytest", "pytest"],
  ["sqlalchemy", "SQLAlchemy"],
  ["pydantic", "Pydantic"],
  ["celery", "Celery"],
  ["numpy", "NumPy"],
  ["torch", "PyTorch"]
], ii = [
  ["spring-boot", "Spring Boot"],
  ["org.springframework", "Spring"],
  ["jakarta.persistence", "JPA"],
  ["javax.persistence", "JPA"],
  ["hibernate", "Hibernate"],
  ["io.quarkus", "Quarkus"],
  ["io.micronaut", "Micronaut"],
  ["junit", "JUnit"],
  ["com.android", "Android"]
], ac = [
  ["tokio", "Tokio"],
  ["actix-web", "Actix"],
  ["axum", "Axum"],
  ["rocket", "Rocket"],
  ["serde", "Serde"],
  ["diesel", "Diesel"]
], cc = [
  ["github.com/gin-gonic/gin", "Gin"],
  ["github.com/labstack/echo", "Echo"],
  ["github.com/gofiber/fiber", "Fiber"],
  ["google.golang.org/grpc", "gRPC"],
  ["k8s.io/", "Kubernetes"]
];
function ct(r, t) {
  const e = /* @__PURE__ */ new Set();
  for (const [n, i] of t)
    r.includes(n) && e.add(i);
  return [...e];
}
const lc = [
  "package.json",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "pyproject.toml",
  "requirements.txt",
  "Gemfile",
  "composer.json",
  "Package.swift",
  "pubspec.yaml"
], uc = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".cache",
  "coverage",
  "release"
]);
async function dc(r) {
  const t = [];
  async function e(n, i) {
    let s;
    try {
      s = await v.readdir(n);
    } catch {
      return;
    }
    const o = new Set(s), a = lc.find((c) => o.has(c));
    if (a && t.push({ dir: y.relative(r, n), manifest: a }), !(i >= 3))
      for (const c of s) {
        if (uc.has(c) || c.startsWith(".")) continue;
        const u = y.join(n, c);
        try {
          (await v.stat(u)).isDirectory() && await e(u, i + 1);
        } catch {
        }
      }
  }
  return await e(r, 0), t;
}
async function fc(r, t, e) {
  var a, c, u, f, d, p, m, w, k;
  const n = y.join(r, t), i = t === "" ? y.basename(r) : t, s = {
    dir: t,
    name: i,
    manifest: e,
    language: "",
    frameworks: [],
    dependsOn: [],
    engine: ""
  }, o = async (_) => {
    try {
      return await v.readFile(y.join(n, _), "utf8");
    } catch {
      return "";
    }
  };
  switch (e) {
    case "package.json": {
      s.language = "JavaScript / TypeScript";
      try {
        const _ = JSON.parse(await o("package.json"));
        _.name && (s.name = _.name);
        const x = { ..._.dependencies, ..._.devDependencies };
        s.frameworks = ct(Object.keys(x).join(" "), sc), (a = _.engines) != null && a.node && (s.engine = `node ${_.engines.node}`), s.dependsOn = Object.entries(x).filter(([, A]) => typeof A == "string" && /^(workspace:|file:|link:)/.test(A)).map(([A]) => A);
      } catch {
      }
      break;
    }
    case "go.mod": {
      s.language = "Go";
      const _ = await o("go.mod"), x = (c = /^module\s+(\S+)/m.exec(_)) == null ? void 0 : c[1];
      x && (s.name = x);
      const A = (u = /^go\s+(\S+)/m.exec(_)) == null ? void 0 : u[1];
      A && (s.engine = `go ${A}`), s.frameworks = ct(_, cc);
      break;
    }
    case "Cargo.toml": {
      s.language = "Rust";
      const _ = await o("Cargo.toml"), x = (f = /^\s*name\s*=\s*"([^"]+)"/m.exec(_)) == null ? void 0 : f[1];
      x && (s.name = x), s.frameworks = ct(_, ac), s.dependsOn = [..._.matchAll(/^\s*([\w-]+)\s*=\s*\{[^}]*path\s*=/gm)].map((A) => A[1]);
      break;
    }
    case "pom.xml": {
      s.language = "Java";
      const _ = await o("pom.xml"), x = (d = /<artifactId>([^<]+)<\/artifactId>/.exec(_)) == null ? void 0 : d[1];
      x && (s.name = x);
      const A = ((p = /<java\.version>([^<]+)</.exec(_)) == null ? void 0 : p[1]) ?? ((m = /<maven\.compiler\.source>([^<]+)</.exec(_)) == null ? void 0 : m[1]);
      A && (s.engine = `java ${A}`), s.frameworks = ct(_, ii);
      break;
    }
    case "build.gradle":
    case "build.gradle.kts": {
      s.language = "Java / Kotlin";
      const _ = await o(e);
      s.frameworks = ct(_, ii), s.dependsOn = [..._.matchAll(/project\(["':]+([\w:-]+)["']?\)/g)].map(
        (x) => x[1].replace(/^:/, "")
      );
      break;
    }
    case "pyproject.toml":
    case "requirements.txt": {
      s.language = "Python";
      const _ = `${await o("pyproject.toml")}
${await o("requirements.txt")}`, x = (w = /^\s*name\s*=\s*"([^"]+)"/m.exec(_)) == null ? void 0 : w[1];
      x && (s.name = x);
      const A = (k = /requires-python\s*=\s*"([^"]+)"/.exec(_)) == null ? void 0 : k[1];
      A && (s.engine = `python ${A}`), s.frameworks = ct(_.toLowerCase(), oc);
      break;
    }
    case "Gemfile":
      s.language = "Ruby";
      break;
    case "composer.json": {
      s.language = "PHP";
      const _ = await o("composer.json");
      _.includes("laravel") && s.frameworks.push("Laravel"), _.includes("symfony") && s.frameworks.push("Symfony");
      break;
    }
    case "Package.swift":
      s.language = "Swift";
      break;
    case "pubspec.yaml": {
      s.language = "Dart", (await o("pubspec.yaml")).includes("flutter") && s.frameworks.push("Flutter");
      break;
    }
  }
  return s;
}
const pc = [
  { id: "node", label: "Node.js", command: "node", args: ["--version"] },
  { id: "python", label: "Python", command: "python3", args: ["--version"] },
  { id: "go", label: "Go", command: "go", args: ["version"] },
  { id: "rust", label: "Rust", command: "rustc", args: ["--version"] },
  { id: "java", label: "Java", command: "java", args: ["-version"] },
  { id: "ruby", label: "Ruby", command: "ruby", args: ["--version"] },
  { id: "php", label: "PHP", command: "php", args: ["--version"] },
  { id: "swift", label: "Swift", command: "swift", args: ["--version"] },
  { id: "dotnet", label: ".NET", command: "dotnet", args: ["--version"] }
];
async function hc() {
  return Promise.all(
    pc.map(async (r) => {
      try {
        const { stdout: t, stderr: e } = await ri(r.command, r.args, {
          env: we(),
          timeout: 4e3
        }), n = (t || e).trim().split(`
`)[0].slice(0, 80), { stdout: i } = await ri("which", [r.command], { env: we() }).catch(
          () => ({ stdout: "" })
        );
        return { id: r.id, label: r.label, version: n, binary: i.trim() };
      } catch {
        return { id: r.id, label: r.label, version: "", binary: "" };
      }
    })
  );
}
async function mc(r) {
  const t = await dc(r), e = await Promise.all(t.map(({ dir: i, manifest: s }) => fc(r, i, s))), n = new Map(e.map((i) => [i.name, i]));
  for (const i of e)
    i.dependsOn = i.dependsOn.filter((s) => n.has(s) && s !== i.name).sort();
  return e.sort((i, s) => i.dir.localeCompare(s.dir)), { modules: e, sdks: await hc() };
}
function rn(r) {
  return y.join(ee.getPath("userData"), r);
}
async function Bn(r, t) {
  try {
    return JSON.parse(await v.readFile(r, "utf8"));
  } catch {
    return t;
  }
}
async function si(r, t) {
  await v.mkdir(y.dirname(r), { recursive: !0 }), await v.writeFile(r, JSON.stringify(t, null, 2), "utf8");
}
function gc(r) {
  g.handle("app:openFolderDialog", async () => {
    const t = r.getWindow(), e = t ? await Xt.showOpenDialog(t, { properties: ["openDirectory", "createDirectory"] }) : await Xt.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return e.canceled || e.filePaths.length === 0 ? null : e.filePaths[0];
  }), g.handle(
    "app:openFileDialog",
    async (t, e) => {
      const n = r.getWindow(), i = { properties: ["openFile"], filters: e == null ? void 0 : e.filters }, s = n ? await Xt.showOpenDialog(n, i) : await Xt.showOpenDialog(i);
      return s.canceled || s.filePaths.length === 0 ? null : s.filePaths[0];
    }
  ), g.handle("app:recents", () => Bn(rn("recents.json"), [])), g.handle("app:addRecent", async (t, e) => {
    const n = rn("recents.json"), i = await Bn(n, []), s = [
      { path: e, name: y.basename(e), openedAt: Date.now() },
      ...i.filter((o) => o.path !== e)
    ].slice(0, 12);
    return await si(n, s), s;
  }), g.handle("app:homeDir", () => We.homedir()), g.handle("app:projectModel", (t, e) => mc(e)), g.handle("app:readSettings", () => Bn(rn("settings.json"), null)), g.handle(
    "app:writeSettings",
    (t, e) => si(rn("settings.json"), e)
  ), g.handle("app:reveal", (t, e) => {
    kn.showItemInFolder(e);
  }), g.handle("app:openExternal", (t, e) => {
    /^https?:/i.test(e) && kn.openExternal(e);
  });
}
function Ws(r) {
  const t = r.split("/").filter(Boolean);
  return t[t.length - 1] ?? r;
}
function yc(r) {
  const t = Ws(r), e = t.lastIndexOf(".");
  return e <= 0 ? "" : t.slice(e).toLowerCase();
}
const wc = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".jsonc": "json",
  ".json5": "json",
  ".html": "html",
  ".htm": "html",
  ".vue": "html",
  ".svelte": "html",
  ".hbs": "handlebars",
  ".pug": "pug",
  ".css": "css",
  ".scss": "scss",
  ".sass": "scss",
  ".less": "less",
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".py": "python",
  ".pyi": "python",
  ".rb": "ruby",
  ".gemspec": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".swift": "swift",
  ".m": "objective-c",
  ".mm": "objective-c",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".cs": "csharp",
  ".fs": "fsharp",
  ".fsx": "fsharp",
  ".php": "php",
  ".pl": "perl",
  ".pm": "perl",
  ".lua": "lua",
  ".r": "r",
  ".jl": "julia",
  ".dart": "dart",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hs": "haskell",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".fish": "shell",
  ".ps1": "powershell",
  ".bat": "bat",
  ".cmd": "bat",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "proto",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "ini",
  ".ini": "ini",
  ".cfg": "ini",
  ".conf": "ini",
  ".env": "ini",
  ".xml": "xml",
  ".svg": "xml",
  ".plist": "xml",
  ".gradle": "groovy",
  ".groovy": "groovy",
  ".tf": "hcl",
  ".tfvars": "hcl",
  ".hcl": "hcl",
  ".dockerfile": "dockerfile",
  ".sol": "sol",
  ".vb": "vb",
  ".pas": "pascal",
  ".asm": "plaintext",
  ".s": "plaintext",
  ".txt": "plaintext",
  ".log": "plaintext",
  ".csv": "plaintext",
  ".mermaid": "plaintext",
  ".mmd": "plaintext",
  ".ipynb": "json"
}, oi = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  rakefile: "ruby",
  gemfile: "ruby",
  brewfile: "ruby",
  procfile: "yaml",
  ".gitignore": "plaintext",
  ".gitattributes": "plaintext",
  ".npmrc": "ini",
  ".editorconfig": "ini",
  "cmakelists.txt": "plaintext"
};
function ft(r) {
  const t = Ws(r).toLowerCase();
  return oi[t] ? oi[t] : t.startsWith("dockerfile") ? "dockerfile" : t.startsWith(".env") ? "ini" : wc[yc(r)] ?? "plaintext";
}
const ai = /* @__PURE__ */ new Set([
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
  "kotlin",
  "scala",
  "groovy",
  "swift",
  "objective-c",
  "c",
  "cpp",
  "csharp",
  "ruby",
  "php",
  "dart",
  "elixir",
  "erlang",
  "haskell",
  "clojure",
  "lua",
  "r",
  "julia",
  "perl",
  "shell",
  "powershell",
  "sql",
  "graphql",
  "proto",
  "hcl",
  "css",
  "scss",
  "less",
  "html",
  "sol",
  "vb",
  "fsharp",
  "pascal"
]), Hn = "[A-Za-z_$][\\w$]*", tt = {
  typescript: [
    { re: /^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface", opensContainer: !0 },
    { re: /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: "enum", opensContainer: !0 },
    { re: /^\s*(?:export\s+)?(?:declare\s+)?namespace\s+([A-Za-z_$][\w$]*)/, kind: "module", opensContainer: !0 },
    { re: /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, kind: "type" },
    { re: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: "function" },
    // `const foo = (a) => …` and `const foo = function …`
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=>)/, kind: "function", topLevelOnly: !0 },
    { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/, kind: "constant", topLevelOnly: !0 },
    { re: /^\s*(?:export\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)/, kind: "variable", topLevelOnly: !0 },
    // Class/interface members: require a body or a type annotation so calls do not match.
    { re: /^\s+(?:(?:public|private|protected|static|readonly|async|override|abstract|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^;]*\)\s*(?::\s*[^{;]+)?\s*\{/, kind: "method" },
    { re: /^\s+(?:(?:public|private|protected|readonly|static|declare)\s+)+([A-Za-z_$][\w$]*)\s*[?!]?\s*[:=]/, kind: "property" }
  ],
  python: [
    { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: "function", methodInContainer: !0 },
    { re: /^([A-Z_][A-Z0-9_]*)\s*(?::[^=]+)?=/, kind: "constant" },
    { re: /^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/, kind: "variable" }
  ],
  go: [
    { re: /^func\s+\([^)]*\)\s*([A-Za-z_]\w*)/, kind: "method" },
    { re: /^func\s+([A-Za-z_]\w*)/, kind: "function" },
    { re: /^type\s+([A-Za-z_]\w*)\s+struct/, kind: "struct", opensContainer: !0 },
    { re: /^type\s+([A-Za-z_]\w*)\s+interface/, kind: "interface", opensContainer: !0 },
    { re: /^type\s+([A-Za-z_]\w*)/, kind: "type" },
    { re: /^const\s+([A-Za-z_]\w*)/, kind: "constant" },
    { re: /^var\s+([A-Za-z_]\w*)/, kind: "variable" },
    { re: /^\s+([A-Za-z_]\w*)\s+[\w*\[\]./]+(?:\s+`[^`]*`)?\s*$/, kind: "field" }
  ],
  rust: [
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/, kind: "function", methodInContainer: !0 },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, kind: "struct", opensContainer: !0 },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, kind: "enum", opensContainer: !0 },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/, kind: "trait", opensContainer: !0 },
    { re: /^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>, ]+\s+for\s+)?([A-Za-z_]\w*)/, kind: "module", opensContainer: !0 },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)/, kind: "module", opensContainer: !0 },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)/, kind: "type" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:static|const)\s+(?:mut\s+)?([A-Za-z_]\w*)/, kind: "constant" },
    { re: /^\s*macro_rules!\s*([A-Za-z_]\w*)/, kind: "macro" }
  ],
  java: [
    { re: /^\s*(?:(?:public|private|protected|static|final|abstract|sealed)\s+)*(?:class|record)\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*(?:(?:public|private|protected|static|abstract|sealed)\s+)*interface\s+([A-Za-z_]\w*)/, kind: "interface", opensContainer: !0 },
    { re: /^\s*(?:(?:public|private|protected|static|final)\s+)*enum\s+([A-Za-z_]\w*)/, kind: "enum", opensContainer: !0 },
    { re: /^\s*package\s+([\w.]+)/, kind: "module" },
    { re: /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp)\s+)+(?:<[^>]+>\s*)?[\w.<>\[\],? ]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:throws\s+[\w., ]+)?\s*[{;]/, kind: "method" },
    { re: /^\s*(?:(?:public|private|protected|static|final|volatile|transient)\s+)+[\w.<>\[\],? ]+\s+([A-Za-z_]\w*)\s*[=;]/, kind: "field" }
  ],
  kotlin: [
    { re: /^\s*(?:(?:public|private|protected|internal|open|abstract|sealed|data|inner|value)\s+)*(?:class|object)\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*(?:(?:public|private|protected|internal)\s+)*interface\s+([A-Za-z_]\w*)/, kind: "interface", opensContainer: !0 },
    { re: /^\s*(?:(?:public|private|protected|internal|open|override|suspend|inline|operator|tailrec)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.<>]+\.)?([A-Za-z_]\w*)/, kind: "function", methodInContainer: !0 },
    { re: /^\s*(?:(?:public|private|protected|internal|const|lateinit|override)\s+)*va[lr]\s+([A-Za-z_]\w*)/, kind: "variable" },
    { re: /^\s*typealias\s+([A-Za-z_]\w*)/, kind: "type" }
  ],
  scala: [
    { re: /^\s*(?:(?:private|protected|final|sealed|abstract|implicit|case)\s+)*(?:class|object|trait)\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*(?:(?:private|protected|final|override|implicit)\s+)*def\s+([A-Za-z_]\w*)/, kind: "function", methodInContainer: !0 },
    { re: /^\s*(?:(?:private|protected|final|lazy|implicit)\s+)*va[lr]\s+([A-Za-z_]\w*)/, kind: "variable" },
    { re: /^\s*type\s+([A-Za-z_]\w*)/, kind: "type" }
  ],
  groovy: [
    { re: /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*class\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*(?:(?:public|private|protected|static|final)\s+)*def\s+([A-Za-z_]\w*)/, kind: "function", methodInContainer: !0 }
  ],
  swift: [
    { re: /^\s*(?:(?:public|private|internal|fileprivate|open|final|@\w+)\s+)*(?:class|struct|actor)\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*(?:(?:public|private|internal|fileprivate|open)\s+)*protocol\s+([A-Za-z_]\w*)/, kind: "interface", opensContainer: !0 },
    { re: /^\s*(?:(?:public|private|internal|fileprivate|indirect)\s+)*enum\s+([A-Za-z_]\w*)/, kind: "enum", opensContainer: !0 },
    { re: /^\s*extension\s+([A-Za-z_]\w*)/, kind: "module", opensContainer: !0 },
    { re: /^\s*(?:(?:public|private|internal|fileprivate|open|static|class|override|mutating|@\w+)\s+)*func\s+([A-Za-z_]\w*)/, kind: "function", methodInContainer: !0 },
    { re: /^\s*(?:(?:public|private|internal|fileprivate|static|lazy|weak|@\w+)\s+)*(?:let|var)\s+([A-Za-z_]\w*)/, kind: "variable" },
    { re: /^\s*typealias\s+([A-Za-z_]\w*)/, kind: "type" }
  ],
  c: [
    { re: /^\s*(?:typedef\s+)?struct\s+([A-Za-z_]\w*)/, kind: "struct", opensContainer: !0 },
    { re: /^\s*(?:typedef\s+)?union\s+([A-Za-z_]\w*)/, kind: "struct" },
    { re: /^\s*(?:typedef\s+)?enum\s+([A-Za-z_]\w*)/, kind: "enum" },
    { re: /^\s*#\s*define\s+([A-Za-z_]\w*)/, kind: "macro" },
    { re: /^\s*typedef\s+.*\b([A-Za-z_]\w*)\s*;/, kind: "type" },
    { re: /^\s*[A-Za-z_][\w\s*&:<>,]*?\b([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?\{/, kind: "function", methodInContainer: !0 }
  ],
  cpp: [
    { re: /^\s*(?:template\s*<[^>]*>\s*)?class\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*(?:template\s*<[^>]*>\s*)?struct\s+([A-Za-z_]\w*)/, kind: "struct", opensContainer: !0 },
    { re: /^\s*enum(?:\s+class)?\s+([A-Za-z_]\w*)/, kind: "enum" },
    { re: /^\s*namespace\s+([A-Za-z_]\w*)/, kind: "module", opensContainer: !0 },
    { re: /^\s*#\s*define\s+([A-Za-z_]\w*)/, kind: "macro" },
    { re: /^\s*using\s+([A-Za-z_]\w*)\s*=/, kind: "type" },
    { re: /^\s*[A-Za-z_~][\w\s*&:<>,]*?\b([A-Za-z_~]\w*)\s*\([^;]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?\{/, kind: "function", methodInContainer: !0 }
  ],
  "objective-c": [
    { re: /^\s*@(?:interface|implementation)\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*@protocol\s+([A-Za-z_]\w*)/, kind: "interface", opensContainer: !0 },
    { re: /^\s*[-+]\s*\([^)]*\)\s*([A-Za-z_]\w*)/, kind: "method" },
    { re: /^\s*#\s*define\s+([A-Za-z_]\w*)/, kind: "macro" }
  ],
  csharp: [
    { re: /^\s*(?:(?:public|private|protected|internal|static|sealed|abstract|partial|record)\s+)*class\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*(?:(?:public|private|protected|internal)\s+)*interface\s+([A-Za-z_]\w*)/, kind: "interface", opensContainer: !0 },
    { re: /^\s*(?:(?:public|private|protected|internal)\s+)*(?:struct|record)\s+([A-Za-z_]\w*)/, kind: "struct", opensContainer: !0 },
    { re: /^\s*(?:(?:public|private|protected|internal)\s+)*enum\s+([A-Za-z_]\w*)/, kind: "enum" },
    { re: /^\s*namespace\s+([\w.]+)/, kind: "module" },
    { re: /^\s*(?:(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|extern|new)\s+)+[\w.<>\[\],? ]+\s+([A-Za-z_]\w*)\s*\([^)]*\)/, kind: "method" },
    { re: /^\s*(?:(?:public|private|protected|internal|static|readonly|const|virtual|override)\s+)+[\w.<>\[\],? ]+\s+([A-Za-z_]\w*)\s*\{\s*get/, kind: "property" },
    { re: /^\s*(?:(?:public|private|protected|internal|static|readonly|const)\s+)+[\w.<>\[\],? ]+\s+([A-Za-z_]\w*)\s*[=;]/, kind: "field" }
  ],
  ruby: [
    { re: /^\s*(?:class|module)\s+([A-Z][\w:]*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/, kind: "function", methodInContainer: !0 },
    { re: /^\s*attr_(?:accessor|reader|writer)\s+:([A-Za-z_]\w*)/, kind: "property" },
    { re: /^\s*([A-Z][A-Z0-9_]*)\s*=/, kind: "constant" }
  ],
  php: [
    { re: /^\s*(?:(?:abstract|final)\s+)*class\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*(?:interface|trait|enum)\s+([A-Za-z_]\w*)/, kind: "interface", opensContainer: !0 },
    { re: /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+&?\s*([A-Za-z_]\w*)/, kind: "function", methodInContainer: !0 },
    { re: /^\s*const\s+([A-Za-z_]\w*)/, kind: "constant" },
    { re: /^\s*define\s*\(\s*['"]([A-Za-z_]\w*)/, kind: "constant" },
    { re: /^\s*(?:public|private|protected|static|var)\s+\$([A-Za-z_]\w*)/, kind: "property" },
    { re: /^\s*namespace\s+([\w\\]+)/, kind: "module" }
  ],
  dart: [
    { re: /^\s*(?:abstract\s+)?class\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*(?:mixin|extension|enum)\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*typedef\s+([A-Za-z_]\w*)/, kind: "type" },
    { re: /^\s*(?:(?:static|final|const|late)\s+)*[\w<>,\[\]? ]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:async\s*\*?\s*)?\{/, kind: "function", methodInContainer: !0 }
  ],
  elixir: [
    { re: /^\s*defmodule\s+([A-Z][\w.]*)/, kind: "module", opensContainer: !0 },
    { re: /^\s*defp?\s+([a-z_]\w*[?!]?)/, kind: "function", methodInContainer: !0 },
    { re: /^\s*defmacro p?\s*([a-z_]\w*)/, kind: "macro" },
    { re: /^\s*defstruct\b/, kind: "struct" }
  ],
  erlang: [
    { re: /^\s*-module\(([a-z_]\w*)\)/, kind: "module" },
    { re: /^([a-z_]\w*)\s*\(/, kind: "function" }
  ],
  haskell: [
    { re: /^([a-z_][\w']*)\s*::/, kind: "function" },
    { re: /^\s*(?:data|newtype|type)\s+([A-Z][\w']*)/, kind: "type" },
    { re: /^\s*class\s+([A-Z][\w']*)/, kind: "class" }
  ],
  clojure: [
    { re: /^\s*\(def(?:n|n-|macro|protocol|record|struct)?\s+([^\s()]+)/, kind: "function" },
    { re: /^\s*\(ns\s+([^\s()]+)/, kind: "module" }
  ],
  lua: [
    { re: /^\s*(?:local\s+)?function\s+([\w.:]+)/, kind: "function" },
    { re: /^\s*(?:local\s+)?([\w.]+)\s*=\s*function/, kind: "function" },
    { re: /^\s*local\s+([A-Za-z_]\w*)\s*=/, kind: "variable" }
  ],
  r: [
    { re: /^\s*([A-Za-z_.][\w.]*)\s*(?:<-|=)\s*function/, kind: "function" },
    { re: /^\s*([A-Za-z_.][\w.]*)\s*<-/, kind: "variable" }
  ],
  julia: [
    { re: /^\s*function\s+([A-Za-z_]\w*)/, kind: "function" },
    { re: /^\s*(?:mutable\s+)?struct\s+([A-Za-z_]\w*)/, kind: "struct", opensContainer: !0 },
    { re: /^\s*macro\s+([A-Za-z_]\w*)/, kind: "macro" },
    { re: /^\s*module\s+([A-Za-z_]\w*)/, kind: "module", opensContainer: !0 },
    { re: /^\s*([A-Za-z_]\w*)\s*\([^)]*\)\s*=\s*/, kind: "function" }
  ],
  perl: [
    { re: /^\s*sub\s+([A-Za-z_]\w*)/, kind: "function" },
    { re: /^\s*package\s+([\w:]+)/, kind: "module", opensContainer: !0 }
  ],
  shell: [
    { re: /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{/, kind: "function" },
    { re: /^\s*function\s+([A-Za-z_]\w*)/, kind: "function" },
    { re: /^\s*(?:export\s+|readonly\s+)?([A-Z_][A-Z0-9_]*)=/, kind: "constant" }
  ],
  powershell: [
    { re: /^\s*function\s+([\w-]+)/, kind: "function" },
    { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 }
  ],
  sql: [
    { re: /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([\w.]+)/i, kind: "struct" },
    { re: /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+[`"[]?([\w.]+)/i, kind: "function" },
    { re: /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([\w.]+)/i, kind: "property" },
    { re: /^\s*CREATE\s+TYPE\s+[`"[]?([\w.]+)/i, kind: "type" }
  ],
  graphql: [
    { re: /^\s*(?:type|input|interface|enum|union|scalar)\s+([A-Za-z_]\w*)/, kind: "type", opensContainer: !0 },
    { re: /^\s*fragment\s+([A-Za-z_]\w*)/, kind: "type" },
    { re: /^\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:/, kind: "field" }
  ],
  proto: [
    { re: /^\s*message\s+([A-Za-z_]\w*)/, kind: "struct", opensContainer: !0 },
    { re: /^\s*service\s+([A-Za-z_]\w*)/, kind: "interface", opensContainer: !0 },
    { re: /^\s*enum\s+([A-Za-z_]\w*)/, kind: "enum" },
    { re: /^\s*rpc\s+([A-Za-z_]\w*)/, kind: "method" }
  ],
  hcl: [
    { re: /^\s*(?:resource|data)\s+"[^"]+"\s+"([^"]+)"/, kind: "struct" },
    { re: /^\s*(?:variable|output|module|provider)\s+"([^"]+)"/, kind: "variable" },
    { re: /^\s*([A-Za-z_][\w-]*)\s*=/, kind: "field" }
  ],
  css: [
    { re: /^\s*\.([\w-]+)/, kind: "selector" },
    { re: /^\s*#([\w-]+)/, kind: "selector" },
    { re: /^\s*--([\w-]+)\s*:/, kind: "variable" }
  ],
  scss: [
    { re: /^\s*@mixin\s+([\w-]+)/, kind: "function" },
    { re: /^\s*@function\s+([\w-]+)/, kind: "function" },
    { re: /^\s*\$([\w-]+)\s*:/, kind: "variable" },
    { re: /^\s*\.([\w-]+)/, kind: "selector" },
    { re: /^\s*#([\w-]+)/, kind: "selector" },
    { re: /^\s*--([\w-]+)\s*:/, kind: "variable" }
  ],
  sol: [
    { re: /^\s*(?:contract|library|interface)\s+([A-Za-z_]\w*)/, kind: "class", opensContainer: !0 },
    { re: /^\s*function\s+([A-Za-z_]\w*)/, kind: "function", methodInContainer: !0 },
    { re: /^\s*(?:struct|enum|event|modifier|error)\s+([A-Za-z_]\w*)/, kind: "struct" }
  ],
  vb: [
    { re: /^\s*(?:(?:Public|Private|Protected|Friend|Shared|Overrides)\s+)*(?:Sub|Function)\s+([A-Za-z_]\w*)/i, kind: "function", methodInContainer: !0 },
    { re: /^\s*(?:(?:Public|Private|Protected|Friend)\s+)*(?:Class|Module|Structure|Interface)\s+([A-Za-z_]\w*)/i, kind: "class", opensContainer: !0 },
    { re: /^\s*(?:(?:Public|Private|Protected|Friend)\s+)*Property\s+([A-Za-z_]\w*)/i, kind: "property" }
  ],
  fsharp: [
    { re: /^\s*let\s+(?:rec\s+|mutable\s+|inline\s+)*([A-Za-z_]\w*)/, kind: "function" },
    { re: /^\s*type\s+([A-Za-z_]\w*)/, kind: "type", opensContainer: !0 },
    { re: /^\s*module\s+([A-Za-z_]\w*)/, kind: "module", opensContainer: !0 }
  ],
  pascal: [
    { re: /^\s*(?:procedure|function)\s+([A-Za-z_]\w*)/i, kind: "function" },
    { re: /^\s*type\s+([A-Za-z_]\w*)/i, kind: "type" }
  ]
};
tt.javascript = tt.typescript;
tt.html = tt.typescript;
tt.less = tt.scss;
const bc = [
  { re: new RegExp(`^\\s*(?:def|func|function|fn|sub|proc|method)\\s+(${Hn})`), kind: "function" },
  { re: new RegExp(`^\\s*(?:class|struct|interface|type|module|enum|trait)\\s+(${Hn})`), kind: "class" },
  { re: new RegExp(`^\\s*(?:const|let|var|val)\\s+(${Hn})`), kind: "variable" }
];
function vc(r) {
  return tt[r] ?? bc;
}
const kc = /* @__PURE__ */ new Set([
  "python",
  "yaml",
  "haskell",
  "ruby",
  "elixir",
  "julia",
  "lua",
  "vb",
  "pascal",
  "fsharp"
]), Sc = {
  typescript: ["//", "/*", "*"],
  javascript: ["//", "/*", "*"],
  java: ["//", "/*", "*"],
  kotlin: ["//", "/*", "*"],
  scala: ["//", "/*", "*"],
  groovy: ["//", "/*", "*"],
  swift: ["//", "/*", "*"],
  c: ["//", "/*", "*"],
  cpp: ["//", "/*", "*"],
  "objective-c": ["//", "/*", "*"],
  csharp: ["//", "/*", "*"],
  go: ["//", "/*", "*"],
  rust: ["//", "///", "/*", "*"],
  php: ["//", "#", "/*", "*"],
  dart: ["//", "/*", "*"],
  sol: ["//", "/*", "*"],
  css: ["/*", "*"],
  scss: ["//", "/*", "*"],
  less: ["//", "/*", "*"],
  python: ["#"],
  ruby: ["#"],
  shell: ["#"],
  perl: ["#"],
  r: ["#"],
  julia: ["#"],
  elixir: ["#"],
  yaml: ["#"],
  hcl: ["#", "//"],
  proto: ["//"],
  graphql: ["#"],
  sql: ["--"],
  lua: ["--"],
  haskell: ["--"],
  clojure: [";"],
  vb: ["'"],
  powershell: ["#"]
}, xc = /* @__PURE__ */ new Set([
  "if",
  "else",
  "elif",
  "elsif",
  "unless",
  "for",
  "foreach",
  "while",
  "until",
  "do",
  "switch",
  "case",
  "default",
  "when",
  "try",
  "catch",
  "except",
  "finally",
  "ensure",
  "return",
  "break",
  "continue",
  "goto",
  "throw",
  "raise",
  "yield",
  "await",
  "with",
  "match",
  "loop",
  "in",
  "is",
  "as",
  "not"
]);
function Ac(r, t, e) {
  const n = vc(t), i = kc.has(t), s = e.split(`
`), o = [], a = [];
  let c = 0;
  for (let u = 0; u < s.length; u++) {
    const f = s[u];
    if (!f.trim()) continue;
    const d = f.length - f.trimStart().length;
    if (i)
      for (; a.length && d <= a[a.length - 1].indent; ) a.pop();
    else
      for (; a.length; ) {
        const p = a[a.length - 1];
        if (p.opened) {
          if (c <= p.baseDepth) {
            a.pop();
            continue;
          }
        } else if (u - p.line > 1) {
          a.pop();
          continue;
        }
        break;
      }
    for (const p of n) {
      const m = p.re.exec(f);
      if (!m) continue;
      const w = m[p.group ?? 1];
      if (!w || xc.has(w)) break;
      if (p.topLevelOnly && d > 0) continue;
      const k = a.length ? a[a.length - 1].name : "";
      let _ = p.kind;
      if (p.methodInContainer && k && (_ = "method"), o.push({
        name: w,
        kind: _,
        file: r,
        line: u + 1,
        column: Math.max(1, f.indexOf(w) + 1),
        container: k,
        signature: f.trim().slice(0, 200),
        language: t,
        exported: _c(f, w, t)
      }), p.opensContainer) {
        const x = ci(f);
        !i && f.includes("{") && x <= 0 || a.push({ name: w, indent: d, baseDepth: c, opened: x > 0, line: u });
      }
      break;
    }
    if (!i) {
      c += ci(f);
      for (const p of a)
        !p.opened && c > p.baseDepth && (p.opened = !0);
    }
  }
  return o;
}
function ci(r) {
  let t = 0;
  for (const e of r)
    e === "{" ? t++ : e === "}" && t--;
  return t;
}
function _c(r, t, e) {
  switch (e) {
    case "go":
      return /^[A-Z]/.test(t);
    case "rust":
      return /\bpub\b/.test(r);
    case "python":
      return !t.startsWith("_");
    case "java":
    case "csharp":
    case "kotlin":
    case "swift":
    case "php":
      return /\b(?:public|open|internal)\b/.test(r);
    default:
      return /\bexport\b/.test(r);
  }
}
const li = 4e4, Ec = 2 * 1024 * 1024, Cc = 96 * 1024 * 1024, zn = 5e3, Un = {
  class: 10,
  interface: 10,
  struct: 10,
  trait: 10,
  enum: 9,
  type: 9,
  function: 8,
  method: 7,
  module: 6,
  macro: 6,
  constant: 5,
  variable: 4,
  property: 3,
  field: 3,
  selector: 2
}, ui = /[A-Za-z0-9_$]/;
class Tc {
  constructor() {
    H(this, "root", "");
    H(this, "ready", !1);
    H(this, "indexing", !1);
    H(this, "truncated", !1);
    H(this, "durationMs", 0);
    H(this, "byFile", /* @__PURE__ */ new Map());
    H(this, "byName", /* @__PURE__ */ new Map());
    H(this, "contents", /* @__PURE__ */ new Map());
    H(this, "cachedBytes", 0);
    /** Every indexed file, including those too large to cache. */
    H(this, "files", []);
    H(this, "generation", 0);
  }
  get fileCount() {
    return this.files.length;
  }
  get symbolCount() {
    let t = 0;
    for (const e of this.byFile.values()) t += e.length;
    return t;
  }
  status() {
    return {
      root: this.root,
      ready: this.ready,
      indexing: this.indexing,
      files: this.fileCount,
      symbols: this.symbolCount,
      durationMs: this.durationMs,
      truncated: this.truncated
    };
  }
  clear() {
    this.byFile.clear(), this.byName.clear(), this.contents.clear(), this.cachedBytes = 0, this.files = [], this.truncated = !1;
  }
  async build(t, e) {
    const n = ++this.generation;
    this.root = t, this.indexing = !0, this.ready = !1, this.clear(), e(this.status());
    const i = Date.now();
    let s = 0;
    for await (const o of et(t, li)) {
      if (n !== this.generation) return;
      const a = ft(o);
      ai.has(a) && (Ot.has(y.extname(o).toLowerCase()) || (await this.ingest(o, a), s++, s % 200 === 0 && (e(this.status()), await new Promise((c) => setImmediate(c)))));
    }
    n === this.generation && (this.truncated = this.files.length >= li, this.durationMs = Date.now() - i, this.indexing = !1, this.ready = !0, e(this.status()));
  }
  async ingest(t, e) {
    let n;
    try {
      if ((await v.stat(t)).size > Ec) return;
      const o = await v.readFile(t);
      if (Sn(o)) return;
      n = o.toString("utf8");
    } catch {
      return;
    }
    this.files.push(t), this.cachedBytes + n.length <= Cc && (this.contents.set(t, n), this.cachedBytes += n.length);
    const i = Ac(t, e, n);
    if (i.length !== 0) {
      this.byFile.set(t, i);
      for (const s of i) {
        const o = this.byName.get(s.name);
        o ? o.push(s) : this.byName.set(s.name, [s]);
      }
    }
  }
  /** Re-parses a single file after an on-disk edit. */
  async refresh(t) {
    if (!this.root || !t.startsWith(this.root)) return;
    const e = ft(t);
    if (ai.has(e)) {
      this.evict(t);
      try {
        await v.access(t);
      } catch {
        return;
      }
      await this.ingest(t, e);
    }
  }
  evict(t) {
    const e = this.byFile.get(t);
    if (e) {
      for (const s of e) {
        const o = this.byName.get(s.name);
        if (!o) continue;
        const a = o.filter((c) => c.file !== t);
        a.length ? this.byName.set(s.name, a) : this.byName.delete(s.name);
      }
      this.byFile.delete(t);
    }
    const n = this.contents.get(t);
    n !== void 0 && (this.cachedBytes -= n.length, this.contents.delete(t));
    const i = this.files.indexOf(t);
    i !== -1 && this.files.splice(i, 1);
  }
  definitions(t, e) {
    const n = this.byName.get(t) ?? [], i = e ? ft(e) : "";
    return [...n].sort((o, a) => s(a) - s(o)).slice(0, 50);
    function s(o) {
      let a = Un[o.kind] ?? 1;
      return e && o.file === e && (a += 24), i && o.language === i && (a += 12), o.exported && (a += 6), /(?:^|\/)(?:test|tests|spec|__tests__)\//.test(o.file) && (a -= 8), /\.(?:test|spec)\.[\w]+$/.test(o.file) && (a -= 8), a;
    }
  }
  documentSymbols(t) {
    return this.byFile.get(t) ?? [];
  }
  /**
   * Prefix completions drawn from the project's own declarations. This is what
   * makes class/function suggestions work for languages with no language
   * server installed — the index already knows every declaration in the tree.
   */
  completions(t, e, n = 60) {
    const i = t.toLowerCase(), s = e ? ft(e) : "", o = /* @__PURE__ */ new Map();
    for (const [a, c] of this.byName)
      if (!(i && !a.toLowerCase().startsWith(i))) {
        for (const u of c) {
          let f = Un[u.kind] ?? 1;
          u.exported && (f += 8), s && u.language === s && (f += 20), e && u.file === e && (f += 10);
          const d = o.get(a);
          (!d || f > d.score) && o.set(a, { symbol: u, score: f });
        }
        if (o.size > 3e3) break;
      }
    return [...o.values()].sort((a, c) => c.score - a.score || a.symbol.name.length - c.symbol.name.length).slice(0, n).map((a) => a.symbol);
  }
  workspaceSymbols(t, e = 60) {
    const n = t.toLowerCase(), i = [];
    for (const [s, o] of this.byName) {
      const a = s.toLowerCase();
      let c = 0;
      if (!n) c = 1;
      else if (a === n) c = 100;
      else if (a.startsWith(n)) c = 70 - s.length;
      else if (a.includes(n)) c = 40 - s.length;
      else continue;
      for (const u of o)
        i.push({ symbol: u, score: c + (Un[u.kind] ?? 0) });
      if (i.length > 4e3) break;
    }
    return i.sort((s, o) => o.score - s.score), i.slice(0, e).map((s) => s.symbol);
  }
  async references(t, e) {
    if (!t) return [];
    const n = new Set(
      (this.byName.get(t) ?? []).map((s) => `${s.file}:${s.line}`)
    ), i = [];
    for (const s of this.files) {
      if (i.length >= zn) break;
      const o = await this.textOf(s);
      if (o === null || !o.includes(t)) continue;
      const a = ft(s), c = Sc[a] ?? [], u = o.split(`
`);
      for (let f = 0; f < u.length; f++) {
        const d = u[f];
        if (!d.includes(t)) continue;
        let p = 0;
        for (; ; ) {
          const m = d.indexOf(t, p);
          if (m === -1) break;
          p = m + t.length;
          const w = m > 0 ? d[m - 1] : "", k = m + t.length < d.length ? d[m + t.length] : "";
          if (!(ui.test(w) || ui.test(k)) && (i.push({
            file: s,
            line: f + 1,
            column: m + 1,
            preview: d.length > 300 ? `${d.slice(0, 300)}…` : d,
            kind: $c(d, m, c, n.has(`${s}:${f + 1}`))
          }), i.length >= zn))
            break;
        }
        if (i.length >= zn) break;
      }
    }
    return i.sort((s, o) => {
      if (e) {
        const a = s.file === e ? 0 : 1, c = o.file === e ? 0 : 1;
        if (a !== c) return a - c;
      }
      return s.kind === "declaration" != (o.kind === "declaration") ? s.kind === "declaration" ? -1 : 1 : s.file.localeCompare(o.file) || s.line - o.line;
    }), i;
  }
  async textOf(t) {
    const e = this.contents.get(t);
    if (e !== void 0) return e;
    try {
      const n = await v.readFile(t);
      return Sn(n) ? null : n.toString("utf8");
    } catch {
      return null;
    }
  }
}
function $c(r, t, e, n) {
  if (n) return "declaration";
  const i = r.trimStart();
  return e.some((s) => i.startsWith(s)) ? "comment" : /^\s*(?:import|from|require|use|using|include|#include|package|export\s+\*|export\s+\{)/.test(r) ? "import" : Oc(r, t) ? "string" : "code";
}
function Oc(r, t) {
  let e = 0, n = 0, i = 0;
  for (let s = 0; s < t; s++) {
    const o = r[s];
    if (o === "\\") {
      s++;
      continue;
    }
    o === "'" ? e++ : o === '"' ? n++ : o === "`" && i++;
  }
  return e % 2 === 1 || n % 2 === 1 || i % 2 === 1;
}
const Ae = new Tc();
let di;
const qn = /* @__PURE__ */ new Set();
function jc(r) {
  const t = (e) => r.broadcast("index:status", e);
  return g.handle("index:build", async (e, n) => (await Ae.build(n, t), Ae.status())), g.handle("index:status", () => Ae.status()), g.handle(
    "index:definitions",
    (e, n, i) => Ae.definitions(n, i)
  ), g.handle(
    "index:references",
    (e, n, i) => Ae.references(n, i)
  ), g.handle("index:documentSymbols", (e, n) => Ae.documentSymbols(n)), g.handle(
    "index:completions",
    (e, n, i, s) => Ae.completions(n, i, s)
  ), g.handle(
    "index:workspaceSymbols",
    (e, n, i) => Ae.workspaceSymbols(n, i)
  ), {
    /** Called by the file watcher; batched so a burst of writes costs one pass. */
    onFileChanged(e) {
      qn.add(e), clearTimeout(di), di = setTimeout(async () => {
        const n = [...qn];
        qn.clear();
        for (const i of n) await Ae.refresh(i);
        Ae.ready && t(Ae.status());
      }, 400);
    }
  };
}
class Ic extends Ns {
  constructor(e, n, i, s, o) {
    super();
    H(this, "child", null);
    H(this, "buffer", Buffer.alloc(0));
    H(this, "nextId", 1);
    H(this, "pending", /* @__PURE__ */ new Map());
    H(this, "stopped", !1);
    this.id = e, this.command = n, this.args = i, this.cwd = s, this.env = o;
  }
  get running() {
    return this.child !== null && !this.stopped;
  }
  start() {
    this.child = qe(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"]
    }), this.child.stdout.on("data", (e) => this.consume(e)), this.child.stderr.setEncoding("utf8"), this.child.stderr.on("data", (e) => this.emit("stderr", e)), this.child.on("error", (e) => {
      this.emit("stderr", `${this.command}: ${e.message}
`), this.failAll(new Error(e.message));
    }), this.child.on("exit", (e) => {
      this.stopped = !0, this.failAll(new Error(`${this.id} exited (${e})`)), this.emit("exit", e);
    });
  }
  /** Frames and parses the `Content-Length` stream. */
  consume(e) {
    for (this.buffer = Buffer.concat([this.buffer, e]); ; ) {
      const n = this.buffer.indexOf(`\r
\r
`);
      if (n === -1) return;
      const i = this.buffer.subarray(0, n).toString("ascii"), s = /content-length:\s*(\d+)/i.exec(i);
      if (!s) {
        this.buffer = this.buffer.subarray(n + 4);
        continue;
      }
      const o = Number(s[1]), a = n + 4;
      if (this.buffer.length < a + o) return;
      const c = this.buffer.subarray(a, a + o).toString("utf8");
      this.buffer = this.buffer.subarray(a + o);
      try {
        this.dispatch(JSON.parse(c));
      } catch {
      }
    }
  }
  dispatch(e) {
    if (e.id !== void 0 && e.method === void 0) {
      const n = this.pending.get(e.id);
      if (!n) return;
      this.pending.delete(e.id), clearTimeout(n.timer), e.error ? n.reject(new Error(e.error.message)) : n.resolve(e.result);
      return;
    }
    if (e.id !== void 0 && e.method) {
      const n = (i, s) => {
        this.write({ jsonrpc: "2.0", id: e.id, ...s ? { error: s } : { result: i } });
      };
      this.emit("request", e.method, e.params, n);
      return;
    }
    e.method && this.emit("notification", e.method, e.params);
  }
  write(e) {
    if (!this.child || this.stopped) return;
    const n = JSON.stringify(e), i = Buffer.from(n, "utf8");
    this.child.stdin.write(`Content-Length: ${i.byteLength}\r
\r
`), this.child.stdin.write(i);
  }
  request(e, n, i = 2e4) {
    if (!this.running) return Promise.reject(new Error(`${this.id} is not running`));
    const s = this.nextId++;
    return new Promise((o, a) => {
      const c = setTimeout(() => {
        this.pending.delete(s), a(new Error(`${this.id}: ${e} timed out`));
      }, i);
      this.pending.set(s, {
        resolve: o,
        reject: a,
        timer: c
      }), this.write({ jsonrpc: "2.0", id: s, method: e, params: n });
    });
  }
  notify(e, n) {
    this.write({ jsonrpc: "2.0", method: e, params: n });
  }
  failAll(e) {
    for (const [, n] of this.pending)
      clearTimeout(n.timer), n.reject(e);
    this.pending.clear();
  }
  async stop() {
    if (!this.child || this.stopped) return;
    try {
      await this.request("shutdown", null, 2500), this.notify("exit");
    } catch {
    }
    this.stopped = !0;
    const e = this.child;
    setTimeout(() => {
      e.exitCode === null && e.kill("SIGKILL");
    }, 1500), e.kill("SIGTERM");
  }
}
const Er = [
  {
    id: "typescript",
    label: "TypeScript / JavaScript",
    languages: ["typescript", "javascript"],
    command: "typescript-language-server",
    args: ["--stdio"],
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
    install: "npm i -g typescript-language-server typescript"
  },
  {
    id: "pyright",
    label: "Python (Pyright)",
    languages: ["python"],
    command: "pyright-langserver",
    args: ["--stdio"],
    rootMarkers: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"],
    settings: {
      python: { analysis: { autoSearchPaths: !0, useLibraryCodeForTypes: !0 } }
    },
    install: "npm i -g pyright"
  },
  {
    id: "pylsp",
    label: "Python (pylsp)",
    languages: ["python"],
    command: "pylsp",
    args: [],
    rootMarkers: ["pyproject.toml", "setup.py", "requirements.txt"],
    install: "pipx install python-lsp-server"
  },
  {
    id: "gopls",
    label: "Go",
    languages: ["go"],
    command: "gopls",
    args: [],
    rootMarkers: ["go.mod", "go.work"],
    install: "go install golang.org/x/tools/gopls@latest"
  },
  {
    id: "rust-analyzer",
    label: "Rust",
    languages: ["rust"],
    command: "rust-analyzer",
    args: [],
    rootMarkers: ["Cargo.toml", "rust-project.json"],
    settings: {
      "rust-analyzer": {
        checkOnSave: { command: "check" },
        cargo: { buildScripts: { enable: !0 } },
        procMacro: { enable: !0 }
      }
    },
    install: "rustup component add rust-analyzer"
  },
  {
    id: "clangd",
    label: "C / C++ / Objective-C",
    languages: ["c", "cpp", "objective-c"],
    command: "clangd",
    args: ["--background-index", "--clang-tidy"],
    rootMarkers: ["compile_commands.json", ".clangd", "CMakeLists.txt", "Makefile"],
    install: "brew install llvm  (or xcode-select --install)",
    xcrun: !0
  },
  {
    id: "sourcekit-lsp",
    label: "Swift",
    languages: ["swift"],
    command: "sourcekit-lsp",
    args: [],
    rootMarkers: ["Package.swift", "*.xcodeproj"],
    install: "ships with Xcode / Swift toolchain",
    xcrun: !0
  },
  {
    id: "jdtls",
    label: "Java",
    languages: ["java"],
    command: "jdtls",
    args: [],
    rootMarkers: ["pom.xml", "build.gradle", "build.gradle.kts", ".project"],
    install: "brew install jdtls"
  },
  {
    id: "kotlin",
    label: "Kotlin",
    languages: ["kotlin"],
    command: "kotlin-language-server",
    args: [],
    rootMarkers: ["build.gradle.kts", "build.gradle", "settings.gradle"],
    install: "brew install kotlin-language-server"
  },
  {
    id: "omnisharp",
    label: "C#",
    languages: ["csharp"],
    command: "csharp-ls",
    args: [],
    rootMarkers: ["*.sln", "*.csproj"],
    install: "dotnet tool install -g csharp-ls"
  },
  {
    id: "ruby-lsp",
    label: "Ruby",
    languages: ["ruby"],
    command: "ruby-lsp",
    args: [],
    rootMarkers: ["Gemfile", ".ruby-version"],
    install: "gem install ruby-lsp"
  },
  {
    id: "solargraph",
    label: "Ruby (Solargraph)",
    languages: ["ruby"],
    command: "solargraph",
    args: ["stdio"],
    rootMarkers: ["Gemfile", ".solargraph.yml"],
    install: "gem install solargraph"
  },
  {
    id: "intelephense",
    label: "PHP",
    languages: ["php"],
    command: "intelephense",
    args: ["--stdio"],
    rootMarkers: ["composer.json"],
    install: "npm i -g intelephense"
  },
  {
    id: "dart",
    label: "Dart / Flutter",
    languages: ["dart"],
    command: "dart",
    args: ["language-server", "--client-id=nova-ide"],
    rootMarkers: ["pubspec.yaml"],
    install: "ships with the Dart/Flutter SDK"
  },
  {
    id: "elixir-ls",
    label: "Elixir",
    languages: ["elixir"],
    command: "elixir-ls",
    args: [],
    rootMarkers: ["mix.exs"],
    install: "brew install elixir-ls"
  },
  {
    id: "lua",
    label: "Lua",
    languages: ["lua"],
    command: "lua-language-server",
    args: [],
    rootMarkers: [".luarc.json"],
    install: "brew install lua-language-server"
  },
  {
    id: "bash",
    label: "Shell",
    languages: ["shell"],
    command: "bash-language-server",
    args: ["start"],
    rootMarkers: [],
    install: "npm i -g bash-language-server"
  },
  {
    id: "yaml",
    label: "YAML",
    languages: ["yaml"],
    command: "yaml-language-server",
    args: ["--stdio"],
    rootMarkers: [],
    install: "npm i -g yaml-language-server"
  },
  {
    id: "json",
    label: "JSON",
    languages: ["json"],
    command: "vscode-json-language-server",
    args: ["--stdio"],
    rootMarkers: [],
    install: "npm i -g vscode-langservers-extracted"
  },
  {
    id: "html",
    label: "HTML",
    languages: ["html"],
    command: "vscode-html-language-server",
    args: ["--stdio"],
    rootMarkers: [],
    install: "npm i -g vscode-langservers-extracted"
  },
  {
    id: "css",
    label: "CSS / SCSS / Less",
    languages: ["css", "scss", "less"],
    command: "vscode-css-language-server",
    args: ["--stdio"],
    rootMarkers: [],
    install: "npm i -g vscode-langservers-extracted"
  },
  {
    id: "terraform",
    label: "Terraform",
    languages: ["hcl"],
    command: "terraform-ls",
    args: ["serve"],
    rootMarkers: [".terraform", "*.tf"],
    install: "brew install hashicorp/tap/terraform-ls"
  },
  {
    id: "haskell",
    label: "Haskell",
    languages: ["haskell"],
    command: "haskell-language-server-wrapper",
    args: ["--lsp"],
    rootMarkers: ["stack.yaml", "cabal.project", "*.cabal"],
    install: "ghcup install hls"
  },
  {
    id: "sqls",
    label: "SQL",
    languages: ["sql"],
    command: "sqls",
    args: [],
    rootMarkers: [],
    install: "go install github.com/sqls-server/sqls@latest"
  }
];
function Wn(r) {
  return Er.filter((t) => t.languages.includes(r));
}
const Nc = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator"
], Rc = [
  "declaration",
  "definition",
  "readonly",
  "static",
  "deprecated",
  "abstract",
  "async",
  "modification",
  "documentation",
  "defaultLibrary"
];
function be(r) {
  return la(r).toString();
}
function Mc(r) {
  try {
    return r.startsWith("file:") ? jr(r) : r;
  } catch {
    return r;
  }
}
const Lc = {
  general: { positionEncodings: ["utf-16"] },
  // Servers only emit `$/progress` (rust-analyzer's indexing, gopls' loading)
  // when the client advertises support for it.
  window: { workDoneProgress: !0, showMessage: { messageActionItem: { additionalPropertiesSupport: !1 } } },
  workspace: {
    applyEdit: !0,
    workspaceFolders: !0,
    configuration: !0,
    didChangeConfiguration: { dynamicRegistration: !0 },
    symbol: { dynamicRegistration: !0 },
    workspaceEdit: { documentChanges: !0, resourceOperations: ["create", "rename", "delete"] }
  },
  textDocument: {
    synchronization: { dynamicRegistration: !0, didSave: !0, willSave: !1 },
    publishDiagnostics: { relatedInformation: !0, versionSupport: !1 },
    completion: {
      dynamicRegistration: !0,
      completionItem: {
        snippetSupport: !0,
        documentationFormat: ["markdown", "plaintext"],
        insertReplaceSupport: !0,
        resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] }
      },
      contextSupport: !0
    },
    hover: { dynamicRegistration: !0, contentFormat: ["markdown", "plaintext"] },
    signatureHelp: {
      dynamicRegistration: !0,
      signatureInformation: { documentationFormat: ["markdown", "plaintext"] }
    },
    definition: { dynamicRegistration: !0, linkSupport: !0 },
    typeDefinition: { dynamicRegistration: !0, linkSupport: !0 },
    implementation: { dynamicRegistration: !0, linkSupport: !0 },
    references: { dynamicRegistration: !0 },
    documentHighlight: { dynamicRegistration: !0 },
    documentSymbol: { dynamicRegistration: !0, hierarchicalDocumentSymbolSupport: !0 },
    formatting: { dynamicRegistration: !0 },
    rangeFormatting: { dynamicRegistration: !0 },
    rename: { dynamicRegistration: !0, prepareSupport: !0 },
    codeAction: {
      dynamicRegistration: !0,
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: ["", "quickfix", "refactor", "refactor.extract", "refactor.inline", "source", "source.organizeImports"]
        }
      },
      resolveSupport: { properties: ["edit"] }
    },
    inlayHint: { dynamicRegistration: !0, resolveSupport: { properties: ["tooltip", "label.tooltip"] } },
    callHierarchy: { dynamicRegistration: !0 },
    typeHierarchy: { dynamicRegistration: !0 },
    documentLink: { dynamicRegistration: !0 },
    selectionRange: { dynamicRegistration: !0 },
    foldingRange: { dynamicRegistration: !0, lineFoldingOnly: !0 },
    // Without this a server will not compute semantic tokens at all, and
    // function and type names stay the same colour as every other word.
    semanticTokens: {
      dynamicRegistration: !0,
      requests: { range: !1, full: { delta: !1 } },
      tokenTypes: Nc,
      tokenModifiers: Rc,
      formats: ["relative"],
      // Nova paints one style per token, so a server that would otherwise
      // send overlapping or multi-line tokens is asked not to.
      overlappingTokenSupport: !1,
      multilineTokenSupport: !1,
      serverCancelSupport: !0,
      augmentsSyntaxTokens: !0
    }
  }
};
class Pc {
  constructor(t) {
    H(this, "sessions", /* @__PURE__ */ new Map());
    H(this, "available", /* @__PURE__ */ new Map());
    H(this, "detected", !1);
    H(this, "root", "");
    this.events = t;
  }
  setRoot(t) {
    this.root !== t && (this.root = t, this.stopAll());
  }
  /** Probes PATH once per app run to see which servers exist. */
  async detect(t = !1) {
    return (!this.detected || t) && (this.available.clear(), await Promise.all(
      Er.map(async (e) => {
        const n = await Re(e.command) || (e.xcrun ? await qs(e.command) : "");
        n && this.available.set(e.id, n);
      })
    ), this.detected = !0), this.status();
  }
  status() {
    return Er.map((t) => {
      const e = this.sessions.get(t.id);
      return {
        id: t.id,
        label: t.label,
        languages: t.languages,
        command: t.command,
        binary: this.available.get(t.id) ?? "",
        installed: this.available.has(t.id),
        state: (e == null ? void 0 : e.state) ?? "stopped",
        error: (e == null ? void 0 : e.error) ?? "",
        progress: (e == null ? void 0 : e.progress) ?? "",
        install: t.install
      };
    });
  }
  /** The best installed server for a language, started if needed. */
  async ensure(t) {
    if (!this.root) return null;
    this.detected || await this.detect();
    const e = Wn(t).find((i) => this.available.has(i.id));
    if (!e) return null;
    const n = this.sessions.get(e.id);
    return n ? n.state === "failed" || n.state === "stopped" ? null : (await n.ready.catch(() => {
    }), n.state === "ready" ? n : null) : this.start(e);
  }
  async resolveRoot(t) {
    for (const e of t.rootMarkers)
      if (!e.includes("*"))
        try {
          return await v.access(y.join(this.root, e)), this.root;
        } catch {
        }
    return this.root;
  }
  async start(t) {
    const e = this.available.get(t.id), n = await this.resolveRoot(t), i = new Ic(t.id, e, t.args, n, we({ NO_COLOR: "1" }));
    let s = () => {
    }, o = () => {
    };
    const a = new Promise((u, f) => {
      s = u, o = f;
    }), c = {
      spec: t,
      client: i,
      root: n,
      ready: a,
      capabilities: {},
      state: "starting",
      openDocs: /* @__PURE__ */ new Map()
    };
    this.sessions.set(t.id, c), this.events.onStatus(), i.on("stderr", (u) => this.events.onLog(t.id, u)), i.on("notification", (u, f) => {
      if (u === "textDocument/publishDiagnostics")
        this.events.onDiagnostics({ uri: f.uri, diagnostics: f.diagnostics ?? [] });
      else if (u === "window/logMessage" || u === "window/showMessage")
        this.events.onLog(t.id, String((f == null ? void 0 : f.message) ?? ""));
      else if (u === "$/progress") {
        const d = (f == null ? void 0 : f.value) ?? {};
        d.kind === "end" ? c.progress = "" : c.progress = [d.title, d.message].filter(Boolean).join(" — "), this.events.onStatus();
      }
    }), i.on(
      "request",
      (u, f, d) => {
        switch (u) {
          case "workspace/configuration": {
            const p = (f == null ? void 0 : f.items) ?? [];
            d(p.map((m) => Dc(t.settings, m.section)));
            return;
          }
          case "workspace/applyEdit":
            this.events.onApplyEdit(f == null ? void 0 : f.edit), d({ applied: !0 });
            return;
          case "window/workDoneProgress/create":
          case "client/registerCapability":
          case "client/unregisterCapability":
          case "workspace/semanticTokens/refresh":
          case "workspace/codeLens/refresh":
          case "workspace/inlayHint/refresh":
          case "workspace/diagnostic/refresh":
            d(null);
            return;
          default:
            d(null, { code: -32601, message: `Unhandled request ${u}` });
        }
      }
    ), i.on("exit", () => {
      c.state = "stopped", this.events.onStatus();
    });
    try {
      i.start();
      const u = await i.request(
        "initialize",
        {
          processId: process.pid,
          clientInfo: { name: "Nova IDE", version: "0.1.0" },
          rootUri: be(n),
          rootPath: n,
          workspaceFolders: [{ uri: be(n), name: y.basename(n) }],
          capabilities: Lc,
          initializationOptions: t.initializationOptions ?? {}
        },
        45e3
      );
      c.capabilities = (u == null ? void 0 : u.capabilities) ?? {}, i.notify("initialized", {}), t.settings && i.notify("workspace/didChangeConfiguration", { settings: t.settings }), c.state = "ready", s();
    } catch (u) {
      c.state = "failed", c.error = u instanceof Error ? u.message : String(u), o(u instanceof Error ? u : new Error(String(u))), a.catch(() => {
      });
    }
    return this.events.onStatus(), c.state === "ready" ? c : null;
  }
  /* ---------------- document sync ---------------- */
  async openDocument(t, e, n) {
    const i = await this.ensure(e);
    if (!i) return;
    const s = be(t);
    i.openDocs.has(s) || (i.openDocs.set(s, { version: 1, languageId: e }), i.client.notify("textDocument/didOpen", {
      textDocument: { uri: s, languageId: e, version: 1, text: n }
    }));
  }
  async changeDocument(t, e, n) {
    const i = await this.ensure(e);
    if (!i) return;
    const s = be(t), o = i.openDocs.get(s);
    if (!o) {
      await this.openDocument(t, e, n);
      return;
    }
    o.version += 1, i.client.notify("textDocument/didChange", {
      textDocument: { uri: s, version: o.version },
      contentChanges: [{ text: n }]
    });
  }
  async closeDocument(t, e) {
    var s;
    const n = this.sessions.get(
      ((s = Wn(e).find((o) => this.sessions.has(o.id))) == null ? void 0 : s.id) ?? ""
    );
    if (!n) return;
    const i = be(t);
    n.openDocs.delete(i) && n.client.notify("textDocument/didClose", { textDocument: { uri: i } });
  }
  async saveDocument(t, e, n) {
    const i = await this.ensure(e);
    i && i.client.notify("textDocument/didSave", {
      textDocument: { uri: be(t) },
      text: n
    });
  }
  /* ---------------- requests ---------------- */
  async send(t, e, n, i) {
    const s = await this.ensure(t);
    if (!s) return null;
    try {
      return await s.client.request(e, n, i) ?? null;
    } catch (o) {
      return this.events.onLog(s.spec.id, `${e}: ${o.message}
`), null;
    }
  }
  docPos(t, e, n) {
    return {
      textDocument: { uri: be(t) },
      position: { line: e, character: n }
    };
  }
  definition(t, e, n, i) {
    return this.send(e, "textDocument/definition", this.docPos(t, n, i));
  }
  typeDefinition(t, e, n, i) {
    return this.send(e, "textDocument/typeDefinition", this.docPos(t, n, i));
  }
  implementation(t, e, n, i) {
    return this.send(e, "textDocument/implementation", this.docPos(t, n, i));
  }
  references(t, e, n, i) {
    return this.send(e, "textDocument/references", {
      ...this.docPos(t, n, i),
      context: { includeDeclaration: !0 }
    });
  }
  hover(t, e, n, i) {
    return this.send(e, "textDocument/hover", this.docPos(t, n, i), 8e3);
  }
  completion(t, e, n, i, s) {
    return this.send(e, "textDocument/completion", {
      ...this.docPos(t, n, i),
      context: s ? { triggerKind: 2, triggerCharacter: s } : { triggerKind: 1 }
    });
  }
  resolveCompletion(t, e) {
    return this.send(t, "completionItem/resolve", e, 8e3);
  }
  signatureHelp(t, e, n, i) {
    return this.send(e, "textDocument/signatureHelp", this.docPos(t, n, i), 8e3);
  }
  documentSymbols(t, e) {
    return this.send(e, "textDocument/documentSymbol", {
      textDocument: { uri: be(t) }
    });
  }
  /**
   * Full-document semantic tokens, with the server's own legend attached.
   *
   * Deliberately does not start a server. Every other request may wait for one
   * to boot, but highlighting is on screen: making the renderer wait would
   * leave the file grey for however long sourcekit-lsp or rust-analyzer takes,
   * which is worse than the syntactic fallback it would have used instead. The
   * `lsp:status` broadcast asks the renderer to come back once a server is up.
   *
   * The legend has to travel with the data — a server orders its token types
   * however it likes, so the indices in `data` mean nothing without it.
   */
  async semanticTokens(t, e) {
    var a, c;
    const n = Wn(e).find((u) => this.available.has(u.id)), i = n ? this.sessions.get(n.id) : void 0;
    if (!i || i.state !== "ready") return null;
    const s = i.capabilities.semanticTokensProvider;
    if (!((c = (a = s == null ? void 0 : s.legend) == null ? void 0 : a.tokenTypes) != null && c.length) || !s.full) return null;
    let o = null;
    try {
      o = await i.client.request(
        "textDocument/semanticTokens/full",
        { textDocument: { uri: be(t) } },
        15e3
      );
    } catch (u) {
      return this.events.onLog(i.spec.id, `textDocument/semanticTokens/full: ${u.message}
`), null;
    }
    return o != null && o.data ? {
      legend: {
        tokenTypes: s.legend.tokenTypes,
        tokenModifiers: s.legend.tokenModifiers ?? []
      },
      data: o.data
    } : null;
  }
  workspaceSymbols(t, e) {
    return this.send(t, "workspace/symbol", { query: e });
  }
  /**
   * Runs a server-side command.
   *
   * Many code actions carry a `command` rather than an `edit` — the server does
   * the work and pushes the result back as a `workspace/applyEdit`, which is
   * already handled above. Without this, those actions simply do nothing.
   */
  executeCommand(t, e, n) {
    return this.send(t, "workspace/executeCommand", { command: e, arguments: n ?? [] });
  }
  prepareRename(t, e, n, i) {
    return this.send(e, "textDocument/prepareRename", this.docPos(t, n, i), 8e3);
  }
  rename(t, e, n, i, s) {
    return this.send(e, "textDocument/rename", {
      ...this.docPos(t, n, i),
      newName: s
    }, 3e4);
  }
  formatting(t, e, n, i) {
    return this.send(e, "textDocument/formatting", {
      textDocument: { uri: be(t) },
      options: { tabSize: n, insertSpaces: i }
    });
  }
  codeActions(t, e, n, i) {
    return this.send(e, "textDocument/codeAction", {
      textDocument: { uri: be(t) },
      range: n,
      context: { diagnostics: i }
    });
  }
  resolveCodeAction(t, e) {
    return this.send(t, "codeAction/resolve", e, 15e3);
  }
  inlayHints(t, e, n) {
    return this.send(e, "textDocument/inlayHint", {
      textDocument: { uri: be(t) },
      range: n
    }, 8e3);
  }
  /* --- call hierarchy --- */
  prepareCallHierarchy(t, e, n, i) {
    return this.send(e, "textDocument/prepareCallHierarchy", this.docPos(t, n, i));
  }
  incomingCalls(t, e) {
    return this.send(t, "callHierarchy/incomingCalls", { item: e });
  }
  outgoingCalls(t, e) {
    return this.send(t, "callHierarchy/outgoingCalls", { item: e });
  }
  /* --- type hierarchy --- */
  prepareTypeHierarchy(t, e, n, i) {
    return this.send(e, "textDocument/prepareTypeHierarchy", this.docPos(t, n, i));
  }
  supertypes(t, e) {
    return this.send(t, "typeHierarchy/supertypes", { item: e });
  }
  subtypes(t, e) {
    return this.send(t, "typeHierarchy/subtypes", { item: e });
  }
  /** Which capabilities the active server for a language advertises. */
  async capabilitiesFor(t) {
    const e = await this.ensure(t);
    return e ? { id: e.spec.id, capabilities: e.capabilities } : null;
  }
  async restart(t) {
    const e = this.sessions.get(t);
    e && (await e.client.stop(), this.sessions.delete(t)), this.events.onStatus();
  }
  async stopAll() {
    const t = [...this.sessions.values()];
    this.sessions.clear(), await Promise.all(t.map((e) => e.client.stop().catch(() => {
    }))), this.events.onStatus();
  }
}
function Dc(r, t) {
  if (!r) return {};
  if (!t) return r;
  let e = r;
  for (const n of t.split("."))
    if (e && typeof e == "object" && n in e)
      e = e[n];
    else
      return {};
  return e ?? {};
}
function Fc(r) {
  const t = new Pc({
    onDiagnostics: ({ uri: e, diagnostics: n }) => {
      r.broadcast("lsp:diagnostics", { path: Mc(e), diagnostics: n });
    },
    onStatus: () => r.broadcast("lsp:status", t.status()),
    onLog: (e, n) => r.broadcast("lsp:log", { serverId: e, text: n }),
    onApplyEdit: (e) => r.broadcast("lsp:applyEdit", e)
  });
  return g.handle("lsp:setRoot", (e, n) => {
    t.setRoot(n);
  }), g.handle("lsp:detect", (e, n) => t.detect(n)), g.handle("lsp:status", () => t.status()), g.handle("lsp:restart", (e, n) => t.restart(n)), g.handle("lsp:capabilities", (e, n) => t.capabilitiesFor(n)), g.handle(
    "lsp:didOpen",
    (e, n, i, s) => t.openDocument(n, i, s)
  ), g.handle(
    "lsp:didChange",
    (e, n, i, s) => t.changeDocument(n, i, s)
  ), g.handle(
    "lsp:didClose",
    (e, n, i) => t.closeDocument(n, i)
  ), g.handle(
    "lsp:didSave",
    (e, n, i, s) => t.saveDocument(n, i, s)
  ), g.handle(
    "lsp:definition",
    (e, n, i, s, o) => t.definition(n, i, s, o)
  ), g.handle(
    "lsp:typeDefinition",
    (e, n, i, s, o) => t.typeDefinition(n, i, s, o)
  ), g.handle(
    "lsp:implementation",
    (e, n, i, s, o) => t.implementation(n, i, s, o)
  ), g.handle(
    "lsp:references",
    (e, n, i, s, o) => t.references(n, i, s, o)
  ), g.handle(
    "lsp:hover",
    (e, n, i, s, o) => t.hover(n, i, s, o)
  ), g.handle(
    "lsp:completion",
    (e, n, i, s, o, a) => t.completion(n, i, s, o, a)
  ), g.handle(
    "lsp:resolveCompletion",
    (e, n, i) => t.resolveCompletion(n, i)
  ), g.handle(
    "lsp:signatureHelp",
    (e, n, i, s, o) => t.signatureHelp(n, i, s, o)
  ), g.handle(
    "lsp:documentSymbols",
    (e, n, i) => t.documentSymbols(n, i)
  ), g.handle(
    "lsp:semanticTokens",
    (e, n, i) => t.semanticTokens(n, i)
  ), g.handle(
    "lsp:executeCommand",
    (e, n, i, s) => t.executeCommand(n, i, s)
  ), g.handle(
    "lsp:workspaceSymbols",
    (e, n, i) => t.workspaceSymbols(n, i)
  ), g.handle(
    "lsp:prepareRename",
    (e, n, i, s, o) => t.prepareRename(n, i, s, o)
  ), g.handle(
    "lsp:rename",
    (e, n, i, s, o, a) => t.rename(n, i, s, o, a)
  ), g.handle(
    "lsp:formatting",
    (e, n, i, s, o) => t.formatting(n, i, s, o)
  ), g.handle(
    "lsp:codeActions",
    (e, n, i, s, o) => t.codeActions(n, i, s, o)
  ), g.handle(
    "lsp:resolveCodeAction",
    (e, n, i) => t.resolveCodeAction(n, i)
  ), g.handle(
    "lsp:inlayHints",
    (e, n, i, s) => t.inlayHints(n, i, s)
  ), g.handle(
    "lsp:prepareCallHierarchy",
    (e, n, i, s, o) => t.prepareCallHierarchy(n, i, s, o)
  ), g.handle(
    "lsp:incomingCalls",
    (e, n, i) => t.incomingCalls(n, i)
  ), g.handle(
    "lsp:outgoingCalls",
    (e, n, i) => t.outgoingCalls(n, i)
  ), g.handle(
    "lsp:prepareTypeHierarchy",
    (e, n, i, s, o) => t.prepareTypeHierarchy(n, i, s, o)
  ), g.handle("lsp:supertypes", (e, n, i) => t.supertypes(n, i)), g.handle("lsp:subtypes", (e, n, i) => t.subtypes(n, i)), {
    dispose: () => t.stopAll()
  };
}
function Tn(r, t) {
  const e = r.map((n) => Gs(n));
  return t === "regex-anchored" ? `^(${e.join("|")})$` : t === "regex" ? e.join("|") : r.join(" ");
}
const Bc = {
  id: "go",
  label: "go test",
  detect: (r) => r.rootFiles.has("go.mod"),
  command: (r, t) => {
    var e;
    return r.kind === "name" && r.name ? { command: "go", args: ["test", "-json", "-run", `^${Gs(r.name)}$`, "./..."] } : r.kind === "names" && ((e = r.names) != null && e.length) ? { command: "go", args: ["test", "-json", "-run", Tn(r.names, "regex-anchored"), "./..."] } : r.kind === "file" && r.file ? { command: "go", args: ["test", "-json", `./${t.relative(r.file).split("/").slice(0, -1).join("/") || "."}`] } : { command: "go", args: ["test", "-json", "./..."] };
  },
  parseLine: (r) => {
    var n;
    if (!r.startsWith("{")) return [];
    let t;
    try {
      t = JSON.parse(r);
    } catch {
      return [];
    }
    if (!t.Test) return [];
    const e = `${t.Package}.${t.Test}`;
    switch (t.Action) {
      case "run":
        return [{ type: "start", id: e, name: t.Test, suite: t.Package }];
      case "pass":
        return [{ type: "result", id: e, name: t.Test, suite: t.Package, status: "pass", durationMs: Math.round((t.Elapsed ?? 0) * 1e3) }];
      case "fail":
        return [{ type: "result", id: e, name: t.Test, suite: t.Package, status: "fail", durationMs: Math.round((t.Elapsed ?? 0) * 1e3) }];
      case "skip":
        return [{ type: "result", id: e, name: t.Test, suite: t.Package, status: "skip" }];
      case "output":
        return (n = t.Output) != null && n.trim() ? [{ type: "output", id: e, text: t.Output }] : [];
      default:
        return [];
    }
  }
}, Hc = /^test\s+(\S+)\s+\.\.\.\s+(ok|FAILED|ignored)/, zc = {
  id: "cargo",
  label: "cargo test",
  detect: (r) => r.rootFiles.has("Cargo.toml"),
  command: (r) => {
    var e;
    const t = ["test"];
    return r.kind === "name" && r.name && t.push(r.name), t.push("--", "--nocapture"), r.kind === "names" && ((e = r.names) != null && e.length) && t.push("--exact", ...r.names), { command: "cargo", args: t };
  },
  parseLine: (r) => {
    const t = Hc.exec(r.trim());
    if (!t) return [];
    const [, e, n] = t;
    return [
      {
        type: "result",
        id: e,
        name: e,
        status: n === "ok" ? "pass" : n === "ignored" ? "skip" : "fail"
      }
    ];
  },
  /** libtest prints each failure's captured output under `---- name stdout ----`. */
  parseFinal: (r) => {
    const t = [], e = r.split(/\n-{4}\s+(\S+)\s+stdout\s+-{4}\n/);
    for (let n = 1; n < e.length; n += 2) {
      const i = e[n], s = (e[n + 1] ?? "").split(/\nfailures:/)[0].trim();
      s && t.push({ type: "result", id: i, name: i, status: "fail", message: s.slice(0, 4e3) });
    }
    return t;
  }
}, fi = /^(\S+?)::(\S+?)\s+(PASSED|FAILED|SKIPPED|ERROR|XFAIL|XPASS)/, Zs = {
  id: "pytest",
  label: "pytest",
  detect: (r) => r.rootFiles.has("pytest.ini") || r.rootFiles.has("pyproject.toml") || r.rootFiles.has("setup.cfg") || r.rootFiles.has("tox.ini") || r.rootFiles.has("conftest.py"),
  command: (r, t) => {
    var n;
    const e = ["-v", "--no-header", "-rf", "--color=no"];
    return r.kind === "file" && r.file ? e.push(t.relative(r.file)) : r.kind === "name" && r.file && r.name ? e.push(`${t.relative(r.file)}::${r.name}`) : r.kind === "names" && ((n = r.names) != null && n.length) && e.push("-k", r.names.map((i) => i.replace(/[^\w]/g, " ").trim()).filter(Boolean).join(" or ")), { command: "pytest", args: e };
  },
  fallback: (r, t) => {
    const { args: e } = Zs.command(r, t);
    return { command: "python3", args: ["-m", "pytest", ...e] };
  },
  parseLine: (r) => {
    const t = fi.exec(r.trim());
    if (!t) return [];
    const [, e, n, i] = t, s = i === "PASSED" || i === "XPASS" ? "pass" : i === "SKIPPED" || i === "XFAIL" ? "skip" : "fail";
    return [{ type: "result", id: `${e}::${n}`, name: n, suite: e, status: s }];
  },
  /**
   * Attaches each failure's traceback. pytest prints them in a FAILURES section
   * keyed by test name only, so the ids are recovered from the verbose lines.
   */
  parseFinal: (r) => {
    const t = r.split(/=+\s*FAILURES\s*=+/)[1];
    if (!t) return [];
    const e = /* @__PURE__ */ new Map();
    for (const s of r.split(`
`)) {
      const o = fi.exec(s.trim());
      o && e.set(o[2], { id: `${o[1]}::${o[2]}`, suite: o[1] });
    }
    const n = [], i = t.split(/\n_{3,}\s+(\S+)\s+_{3,}\n/);
    for (let s = 1; s < i.length; s += 2) {
      const o = i[s], a = (i[s + 1] ?? "").split(/\n=+\s*short test summary/)[0].trim(), c = e.get(o);
      !c || !a || n.push({
        type: "result",
        id: c.id,
        name: o,
        suite: c.suite,
        status: "fail",
        message: a.slice(0, 4e3)
      });
    }
    return n;
  }
};
function Js(r, t, e) {
  return {
    id: r,
    label: t,
    detect: (n) => {
      var s, o;
      const i = { ...(s = n.packageJson) == null ? void 0 : s.dependencies, ...(o = n.packageJson) == null ? void 0 : o.devDependencies };
      return !!(i != null && i[e]);
    },
    command: (n, i) => {
      var o;
      const s = ["--yes", e];
      return e === "vitest" && s.push("run"), s.push("--reporter=json"), e === "jest" && (s.splice(s.indexOf("--reporter=json"), 1), s.push("--json")), n.kind === "file" && n.file && s.push(i.relative(n.file)), n.kind === "name" && n.name && s.push("-t", n.name), n.kind === "names" && ((o = n.names) != null && o.length) && s.push("-t", Tn(n.names, "regex")), { command: "npx", args: s };
    },
    // Both print one JSON document at the end; stream output is human text.
    parseFinal: (n) => {
      const i = n.indexOf('{"');
      if (i === -1) return [];
      let s;
      try {
        s = JSON.parse(n.slice(i, n.lastIndexOf("}") + 1));
      } catch {
        return [];
      }
      const o = [];
      for (const a of s.testResults ?? []) {
        const c = a.name ?? a.testFilePath ?? "";
        for (const u of a.assertionResults ?? a.testResults ?? []) {
          const f = u.fullName ?? u.title ?? u.name ?? "", d = u.status ?? u.state;
          o.push({
            type: "result",
            id: `${c}::${f}`,
            name: f,
            suite: c,
            status: d === "passed" ? "pass" : d === "pending" || d === "skipped" ? "skip" : "fail",
            durationMs: u.duration ?? void 0,
            message: (u.failureMessages ?? []).join(`
`) || void 0
          });
        }
      }
      return o;
    }
  };
}
const Uc = Js("vitest", "vitest", "vitest"), qc = Js("jest", "jest", "jest"), Wc = {
  id: "playwright",
  label: "playwright",
  detect: (r) => {
    var e, n;
    const t = { ...(e = r.packageJson) == null ? void 0 : e.dependencies, ...(n = r.packageJson) == null ? void 0 : n.devDependencies };
    return !!(t != null && t["@playwright/test"] || t != null && t.playwright || r.rootFiles.has("playwright.config.ts") || r.rootFiles.has("playwright.config.js"));
  },
  command: (r, t) => {
    var n;
    const e = ["--yes", "playwright", "test", "--reporter=json"];
    return r.kind === "file" && r.file && e.push(t.relative(r.file)), r.kind === "name" && r.name && e.push("-g", r.name), r.kind === "names" && ((n = r.names) != null && n.length) && e.push("-g", Tn(r.names, "regex")), { command: "npx", args: e };
  },
  parseFinal: (r) => {
    const t = r.indexOf("{");
    if (t === -1) return [];
    let e;
    try {
      e = JSON.parse(r.slice(t, r.lastIndexOf("}") + 1));
    } catch {
      return [];
    }
    const n = [], i = (s, o) => {
      var c, u, f;
      const a = s.title ? [...o, s.title] : o;
      for (const d of s.specs ?? []) {
        const p = (c = d.tests) == null ? void 0 : c[d.tests.length - 1], m = (u = p == null ? void 0 : p.results) == null ? void 0 : u[p.results.length - 1], w = a.join(" › ");
        n.push({
          type: "result",
          id: `${w}::${d.title}`,
          name: d.title,
          suite: w,
          status: d.ok ? "pass" : (m == null ? void 0 : m.status) === "skipped" ? "skip" : "fail",
          durationMs: m == null ? void 0 : m.duration,
          message: ((f = m == null ? void 0 : m.error) == null ? void 0 : f.message) ?? ((m == null ? void 0 : m.errors) ?? []).map((k) => k.message).join(`
`) ?? void 0
        });
      }
      for (const d of s.suites ?? []) i(d, a);
    };
    for (const s of e.suites ?? []) i(s, []);
    return n;
  }
}, Zc = {
  id: "cypress",
  label: "cypress",
  detect: (r) => {
    var e, n;
    const t = { ...(e = r.packageJson) == null ? void 0 : e.dependencies, ...(n = r.packageJson) == null ? void 0 : n.devDependencies };
    return !!(t != null && t.cypress || r.rootFiles.has("cypress.config.ts") || r.rootFiles.has("cypress.config.js") || r.rootFiles.has("cypress.json"));
  },
  command: (r, t) => {
    const e = ["--yes", "cypress", "run", "--reporter", "json"];
    return r.kind === "file" && r.file && e.push("--spec", t.relative(r.file)), { command: "npx", args: e };
  },
  parseFinal: (r) => {
    const t = r.indexOf("{");
    if (t === -1) return [];
    let e;
    try {
      e = JSON.parse(r.slice(t, r.lastIndexOf("}") + 1));
    } catch {
      return [];
    }
    const n = [], i = (s, o) => {
      var u;
      const a = s.fullTitle ?? s.title ?? "", c = s.title ?? a;
      n.push({
        type: "result",
        id: `${a}`,
        name: c,
        // Mocha's fullTitle is the suite chain plus the title, so removing the
        // title leaves the suite.
        suite: a.endsWith(c) ? a.slice(0, a.length - c.length).trim() : "",
        status: o,
        durationMs: s.duration,
        message: ((u = s.err) == null ? void 0 : u.message) || void 0
      });
    };
    for (const s of e.passes ?? []) i(s, "pass");
    for (const s of e.failures ?? []) i(s, "fail");
    for (const s of e.pending ?? []) i(s, "skip");
    return n;
  }
}, Jc = {
  id: "rspec",
  label: "rspec",
  detect: (r) => r.rootFiles.has(".rspec") || r.rootFiles.has("spec"),
  command: (r, t) => {
    var n;
    const e = [];
    if (r.kind === "file" && r.file && e.push(t.relative(r.file)), r.kind === "name" && r.name && e.push("-e", r.name), r.kind === "names" && ((n = r.names) != null && n.length))
      for (const i of r.names) e.push("-e", i);
    return { command: "rspec", args: e };
  }
}, Kc = {
  id: "phpunit",
  label: "PHPUnit",
  detect: (r) => r.rootFiles.has("phpunit.xml") || r.rootFiles.has("phpunit.xml.dist"),
  command: (r, t) => {
    var n;
    const e = [];
    return r.kind === "file" && r.file && e.push(t.relative(r.file)), r.kind === "name" && r.name && e.push("--filter", r.name), r.kind === "names" && ((n = r.names) != null && n.length) && e.push("--filter", Tn(r.names, "regex")), { command: "./vendor/bin/phpunit", args: e };
  }
}, Ks = {
  id: "gradle",
  label: "Gradle test",
  detect: (r) => r.rootFiles.has("build.gradle") || r.rootFiles.has("build.gradle.kts"),
  command: (r) => {
    var e;
    const t = ["test"];
    if (r.kind === "name" && r.name && t.push("--tests", r.name), r.kind === "names" && ((e = r.names) != null && e.length))
      for (const n of r.names) t.push("--tests", n);
    return { command: "./gradlew", args: t };
  },
  fallback: (r, t) => ({ command: "gradle", args: Ks.command(r, t).args })
}, Yc = {
  id: "maven",
  label: "Maven test",
  detect: (r) => r.rootFiles.has("pom.xml"),
  command: (r) => {
    var e;
    const t = ["test"];
    return r.kind === "name" && r.name && t.push(`-Dtest=${r.name}`), r.kind === "names" && ((e = r.names) != null && e.length) && t.push(`-Dtest=${r.names.join("+")}`), { command: "mvn", args: t };
  }
}, Gc = {
  id: "npm",
  label: "npm test",
  detect: (r) => {
    var t, e;
    return !!((e = (t = r.packageJson) == null ? void 0 : t.scripts) != null && e.test);
  },
  command: () => ({ command: "npm", args: ["test", "--silent"] })
}, Ys = [
  Bc,
  zc,
  // Ahead of the unit runners: a project with both should offer its E2E suite
  // as a distinct choice rather than having it hidden behind vitest.
  Wc,
  Zc,
  Uc,
  qc,
  Zs,
  Jc,
  Kc,
  Ks,
  Yc,
  Gc
];
function pi(r) {
  return Ys.filter((t) => t.detect(r));
}
function Gs(r) {
  return r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const Vc = {
  go: [/^func\s+(Test\w+)\s*\(/, /^func\s+(Benchmark\w+)\s*\(/, /^func\s+(Fuzz\w+)\s*\(/],
  rust: [/^\s*fn\s+(\w+)\s*\(/],
  python: [/^\s*(?:async\s+)?def\s+(test_\w+)/, /^\s*class\s+(Test\w+)/],
  typescript: [
    /^\s*(?:it|test)(?:\.\w+)?\s*\(\s*['"`](.+?)['"`]/,
    /^\s*describe(?:\.\w+)?\s*\(\s*['"`](.+?)['"`]/
  ],
  javascript: [
    /^\s*(?:it|test)(?:\.\w+)?\s*\(\s*['"`](.+?)['"`]/,
    /^\s*describe(?:\.\w+)?\s*\(\s*['"`](.+?)['"`]/
  ],
  ruby: [/^\s*(?:it|describe|context)\s+['"](.+?)['"]/],
  java: [/^\s*(?:public\s+)?void\s+(test\w+|\w+Test)\s*\(/],
  php: [/^\s*public\s+function\s+(test\w+)\s*\(/]
};
function Xc(r, t) {
  const e = Vc[r];
  if (!e) return [];
  const n = t.split(`
`), i = [];
  for (let s = 0; s < n.length; s++) {
    if (r === "rust") {
      const o = (n[s - 1] ?? "").trim();
      if (!/^#\[(?:test|tokio::test|test_case.*)\]/.test(o)) continue;
    }
    for (const o of e) {
      const a = o.exec(n[s]);
      if (a != null && a[1]) {
        i.push({ name: a[1], line: s + 1 });
        break;
      }
    }
  }
  return i;
}
const Qc = [
  "coverage/lcov.info",
  "coverage/coverage-final.json",
  "coverage/cobertura-coverage.xml",
  "lcov.info",
  "coverage.out",
  "coverage.txt",
  "target/site/jacoco/jacoco.xml",
  "build/reports/jacoco/test/jacocoTestReport.xml"
];
async function Vs(r) {
  for (const t of Qc) {
    const e = y.join(r, t);
    try {
      return await v.access(e), e;
    } catch {
    }
  }
  return null;
}
async function el(r, t) {
  const e = t ?? await Vs(r);
  if (!e) return null;
  const n = await v.readFile(e, "utf8"), i = y.basename(e);
  let s, o;
  i.endsWith(".json") ? (s = nl(n, r), o = "istanbul") : i.endsWith(".xml") ? (s = il(n, r), o = "cobertura") : n.startsWith("mode:") ? (s = rl(n, r), o = "go") : (s = tl(n, r), o = "lcov");
  const a = s.reduce(
    (c, u) => ({
      coveredLines: c.coveredLines + u.coveredLines,
      totalLines: c.totalLines + u.totalLines,
      coveredBranches: c.coveredBranches + u.coveredBranches,
      totalBranches: c.totalBranches + u.totalBranches,
      coveredFunctions: c.coveredFunctions + u.coveredFunctions,
      totalFunctions: c.totalFunctions + u.totalFunctions
    }),
    { coveredLines: 0, totalLines: 0, coveredBranches: 0, totalBranches: 0, coveredFunctions: 0, totalFunctions: 0 }
  );
  return {
    at: Date.now(),
    source: e,
    format: o,
    files: s.sort((c, u) => c.path.localeCompare(u.path)),
    totals: a
  };
}
function Rt(r) {
  return {
    path: r,
    lines: {},
    uncovered: [],
    partial: [],
    coveredLines: 0,
    totalLines: 0,
    coveredBranches: 0,
    totalBranches: 0,
    coveredFunctions: 0,
    totalFunctions: 0
  };
}
function ht(r) {
  const t = Object.entries(r.lines);
  return r.totalLines = t.length, r.coveredLines = t.filter(([, e]) => e > 0).length, r.uncovered = t.filter(([, e]) => e === 0).map(([e]) => Number(e)).sort((e, n) => e - n), r;
}
function tl(r, t) {
  const e = /* @__PURE__ */ new Map();
  let n = null, i = /* @__PURE__ */ new Map();
  for (const s of r.split(/\r?\n/)) {
    const o = s.trim();
    if (o) {
      if (o.startsWith("SF:")) {
        const a = Mt(t, o.slice(3));
        n = e.get(a) ?? Rt(a), e.set(a, n), i = /* @__PURE__ */ new Map();
        continue;
      }
      if (n) {
        if (o.startsWith("DA:")) {
          const [a, c] = o.slice(3).split(","), u = Number(a);
          if (!Number.isFinite(u)) continue;
          n.lines[u] = (n.lines[u] ?? 0) + (Number(c) || 0);
        } else if (o.startsWith("BRDA:")) {
          const [a, c, u, f] = o.slice(5).split(","), d = `${a}:${c}:${u}`, p = f === "-" ? 0 : Number(f) || 0;
          i.set(d, (i.get(d) ?? 0) + p);
        } else if (o.startsWith("FNDA:")) {
          const [a] = o.slice(5).split(",");
          (Number(a) || 0) > 0 && n.coveredFunctions++;
        } else if (o.startsWith("FNF:"))
          n.totalFunctions = Number(o.slice(4)) || n.totalFunctions;
        else if (o === "end_of_record") {
          const a = /* @__PURE__ */ new Set();
          for (const [c, u] of i) {
            const f = Number(c.split(":")[0]);
            n.totalBranches++, u > 0 ? n.coveredBranches++ : n.lines[f] > 0 && a.add(f);
          }
          n.partial = Array.from(a).sort((c, u) => c - u), ht(n), n = null;
        }
      }
    }
  }
  for (const s of e.values()) s.totalLines === 0 && ht(s);
  return Array.from(e.values());
}
function nl(r, t) {
  var i, s, o, a, c;
  let e;
  try {
    e = JSON.parse(r);
  } catch {
    return [];
  }
  const n = [];
  for (const [u, f] of Object.entries(e)) {
    if (!f || typeof f != "object" || !f.statementMap) continue;
    const d = Rt(Mt(t, f.path ?? u));
    for (const [m, w] of Object.entries(f.statementMap)) {
      const k = (i = w == null ? void 0 : w.start) == null ? void 0 : i.line;
      if (!k) continue;
      const _ = ((s = f.s) == null ? void 0 : s[m]) ?? 0;
      d.lines[k] = Math.max(d.lines[k] ?? 0, _);
    }
    const p = /* @__PURE__ */ new Set();
    for (const [m, w] of Object.entries(f.b ?? {})) {
      const k = (o = f.branchMap) == null ? void 0 : o[m], _ = ((c = (a = k == null ? void 0 : k.loc) == null ? void 0 : a.start) == null ? void 0 : c.line) ?? (k == null ? void 0 : k.line);
      for (const x of w)
        d.totalBranches++, x > 0 ? d.coveredBranches++ : _ && (d.lines[_] ?? 0) > 0 && p.add(_);
    }
    d.partial = Array.from(p).sort((m, w) => m - w);
    for (const [m, w] of Object.entries(f.f ?? {}))
      d.totalFunctions++, w > 0 && d.coveredFunctions++;
    n.push(ht(d));
  }
  return n;
}
function rl(r, t) {
  const e = /* @__PURE__ */ new Map();
  for (const n of r.split(/\r?\n/)) {
    const i = n.trim();
    if (!i || i.startsWith("mode:")) continue;
    const s = /^(.*):(\d+)\.\d+,(\d+)\.\d+ \d+ (\d+)$/.exec(i);
    if (!s) continue;
    const [, o, a, c, u] = s, f = Mt(t, o), d = e.get(f) ?? Rt(f);
    e.set(f, d);
    const p = Number(u);
    for (let m = Number(a); m <= Number(c); m++)
      d.lines[m] = Math.max(d.lines[m] ?? 0, p);
  }
  return Array.from(e.values()).map(ht);
}
function il(r, t) {
  const e = [], n = /<class\b[^>]*filename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g;
  for (const s of r.matchAll(n)) {
    const o = Rt(Mt(t, s[1]));
    for (const a of s[2].matchAll(/<line\b[^>]*number="(\d+)"[^>]*hits="(\d+)"[^>]*\/?>/g)) {
      const c = Number(a[1]);
      o.lines[c] = Math.max(o.lines[c] ?? 0, Number(a[2]));
    }
    e.push(ht(o));
  }
  const i = /<sourcefile\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/sourcefile>/g;
  for (const s of r.matchAll(i)) {
    const o = Rt(Mt(t, s[1]));
    for (const a of s[2].matchAll(/<line\b[^>]*nr="(\d+)"[^>]*mi="(\d+)"[^>]*ci="(\d+)"[^>]*\/?>/g))
      o.lines[Number(a[1])] = Number(a[3]) > 0 ? Number(a[3]) : 0;
    e.push(ht(o));
  }
  return e;
}
function Mt(r, t) {
  return y.isAbsolute(t) ? t : y.resolve(r, t);
}
function Xs(r) {
  switch (r) {
    case "jest":
      return ["--coverage", "--coverageReporters=lcov", "--coverageReporters=json-summary"];
    case "vitest":
      return ["--coverage", "--coverage.reporter=lcov"];
    case "pytest":
      return ["--cov", "--cov-report=lcov"];
    case "go":
      return ["-coverprofile=coverage.out"];
    case "cargo":
      return null;
    case "rspec":
      return null;
    case "phpunit":
      return ["--coverage-clover", "coverage/cobertura-coverage.xml"];
    case "gradle":
      return ["jacocoTestReport"];
    case "maven":
      return ["jacoco:report"];
    default:
      return null;
  }
}
async function hi(r) {
  let t = /* @__PURE__ */ new Set();
  try {
    t = new Set(await v.readdir(r));
  } catch {
  }
  let e = null;
  try {
    e = JSON.parse(await v.readFile(y.join(r, "package.json"), "utf8"));
  } catch {
  }
  return {
    root: r,
    rootFiles: t,
    packageJson: e,
    relative: (n) => y.relative(r, n) || y.basename(n)
  };
}
let Ee = null;
function mi(r, t, e) {
  return qe(r, t, {
    cwd: e,
    env: we({ NO_COLOR: "1", FORCE_COLOR: "0", CI: "1" }),
    stdio: ["ignore", "pipe", "pipe"]
  });
}
function sl(r) {
  g.handle("tests:detect", async (t, e) => {
    const n = await hi(e);
    return pi(n).map((i) => ({ id: i.id, label: i.label }));
  }), g.handle(
    "tests:declarations",
    async (t, e) => {
      try {
        const n = await v.readFile(e, "utf8");
        return Xc(ft(e), n);
      } catch {
        return [];
      }
    }
  ), g.handle(
    "tests:run",
    async (t, e, n, i, s) => {
      const o = `test_${Date.now().toString(36)}`, a = await hi(e), c = Ys.find((z) => z.id === n) ?? pi(a)[0];
      if (!c)
        return r.broadcast("tests:update", {
          runId: o,
          framework: "",
          command: "",
          events: [{ type: "output", text: `No test framework detected in this project.
` }],
          done: { exitCode: 1, durationMs: 0 }
        }), { runId: o };
      Ee && Ee.kill("SIGTERM");
      const u = Date.now();
      let f = !1, { command: d, args: p } = c.command(i, a);
      if (s != null && s.coverage) {
        const z = Xs(c.id);
        z ? p = [...p, ...z] : r.broadcast("tests:update", {
          runId: o,
          framework: c.id,
          command: "",
          events: [
            {
              type: "output",
              text: `${c.label} has no coverage mode Nova knows how to enable — running without it.
`
            }
          ]
        });
      }
      let m = mi(d, p, e);
      Ee = m;
      let w = `${d} ${p.join(" ")}`;
      const k = (z, F) => {
        z.length === 0 && !F || r.broadcast("tests:update", {
          runId: o,
          framework: c.id,
          command: w,
          events: z,
          done: F
        });
      };
      k([{ type: "output", text: `$ ${w}
` }]);
      let _ = "", x = "";
      const A = (z) => {
        _ += z, x += z;
        const F = [];
        let K;
        for (; (K = x.indexOf(`
`)) !== -1; ) {
          const Y = x.slice(0, K);
          x = x.slice(K + 1), c.parseLine && F.push(...c.parseLine(Y)), (!c.parseLine || c.id !== "go") && F.push({ type: "output", text: `${Y}
` });
        }
        k(F);
      }, N = (z) => {
        if (z.code === "ENOENT" && c.fallback && !f) {
          f = !0;
          const F = c.fallback(i, a);
          d = F.command, p = F.args, w = `${d} ${p.join(" ")}`, k([{ type: "output", text: `not found on PATH, retrying: $ ${w}
` }]), m = mi(d, p, e), Ee = m, P(m);
          return;
        }
        k([{ type: "output", text: `${d}: ${z.message}
` }], {
          exitCode: 127,
          durationMs: Date.now() - u
        }), Ee = null;
      }, j = (z) => {
        const F = [];
        x.trim() && (c.parseLine && F.push(...c.parseLine(x)), F.push({ type: "output", text: x })), c.parseFinal && F.push(...c.parseFinal(_)), k(F, { exitCode: z, durationMs: Date.now() - u }), Ee = null;
      };
      function P(z) {
        var F, K, Y, X;
        (F = z.stdout) == null || F.setEncoding("utf8"), (K = z.stdout) == null || K.on("data", A), (Y = z.stderr) == null || Y.setEncoding("utf8"), (X = z.stderr) == null || X.on("data", A), z.on("error", N), z.on("close", j);
      }
      return P(m), { runId: o };
    }
  ), g.handle("tests:cancel", () => {
    Ee == null || Ee.kill("SIGTERM"), Ee = null;
  });
}
function ol() {
  g.handle("coverage:load", (r, t, e) => el(t, e)), g.handle("coverage:find", (r, t) => Vs(t)), g.handle("coverage:args", (r, t) => Xs(t));
}
class al extends Ns {
  constructor(e, n, i, s) {
    super();
    H(this, "child", null);
    H(this, "buffer", Buffer.alloc(0));
    H(this, "seq", 1);
    H(this, "pending", /* @__PURE__ */ new Map());
    H(this, "stopped", !1);
    this.command = e, this.args = n, this.cwd = i, this.env = s;
  }
  get running() {
    return this.child !== null && !this.stopped;
  }
  start() {
    this.child = qe(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"]
    }), this.child.stdout.on("data", (e) => this.consume(e)), this.child.stderr.setEncoding("utf8"), this.child.stderr.on("data", (e) => this.emit("stderr", e)), this.child.on("error", (e) => {
      this.emit("stderr", `${this.command}: ${e.message}
`), this.failAll(new Error(e.message));
    }), this.child.on("exit", (e) => {
      this.stopped = !0, this.failAll(new Error(`debug adapter exited (${e})`)), this.emit("exit", e);
    });
  }
  consume(e) {
    for (this.buffer = Buffer.concat([this.buffer, e]); ; ) {
      const n = this.buffer.indexOf(`\r
\r
`);
      if (n === -1) return;
      const i = this.buffer.subarray(0, n).toString("ascii"), s = /content-length:\s*(\d+)/i.exec(i);
      if (!s) {
        this.buffer = this.buffer.subarray(n + 4);
        continue;
      }
      const o = Number(s[1]), a = n + 4;
      if (this.buffer.length < a + o) return;
      const c = this.buffer.subarray(a, a + o).toString("utf8");
      this.buffer = this.buffer.subarray(a + o);
      try {
        this.dispatch(JSON.parse(c));
      } catch {
      }
    }
  }
  dispatch(e) {
    if (e.type === "response") {
      const n = this.pending.get(e.request_seq);
      if (!n) return;
      this.pending.delete(e.request_seq), clearTimeout(n.timer), e.success === !1 ? n.reject(new Error(e.message || `${e.command} failed`)) : n.resolve(e.body);
      return;
    }
    if (e.type === "event") {
      this.emit("event", e.event, e.body);
      return;
    }
    e.type === "request" && this.emit(
      "reverseRequest",
      e.command,
      e.arguments,
      (n) => this.write({
        seq: this.seq++,
        type: "response",
        request_seq: e.seq,
        success: !0,
        command: e.command,
        body: n
      })
    );
  }
  write(e) {
    if (!this.child || this.stopped) return;
    const n = Buffer.from(JSON.stringify(e), "utf8");
    this.child.stdin.write(`Content-Length: ${n.byteLength}\r
\r
`), this.child.stdin.write(n);
  }
  request(e, n, i = 15e3) {
    if (!this.running) return Promise.reject(new Error("debug adapter is not running"));
    const s = this.seq++;
    return new Promise((o, a) => {
      const c = setTimeout(() => {
        this.pending.delete(s), a(new Error(`${e} timed out`));
      }, i);
      this.pending.set(s, { resolve: o, reject: a, timer: c }), this.write({ seq: s, type: "request", command: e, arguments: n ?? {} });
    });
  }
  failAll(e) {
    for (const [, n] of this.pending)
      clearTimeout(n.timer), n.reject(e);
    this.pending.clear();
  }
  kill() {
    var e;
    this.stopped = !0, (e = this.child) == null || e.kill("SIGKILL");
  }
}
const wn = [
  {
    id: "debugpy",
    label: "Python (debugpy)",
    languages: ["python"],
    command: "python3",
    args: ["-m", "debugpy.adapter"],
    launchDefaults: { console: "internalConsole", justMyCode: !0 },
    programKind: "script",
    install: "pip install debugpy"
  },
  {
    id: "delve",
    label: "Go (Delve)",
    languages: ["go"],
    command: "dlv",
    args: ["dap"],
    launchDefaults: { mode: "debug" },
    programKind: "script",
    install: "go install github.com/go-delve/delve/cmd/dlv@latest"
  },
  {
    id: "lldb-dap",
    label: "C / C++ / Rust / Swift (lldb-dap)",
    languages: ["c", "cpp", "objective-c", "rust", "swift"],
    command: "lldb-dap",
    args: [],
    launchDefaults: {},
    programKind: "binary",
    install: "ships with Xcode / LLVM (xcrun --find lldb-dap)",
    xcrun: !0
  },
  {
    id: "codelldb",
    label: "Rust / C++ (CodeLLDB)",
    languages: ["rust", "c", "cpp"],
    command: "codelldb",
    args: ["--port", "0"],
    launchDefaults: {},
    programKind: "binary",
    install: "install the CodeLLDB release and put `codelldb` on PATH"
  },
  {
    id: "js-debug",
    label: "Node / TypeScript (vscode-js-debug)",
    languages: ["javascript", "typescript"],
    command: "js-debug-adapter",
    args: [],
    launchDefaults: { type: "pwa-node", console: "internalConsole", sourceMaps: !0 },
    programKind: "script",
    install: "npm i -g js-debug-adapter"
  }
];
function cl(r) {
  return wn.filter((t) => t.languages.includes(r));
}
class ll {
  constructor(t) {
    H(this, "client", null);
    H(this, "spec", null);
    H(this, "available", /* @__PURE__ */ new Map());
    H(this, "detected", !1);
    H(this, "capabilities", {});
    /** file -> the breakpoints the user has set, ordered by line. */
    H(this, "breakpoints", /* @__PURE__ */ new Map());
    H(this, "verified", /* @__PURE__ */ new Map());
    /**
     * Break-on-exception categories.
     *
     * The adapter decides which categories exist (`raised`, `uncaught`, `assert`
     * …) and Nova decides which are on. Selection is kept by filter id rather
     * than by index, because the list is per adapter and a project may be
     * debugged with more than one.
     */
    H(this, "exceptionFilters", []);
    H(this, "exceptionChoice", /* @__PURE__ */ new Map());
    /** Field/data watchpoints, keyed by the adapter's opaque dataId. */
    H(this, "dataBreakpoints", []);
    /**
     * The Run to Cursor target, armed as a one-shot breakpoint the adapter never
     * learns is temporary — it is withdrawn as soon as the program stops.
     */
    H(this, "runToCursor", null);
    /** The open project, used to scope persisted breakpoints. */
    H(this, "projectRoot", "");
    H(this, "configured", !1);
    H(this, "status", "inactive");
    H(this, "threadId", null);
    H(this, "frames", []);
    H(this, "currentFrameId", null);
    H(this, "stopReason", "");
    H(this, "error", "");
    this.events = t;
  }
  async detect(t = !1) {
    return (!this.detected || t) && (this.available.clear(), await Promise.all(
      wn.map(async (e) => {
        const n = await Re(e.command) || (e.xcrun ? await qs(e.command) : "");
        n && (e.id === "debugpy" && !await ul(n, "debugpy") || this.available.set(e.id, n));
      })
    ), this.detected = !0), wn.map((e) => ({
      id: e.id,
      label: e.label,
      languages: e.languages,
      command: e.command,
      binary: this.available.get(e.id) ?? "",
      installed: this.available.has(e.id),
      install: e.install,
      programKind: e.programKind
    }));
  }
  state() {
    var t, e;
    return {
      status: this.status,
      adapterId: ((t = this.spec) == null ? void 0 : t.id) ?? "",
      adapterLabel: ((e = this.spec) == null ? void 0 : e.label) ?? "",
      threadId: this.threadId,
      frames: this.frames,
      currentFrameId: this.currentFrameId,
      stopReason: this.stopReason,
      error: this.error,
      breakpoints: [...this.breakpoints.entries()].map(([n, i]) => ({
        file: n,
        lines: i.map((s) => s.line),
        verified: this.verified.get(n) ?? [],
        items: i
      })),
      exceptionFilters: this.exceptionFilters.map((n) => ({
        ...n,
        ...this.exceptionChoice.get(n.filter) ?? {
          enabled: n.default,
          condition: ""
        }
      })),
      dataBreakpoints: this.dataBreakpoints,
      supportsStepBack: !!this.capabilities.supportsStepBack,
      supportsRestart: !!this.capabilities.supportsRestartRequest,
      supportsDropFrame: !!this.capabilities.supportsRestartFrame,
      supportsSetVariable: !!this.capabilities.supportsSetVariable,
      supportsDataBreakpoints: !!this.capabilities.supportsDataBreakpoints,
      runningToCursor: this.runToCursor !== null
    };
  }
  publish() {
    this.events.onState(this.state());
  }
  /* ---------------- breakpoints ---------------- */
  toggleBreakpoint(t, e) {
    var s;
    const n = this.breakpoints.get(t) ?? [], i = n.some((o) => o.line === e) ? n.filter((o) => o.line !== e) : [...n, { line: e, enabled: !0 }].sort((o, a) => o.line - a.line);
    i.length ? this.breakpoints.set(t, i) : this.breakpoints.delete(t), (s = this.client) != null && s.running && this.sendBreakpoints(t), this.persist(), this.publish();
  }
  /**
   * Edits an existing breakpoint — condition, hit count, log message or the
   * enabled flag. Creates one when the line has none yet, so the properties
   * dialog can be opened straight from the gutter.
   */
  updateBreakpoint(t, e, n) {
    var a;
    const i = this.breakpoints.get(t) ?? [], o = i.find((c) => c.line === e) ? i.map((c) => c.line === e ? { ...c, ...n, line: e } : c) : [...i, { line: e, enabled: !0, ...n }].sort((c, u) => c.line - u.line);
    this.breakpoints.set(t, o), (a = this.client) != null && a.running && this.sendBreakpoints(t), this.persist(), this.publish();
  }
  clearBreakpoints() {
    var e;
    const t = [...this.breakpoints.keys()];
    if (this.breakpoints.clear(), this.verified.clear(), (e = this.client) != null && e.running) for (const n of t) this.sendBreakpoints(n);
    this.persist(), this.publish();
  }
  async sendBreakpoints(t) {
    var n, i;
    if (!((n = this.client) != null && n.running)) return;
    const e = (this.breakpoints.get(t) ?? []).filter((s) => s.enabled);
    ((i = this.runToCursor) == null ? void 0 : i.file) === t && !e.some((s) => s.line === this.runToCursor.line) && (e.push({ line: this.runToCursor.line, enabled: !0 }), e.sort((s, o) => s.line - o.line));
    try {
      const s = await this.client.request("setBreakpoints", {
        source: { path: t, name: y.basename(t) },
        breakpoints: e.map((a) => ({
          line: a.line,
          ...a.condition ? { condition: a.condition } : {},
          ...a.hitCondition ? { hitCondition: a.hitCondition } : {},
          ...a.logMessage ? { logMessage: a.logMessage } : {}
        })),
        lines: e.map((a) => a.line)
      }), o = ((s == null ? void 0 : s.breakpoints) ?? []).map((a, c) => {
        var u;
        return a.verified ? a.line ?? ((u = e[c]) == null ? void 0 : u.line) : null;
      }).filter((a) => a !== null);
      this.verified.set(t, o), this.publish();
    } catch {
    }
  }
  /* ---------------- persistence ---------------- */
  storePath() {
    return y.join(
      ee.getPath("userData"),
      "breakpoints",
      `${wt.createHash("sha1").update(this.projectRoot).digest("hex").slice(0, 16)}.json`
    );
  }
  /**
   * Breakpoints survive a restart, which is the whole point of setting one in a
   * place you are still investigating.
   */
  async setProjectRoot(t) {
    if (t !== this.projectRoot) {
      if (this.projectRoot = t, this.breakpoints.clear(), this.verified.clear(), !t) {
        this.publish();
        return;
      }
      this.exceptionChoice.clear();
      try {
        const e = JSON.parse(await v.readFile(this.storePath(), "utf8")), n = "files" in e && e.files ? e.files : e;
        for (const [s, o] of Object.entries(n)) {
          if (!Array.isArray(o)) continue;
          const a = o.filter((c) => Number.isFinite(c == null ? void 0 : c.line));
          a.length && this.breakpoints.set(s, a);
        }
        const i = "files" in e ? e.exceptions : void 0;
        for (const [s, o] of Object.entries(i ?? {}))
          this.exceptionChoice.set(s, {
            enabled: !!(o != null && o.enabled),
            condition: String((o == null ? void 0 : o.condition) ?? "")
          });
      } catch {
      }
      this.publish();
    }
  }
  async persist() {
    if (!this.projectRoot) return;
    const t = this.storePath();
    try {
      await v.mkdir(y.dirname(t), { recursive: !0 }), await v.writeFile(
        t,
        JSON.stringify(
          {
            files: Object.fromEntries(this.breakpoints),
            exceptions: Object.fromEntries(this.exceptionChoice)
          },
          null,
          2
        )
      );
    } catch {
    }
  }
  /* ---------------- lifecycle ---------------- */
  async launch(t) {
    await this.stop(), this.detected || await this.detect();
    const e = t.adapterId ? wn.find((s) => s.id === t.adapterId) : cl(t.language).find((s) => this.available.has(s.id));
    if (!e || !this.available.has(e.id)) {
      this.status = "inactive", this.error = e ? `${e.label} is not installed. ${e.install}` : `No debug adapter for ${t.language}. Install one from Settings › Debuggers.`, this.publish();
      return;
    }
    this.spec = e, this.configured = !1, this.status = "starting", this.error = "", this.frames = [], this.threadId = null, this.publish();
    const n = this.available.get(e.id), i = new al(n, e.args, t.cwd, we(t.env));
    this.client = i, i.on("stderr", (s) => this.events.onOutput(s, "stderr")), i.on("exit", () => {
      this.status = "inactive", this.threadId = null, this.frames = [], this.publish();
    }), i.on("reverseRequest", (s, o, a) => {
      a({});
    }), i.on("event", (s, o) => void this.onEvent(s, o));
    try {
      i.start(), this.capabilities = await i.request("initialize", {
        clientID: "nova-ide",
        clientName: "Nova IDE",
        adapterID: e.id,
        locale: "en",
        pathFormat: "path",
        linesStartAt1: !0,
        columnsStartAt1: !0,
        supportsVariableType: !0,
        supportsVariablePaging: !1,
        supportsRunInTerminalRequest: !1,
        supportsProgressReporting: !0
      }) ?? {}, this.adoptExceptionFilters();
      const s = {
        ...e.launchDefaults,
        name: "Nova debug",
        request: "launch",
        program: t.program,
        args: t.args ?? [],
        cwd: t.cwd,
        stopOnEntry: t.stopOnEntry ?? !1,
        env: t.env ?? {}
      };
      i.request("launch", s, 6e4).catch((a) => {
        this.status = "inactive", this.error = a.message, this.publish();
      }), setTimeout(() => {
        this.client === i && !this.configured && this.configure();
      }, 1500), this.status = "running", this.publish();
    } catch (s) {
      this.status = "inactive", this.error = s instanceof Error ? s.message : String(s), this.publish();
    }
  }
  /** Sends breakpoints then `configurationDone`; safe to call more than once. */
  async configure() {
    const t = this.client;
    if (!(!(t != null && t.running) || this.configured)) {
      this.configured = !0;
      for (const e of this.breakpoints.keys()) await this.sendBreakpoints(e);
      await this.sendExceptionBreakpoints(), this.capabilities.supportsConfigurationDoneRequest !== !1 && await t.request("configurationDone").catch(() => {
      });
    }
  }
  /* ---------------- exception breakpoints ---------------- */
  /**
   * Reads the adapter's categories out of its capabilities and reconciles them
   * with what the user chose last time.
   *
   * This is what makes break-on-throw actually work: the filters have to be
   * sent by id, and the ids only exist once `initialize` has answered.
   */
  adoptExceptionFilters() {
    const t = this.capabilities.exceptionBreakpointFilters ?? [];
    this.exceptionFilters = t.map((e) => ({
      filter: String(e.filter),
      label: String(e.label ?? e.filter),
      description: String(e.description ?? ""),
      default: !!e.default,
      supportsCondition: !!e.supportsCondition,
      conditionDescription: String(e.conditionDescription ?? ""),
      enabled: !!e.default,
      condition: ""
    }));
    for (const e of this.exceptionFilters)
      this.exceptionChoice.has(e.filter) || this.exceptionChoice.set(e.filter, { enabled: e.default, condition: "" });
  }
  async sendExceptionBreakpoints() {
    const t = this.client;
    if (!(t != null && t.running) || this.exceptionFilters.length === 0) return;
    const e = this.exceptionFilters.filter(
      (i) => {
        var s;
        return ((s = this.exceptionChoice.get(i.filter)) == null ? void 0 : s.enabled) ?? i.default;
      }
    ), n = e.filter((i) => {
      var s;
      return i.supportsCondition && ((s = this.exceptionChoice.get(i.filter)) == null ? void 0 : s.condition);
    }).map((i) => ({
      filterId: i.filter,
      condition: this.exceptionChoice.get(i.filter).condition
    }));
    await t.request("setExceptionBreakpoints", {
      filters: e.map((i) => i.filter),
      ...n.length && this.capabilities.supportsExceptionFilterOptions ? { filterOptions: n.map((i) => ({ filterId: i.filterId, condition: i.condition })) } : {}
    }).catch(() => {
    });
  }
  async setExceptionBreakpoint(t, e) {
    const n = this.exceptionChoice.get(t) ?? { enabled: !1, condition: "" };
    this.exceptionChoice.set(t, { ...n, ...e }), await this.sendExceptionBreakpoints(), this.persist(), this.publish();
  }
  /* ---------------- data (field) watchpoints ---------------- */
  /**
   * Adds a watchpoint on a variable: break when the program writes to it.
   *
   * The adapter turns a (name, container) pair into an opaque `dataId` first —
   * the id is only valid for the current session, so watchpoints are not
   * persisted the way line breakpoints are.
   */
  async addDataBreakpoint(t, e, n = "write") {
    var s;
    const i = this.client;
    if (!(i != null && i.running)) return { ok: !1, message: "Start a debug session first." };
    if (!this.capabilities.supportsDataBreakpoints)
      return { ok: !1, message: `${((s = this.spec) == null ? void 0 : s.label) ?? "This adapter"} does not support watchpoints.` };
    try {
      const o = await i.request("dataBreakpointInfo", {
        name: t,
        ...e ? { variablesReference: e } : {},
        ...this.currentFrameId !== null ? { frameId: this.currentFrameId } : {}
      });
      if (!(o != null && o.dataId))
        return { ok: !1, message: (o == null ? void 0 : o.description) || `\`${t}\` cannot be watched here.` };
      const a = o.accessTypes ?? ["write"], c = a.includes(n) ? n : a[0];
      return this.dataBreakpoints = [
        ...this.dataBreakpoints.filter((u) => u.dataId !== o.dataId),
        {
          dataId: o.dataId,
          label: o.description || t,
          accessType: c,
          enabled: !0
        }
      ], await this.sendDataBreakpoints(), this.publish(), { ok: !0, message: `Watching ${o.description || t}` };
    } catch (o) {
      return { ok: !1, message: o.message };
    }
  }
  async removeDataBreakpoint(t) {
    this.dataBreakpoints = this.dataBreakpoints.filter((e) => e.dataId !== t), await this.sendDataBreakpoints(), this.publish();
  }
  async sendDataBreakpoints() {
    const t = this.client;
    !(t != null && t.running) || !this.capabilities.supportsDataBreakpoints || await t.request("setDataBreakpoints", {
      breakpoints: this.dataBreakpoints.filter((e) => e.enabled).map((e) => ({
        dataId: e.dataId,
        accessType: e.accessType,
        ...e.condition ? { condition: e.condition } : {},
        ...e.hitCondition ? { hitCondition: e.hitCondition } : {}
      }))
    }).catch(() => {
    });
  }
  async onEvent(t, e) {
    if (this.client)
      switch (t) {
        case "initialized":
          await this.configure();
          return;
        case "stopped": {
          this.status = "paused", this.stopReason = (e == null ? void 0 : e.reason) ?? "pause", this.threadId = (e == null ? void 0 : e.threadId) ?? this.threadId, await this.clearRunToCursor(), await this.refreshStack(), this.events.onStopped(), this.publish();
          return;
        }
        case "continued":
          this.status = "running", this.frames = [], this.currentFrameId = null, this.publish();
          return;
        case "output":
          this.events.onOutput((e == null ? void 0 : e.output) ?? "", (e == null ? void 0 : e.category) ?? "console");
          return;
        case "terminated":
        case "exited": {
          this.status = "inactive", this.frames = [], this.threadId = null, this.currentFrameId = null, t === "exited" && typeof (e == null ? void 0 : e.exitCode) == "number" && this.events.onOutput(`
Process exited with code ${e.exitCode}
`, "console"), this.publish();
          return;
        }
        default:
          return;
      }
  }
  async refreshStack() {
    var e, n, i;
    const t = this.client;
    if (t != null && t.running)
      try {
        if (this.threadId === null) {
          const o = await t.request("threads");
          this.threadId = ((n = (e = o == null ? void 0 : o.threads) == null ? void 0 : e[0]) == null ? void 0 : n.id) ?? null;
        }
        if (this.threadId === null) return;
        const s = await t.request("stackTrace", {
          threadId: this.threadId,
          startFrame: 0,
          levels: 50
        });
        this.frames = ((s == null ? void 0 : s.stackFrames) ?? []).map((o) => {
          var a;
          return {
            id: o.id,
            name: o.name,
            file: ((a = o.source) == null ? void 0 : a.path) ?? "",
            line: o.line ?? 0,
            column: o.column ?? 1
          };
        }), this.currentFrameId = ((i = this.frames[0]) == null ? void 0 : i.id) ?? null;
      } catch {
        this.frames = [];
      }
  }
  /* ---------------- inspection ---------------- */
  async scopes(t) {
    var e;
    if (!((e = this.client) != null && e.running)) return [];
    try {
      const n = await this.client.request("scopes", { frameId: t });
      return ((n == null ? void 0 : n.scopes) ?? []).map((i) => ({
        name: i.name,
        variablesReference: i.variablesReference,
        expensive: !!i.expensive
      }));
    } catch {
      return [];
    }
  }
  async variables(t) {
    var e;
    if (!((e = this.client) != null && e.running)) return [];
    try {
      const n = await this.client.request("variables", { variablesReference: t });
      return ((n == null ? void 0 : n.variables) ?? []).map((i) => ({
        name: i.name,
        value: i.value ?? "",
        type: i.type ?? "",
        variablesReference: i.variablesReference ?? 0
      }));
    } catch {
      return [];
    }
  }
  /**
   * Writes a new value into a variable while paused.
   *
   * `setVariable` is the container-scoped form and works for locals and object
   * members; `setExpression` handles everything addressable by an expression.
   * Adapters implement one, the other, or both, so both are tried.
   */
  async setVariable(t, e, n) {
    var s;
    const i = this.client;
    if (!(i != null && i.running)) return { ok: !1, value: "", error: "Not running" };
    if (this.capabilities.supportsSetVariable && t)
      try {
        const o = await i.request("setVariable", { variablesReference: t, name: e, value: n });
        return this.publish(), { ok: !0, value: (o == null ? void 0 : o.value) ?? n, error: "" };
      } catch (o) {
        if (!this.capabilities.supportsSetExpression)
          return { ok: !1, value: "", error: o.message };
      }
    if (!this.capabilities.supportsSetExpression)
      return {
        ok: !1,
        value: "",
        error: `${((s = this.spec) == null ? void 0 : s.label) ?? "This adapter"} cannot change variables.`
      };
    try {
      const o = await i.request("setExpression", {
        expression: e,
        value: n,
        frameId: this.currentFrameId ?? void 0
      });
      return this.publish(), { ok: !0, value: (o == null ? void 0 : o.value) ?? n, error: "" };
    } catch (o) {
      return { ok: !1, value: "", error: o.message };
    }
  }
  /**
   * Run to Cursor: continue, but stop at `line` even without a breakpoint
   * there.
   *
   * Implemented as a one-shot breakpoint rather than DAP's `goto`, because
   * `goto` *skips* the intervening code — which is a different feature, and not
   * the one anybody means by Run to Cursor.
   */
  async runToLine(t, e) {
    var n;
    (n = this.client) != null && n.running && (this.runToCursor = { file: t, line: e }, await this.sendBreakpoints(t), this.publish(), await this.control("continue"));
  }
  /** Withdraws the temporary breakpoint once the program has stopped. */
  async clearRunToCursor() {
    const t = this.runToCursor;
    t && (this.runToCursor = null, await this.sendBreakpoints(t.file));
  }
  /** IntelliJ's Drop Frame: re-enter the selected frame from its first line. */
  async dropFrame(t) {
    var i;
    const e = this.client;
    if (!(e != null && e.running)) return { ok: !1, error: "Not running" };
    if (!this.capabilities.supportsRestartFrame)
      return { ok: !1, error: `${((i = this.spec) == null ? void 0 : i.label) ?? "This adapter"} cannot drop frames.` };
    const n = t ?? this.currentFrameId;
    if (n == null) return { ok: !1, error: "No frame selected" };
    try {
      return await e.request("restartFrame", { frameId: n }), { ok: !0, error: "" };
    } catch (s) {
      return { ok: !1, error: s.message };
    }
  }
  async evaluate(t, e, n = "watch") {
    var i;
    if (!((i = this.client) != null && i.running)) return { result: "", variablesReference: 0, error: "Not running" };
    try {
      const s = await this.client.request("evaluate", {
        expression: t,
        frameId: e ?? this.currentFrameId ?? void 0,
        context: n
      });
      return {
        result: (s == null ? void 0 : s.result) ?? "",
        type: (s == null ? void 0 : s.type) ?? "",
        variablesReference: (s == null ? void 0 : s.variablesReference) ?? 0,
        error: ""
      };
    } catch (s) {
      return { result: "", variablesReference: 0, error: s.message };
    }
  }
  selectFrame(t) {
    this.currentFrameId = t, this.publish();
  }
  /* ---------------- control ---------------- */
  async control(t, e) {
    var n;
    if ((n = this.client) != null && n.running)
      try {
        await this.client.request(t, e ?? { threadId: this.threadId }), t !== "pause" && (this.status = "running", this.publish());
      } catch (i) {
        this.events.onOutput(`${t}: ${i.message}
`, "stderr");
      }
  }
  continue_() {
    return this.control("continue");
  }
  next() {
    return this.control("next");
  }
  stepIn() {
    return this.control("stepIn");
  }
  stepOut() {
    return this.control("stepOut");
  }
  pause() {
    return this.control("pause");
  }
  stepBack() {
    return this.control("stepBack");
  }
  async restart() {
    var t;
    (t = this.client) != null && t.running && await this.client.request("restart").catch(() => {
    });
  }
  async stop() {
    const t = this.client;
    if (t) {
      this.client = null;
      try {
        await t.request("disconnect", { terminateDebuggee: !0 }, 3e3);
      } catch {
      }
      t.kill(), this.status = "inactive", this.frames = [], this.threadId = null, this.currentFrameId = null, this.runToCursor = null, this.dataBreakpoints = [], this.publish();
    }
  }
}
async function ul(r, t) {
  const { execFile: e } = await import("node:child_process"), { promisify: n } = await import("node:util");
  try {
    return await n(e)(r, ["-c", `import ${t}`], { env: we() }), !0;
  } catch {
    return !1;
  }
}
function dl(r) {
  const t = new ll({
    onState: (e) => r.broadcast("debug:state", e),
    onOutput: (e, n) => r.broadcast("debug:output", { text: e, category: n }),
    onStopped: () => r.broadcast("debug:stopped", {})
  });
  return g.handle("debug:detect", (e, n) => t.detect(n)), g.handle("debug:state", () => t.state()), g.handle("debug:launch", (e, n) => t.launch(n)), g.handle("debug:stop", () => t.stop()), g.handle("debug:restart", () => t.restart()), g.handle(
    "debug:toggleBreakpoint",
    (e, n, i) => t.toggleBreakpoint(n, i)
  ), g.handle("debug:clearBreakpoints", () => t.clearBreakpoints()), g.handle(
    "debug:updateBreakpoint",
    (e, n, i, s) => t.updateBreakpoint(n, i, s)
  ), g.handle("debug:setRoot", (e, n) => t.setProjectRoot(n)), g.handle("debug:continue", () => t.continue_()), g.handle("debug:next", () => t.next()), g.handle("debug:stepIn", () => t.stepIn()), g.handle("debug:stepOut", () => t.stepOut()), g.handle("debug:pause", () => t.pause()), g.handle("debug:stepBack", () => t.stepBack()), g.handle("debug:runToLine", (e, n, i) => t.runToLine(n, i)), g.handle("debug:dropFrame", (e, n) => t.dropFrame(n)), g.handle(
    "debug:setExceptionBreakpoint",
    (e, n, i) => t.setExceptionBreakpoint(n, i)
  ), g.handle(
    "debug:addDataBreakpoint",
    (e, n, i, s) => t.addDataBreakpoint(n, i, s)
  ), g.handle(
    "debug:removeDataBreakpoint",
    (e, n) => t.removeDataBreakpoint(n)
  ), g.handle(
    "debug:setVariable",
    (e, n, i, s) => t.setVariable(n, i, s)
  ), g.handle("debug:scopes", (e, n) => t.scopes(n)), g.handle("debug:variables", (e, n) => t.variables(n)), g.handle("debug:selectFrame", (e, n) => t.selectFrame(n)), g.handle(
    "debug:evaluate",
    (e, n, i, s) => t.evaluate(n, i, s)
  ), { dispose: () => t.stop() };
}
const Zn = he(de), fl = 2 * 60 * 1e3;
class pl {
  constructor(t) {
    H(this, "loaded", /* @__PURE__ */ new Map());
    /**
     * In-flight command calls. The owning plugin is recorded alongside each one:
     * ids are handed out globally, so without this check a plugin could resolve a
     * *different* plugin's pending command with a value of its choosing.
     */
    H(this, "pendingCommands", /* @__PURE__ */ new Map());
    H(this, "viewHtml", /* @__PURE__ */ new Map());
    H(this, "nextCommandId", 1);
    this.ctx = t;
  }
  /** Loads every enabled plugin, replacing whatever is currently running. */
  async start(t) {
    await this.stop();
    for (const e of t.filter((n) => n.enabled))
      try {
        await this.load(e);
      } catch (n) {
        this.log(e.manifest.id, "error", n instanceof Error ? n.message : String(n));
      }
  }
  async stop() {
    for (const t of Array.from(this.loaded.keys())) this.killChild(t);
    this.loaded.clear(), this.viewHtml.clear();
    for (const { reject: t } of this.pendingCommands.values()) t(new Error("Plugin host stopped."));
    this.pendingCommands.clear();
  }
  killChild(t) {
    const e = this.loaded.get(t);
    e && (e.child.removeAllListeners(), e.child.kill());
  }
  runtimeStates() {
    return Array.from(this.loaded.values()).map((t) => t.runtime);
  }
  getViewHtml(t, e) {
    return this.viewHtml.get(`${t}:${e}`) ?? "";
  }
  /** Every command currently registered, namespaced for the palette. */
  commands() {
    const t = [];
    for (const { plugin: e, runtime: n } of this.loaded.values())
      for (const i of n.commands)
        t.push({
          pluginId: e.manifest.id,
          commandId: i.id,
          title: i.title,
          category: i.category || e.manifest.name
        });
    return t;
  }
  async load(t) {
    var i, s;
    const e = t.manifest;
    this.loaded.has(e.id) && await this.unload(e.id);
    const n = await this.spawnFor(e.id);
    this.loaded.set(e.id, {
      plugin: t,
      child: n,
      runtime: {
        pluginId: e.id,
        commands: ((i = e.contributes) == null ? void 0 : i.commands) ?? [],
        views: ((s = e.contributes) == null ? void 0 : s.views) ?? [],
        statusBar: []
      }
    }), n.send({
      t: "load",
      plugin: {
        id: e.id,
        dir: t.dir,
        main: e.main ? y.join(t.dir, e.main) : null,
        permissions: t.grantedPermissions
      }
    });
  }
  async unload(t) {
    const e = this.loaded.get(t);
    e && (e.child.send({ t: "dispose", pluginId: t }), await new Promise((n) => setTimeout(n, 100)), this.killChild(t)), this.loaded.delete(t);
    for (const n of Array.from(this.viewHtml.keys()))
      n.startsWith(`${t}:`) && this.viewHtml.delete(n);
    this.emitRuntime();
  }
  /** Invokes a plugin command and resolves with whatever the handler returned. */
  invoke(t, e, n) {
    const i = this.loaded.get(t);
    if (!i) return Promise.reject(new Error(`${t} is not loaded.`));
    const s = `c${this.nextCommandId++}`;
    return new Promise((o, a) => {
      this.pendingCommands.set(s, { pluginId: t, resolve: o, reject: a }), i.child.send({ t: "command", id: s, pluginId: t, commandId: e, args: n }), setTimeout(() => {
        this.pendingCommands.delete(s) && a(new Error(`Command "${e}" timed out after 60s.`));
      }, 6e4);
    });
  }
  /**
   * Forks a host dedicated to one plugin.
   *
   * The plugin id is captured here, from the caller, and every message this
   * child sends is attributed to it. Nothing the child says can change that —
   * which is the whole point.
   */
  spawnFor(t) {
    return new Promise((e, n) => {
      var a, c, u, f;
      const i = da(hl(), [], {
        // Electron's own binary is the Node runtime; this switch makes it behave
        // as plain Node rather than booting a second app instance.
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          NOVA_PLUGIN_HOST: "1",
          NOVA_PLUGIN_ID: t
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        execPath: process.execPath
      });
      let s = !1;
      const o = (d) => {
        s || (s = !0, d ? n(d) : e(i));
      };
      i.on("message", (d) => {
        const p = d;
        if ((p == null ? void 0 : p.t) === "ready") return o();
        this.onHostMessage(t, i, p);
      }), (a = i.stdout) == null || a.setEncoding("utf8"), (c = i.stdout) == null || c.on("data", (d) => this.log(t, "info", d.trimEnd())), (u = i.stderr) == null || u.setEncoding("utf8"), (f = i.stderr) == null || f.on("data", (d) => this.log(t, "error", d.trimEnd())), i.on("error", (d) => {
        this.log(t, "error", `Host failed to start: ${d.message}`), o(d);
      }), i.on("exit", (d, p) => {
        var m;
        ((m = this.loaded.get(t)) == null ? void 0 : m.child) === i && (this.loaded.delete(t), this.log(t, "error", `Plugin host exited unexpectedly (code ${d}, signal ${p}).`), this.emitRuntime()), o(new Error("The plugin host exited before it was ready."));
      }), setTimeout(() => o(new Error("Plugin host did not start within 15s.")), 15e3);
    });
  }
  /**
   * Handles one message from a plugin's host.
   *
   * `pluginId` is the identity of the *channel*, not anything the message
   * claims. Any `pluginId` field inside the payload is ignored.
   */
  async onHostMessage(t, e, n) {
    switch (n.t) {
      case "log":
        this.log(t, n.level, n.text);
        break;
      case "loaded":
        this.emitRuntime();
        break;
      case "load-error":
        this.log(t, "error", n.error), this.ctx.broadcast("plugins:loadError", { pluginId: t, error: n.error });
        break;
      case "result": {
        const i = this.pendingCommands.get(n.id);
        if (!i || i.pluginId !== t) return;
        this.pendingCommands.delete(n.id), n.ok ? i.resolve(n.value) : i.reject(new Error(n.error || "The command failed."));
        break;
      }
      case "rpc": {
        try {
          const i = await this.handleRpc(t, n.method, n.params);
          e.send({ t: "rpc-result", id: n.id, ok: !0, value: i ?? null });
        } catch (i) {
          e.send({
            t: "rpc-result",
            id: n.id,
            ok: !1,
            error: i instanceof Error ? i.message : String(i)
          });
        }
        break;
      }
    }
  }
  /**
   * Fulfils one plugin API call.
   *
   * Every branch that touches the disk resolves the path against the workspace
   * root first. A plugin granted `workspace:read` is granted it for the open
   * project, not for the user's home directory.
   */
  async handleRpc(t, e, n) {
    const i = this.loaded.get(t);
    if (!i) throw new Error(`${t} is not loaded.`);
    const s = new Set(i.plugin.grantedPermissions), o = (c) => {
      if (!s.has(c))
        throw new Error(`"${c}" permission has not been granted to ${t}.`);
    }, a = () => {
      const c = this.ctx.getWorkspaceRoot();
      if (!c) throw new Error("No project is open.");
      return c;
    };
    switch (e) {
      case "workspace.root":
        return this.ctx.getWorkspaceRoot();
      case "workspace.readFile":
        return o("workspace:read"), v.readFile(this.resolveInWorkspace(a(), String(n.file)), "utf8");
      case "workspace.writeFile": {
        o("workspace:write");
        const c = this.resolveInWorkspace(a(), String(n.file));
        return await v.mkdir(y.dirname(c), { recursive: !0 }), await v.writeFile(c, String(n.content ?? ""), "utf8"), this.ctx.broadcast("fs:changed", { path: c }), null;
      }
      case "workspace.list": {
        o("workspace:read");
        const c = this.resolveInWorkspace(a(), String(n.dir ?? "."));
        return (await v.readdir(c, { withFileTypes: !0 })).map((f) => ({
          name: f.name,
          path: y.join(c, f.name),
          isDirectory: f.isDirectory()
        }));
      }
      case "workspace.findFiles":
      case "workspace.search":
      case "editor.activeFile":
      case "editor.selection":
      case "editor.applyEdit":
      case "editor.open":
      case "ui.showMessage":
      case "ui.prompt":
      case "commands.execute":
        return e.startsWith("editor.") && o("editor"), e.startsWith("ui.") && o("ui"), e.startsWith("workspace.") && o("workspace:read"), this.ctx.askRenderer(e, { pluginId: t, ...n });
      case "ui.setViewHtml": {
        o("ui");
        const c = String(n.viewId);
        if (!i.runtime.views.some((f) => f.id === c)) throw new Error(`View "${c}" is not declared in contributes.views.`);
        return this.viewHtml.set(`${t}:${c}`, String(n.html ?? "")), this.ctx.broadcast("plugins:viewHtml", { pluginId: t, viewId: c, html: n.html ?? "" }), null;
      }
      case "ui.setStatusBarItem": {
        o("ui");
        const c = String(n.id), u = n.item ?? {}, f = i.runtime.statusBar.filter((d) => d.id !== c);
        return u.text && f.push({ id: c, text: u.text, tooltip: u.tooltip, command: u.command }), i.runtime.statusBar = f, this.emitRuntime(), null;
      }
      case "git.status": {
        o("git");
        const { stdout: c } = await Zn("git", ["status", "--porcelain=v1", "-b"], { cwd: a() });
        return c;
      }
      case "git.log": {
        o("git");
        const c = Math.min(Number(n.limit) || 50, 500), { stdout: u } = await Zn("git", ["log", `-${c}`, "--pretty=format:%H%x00%an%x00%ad%x00%s"], {
          cwd: a()
        });
        return u.split(`
`).filter(Boolean).map((f) => {
          const [d, p, m, w] = f.split("\0");
          return { hash: d, author: p, date: m, subject: w };
        });
      }
      case "shell.exec": {
        o("shell");
        const c = String(n.command ?? "");
        if (!c.trim()) throw new Error("shell.exec needs a command.");
        const u = n.options ?? {}, f = u.cwd ? this.resolveInWorkspace(a(), u.cwd) : a();
        try {
          const { stdout: d, stderr: p } = await Zn("/bin/sh", ["-lc", c], {
            cwd: f,
            timeout: fl,
            maxBuffer: 16777216
          });
          return { ok: !0, stdout: d, stderr: p };
        } catch (d) {
          const p = d;
          return { ok: !1, stdout: p.stdout ?? "", stderr: p.stderr ?? p.message ?? "" };
        }
      }
      case "storage.get":
        return (await this.readStorage(t))[String(n.key)] ?? null;
      case "storage.set": {
        const c = await this.readStorage(t);
        return c[String(n.key)] = n.value, await this.writeStorage(t, c), null;
      }
      case "secrets.get":
        return o("secrets"), (await this.readStorage(t, "secrets"))[String(n.key)] ?? null;
      case "secrets.set": {
        o("secrets");
        const c = await this.readStorage(t, "secrets");
        return c[String(n.key)] = n.value, await this.writeStorage(t, c, "secrets"), null;
      }
      default:
        throw new Error(`Unknown plugin API method "${e}".`);
    }
  }
  /**
   * Resolves a plugin-supplied path and refuses anything outside the project.
   *
   * `path.resolve` collapses `..` before the check, so a traversal attempt fails
   * here rather than reaching the filesystem.
   */
  resolveInWorkspace(t, e) {
    const n = y.resolve(t, e), i = y.relative(t, n);
    if (i.startsWith("..") || y.isAbsolute(i))
      throw new Error(`Path "${e}" is outside the open project.`);
    return n;
  }
  storageFile(t, e = "storage") {
    return y.join(ee.getPath("userData"), "plugin-data", `${t}.${e}.json`);
  }
  async readStorage(t, e = "storage") {
    try {
      return JSON.parse(await v.readFile(this.storageFile(t, e), "utf8"));
    } catch {
      return {};
    }
  }
  async writeStorage(t, e, n = "storage") {
    const i = this.storageFile(t, n);
    await v.mkdir(y.dirname(i), { recursive: !0 }), await v.writeFile(i, JSON.stringify(e, null, 2), "utf8"), n === "secrets" && await v.chmod(i, 384).catch(() => {
    });
  }
  emitRuntime() {
    this.ctx.broadcast("plugins:runtime", this.runtimeStates());
  }
  log(t, e, n) {
    if (!n) return;
    const i = { pluginId: t, level: e, text: n, at: Date.now() };
    this.ctx.broadcast("plugins:log", i);
  }
}
function hl() {
  const r = y.dirname(jr(import.meta.url)), t = process.env.APP_ROOT ?? y.join(r, ".."), e = [
    y.join(r, "plugin-host", "host.mjs"),
    y.join(t, "dist-electron", "plugin-host", "host.mjs"),
    y.join(t, "electron", "plugin-host", "host.mjs")
  ];
  return e.find((n) => js(n)) ?? e[0];
}
const ml = [
  { id: "workspace:read", label: "Read workspace files", detail: "List and read any file in the open project." },
  { id: "workspace:write", label: "Modify workspace files", detail: "Create, edit and delete files in the open project." },
  { id: "editor", label: "Editor access", detail: "Read the active selection and apply edits to open buffers." },
  { id: "ui", label: "Contribute UI", detail: "Add views, status-bar items, commands and notifications." },
  { id: "shell", label: "Run commands", detail: "Execute processes on your machine." },
  { id: "net", label: "Network access", detail: "Make outbound network requests." },
  { id: "git", label: "Git access", detail: "Read repository history and status." },
  { id: "secrets", label: "Secret storage", detail: "Store and read its own credentials." }
];
function gl(r) {
  return typeof r == "string" && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(r) && r.length <= 128;
}
function yl(r) {
  var s;
  const t = [];
  if (!r || typeof r != "object") return { errors: ["nova-plugin.json is not a JSON object."] };
  const e = r;
  if (gl(e.id) || t.push('`id` must be a dot/dash/underscore separated identifier, e.g. "dev.nova.hello".'), (typeof e.name != "string" || !e.name.trim()) && t.push("`name` is required."), (typeof e.version != "string" || !/^\d+\.\d+\.\d+/.test(e.version)) && t.push('`version` must be semver, e.g. "1.0.0".'), e.main !== void 0 && (typeof e.main != "string" || gi(e.main)) && t.push("`main` must be a path inside the plugin directory."), e.build !== void 0 && typeof e.build != "string" && t.push("`build` must be a string."), e.permissions !== void 0)
    if (!Array.isArray(e.permissions)) t.push("`permissions` must be an array.");
    else {
      const o = new Set(ml.map((a) => a.id));
      for (const a of e.permissions)
        o.has(a) || t.push(`Unknown permission "${String(a)}".`);
    }
  const n = e.contributes;
  if (n !== void 0)
    if (typeof n != "object" || n === null)
      t.push("`contributes` must be an object.");
    else {
      for (const o of n.commands ?? [])
        if (!o || typeof o.id != "string" || typeof o.title != "string") {
          t.push("Each `contributes.commands` entry needs an `id` and a `title`.");
          break;
        }
      for (const o of n.views ?? [])
        if (!o || typeof o.id != "string" || o.location !== "sidebar" && o.location !== "panel") {
          t.push('Each `contributes.views` entry needs an `id` and a `location` of "sidebar" or "panel".');
          break;
        }
      for (const o of n.mcpServers ?? []) {
        if (!o || typeof o.name != "string" || typeof o.command != "string") {
          t.push("Each `contributes.mcpServers` entry needs a `name` and a `command`.");
          break;
        }
        o.cwd && gi(o.cwd) && t.push(`MCP server "${o.name}" has a \`cwd\` outside the plugin directory.`);
      }
    }
  const i = Array.isArray(e.permissions) ? e.permissions : [];
  return (((s = n == null ? void 0 : n.mcpServers) == null ? void 0 : s.length) ?? 0) > 0 && !i.includes("shell") && t.push('Declaring `contributes.mcpServers` requires the "shell" permission.'), t.length ? { errors: t } : { manifest: r, errors: [] };
}
function gi(r) {
  return r.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(r) ? !0 : r.split(/[\\/]/).includes("..");
}
const mt = he(de), Ct = "nova-plugin.json", yi = 10 * 60 * 1e3, Qs = 5 * 60 * 1e3;
function Qe() {
  return y.join(ee.getPath("userData"), "plugins");
}
function eo() {
  return y.join(Qe(), "registry.json");
}
async function Mr() {
  try {
    const r = JSON.parse(await v.readFile(eo(), "utf8"));
    return !r || !Array.isArray(r.plugins) ? { plugins: [] } : r;
  } catch {
    return { plugins: [] };
  }
}
async function Lr(r) {
  await v.mkdir(Qe(), { recursive: !0 }), await v.writeFile(eo(), JSON.stringify(r, null, 2), "utf8");
}
async function Ve() {
  const r = await Mr(), t = [];
  let e = !1;
  for (const n of r.plugins)
    await io(y.join(n.dir, Ct)) ? t.push(n) : e = !0;
  return e && await Lr({ plugins: t }), t;
}
async function bt(r) {
  return (await Ve()).find((t) => t.manifest.id === r);
}
async function Pt(r) {
  const t = await Mr(), e = t.plugins.findIndex((n) => n.manifest.id === r.manifest.id);
  e === -1 ? t.plugins.push(r) : t.plugins[e] = r, await Lr(t);
}
async function wl(r, t) {
  const e = await bt(r);
  if (e)
    return e.enabled = t, e.status = t ? "active" : "disabled", t && delete e.error, await Pt(e), e;
}
async function bl(r, t) {
  const e = await bt(r);
  e && (e.status = "error", e.error = t, await Pt(e));
}
async function vl(r) {
  const t = await Mr(), e = t.plugins.find((n) => n.manifest.id === r);
  t.plugins = t.plugins.filter((n) => n.manifest.id !== r), await Lr(t), e && El(Qe(), e.dir) && await v.rm(e.dir, { recursive: !0, force: !0 });
}
async function kl(r) {
  const { url: t, ref: e, onProgress: n } = r, i = (o, a, c) => n == null ? void 0 : n({ url: t, stage: o, message: a, pluginId: c });
  _l(t), await v.mkdir(Qe(), { recursive: !0 });
  const s = y.join(Qe(), `.staging-${Date.now().toString(36)}`);
  await v.rm(s, { recursive: !0, force: !0 });
  try {
    i("cloning", `Cloning ${t}…`);
    const o = ["clone", "--depth", "1", "--single-branch"];
    e && o.push("--branch", e), o.push("--", t, s), await mt("git", o, {
      timeout: Qs,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        // Never let a clone block the app waiting for a credential prompt.
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo"
      }
    }), i("validating", "Reading nova-plugin.json…");
    const a = await to(s), c = await ro(s), u = y.join(Qe(), a.id), f = await bt(a.id);
    if (f && !r.force)
      throw new Error(
        `${a.name} (${a.id}) is already installed. Use Update to pull the latest commit, or reinstall to replace it.`
      );
    await v.rm(u, { recursive: !0, force: !0 }), await v.rename(s, u), a.build && (i("building", `Running: ${a.build}`, a.id), await no(u, a.build));
    const p = {
      manifest: a,
      source: { kind: "git", url: t, ref: e, commit: c },
      dir: u,
      enabled: !0,
      status: "active",
      installedAt: (f == null ? void 0 : f.installedAt) ?? Date.now(),
      updatedAt: Date.now(),
      // Never grant more than the manifest asks for, even if the caller says so.
      grantedPermissions: (r.grantedPermissions ?? a.permissions ?? []).filter(
        (m) => (a.permissions ?? []).includes(m)
      )
    };
    return await Pt(p), i("done", `Installed ${a.name} ${a.version}`, a.id), p;
  } catch (o) {
    await v.rm(s, { recursive: !0, force: !0 });
    const a = so(o);
    throw i("error", a), new Error(a);
  }
}
async function Sl(r, t) {
  const e = await bt(r);
  if (!e) throw new Error(`${r} is not installed.`);
  if (e.source.kind !== "git") throw new Error(`${r} was not installed from git.`);
  const n = (a, c) => t == null ? void 0 : t({ url: e.source.url, stage: a, message: c, pluginId: r });
  n("cloning", "Fetching latest…"), await mt("git", ["fetch", "--depth", "1", "origin"], {
    cwd: e.dir,
    timeout: Qs,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  });
  const i = e.source.ref || await Al(e.dir);
  await mt("git", ["reset", "--hard", `origin/${i}`], { cwd: e.dir }), n("validating", "Re-reading manifest…");
  const s = await to(e.dir);
  if (s.id !== r)
    throw new Error(`The updated repository declares id "${s.id}", not "${r}". Uninstall and reinstall it.`);
  s.build && (n("building", `Running: ${s.build}`), await no(e.dir, s.build));
  const o = {
    ...e,
    manifest: s,
    source: { ...e.source, commit: await ro(e.dir) },
    updatedAt: Date.now(),
    status: e.enabled ? "active" : "disabled",
    // A new version may ask for more than the user previously approved. Keep the
    // old grant set; anything newly requested stays ungranted until re-approved.
    grantedPermissions: e.grantedPermissions.filter((a) => (s.permissions ?? []).includes(a))
  };
  return delete o.error, await Pt(o), n("done", `Updated to ${s.version}`), o;
}
async function xl(r, t) {
  const e = await bt(r);
  if (!e) return;
  const n = e.manifest.permissions ?? [];
  e.grantedPermissions = Array.from(
    /* @__PURE__ */ new Set([...e.grantedPermissions, ...t.filter((i) => n.includes(i))])
  ), await Pt(e);
}
async function to(r) {
  const t = y.join(r, Ct);
  let e;
  try {
    e = JSON.parse(await v.readFile(t, "utf8"));
  } catch (s) {
    throw s.code === "ENOENT" ? new Error(`No ${Ct} at the repository root. Nova plugins must have one.`) : new Error(`${Ct} is not valid JSON: ${so(s)}`);
  }
  const { manifest: n, errors: i } = yl(e);
  if (!n) throw new Error(`${Ct} is invalid:
${i.map((s) => `  • ${s}`).join(`
`)}`);
  if (n.main && !await io(y.join(r, n.main)))
    throw new Error(`\`main\` points at ${n.main}, which does not exist in the repository.`);
  return n;
}
async function no(r, t) {
  const e = process.platform === "win32" ? "cmd" : "/bin/sh", n = process.platform === "win32" ? ["/c", t] : ["-lc", t];
  try {
    await mt(e, n, {
      cwd: r,
      timeout: yi,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, CI: "1", npm_config_yes: "true" }
    });
  } catch (i) {
    const s = i;
    throw s.killed ? new Error(`Build timed out after ${yi / 6e4} minutes: ${t}`) : new Error(`Build failed (${t}):
${(s.stderr || s.stdout || "").slice(-4e3)}`);
  }
}
async function ro(r) {
  try {
    const { stdout: t } = await mt("git", ["rev-parse", "HEAD"], { cwd: r });
    return t.trim();
  } catch {
    return "";
  }
}
async function Al(r) {
  try {
    const { stdout: t } = await mt("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: r }), e = t.trim();
    return e && e !== "HEAD" ? e : "HEAD";
  } catch {
    return "HEAD";
  }
}
function _l(r) {
  const t = r.trim();
  if (!t) throw new Error("Enter a git repository URL.");
  if (t.startsWith("-")) throw new Error("That does not look like a repository URL.");
  if (/^ext::/i.test(t)) throw new Error("`ext::` git URLs are not allowed: they run arbitrary commands.");
  if (/--upload-pack|--receive-pack|--config|-c\s/i.test(t))
    throw new Error("That URL contains git options, which are not allowed.");
  if (!/^(https?:\/\/|git:\/\/|ssh:\/\/|file:\/\/|git@[\w.-]+:)/i.test(t))
    throw new Error("Use an https://, ssh://, file:// or git@host:path repository URL.");
}
function El(r, t) {
  const e = y.relative(r, t);
  return !!e && !e.startsWith("..") && !y.isAbsolute(e);
}
async function io(r) {
  try {
    return await v.access(r), !0;
  } catch {
    return !1;
  }
}
function so(r) {
  const t = r;
  return (t.stderr || t.message || String(r)).trim();
}
const sn = /* @__PURE__ */ new Map();
let Cl = 1;
function Tl(r) {
  let t = null;
  const e = new pl({
    broadcast: r.broadcast,
    getWorkspaceRoot: () => t,
    askRenderer: n
  });
  function n(o, a) {
    const c = _n.getAllWindows().find((f) => !f.isDestroyed());
    if (!c) return Promise.reject(new Error("No editor window is open."));
    const u = `ask${Cl++}`;
    return new Promise((f, d) => {
      sn.set(u, { resolve: f, reject: d }), c.webContents.send("plugins:ask", { id: u, question: o, params: a }), setTimeout(() => {
        sn.delete(u) && d(new Error(`The editor did not answer "${o}" in time.`));
      }, 2e4);
    });
  }
  g.on("plugins:answer", (o, a) => {
    const c = sn.get(a.id);
    c && (sn.delete(a.id), a.ok ? c.resolve(a.value) : c.reject(new Error(a.error || "The editor rejected the request.")));
  }), g.handle("plugins:setRoot", (o, a) => {
    t = a;
  }), g.handle("plugins:list", () => Ve()), g.handle("plugins:dir", () => Qe()), g.handle(
    "plugins:install",
    async (o, a, c) => {
      const u = (d) => r.broadcast("plugins:install-progress", d), f = await kl({
        url: a,
        ref: c == null ? void 0 : c.ref,
        grantedPermissions: c == null ? void 0 : c.permissions,
        force: c == null ? void 0 : c.force,
        onProgress: u
      });
      try {
        u({ url: a, stage: "loading", message: "Activating…", pluginId: f.manifest.id }), await e.load(f);
      } catch (d) {
        const p = d instanceof Error ? d.message : String(d);
        await bl(f.manifest.id, p), u({ url: a, stage: "error", message: p, pluginId: f.manifest.id });
      }
      return await i(), f;
    }
  ), g.handle("plugins:update", async (o, a) => {
    const c = await Sl(a, (u) => r.broadcast("plugins:install-progress", u));
    return await e.unload(a), c.enabled && await e.load(c), await i(), c;
  }), g.handle("plugins:setEnabled", async (o, a, c) => {
    const u = await wl(a, c);
    return u ? (c ? await e.load(u) : await e.unload(a), await i(), u) : null;
  }), g.handle("plugins:uninstall", async (o, a) => {
    await e.unload(a), await vl(a), await i();
  }), g.handle("plugins:grant", async (o, a, c) => {
    await xl(a, c);
    const u = await bt(a);
    return u != null && u.enabled && (await e.unload(a), await e.load(u)), await i(), u ?? null;
  }), g.handle(
    "plugins:invoke",
    (o, a, c, u) => e.invoke(a, c, u)
  ), g.handle("plugins:runtime", () => e.runtimeStates()), g.handle(
    "plugins:viewHtml",
    (o, a, c) => e.getViewHtml(a, c)
  ), g.handle("plugins:commands", () => e.commands()), g.handle("plugins:mcpServers", async () => Jr(await Ve()).map((a) => ({
    key: a.key,
    pluginId: a.pluginId,
    pluginName: a.pluginName,
    name: a.contribution.name,
    description: a.contribution.description ?? "",
    command: a.command,
    args: a.args
  })));
  async function i() {
    r.broadcast("plugins:list", await Ve());
  }
  async function s() {
    try {
      await e.start(await Ve()), await i();
    } catch (o) {
      r.broadcast("plugins:log", {
        pluginId: "host",
        level: "error",
        text: o instanceof Error ? o.message : String(o),
        at: Date.now()
      });
    }
  }
  return {
    start: s,
    dispose: () => e.stop(),
    /** Used by the AI console to attach plugin MCP servers to a run. */
    mcpServers: async () => Jr(await Ve()),
    listPlugins: Ve
  };
}
const $l = /* @__PURE__ */ new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT"
]), Ol = {
  GRAPHQL: "graphql",
  GRPC: "grpc",
  WEBSOCKET: "websocket",
  WS: "websocket",
  SSE: "sse"
};
function jl(r) {
  let t = r, e, n;
  for (const [i, s] of [
    ["<", (o) => e = o],
    [">", (o) => n = o]
  ]) {
    const o = new RegExp(`^[ \\t]*\\${i}\\s*\\{%`, "m").exec(t);
    if (!o) continue;
    const a = o.index + o[0].length, c = t.indexOf("%}", a);
    c !== -1 && (s(t.slice(a, c).trim()), t = `${t.slice(0, o.index)}${t.slice(c + 2)}`);
  }
  return { body: t.replace(/\s+$/, ""), preScript: e, postScript: n };
}
function Dt(r) {
  const t = r.split(/\r?\n/), e = [], n = {}, i = [];
  let s = null, o = { initialMessages: [] };
  const a = () => {
    if (!s) return;
    if (!s.method) {
      s = null;
      return;
    }
    const c = s.bodyLines.join(`
`).replace(/\s+$/, ""), { body: u, preScript: f, postScript: d } = jl(c);
    e.push({
      id: `req-${e.length}`,
      name: s.name || `${s.method} ${Ul(s.url)}`,
      protocol: s.protocol,
      method: s.method,
      url: s.url,
      headers: s.headers,
      body: Ll(s.protocol, u, i, s.line),
      preScript: f,
      postScript: d,
      dataPath: s.dataPath,
      specPath: s.specPath,
      auth: s.auth,
      line: s.line,
      timeoutMs: s.timeoutMs,
      followRedirects: s.followRedirects,
      useCookies: s.useCookies,
      grpcMethod: s.grpcMethod,
      protoPath: s.protoPath,
      initialMessages: s.initialMessages
    }), s = null;
  };
  for (let c = 0; c < t.length; c++) {
    const u = t[c], f = u.trim();
    if (f.startsWith("###")) {
      a(), o = { initialMessages: [] };
      const p = f.replace(/^#+/, "").trim();
      p && (o.name = p);
      continue;
    }
    if (!(s != null && s.inBody) && /^(#|\/\/)\s*@/.test(f)) {
      const p = f.replace(/^(#|\/\/)\s*@/, "");
      Il(p, c + 1, s ?? o, i);
      continue;
    }
    if (!(s != null && s.inBody) && (f.startsWith("//") || f.startsWith("#"))) continue;
    if (!s && f.startsWith("@")) {
      const p = /^@([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(f);
      p ? n[p[1]] = p[2].trim() : i.push(`Line ${c + 1}: could not read variable declaration.`);
      continue;
    }
    if (!s) {
      if (!f) continue;
      const p = Fl(f);
      if (!p) {
        i.push(`Line ${c + 1}: expected a request like \`GET https://example.com\`.`);
        continue;
      }
      s = {
        name: o.name ?? "",
        line: c + 1,
        protocol: p.protocol,
        method: p.method,
        url: p.url,
        grpcMethod: p.grpcMethod,
        headers: [],
        bodyLines: [],
        inBody: !1,
        // Directives written above the request line configure it, and are
        // the usual place to put them.
        auth: o.auth ?? { kind: "none" },
        timeoutMs: o.timeoutMs,
        followRedirects: o.followRedirects ?? !0,
        useCookies: o.useCookies ?? !0,
        protoPath: o.protoPath,
        dataPath: o.dataPath,
        specPath: o.specPath,
        initialMessages: [...o.initialMessages]
      }, o = { initialMessages: [] };
      continue;
    }
    if (s.inBody) {
      s.bodyLines.push(u);
      continue;
    }
    if (!f) {
      s.inBody = !0;
      continue;
    }
    if (f.startsWith("?") || f.startsWith("&")) {
      s.url += f;
      continue;
    }
    const d = f.indexOf(":");
    if (d === -1) {
      i.push(`Line ${c + 1}: expected \`Header: value\`.`);
      continue;
    }
    s.headers.push({
      name: f.slice(0, d).trim(),
      value: f.slice(d + 1).trim()
    });
  }
  return a(), { requests: e, variables: n, errors: i };
}
function Il(r, t, e, n) {
  const i = r.search(/\s/), s = (i === -1 ? r : r.slice(0, i)).toLowerCase(), o = i === -1 ? "" : r.slice(i + 1).trim();
  switch (s) {
    case "name":
      e.name = o;
      return;
    case "auth": {
      const a = Nl(o);
      a ? e.auth = a : n.push(`Line ${t}: could not read \`@auth ${o}\`.`);
      return;
    }
    case "timeout": {
      const a = Number(o);
      if (!Number.isFinite(a) || a <= 0) {
        n.push(`Line ${t}: \`@timeout\` needs a positive number of milliseconds.`);
        return;
      }
      e.timeoutMs = a;
      return;
    }
    case "no-redirect":
      e.followRedirects = !1;
      return;
    case "no-cookies":
      e.useCookies = !1;
      return;
    case "proto":
      e.protoPath = o;
      return;
    case "data":
      e.dataPath = o;
      return;
    case "spec":
      e.specPath = o;
      return;
    case "send":
      e.initialMessages.push(o);
      return;
    default:
      return;
  }
}
function Nl(r) {
  const t = Rl(r), e = (t[0] ?? "").toLowerCase();
  if (e === "none") return { kind: "none" };
  if (e === "basic")
    return t.length < 3 ? null : { kind: "basic", username: t[1], password: t.slice(2).join(" ") };
  if (e === "bearer")
    return t.length < 2 ? null : { kind: "bearer", token: t.slice(1).join(" ") };
  if (e === "apikey") {
    const n = (t[1] ?? "").toLowerCase();
    return n !== "header" && n !== "query" || t.length < 4 ? null : { kind: "apikey", in: n, name: t[2], value: t.slice(3).join(" ") };
  }
  if (e === "oauth2") {
    const n = Ml(t.slice(1)), i = n.grant === "password" ? "password" : "client_credentials", s = n.token_url ?? n.tokenurl ?? "";
    return s ? {
      kind: "oauth2",
      grant: i,
      tokenUrl: s,
      clientId: n.client_id ?? "",
      clientSecret: n.client_secret ?? "",
      username: n.username,
      password: n.password,
      scope: n.scope,
      clientAuth: n.client_auth === "body" ? "body" : "header"
    } : null;
  }
  return null;
}
function Rl(r) {
  const t = [], e = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let n;
  for (; n = e.exec(r); ) t.push(n[1] ?? n[2] ?? n[3]);
  return t;
}
function Ml(r) {
  const t = {};
  for (const e of r) {
    const n = e.indexOf("=");
    n > 0 && (t[e.slice(0, n).toLowerCase()] = e.slice(n + 1));
  }
  return t;
}
function Ll(r, t, e, n) {
  const i = t.trim();
  if (r === "graphql") return Pl(t);
  if (!i) return { kind: "none" };
  const s = /^<\s*(\S.*)$/.exec(i);
  return s && !i.includes(`
`) ? { kind: "file", path: s[1].trim() } : i.startsWith("--form") ? Dl(t, e, n) : { kind: "text", text: t.replace(/^\n+/, "") };
}
function Pl(r) {
  const t = /^\s*--variables\s*$/m.exec(r), e = (t ? r.slice(0, t.index) : r).trim(), n = t ? r.slice(t.index + t[0].length).trim() : "", i = /^\s*(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/m.exec(e);
  return {
    kind: "graphql",
    query: e,
    variables: n || "{}",
    operationName: i == null ? void 0 : i[1]
  };
}
function Dl(r, t, e) {
  const n = [];
  let i = null;
  for (const o of r.split(/\r?\n/)) {
    const a = o.trim();
    if (!a) continue;
    if (a.startsWith("--form")) {
      i && n.push(i), i = { name: "" };
      continue;
    }
    if (!i) continue;
    const c = a.indexOf(":");
    if (c === -1) continue;
    const u = a.slice(0, c).trim().toLowerCase(), f = a.slice(c + 1).trim();
    u === "name" ? i.name = f : u === "value" ? i.value = f : u === "filename" ? i.filename = f : (u === "type" || u === "content-type") && (i.contentType = f);
  }
  return i && n.push(i), n.filter((o) => !o.name).length && t.push(`Line ${e}: a multipart part is missing its \`name\`.`), { kind: "multipart", parts: n.filter((o) => o.name) };
}
function Fl(r) {
  const t = r.split(/\s+/).filter(Boolean), e = (t[0] ?? "").toUpperCase();
  if (e === "GRPC")
    return t.length < 2 ? null : {
      protocol: "grpc",
      method: "GRPC",
      url: t[1],
      grpcMethod: t[2]
    };
  const n = Ol[e];
  if (n)
    return t.length < 2 ? null : { protocol: n, method: e === "WS" ? "WEBSOCKET" : e, url: t.slice(1).join(" ") };
  if (t.length >= 2 && $l.has(e)) {
    const i = t.slice(1).filter((s) => !/^HTTP\/[\d.]+$/i.test(s)).join(" ");
    return { protocol: "http", method: e, url: i };
  }
  return t.length === 1 && /^(https?:\/\/|\{\{)/.test(t[0]) ? { protocol: "http", method: "GET", url: t[0] } : t.length === 1 && /^wss?:\/\//.test(t[0]) ? { protocol: "websocket", method: "WEBSOCKET", url: t[0] } : null;
}
function Bl(r, t, e = {}) {
  return r.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (n, i) => i in e ? e[i] : i in t ? t[i] : process.env[i] ?? n);
}
function oo(r, t, e) {
  const n = (i) => Bl(i, t, e);
  return {
    ...r,
    url: n(r.url),
    grpcMethod: r.grpcMethod ? n(r.grpcMethod) : void 0,
    protoPath: r.protoPath ? n(r.protoPath) : void 0,
    headers: r.headers.map((i) => ({ name: i.name, value: n(i.value) })),
    auth: Hl(r.auth, n),
    body: zl(r.body, n),
    initialMessages: r.initialMessages.map(n)
  };
}
function Hl(r, t) {
  switch (r.kind) {
    case "basic":
      return { ...r, username: t(r.username), password: t(r.password) };
    case "bearer":
      return { ...r, token: t(r.token) };
    case "apikey":
      return { ...r, name: t(r.name), value: t(r.value) };
    case "oauth2":
      return {
        ...r,
        tokenUrl: t(r.tokenUrl),
        clientId: t(r.clientId),
        clientSecret: t(r.clientSecret),
        username: r.username ? t(r.username) : void 0,
        password: r.password ? t(r.password) : void 0,
        scope: r.scope ? t(r.scope) : void 0
      };
    default:
      return r;
  }
}
function zl(r, t) {
  switch (r.kind) {
    case "text":
      return { kind: "text", text: t(r.text) };
    case "file":
      return { kind: "file", path: t(r.path) };
    case "multipart":
      return {
        kind: "multipart",
        parts: r.parts.map((e) => ({
          ...e,
          value: e.value === void 0 ? void 0 : t(e.value),
          filename: e.filename === void 0 ? void 0 : t(e.filename)
        }))
      };
    case "graphql":
      return {
        kind: "graphql",
        query: t(r.query),
        variables: t(r.variables),
        operationName: r.operationName
      };
    default:
      return r;
  }
}
function Ul(r) {
  return r.length > 60 ? `${r.slice(0, 57)}…` : r;
}
const Cr = /* @__PURE__ */ new Map(), ql = 3e4;
async function xn(r) {
  switch (r.kind) {
    case "none":
      return { headers: {}, query: {} };
    case "basic":
      return {
        headers: { Authorization: `Basic ${ao(`${r.username}:${r.password}`)}` },
        query: {}
      };
    case "bearer":
      return { headers: { Authorization: `Bearer ${r.token}` }, query: {} };
    case "apikey":
      return r.in === "header" ? { headers: { [r.name]: r.value }, query: {} } : { headers: {}, query: { [r.name]: r.value } };
    case "oauth2":
      return Wl(r);
  }
}
async function Wl(r) {
  const t = Jl(r), e = Cr.get(t);
  if (e && e.expiresAt > Date.now() + ql)
    return { headers: { Authorization: `${e.type} ${e.token}` }, query: {} };
  const n = new URLSearchParams();
  n.set("grant_type", r.grant), r.scope && n.set("scope", r.scope), r.grant === "password" && (n.set("username", r.username ?? ""), n.set("password", r.password ?? ""));
  const i = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json"
  };
  r.clientAuth === "body" ? (n.set("client_id", r.clientId), r.clientSecret && n.set("client_secret", r.clientSecret)) : i.Authorization = `Basic ${ao(`${r.clientId}:${r.clientSecret}`)}`;
  let s;
  try {
    s = await fetch(r.tokenUrl, {
      method: "POST",
      headers: i,
      body: n.toString(),
      signal: AbortSignal.timeout(3e4)
    });
  } catch (f) {
    return { headers: {}, query: {}, error: `OAuth2 token request failed: ${f.message}` };
  }
  const o = await s.text();
  if (!s.ok)
    return {
      headers: {},
      query: {},
      error: `OAuth2 token endpoint returned ${s.status}: ${o.slice(0, 300)}`
    };
  let a;
  try {
    a = JSON.parse(o);
  } catch {
    return { headers: {}, query: {}, error: `OAuth2 token response was not JSON: ${o.slice(0, 300)}` };
  }
  if (!a.access_token)
    return { headers: {}, query: {}, error: "OAuth2 token response had no `access_token`." };
  const c = a.token_type ? Kl(a.token_type) : "Bearer", u = (a.expires_in ?? 300) * 1e3;
  return Cr.set(t, { token: a.access_token, type: c, expiresAt: Date.now() + u }), { headers: { Authorization: `${c} ${a.access_token}` }, query: {} };
}
function Zl() {
  Cr.clear();
}
function Jl(r) {
  return [
    r.tokenUrl,
    r.grant,
    r.clientId,
    r.clientSecret,
    r.username ?? "",
    r.scope ?? ""
  ].join("\0");
}
function ao(r) {
  return Buffer.from(r, "utf8").toString("base64");
}
function Kl(r) {
  return r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
}
function Yl(r) {
  const t = {};
  for (const [e, n] of Object.entries(r))
    t[e] = Gl.has(e.toLowerCase()) ? Vl(n) : n;
  return t;
}
const Gl = /* @__PURE__ */ new Set(["authorization", "proxy-authorization", "cookie", "set-cookie"]);
function Vl(r) {
  const t = r.indexOf(" "), e = t > 0 ? r.slice(0, t) : "", n = t > 0 ? r.slice(t + 1) : r, i = n.length > 4 ? n.slice(-4) : "";
  return `${e ? `${e} ` : ""}••••${i}`;
}
const wi = 10;
async function co(r, t) {
  const e = Date.now(), n = () => ({
    requestId: r.id,
    protocol: r.protocol,
    status: 0,
    statusText: "",
    headers: {},
    body: "",
    size: 0,
    contentType: "",
    durationMs: Date.now() - e,
    at: e,
    redirects: [],
    cookies: []
  });
  if (/\{\{[A-Za-z0-9_-]+\}\}/.exec(r.url))
    return {
      ...n(),
      error: `Unresolved variable in URL: ${r.url}. Declare it with \`@name = value\` or pick an environment.`
    };
  const s = await xn(r.auth);
  if (s.error) return { ...n(), error: s.error };
  let o;
  try {
    o = await Xl(r.body, t.baseDir);
  } catch (k) {
    return { ...n(), error: k.message };
  }
  const a = {};
  for (const k of r.headers) a[k.name] = k.value;
  Object.assign(a, s.headers);
  for (const [k, _] of Object.entries(o.headers))
    su(a, k) || (a[k] = _);
  let c;
  try {
    c = iu(r.url, s.query);
  } catch {
    return { ...n(), error: `Not a valid URL: ${r.url}` };
  }
  const u = r.timeoutMs ?? t.defaultTimeoutMs, f = [], d = [];
  let p = r.protocol === "graphql" ? "POST" : r.method, m = o.body, w = {};
  for (let k = 0; ; k++) {
    if (k > wi)
      return { ...n(), redirects: f, cookies: d, error: `More than ${wi} redirects — the chain does not terminate.` };
    const _ = { ...a };
    if (r.useCookies) {
      const F = t.jar.header(c);
      F && (_.Cookie = F);
    }
    w = _;
    let x;
    try {
      x = await fetch(c, {
        method: p,
        headers: _,
        body: m,
        redirect: "manual",
        signal: AbortSignal.timeout(u)
      });
    } catch (F) {
      const K = F;
      return {
        ...n(),
        redirects: f,
        cookies: d,
        error: K.name === "TimeoutError" || K.name === "AbortError" ? `Timed out after ${u / 1e3}s.` : K.message
      };
    }
    r.useCookies && d.push(...t.jar.accept(c, ru(x)));
    const A = x.headers.get("location");
    if (r.followRedirects && nu(x.status) && A) {
      let F;
      try {
        F = new URL(A, c).toString();
      } catch {
        return { ...n(), redirects: f, cookies: d, error: `Redirect to an unreadable location: ${A}` };
      }
      f.push({ status: x.status, from: c, to: F }), (x.status === 303 || x.status === 301 || x.status === 302) && (p !== "HEAD" && (p = "GET"), m = void 0, delete a["Content-Type"], delete a["content-type"]), c = F;
      continue;
    }
    const N = Buffer.from(await x.arrayBuffer()), j = N.length > t.maxBodyBytes, P = j ? N.subarray(0, t.maxBodyBytes) : N, z = {};
    return x.headers.forEach((F, K) => {
      z[K] = F;
    }), {
      requestId: r.id,
      protocol: r.protocol,
      status: x.status,
      statusText: x.statusText,
      headers: z,
      body: P.toString("utf8") + (j ? `

… response truncated for display …` : ""),
      size: N.length,
      contentType: x.headers.get("content-type") ?? "",
      durationMs: Date.now() - e,
      at: e,
      redirects: f,
      cookies: d,
      sent: {
        method: p,
        url: c,
        headers: Yl(w),
        body: tu(r.body)
      }
    };
  }
}
async function Xl(r, t) {
  switch (r.kind) {
    case "none":
      return { body: void 0, headers: {} };
    case "text":
      return { body: r.text, headers: bi(r.text) };
    case "file": {
      const e = y.resolve(t, r.path);
      let n;
      try {
        n = await v.readFile(e);
      } catch {
        throw new Error(`Could not read the request body from ${r.path}.`);
      }
      return {
        body: new Uint8Array(n),
        headers: bi(n.subarray(0, 200).toString("utf8"), e)
      };
    }
    case "multipart": {
      const e = `----NovaBoundary${ou()}`, n = await Ql(r.parts, t, e);
      return {
        body: new Uint8Array(n),
        headers: { "Content-Type": `multipart/form-data; boundary=${e}` }
      };
    }
    case "graphql": {
      let e = {};
      if (r.variables.trim())
        try {
          e = JSON.parse(r.variables);
        } catch (i) {
          throw new Error(`GraphQL variables are not valid JSON: ${i.message}`);
        }
      const n = { query: r.query, variables: e };
      return r.operationName && (n.operationName = r.operationName), {
        body: JSON.stringify(n),
        headers: { "Content-Type": "application/json", Accept: "application/json" }
      };
    }
  }
}
async function Ql(r, t, e) {
  const n = [];
  for (const i of r) {
    let s = `form-data; name="${vi(i.name)}"`, o, a = i.contentType;
    if (i.filename !== void 0) {
      const u = y.resolve(t, i.filename);
      try {
        o = await v.readFile(u);
      } catch {
        throw new Error(`Could not read the upload ${i.filename} for part "${i.name}".`);
      }
      s += `; filename="${vi(y.basename(u))}"`, a ?? (a = lo(u));
    } else
      o = Buffer.from(i.value ?? "", "utf8");
    let c = `--${e}\r
Content-Disposition: ${s}\r
`;
    a && (c += `Content-Type: ${a}\r
`), c += `\r
`, n.push(Buffer.from(c, "utf8"), o, Buffer.from(`\r
`, "utf8"));
  }
  return n.push(Buffer.from(`--${e}--\r
`, "utf8")), Buffer.concat(n);
}
function bi(r, t) {
  if (t) {
    const n = lo(t);
    if (n) return { "Content-Type": n };
  }
  const e = r.trim();
  return e.startsWith("{") || e.startsWith("[") ? { "Content-Type": "application/json" } : e.startsWith("<") ? { "Content-Type": "application/xml" } : {};
}
const eu = {
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".bin": "application/octet-stream"
};
function lo(r) {
  return eu[y.extname(r).toLowerCase()] ?? "";
}
function tu(r) {
  switch (r.kind) {
    case "none":
      return "";
    case "text":
      return r.text;
    case "file":
      return `< ${r.path}`;
    case "multipart":
      return r.parts.map((t) => t.filename ? `${t.name}: < ${t.filename}` : `${t.name}: ${t.value ?? ""}`).join(`
`);
    case "graphql":
      return r.variables && r.variables !== "{}" ? `${r.query}

--variables
${r.variables}` : r.query;
  }
}
function nu(r) {
  return r === 301 || r === 302 || r === 303 || r === 307 || r === 308;
}
function ru(r) {
  const t = r.headers;
  if (typeof t.getSetCookie == "function") return t.getSetCookie();
  const e = r.headers.get("set-cookie");
  return e ? [e] : [];
}
function iu(r, t) {
  if (!Object.keys(t).length) return r;
  const e = new URL(r);
  for (const [n, i] of Object.entries(t)) e.searchParams.set(n, i);
  return e.toString();
}
function su(r, t) {
  const e = t.toLowerCase();
  return Object.keys(r).some((n) => n.toLowerCase() === e);
}
function vi(r) {
  return r.replace(/"/g, "%22").replace(/[\r\n]/g, "");
}
function ou() {
  return Math.floor(Math.random() * 4294967295).toString(16).padStart(8, "0");
}
class au {
  constructor() {
    H(this, "cookies", []);
    H(this, "file", "");
    H(this, "saving", null);
  }
  /** Points the jar at a project and loads whatever it saved last time. */
  async open(t) {
    this.file = y.join(t, "cookies.json");
    try {
      const e = await v.readFile(this.file, "utf8"), n = JSON.parse(e);
      this.cookies = Array.isArray(n) ? n.filter(on) : [];
    } catch {
      this.cookies = [];
    }
  }
  /** The `Cookie` header value for a URL, or empty if nothing matches. */
  header(t) {
    const e = ki(t);
    if (!e) return "";
    const n = this.cookies.filter((i) => on(i) && cu(i, e));
    return n.sort((i, s) => s.path.length - i.path.length), n.map((i) => `${i.name}=${i.value}`).join("; ");
  }
  /**
   * Records the `Set-Cookie` headers of a response. Returns the cookies that
   * were actually accepted, so the UI can show what a request changed.
   */
  accept(t, e) {
    const n = ki(t);
    if (!n) return [];
    const i = [];
    for (const s of e) {
      const o = fu(s, n);
      if (!o || !du(o.domain, n.host)) continue;
      const a = this.cookies.findIndex(
        (c) => c.name === o.name && c.domain === o.domain && c.path === o.path
      );
      if (o.expires !== void 0 && o.expires <= Date.now()) {
        a >= 0 && this.cookies.splice(a, 1);
        continue;
      }
      a >= 0 ? this.cookies[a] = o : this.cookies.push(o), i.push(`${o.name}=${o.value}`);
    }
    return i.length && this.persist(), i;
  }
  all() {
    return this.cookies.filter(on);
  }
  /**
   * Resolves once every pending write has landed. `accept` deliberately does
   * not block the request that triggered it, which leaves a window where the
   * process could exit with a session only in memory.
   */
  async flush() {
    await this.saving;
  }
  clear(t) {
    this.cookies = t ? this.cookies.filter((e) => !e.domain.endsWith(t)) : [], this.persist();
  }
  /**
   * Writes are serialised rather than fired in parallel: several requests can
   * finish at once, and two overlapping writes of the same file can interleave
   * into invalid JSON.
   */
  persist() {
    if (!this.file) return Promise.resolve();
    const t = (this.saving ?? Promise.resolve()).then(async () => {
      await v.mkdir(y.dirname(this.file), { recursive: !0 }), await v.writeFile(this.file, JSON.stringify(this.cookies.filter(on), null, 2));
    }).catch(() => {
    });
    return this.saving = t, t;
  }
}
function ki(r) {
  try {
    const t = new URL(r);
    return {
      host: t.hostname.toLowerCase(),
      path: t.pathname || "/",
      secure: t.protocol === "https:" || t.protocol === "wss:"
    };
  } catch {
    return null;
  }
}
function on(r) {
  return r.expires === void 0 || r.expires > Date.now();
}
function cu(r, t) {
  return r.secure && !t.secure || !lu(r.domain, t.host) ? !1 : uu(r.path, t.path);
}
function lu(r, t) {
  return r === t ? !0 : t.endsWith(`.${r}`);
}
function uu(r, t) {
  return r === t ? !0 : t.startsWith(r) ? r.endsWith("/") || t[r.length] === "/" : !1;
}
function du(r, t) {
  return r === t ? !0 : t.endsWith(`.${r}`) ? r.includes(".") : !1;
}
function fu(r, t) {
  const e = r.split(";"), n = e[0] ?? "", i = n.indexOf("=");
  if (i <= 0) return null;
  const s = {
    name: n.slice(0, i).trim(),
    value: n.slice(i + 1).trim(),
    domain: t.host,
    // Without an explicit Path, the default is the request's directory.
    path: pu(t.path),
    secure: !1,
    httpOnly: !1
  };
  if (!s.name) return null;
  let o = null, a = null;
  for (const u of e.slice(1)) {
    const f = u.indexOf("="), d = (f === -1 ? u : u.slice(0, f)).trim().toLowerCase(), p = f === -1 ? "" : u.slice(f + 1).trim();
    switch (d) {
      case "domain":
        s.domain = p.replace(/^\./, "").toLowerCase() || t.host;
        break;
      case "path":
        p.startsWith("/") && (s.path = p);
        break;
      case "secure":
        s.secure = !0;
        break;
      case "httponly":
        s.httpOnly = !0;
        break;
      case "samesite":
        s.sameSite = p;
        break;
      case "max-age": {
        const m = Number(p);
        Number.isFinite(m) && (o = Date.now() + m * 1e3);
        break;
      }
      case "expires": {
        const m = Date.parse(p);
        Number.isNaN(m) || (a = m);
        break;
      }
    }
  }
  const c = o ?? a;
  return c !== null && (s.expires = c), s;
}
function pu(r) {
  if (!r.startsWith("/")) return "/";
  const t = r.lastIndexOf("/");
  return t <= 0 ? "/" : r.slice(0, t);
}
const Si = 200;
class hu {
  constructor() {
    H(this, "entries", []);
    H(this, "dir", "");
    H(this, "saving", null);
    H(this, "counter", 0);
  }
  async open(t) {
    this.dir = y.join(t, "history");
    try {
      const e = await v.readFile(y.join(this.dir, "index.json"), "utf8"), n = JSON.parse(e);
      this.entries = Array.isArray(n) ? n : [];
    } catch {
      this.entries = [];
    }
  }
  list(t) {
    return [...t ? this.entries.filter((n) => n.file === t) : this.entries].reverse();
  }
  async record(t, e, n, i) {
    var a, c;
    const s = {
      // The counter disambiguates two requests finishing in the same
      // millisecond, which a fast local API does constantly.
      id: `h-${i.at}-${this.counter++}`,
      file: t,
      requestId: i.requestId,
      name: e,
      method: ((a = i.sent) == null ? void 0 : a.method) ?? "",
      url: ((c = i.sent) == null ? void 0 : c.url) ?? n,
      protocol: i.protocol,
      status: i.status,
      durationMs: i.durationMs,
      size: i.size,
      at: i.at,
      error: i.error
    };
    this.entries.push(s);
    const o = this.entries.length > Si ? this.entries.splice(0, this.entries.length - Si) : [];
    return await this.write(s, i, o), s;
  }
  /** The full response for an entry, or null once it has been trimmed away. */
  async body(t) {
    if (!this.dir) return null;
    try {
      return JSON.parse(await v.readFile(this.bodyPath(t), "utf8"));
    } catch {
      return null;
    }
  }
  async clear() {
    this.entries = [], this.dir && await v.rm(this.dir, { recursive: !0, force: !0 }).catch(() => {
    });
  }
  bodyPath(t) {
    return y.join(this.dir, `${t.replace(/[^A-Za-z0-9_-]/g, "")}.json`);
  }
  /** Serialised, so two requests finishing together cannot interleave writes. */
  write(t, e, n) {
    if (!this.dir) return Promise.resolve();
    const i = (this.saving ?? Promise.resolve()).then(async () => {
      await v.mkdir(this.dir, { recursive: !0 }), await v.writeFile(this.bodyPath(t.id), JSON.stringify(e)), await v.writeFile(y.join(this.dir, "index.json"), JSON.stringify(this.entries, null, 2));
      for (const s of n)
        await v.rm(this.bodyPath(s.id), { force: !0 }).catch(() => {
        });
    }).catch(() => {
    });
    return this.saving = i, i;
  }
}
class mu {
  constructor(t) {
    H(this, "streams", /* @__PURE__ */ new Map());
    H(this, "counter", 0);
    this.events = t;
  }
  /** Opens a WebSocket or SSE connection and returns its id immediately. */
  open(t, e) {
    const n = `stream-${++this.counter}`, i = {
      streamId: n,
      requestId: t.id,
      protocol: t.protocol,
      state: "connecting",
      url: t.url,
      received: 0,
      sent: 0
    }, s = { status: i, close: () => {
    } };
    return this.streams.set(n, s), this.events.onStatus(i), t.protocol === "websocket" ? this.openWebSocket(s, t, e) : this.openEventSource(s, t, e), n;
  }
  send(t, e) {
    const n = this.streams.get(t);
    return !(n != null && n.send) || n.status.state !== "open" ? !1 : (n.send(e), n.status.sent++, this.emit(n, { direction: "out", data: e }), this.events.onStatus({ ...n.status }), !0);
  }
  close(t) {
    var e;
    (e = this.streams.get(t)) == null || e.close();
  }
  closeAll() {
    for (const t of this.streams.values()) t.close();
    this.streams.clear();
  }
  list() {
    return [...this.streams.values()].map((t) => ({ ...t.status }));
  }
  /* ---------------- WebSocket ---------------- */
  async openWebSocket(t, e, n) {
    const i = await xn(e.auth);
    if (i.error) return this.fail(t, i.error);
    let s;
    try {
      const u = new URL(e.url);
      for (const [f, d] of Object.entries(i.query)) u.searchParams.set(f, d);
      s = u.toString();
    } catch {
      return this.fail(t, `Not a valid WebSocket URL: ${e.url}`);
    }
    const o = e.headers.filter((u) => u.name.toLowerCase() === "sec-websocket-protocol").flatMap((u) => u.value.split(",").map((f) => f.trim())).filter(Boolean);
    let a;
    try {
      a = o.length ? new WebSocket(s, o) : new WebSocket(s);
    } catch (u) {
      return this.fail(t, u.message);
    }
    t.close = () => a.close(), t.send = (u) => a.send(u), a.addEventListener("open", () => {
      t.status.state = "open", this.emit(t, { direction: "system", data: `Connected to ${s}` }), this.events.onStatus({ ...t.status });
      for (const u of e.initialMessages) this.send(t.status.streamId, u);
    }), a.addEventListener("message", (u) => {
      t.status.received++, this.emit(t, { direction: "in", data: yu(u.data) }), this.events.onStatus({ ...t.status });
    });
    let c = !1;
    a.addEventListener("open", () => {
      c = !0;
    }), a.addEventListener("error", () => {
      this.emit(t, { direction: "system", data: "Socket error" });
    }), a.addEventListener("close", (u) => {
      const f = u.code ? ` (${u.code}${u.reason ? `: ${u.reason}` : ""})` : "";
      if (!c) {
        this.fail(t, `Could not connect to ${s}${f}`);
        return;
      }
      t.status.state = "closed", this.emit(t, { direction: "system", data: `Closed${f}` }), this.events.onStatus({ ...t.status }), this.streams.delete(t.status.streamId);
    });
  }
  /* ---------------- Server-Sent Events ---------------- */
  /**
   * SSE is read with `fetch` rather than `EventSource` because EventSource
   * cannot set headers, and an events endpoint almost always needs auth.
   */
  async openEventSource(t, e, n) {
    const i = await xn(e.auth);
    if (i.error) return this.fail(t, i.error);
    const s = new AbortController();
    t.close = () => s.abort();
    const o = { Accept: "text/event-stream" };
    for (const d of e.headers) o[d.name] = d.value;
    if (Object.assign(o, i.headers), e.useCookies) {
      const d = n.header(e.url);
      d && (o.Cookie = d);
    }
    let a;
    try {
      let d = e.url;
      if (Object.keys(i.query).length) {
        const p = new URL(d);
        for (const [m, w] of Object.entries(i.query)) p.searchParams.set(m, w);
        d = p.toString();
      }
      a = await fetch(d, { headers: o, signal: s.signal });
    } catch (d) {
      const p = d;
      return p.name === "AbortError" ? this.finish(t, "Closed") : this.fail(t, p.message);
    }
    if (!a.ok)
      return this.fail(t, `Stream refused: ${a.status} ${a.statusText}`);
    if (!a.body) return this.fail(t, "The response had no body to stream.");
    t.status.state = "open", this.emit(t, { direction: "system", data: `Streaming from ${e.url}` }), this.events.onStatus({ ...t.status });
    const c = a.body.getReader(), u = new TextDecoder();
    let f = "";
    try {
      for (; ; ) {
        const { done: d, value: p } = await c.read();
        if (d) break;
        f += u.decode(p, { stream: !0 });
        let m;
        for (; (m = f.search(/\r?\n\r?\n/)) !== -1; ) {
          const w = f.slice(0, m);
          f = f.slice(m + (f[m] === "\r" ? 4 : 2));
          const k = gu(w);
          k && (t.status.received++, this.emit(t, { direction: "in", event: k.name, data: k.data }), this.events.onStatus({ ...t.status }));
        }
      }
      this.finish(t, "Stream ended");
    } catch (d) {
      const p = d;
      p.name === "AbortError" ? this.finish(t, "Closed") : this.fail(t, p.message);
    }
  }
  /* ---------------- shared ---------------- */
  emit(t, e) {
    this.events.onMessage({ ...e, streamId: t.status.streamId, at: Date.now() });
  }
  fail(t, e) {
    t.status.state = "error", t.status.error = e, this.emit(t, { direction: "system", data: e }), this.events.onStatus({ ...t.status }), this.streams.delete(t.status.streamId);
  }
  finish(t, e) {
    t.status.state = "closed", this.emit(t, { direction: "system", data: e }), this.events.onStatus({ ...t.status }), this.streams.delete(t.status.streamId);
  }
}
function gu(r) {
  const t = [];
  let e;
  for (const n of r.split(/\r?\n/)) {
    if (!n || n.startsWith(":")) continue;
    const i = n.indexOf(":"), s = i === -1 ? n : n.slice(0, i), o = i === -1 ? "" : n.slice(i + 1).replace(/^ /, "");
    s === "data" ? t.push(o) : s === "event" && (e = o);
  }
  return !t.length && !e ? null : { name: e, data: t.join(`
`) };
}
function yu(r) {
  return typeof r == "string" ? r : r instanceof ArrayBuffer ? Buffer.from(r).toString("utf8") : String(r);
}
const wu = `
query NovaIntrospection {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: false) {
        name
        description
        args { name type { ...TypeRef } }
        type { ...TypeRef }
      }
      inputFields { name type { ...TypeRef } }
      enumValues(includeDeprecated: false) { name description }
    }
  }
}

fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType { kind name }
    }
  }
}
`;
async function bu(r, t, e, n = 3e4) {
  var d, p, m, w;
  const i = await xn(e);
  if (i.error) return { types: [], error: i.error };
  let s = r;
  if (Object.keys(i.query).length)
    try {
      const k = new URL(r);
      for (const [_, x] of Object.entries(i.query)) k.searchParams.set(_, x);
      s = k.toString();
    } catch {
      return { types: [], error: `Not a valid URL: ${r}` };
    }
  let o;
  try {
    o = await fetch(s, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...t,
        ...i.headers
      },
      body: JSON.stringify({ query: wu }),
      signal: AbortSignal.timeout(n)
    });
  } catch (k) {
    const _ = k;
    return {
      types: [],
      error: _.name === "TimeoutError" ? `Introspection timed out after ${n / 1e3}s.` : _.message
    };
  }
  const a = await o.text();
  if (!o.ok)
    return { types: [], error: `Introspection returned ${o.status}: ${a.slice(0, 300)}` };
  let c;
  try {
    c = JSON.parse(a);
  } catch {
    return { types: [], error: `Introspection response was not JSON: ${a.slice(0, 300)}` };
  }
  const u = uo(c);
  if (u.length)
    return { types: [], error: `Introspection was refused: ${u.join("; ")}` };
  const f = (d = c.data) == null ? void 0 : d.__schema;
  return f ? {
    queryType: ((p = f.queryType) == null ? void 0 : p.name) ?? void 0,
    mutationType: ((m = f.mutationType) == null ? void 0 : m.name) ?? void 0,
    subscriptionType: ((w = f.subscriptionType) == null ? void 0 : w.name) ?? void 0,
    types: (f.types ?? []).filter((k) => k.name && !k.name.startsWith("__")).map(vu)
  } : { types: [], error: "The server returned no `__schema`." };
}
function vu(r) {
  const t = (r.fields ?? []).map((e) => ({
    name: e.name,
    type: jt(e.type),
    description: e.description ?? void 0,
    args: (e.args ?? []).map((n) => ({ name: n.name, type: jt(n.type) }))
  }));
  for (const e of r.inputFields ?? [])
    t.push({ name: e.name, type: jt(e.type), args: [] });
  for (const e of r.enumValues ?? [])
    t.push({ name: e.name, type: "enum value", description: e.description ?? void 0, args: [] });
  return {
    name: r.name ?? "(anonymous)",
    kind: r.kind,
    description: r.description ?? void 0,
    fields: t
  };
}
function jt(r) {
  return r ? r.kind === "NON_NULL" ? `${jt(r.ofType)}!` : r.kind === "LIST" ? `[${jt(r.ofType)}]` : r.name ?? "Unknown" : "Unknown";
}
function uo(r) {
  if (!r || typeof r != "object") return [];
  const t = r.errors;
  return Array.isArray(t) ? t.map((e) => {
    if (typeof e == "string") return e;
    if (e && typeof e == "object") {
      const n = e, i = typeof n.message == "string" ? n.message : JSON.stringify(e), s = Array.isArray(n.path) ? ` (at ${n.path.join(".")})` : "";
      return `${i}${s}`;
    }
    return String(e);
  }) : [];
}
function fo(r, t) {
  if (!(!t.includes("json") && !r.trim().startsWith("{")))
    try {
      const e = uo(JSON.parse(r));
      return e.length ? e : void 0;
    } catch {
      return;
    }
}
const po = Is(import.meta.url), gt = po("protobufjs"), xi = po("protobufjs/ext/descriptor"), ku = {
  // A 64-bit int does not survive a JS number, so it is rendered as a string —
  // the same choice the canonical protobuf JSON mapping makes.
  longs: String,
  enums: String,
  bytes: String,
  defaults: !0,
  arrays: !0,
  objects: !0,
  oneofs: !0
};
async function Su(r, t, e) {
  if (t)
    try {
      const n = await ho(t, e);
      return { source: "proto", methods: Ei(n) };
    } catch (n) {
      return { source: "proto", methods: [], error: n.message };
    }
  try {
    const n = await mo(r);
    return { source: "reflection", methods: Ei(n) };
  } catch (n) {
    return {
      source: "reflection",
      methods: [],
      error: `${n.message} — add \`# @proto ./service.proto\` if the server has reflection disabled.`
    };
  }
}
async function ho(r, t) {
  const e = y.resolve(t, r);
  try {
    await v.access(e);
  } catch {
    throw new Error(`No such proto file: ${r}`);
  }
  const n = new gt.Root();
  return n.resolvePath = (i, s) => y.isAbsolute(s) ? s : y.resolve(i ? y.dirname(i) : y.dirname(e), s), await n.load(e, { keepCase: !1 }), n;
}
async function mo(r) {
  const { client: t, close: e } = xu(r);
  try {
    const n = await _u(t);
    if (!n.length) throw new Error("The server reflected no services.");
    const i = [];
    for (const s of n)
      i.push(...await Eu(t, s));
    return Cu(i);
  } finally {
    e();
  }
}
const Ai = [
  "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo",
  "/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo"
];
function xu(r) {
  const t = new ke.Client(Pr(r), vo(r));
  return { client: t, close: () => t.close() };
}
function go(r, t) {
  const e = Buffer.from(t, "utf8");
  return Buffer.concat([Au(r, 2), yo(e.length), e]);
}
function Au(r, t) {
  return yo(r << 3 | t);
}
function yo(r) {
  const t = [];
  let e = r;
  do {
    let n = e & 127;
    e >>>= 7, e && (n |= 128), t.push(n);
  } while (e);
  return Buffer.from(t);
}
function It(r, t) {
  const e = [];
  let n = 0;
  for (; n < r.length; ) {
    const [i, s] = Jn(r, n);
    if (s < 0) break;
    const o = i >>> 3, a = i & 7;
    if (n = s, a === 2) {
      const [c, u] = Jn(r, n);
      if (u < 0) break;
      n = u, o === t && e.push(r.subarray(n, n + c)), n += c;
    } else if (a === 0) {
      const [, c] = Jn(r, n);
      if (c < 0) break;
      n = c;
    } else if (a === 5)
      n += 4;
    else if (a === 1)
      n += 8;
    else
      break;
  }
  return e;
}
function Jn(r, t) {
  let e = 0, n = 0, i = t;
  for (; i < r.length; ) {
    const s = r[i++];
    if (e |= (s & 127) << n, !(s & 128)) return [e >>> 0, i];
    if (n += 7, n > 28) break;
  }
  return [0, -1];
}
const _i = {
  serialize: (r) => r,
  deserialize: (r) => r
};
function _u(r) {
  return wo(r, go(7, ""), (t) => {
    const e = It(t, 6)[0];
    return e ? It(e, 1).map((n) => {
      var i;
      return ((i = It(n, 1)[0]) == null ? void 0 : i.toString("utf8")) ?? "";
    }).filter((n) => n && !n.startsWith("grpc.reflection.")) : [];
  });
}
function Eu(r, t) {
  return wo(r, go(4, t), (e) => {
    const n = It(e, 4)[0];
    return n ? It(n, 1) : [];
  });
}
function wo(r, t, e) {
  return new Promise((n, i) => {
    let s = null, o = null;
    const a = (c) => {
      if (c >= Ai.length)
        return i(o ?? new Error("Server reflection is not available."));
      s = r.makeBidiStreamRequest(
        Ai[c],
        _i.serialize,
        _i.deserialize,
        new ke.Metadata()
      );
      let u = !1;
      s.on("data", (f) => {
        u = !0;
        try {
          n(e(f));
        } catch (d) {
          i(d);
        }
        s == null || s.end();
      }), s.on("error", (f) => {
        o = f, u || a(c + 1);
      }), s.on("end", () => {
        u || a(c + 1);
      }), s.write(t);
    };
    a(0);
  });
}
function Cu(r) {
  const t = /* @__PURE__ */ new Set(), e = [];
  for (const i of r) {
    const s = xi.FileDescriptorProto.decode(i), o = s.name ?? "";
    o && t.has(o) || (o && t.add(o), e.push(s));
  }
  const n = xi.FileDescriptorSet.fromObject({ file: e });
  return gt.Root.fromDescriptor(n);
}
function Ei(r) {
  const t = [], e = (n) => {
    for (const i of n.nestedArray) {
      if (i instanceof gt.Service)
        for (const s of i.methodsArray) {
          s.resolve();
          const o = s.resolvedRequestType;
          t.push({
            path: `${i.fullName.replace(/^\./, "")}/${s.name}`,
            service: i.fullName.replace(/^\./, ""),
            name: s.name,
            clientStreaming: !!s.requestStream,
            serverStreaming: !!s.responseStream,
            template: o ? Tu(o) : "{}"
          });
        }
      i instanceof gt.Namespace && e(i);
    }
  };
  return e(r), t.sort((n, i) => n.path.localeCompare(i.path));
}
function Tu(r, t = 0) {
  return JSON.stringify(bo(r, t), null, 2);
}
function bo(r, t) {
  if (t > 3) return {};
  const e = {};
  for (const n of r.fieldsArray) {
    n.resolve();
    let i;
    n.resolvedType instanceof gt.Enum ? i = Object.keys(n.resolvedType.values)[0] ?? "" : n.resolvedType instanceof gt.Type ? i = bo(n.resolvedType, t + 1) : i = $u(n.type), e[n.name] = n.repeated ? [i] : i;
  }
  return e;
}
function $u(r) {
  switch (r) {
    case "string":
    case "bytes":
      return "";
    case "bool":
      return !1;
    case "double":
    case "float":
      return 0;
    case "int64":
    case "uint64":
    case "sint64":
    case "fixed64":
    case "sfixed64":
      return "0";
    default:
      return 0;
  }
}
async function Ou(r, t, e, n, i, s, o, a) {
  const c = e ? await ho(e, n) : await mo(r), u = t.lastIndexOf("/");
  if (u <= 0)
    throw new Error(`A gRPC method looks like \`package.Service/Method\`, not \`${t}\`.`);
  const f = t.slice(0, u), d = t.slice(u + 1), p = c.lookupService(f), m = p.methods[d];
  if (!m) {
    const J = Object.keys(p.methods).join(", ");
    throw new Error(`${f} has no method ${d}. It has: ${J}.`);
  }
  m.resolve();
  const w = m.resolvedRequestType, k = m.resolvedResponseType, _ = (J) => {
    const te = w.verify(J);
    if (te) throw new Error(`Request does not match ${w.name}: ${te}`);
    return Buffer.from(w.encode(w.fromObject(J)).finish());
  }, x = (J) => k.toObject(k.decode(J), ku), A = new ke.Client(Pr(r), vo(r)), N = new ke.Metadata();
  for (const [J, te] of Object.entries(s)) N.set(J, te);
  const j = { deadline: Date.now() + o }, P = `/${f}/${d}`;
  let z = () => {
  };
  const F = new Promise((J) => z = J), K = (J) => {
    const te = J.trim();
    if (!te) return {};
    try {
      return JSON.parse(te);
    } catch (me) {
      throw new Error(`Request body is not valid JSON: ${me.message}`);
    }
  }, Y = (J) => {
    const te = ke.status[J.code] ?? String(J.code);
    a.onSystem(
      J.code === ke.status.OK ? "Completed OK" : `${te}${J.details ? `: ${J.details}` : ""}`
    ), z({ code: J.code, details: J.details }), A.close();
  };
  if (!m.requestStream && !m.responseStream) {
    const J = A.makeUnaryRequest(
      P,
      _,
      x,
      K(i),
      N,
      j,
      (te, me) => {
        me !== void 0 && a.onMessage(JSON.stringify(me, null, 2)), Y(te || { code: ke.status.OK, details: "", metadata: new ke.Metadata() });
      }
    );
    return an(J, () => {
    }, F);
  }
  if (!m.requestStream && m.responseStream) {
    const J = A.makeServerStreamRequest(
      P,
      _,
      x,
      K(i),
      N,
      j
    );
    return J.on("data", (te) => a.onMessage(JSON.stringify(te, null, 2))), J.on("status", Y), J.on("error", () => {
    }), an(J, () => {
    }, F);
  }
  if (m.requestStream && !m.responseStream) {
    const J = A.makeClientStreamRequest(
      P,
      _,
      x,
      N,
      j,
      (te, me) => {
        me !== void 0 && a.onMessage(JSON.stringify(me, null, 2)), Y(te || { code: ke.status.OK, details: "", metadata: new ke.Metadata() });
      }
    );
    return i.trim() && J.write(K(i)), an(J, (te) => J.write(K(te)), F, () => J.end());
  }
  const X = A.makeBidiStreamRequest(P, _, x, N, j);
  return X.on("data", (J) => a.onMessage(JSON.stringify(J, null, 2))), X.on("status", Y), X.on("error", () => {
  }), i.trim() && X.write(K(i)), an(X, (J) => X.write(K(J)), F, () => X.end());
}
function an(r, t, e, n = () => {
}) {
  return { send: t, finish: n, cancel: () => r.cancel(), done: e };
}
function Pr(r) {
  return r.replace(/^(grpcs?|https?):\/\//, "").replace(/\/+$/, "");
}
function vo(r) {
  return /^(grpcs|https):\/\//.test(r) || /:443$/.test(Pr(r)) ? ke.credentials.createSsl() : ke.credentials.createInsecure();
}
const Ci = 5e3;
function ju(r, t, e) {
  const n = {}, i = [], s = {
    method: t.method,
    url: t.url,
    headers: { ...t.headers },
    body: t.body
  }, o = {
    request: s,
    vars: So(e, n),
    env: { get: (c) => e[c] ?? "" },
    log: (...c) => i.push(c.map(ie).join(" ")),
    // No tests before a response exists, but the function is present so a
    // shared snippet does not explode when pasted into the wrong block.
    test: () => {
      throw new Error("nova.test is only available in a response script (`> {% %}`).");
    }
  }, a = ko(r, o);
  return {
    tests: [],
    logs: i,
    variables: n,
    error: a,
    request: { url: s.url, headers: s.headers, body: s.body }
  };
}
function Iu(r, t, e) {
  const n = {}, i = [], s = [];
  let o, a = !1;
  const c = {
    response: {
      status: t.status,
      statusText: t.statusText,
      headers: Lu(t.headers),
      body: t.body,
      contentType: t.contentType,
      time: t.durationMs,
      size: t.size,
      /**
       * Parsed lazily and once. A script that never calls it should not pay
       * for parsing a large body, and one that calls it in five assertions
       * should not pay five times.
       */
      json: () => {
        if (a) throw new Error("The response body is not valid JSON.");
        if (o === void 0)
          try {
            o = JSON.parse(t.body);
          } catch (f) {
            throw a = !0, new Error(`The response body is not valid JSON: ${f.message}`);
          }
        return o;
      }
    },
    /**
     * A failing assertion fails its own test and no others. Without the catch,
     * the first failure would abort the script and hide every check after it —
     * which is exactly when you most want to see the rest.
     */
    test: (f, d) => {
      const p = Date.now();
      try {
        d(), s.push({ name: f, passed: !0, durationMs: Date.now() - p });
      } catch (m) {
        s.push({
          name: f,
          passed: !1,
          message: m.message,
          durationMs: Date.now() - p
        });
      }
    },
    expect: (f) => Nu(f),
    vars: So(e, n),
    env: { get: (f) => e[f] ?? "" },
    log: (...f) => i.push(f.map(ie).join(" "))
  }, u = ko(r, c);
  return { tests: s, logs: i, variables: n, error: u };
}
function ko(r, t) {
  const e = qr.createContext({
    nova: t,
    // A deliberately small standard library. Everything here is pure; nothing
    // reaches the filesystem, the network, or the process.
    JSON,
    Math,
    Date,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    console: { log: t.log, error: t.log, warn: t.log }
  });
  try {
    new qr.Script(r, { filename: "request-script.js" }).runInContext(e, {
      timeout: Ci
    });
    return;
  } catch (n) {
    const i = n;
    return i.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ? `The script did not finish within ${Ci / 1e3}s.` : i.message;
  }
}
function So(r, t) {
  return {
    get: (e) => t[e] ?? r[e] ?? "",
    set: (e, n) => {
      t[String(e)] = typeof n == "string" ? n : ie(n);
    },
    has: (e) => e in t || e in r,
    all: () => ({ ...r, ...t })
  };
}
function Nu(r) {
  const t = (n) => {
    throw new Error(n);
  }, e = {
    toBe(n) {
      r !== n && t(`expected ${ie(n)}, got ${ie(r)}`);
    },
    toEqual(n) {
      Nt(r, n) || t(`expected ${ie(n)}, got ${ie(r)}`);
    },
    toContain(n) {
      if (typeof r == "string") {
        r.includes(String(n)) || t(`expected ${ie(r)} to contain ${ie(n)}`);
        return;
      }
      if (Array.isArray(r)) {
        r.some((i) => Nt(i, n)) || t(`expected ${ie(r)} to contain ${ie(n)}`);
        return;
      }
      t(`toContain needs a string or an array, got ${ie(r)}`);
    },
    toMatch(n) {
      const i = typeof n == "string" ? new RegExp(n) : n;
      (typeof r != "string" || !i.test(r)) && t(`expected ${ie(r)} to match ${i}`);
    },
    toBeGreaterThan(n) {
      (typeof r != "number" || !(r > n)) && t(`expected ${ie(r)} to be greater than ${n}`);
    },
    toBeLessThan(n) {
      (typeof r != "number" || !(r < n)) && t(`expected ${ie(r)} to be less than ${n}`);
    },
    toBeDefined() {
      r == null && t("expected a value, got nothing");
    },
    toBeTruthy() {
      r || t(`expected something truthy, got ${ie(r)}`);
    },
    toHaveLength(n) {
      const i = r == null ? void 0 : r.length;
      i !== n && t(`expected length ${n}, got ${ie(i)}`);
    },
    toHaveProperty(n, i) {
      const s = Mu(r, n);
      s === void 0 && t(`expected a property "${n}", which is not there`), arguments.length > 1 && !Nt(s, i) && t(`expected "${n}" to be ${ie(i)}, got ${ie(s)}`);
    }
  };
  return {
    ...e,
    get not() {
      return Ru(e, r);
    }
  };
}
function Ru(r, t) {
  const e = {};
  for (const [n, i] of Object.entries(r))
    typeof i == "function" && (e[n] = (...s) => {
      let o = !1;
      try {
        i(...s);
      } catch {
        o = !0;
      }
      if (!o)
        throw new Error(`expected ${ie(t)} NOT to ${n}(${s.map(ie).join(", ")})`);
    });
  return e;
}
function Mu(r, t) {
  let e = r;
  for (const n of t.split(".")) {
    if (e == null) return;
    e = e[n];
  }
  return e;
}
function Nt(r, t) {
  if (r === t) return !0;
  if (typeof r != typeof t || r === null || t === null || typeof r != "object") return !1;
  if (Array.isArray(r) || Array.isArray(t))
    return !Array.isArray(r) || !Array.isArray(t) || r.length !== t.length ? !1 : r.every((s, o) => Nt(s, t[o]));
  const e = r, n = t, i = Object.keys(e);
  return i.length !== Object.keys(n).length ? !1 : i.every((s) => s in n && Nt(e[s], n[s]));
}
function ie(r) {
  if (typeof r == "string") return JSON.stringify(r);
  if (r === void 0) return "undefined";
  if (r === null) return "null";
  if (typeof r == "object")
    try {
      const t = JSON.stringify(r);
      return t.length > 200 ? `${t.slice(0, 200)}…` : t;
    } catch {
      return String(r);
    }
  return String(r);
}
function Lu(r) {
  const t = {};
  for (const [e, n] of Object.entries(r)) t[e.toLowerCase()] = n;
  return t;
}
function Pu(r) {
  return r && r.__esModule && Object.prototype.hasOwnProperty.call(r, "default") ? r.default : r;
}
var ce = {}, cn = {}, Pe = {}, Ti;
function Ft() {
  if (Ti) return Pe;
  Ti = 1;
  function r(o) {
    return typeof o > "u" || o === null;
  }
  function t(o) {
    return typeof o == "object" && o !== null;
  }
  function e(o) {
    return Array.isArray(o) ? o : r(o) ? [] : [o];
  }
  function n(o, a) {
    if (a) {
      const c = Object.keys(a);
      for (let u = 0, f = c.length; u < f; u += 1) {
        const d = c[u];
        o[d] = a[d];
      }
    }
    return o;
  }
  function i(o, a) {
    let c = "";
    for (let u = 0; u < a; u += 1)
      c += o;
    return c;
  }
  function s(o) {
    return o === 0 && Number.NEGATIVE_INFINITY === 1 / o;
  }
  return Pe.isNothing = r, Pe.isObject = t, Pe.toArray = e, Pe.repeat = i, Pe.isNegativeZero = s, Pe.extend = n, Pe;
}
var Kn, $i;
function Bt() {
  if ($i) return Kn;
  $i = 1;
  function r(e, n) {
    let i = "";
    const s = e.reason || "(unknown reason)";
    return e.mark ? (e.mark.name && (i += 'in "' + e.mark.name + '" '), i += "(" + (e.mark.line + 1) + ":" + (e.mark.column + 1) + ")", !n && e.mark.snippet && (i += `

` + e.mark.snippet), s + " " + i) : s;
  }
  function t(e, n) {
    Error.call(this), this.name = "YAMLException", this.reason = e, this.mark = n, this.message = r(this, !1), Error.captureStackTrace ? Error.captureStackTrace(this, this.constructor) : this.stack = new Error().stack || "";
  }
  return t.prototype = Object.create(Error.prototype), t.prototype.constructor = t, t.prototype.toString = function(n) {
    return this.name + ": " + r(this, n);
  }, Kn = t, Kn;
}
var Yn, Oi;
function Du() {
  if (Oi) return Yn;
  Oi = 1;
  const r = Ft();
  function t(i, s, o, a, c) {
    let u = "", f = "";
    const d = Math.floor(c / 2) - 1;
    return a - s > d && (u = " ... ", s = a - d + u.length), o - a > d && (f = " ...", o = a + d - f.length), {
      str: u + i.slice(s, o).replace(/\t/g, "→") + f,
      pos: a - s + u.length
      // relative position
    };
  }
  function e(i, s) {
    return r.repeat(" ", s - i.length) + i;
  }
  function n(i, s) {
    if (s = Object.create(s || null), !i.buffer) return null;
    s.maxLength || (s.maxLength = 79), typeof s.indent != "number" && (s.indent = 1), typeof s.linesBefore != "number" && (s.linesBefore = 3), typeof s.linesAfter != "number" && (s.linesAfter = 2);
    const o = /\r?\n|\r|\0/g, a = [0], c = [];
    let u, f = -1;
    for (; u = o.exec(i.buffer); )
      c.push(u.index), a.push(u.index + u[0].length), i.position <= u.index && f < 0 && (f = a.length - 2);
    f < 0 && (f = a.length - 1);
    let d = "";
    const p = Math.min(i.line + s.linesAfter, c.length).toString().length, m = s.maxLength - (s.indent + p + 3);
    for (let k = 1; k <= s.linesBefore && !(f - k < 0); k++) {
      const _ = t(
        i.buffer,
        a[f - k],
        c[f - k],
        i.position - (a[f] - a[f - k]),
        m
      );
      d = r.repeat(" ", s.indent) + e((i.line - k + 1).toString(), p) + " | " + _.str + `
` + d;
    }
    const w = t(i.buffer, a[f], c[f], i.position, m);
    d += r.repeat(" ", s.indent) + e((i.line + 1).toString(), p) + " | " + w.str + `
`, d += r.repeat("-", s.indent + p + 3 + w.pos) + `^
`;
    for (let k = 1; k <= s.linesAfter && !(f + k >= c.length); k++) {
      const _ = t(
        i.buffer,
        a[f + k],
        c[f + k],
        i.position - (a[f] - a[f + k]),
        m
      );
      d += r.repeat(" ", s.indent) + e((i.line + k + 1).toString(), p) + " | " + _.str + `
`;
    }
    return d.replace(/\n$/, "");
  }
  return Yn = n, Yn;
}
var Gn, ji;
function fe() {
  if (ji) return Gn;
  ji = 1;
  const r = Bt(), t = [
    "kind",
    "multi",
    "resolve",
    "construct",
    "instanceOf",
    "predicate",
    "represent",
    "representName",
    "defaultStyle",
    "styleAliases"
  ], e = [
    "scalar",
    "sequence",
    "mapping"
  ];
  function n(s) {
    const o = {};
    return s !== null && Object.keys(s).forEach(function(a) {
      s[a].forEach(function(c) {
        o[String(c)] = a;
      });
    }), o;
  }
  function i(s, o) {
    if (o = o || {}, Object.keys(o).forEach(function(a) {
      if (t.indexOf(a) === -1)
        throw new r('Unknown option "' + a + '" is met in definition of "' + s + '" YAML type.');
    }), this.options = o, this.tag = s, this.kind = o.kind || null, this.resolve = o.resolve || function() {
      return !0;
    }, this.construct = o.construct || function(a) {
      return a;
    }, this.instanceOf = o.instanceOf || null, this.predicate = o.predicate || null, this.represent = o.represent || null, this.representName = o.representName || null, this.defaultStyle = o.defaultStyle || null, this.multi = o.multi || !1, this.styleAliases = n(o.styleAliases || null), e.indexOf(this.kind) === -1)
      throw new r('Unknown kind "' + this.kind + '" is specified for "' + s + '" YAML type.');
  }
  return Gn = i, Gn;
}
var Vn, Ii;
function xo() {
  if (Ii) return Vn;
  Ii = 1;
  const r = Bt(), t = fe();
  function e(s, o) {
    const a = [];
    return s[o].forEach(function(c) {
      let u = a.length;
      a.forEach(function(f, d) {
        f.tag === c.tag && f.kind === c.kind && f.multi === c.multi && (u = d);
      }), a[u] = c;
    }), a;
  }
  function n() {
    const s = {
      scalar: {},
      sequence: {},
      mapping: {},
      fallback: {},
      multi: {
        scalar: [],
        sequence: [],
        mapping: [],
        fallback: []
      }
    };
    function o(a) {
      a.multi ? (s.multi[a.kind].push(a), s.multi.fallback.push(a)) : s[a.kind][a.tag] = s.fallback[a.tag] = a;
    }
    for (let a = 0, c = arguments.length; a < c; a += 1)
      arguments[a].forEach(o);
    return s;
  }
  function i(s) {
    return this.extend(s);
  }
  return i.prototype.extend = function(o) {
    let a = [], c = [];
    if (o instanceof t)
      c.push(o);
    else if (Array.isArray(o))
      c = c.concat(o);
    else if (o && (Array.isArray(o.implicit) || Array.isArray(o.explicit)))
      o.implicit && (a = a.concat(o.implicit)), o.explicit && (c = c.concat(o.explicit));
    else
      throw new r("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
    a.forEach(function(f) {
      if (!(f instanceof t))
        throw new r("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      if (f.loadKind && f.loadKind !== "scalar")
        throw new r("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
      if (f.multi)
        throw new r("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
    }), c.forEach(function(f) {
      if (!(f instanceof t))
        throw new r("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    });
    const u = Object.create(i.prototype);
    return u.implicit = (this.implicit || []).concat(a), u.explicit = (this.explicit || []).concat(c), u.compiledImplicit = e(u, "implicit"), u.compiledExplicit = e(u, "explicit"), u.compiledTypeMap = n(u.compiledImplicit, u.compiledExplicit), u;
  }, Vn = i, Vn;
}
var Xn, Ni;
function Ao() {
  if (Ni) return Xn;
  Ni = 1;
  const r = fe();
  return Xn = new r("tag:yaml.org,2002:str", {
    kind: "scalar",
    construct: function(t) {
      return t !== null ? t : "";
    }
  }), Xn;
}
var Qn, Ri;
function _o() {
  if (Ri) return Qn;
  Ri = 1;
  const r = fe();
  return Qn = new r("tag:yaml.org,2002:seq", {
    kind: "sequence",
    construct: function(t) {
      return t !== null ? t : [];
    }
  }), Qn;
}
var er, Mi;
function Eo() {
  if (Mi) return er;
  Mi = 1;
  const r = fe();
  return er = new r("tag:yaml.org,2002:map", {
    kind: "mapping",
    construct: function(t) {
      return t !== null ? t : {};
    }
  }), er;
}
var tr, Li;
function Co() {
  if (Li) return tr;
  Li = 1;
  const r = xo();
  return tr = new r({
    explicit: [
      Ao(),
      _o(),
      Eo()
    ]
  }), tr;
}
var nr, Pi;
function To() {
  if (Pi) return nr;
  Pi = 1;
  const r = fe();
  function t(i) {
    if (i === null) return !0;
    const s = i.length;
    return s === 1 && i === "~" || s === 4 && (i === "null" || i === "Null" || i === "NULL");
  }
  function e() {
    return null;
  }
  function n(i) {
    return i === null;
  }
  return nr = new r("tag:yaml.org,2002:null", {
    kind: "scalar",
    resolve: t,
    construct: e,
    predicate: n,
    represent: {
      canonical: function() {
        return "~";
      },
      lowercase: function() {
        return "null";
      },
      uppercase: function() {
        return "NULL";
      },
      camelcase: function() {
        return "Null";
      },
      empty: function() {
        return "";
      }
    },
    defaultStyle: "lowercase"
  }), nr;
}
var rr, Di;
function $o() {
  if (Di) return rr;
  Di = 1;
  const r = fe();
  function t(i) {
    if (i === null) return !1;
    const s = i.length;
    return s === 4 && (i === "true" || i === "True" || i === "TRUE") || s === 5 && (i === "false" || i === "False" || i === "FALSE");
  }
  function e(i) {
    return i === "true" || i === "True" || i === "TRUE";
  }
  function n(i) {
    return Object.prototype.toString.call(i) === "[object Boolean]";
  }
  return rr = new r("tag:yaml.org,2002:bool", {
    kind: "scalar",
    resolve: t,
    construct: e,
    predicate: n,
    represent: {
      lowercase: function(i) {
        return i ? "true" : "false";
      },
      uppercase: function(i) {
        return i ? "TRUE" : "FALSE";
      },
      camelcase: function(i) {
        return i ? "True" : "False";
      }
    },
    defaultStyle: "lowercase"
  }), rr;
}
var ir, Fi;
function Oo() {
  if (Fi) return ir;
  Fi = 1;
  const r = Ft(), t = fe();
  function e(u) {
    return u >= 48 && u <= 57 || u >= 65 && u <= 70 || u >= 97 && u <= 102;
  }
  function n(u) {
    return u >= 48 && u <= 55;
  }
  function i(u) {
    return u >= 48 && u <= 57;
  }
  function s(u) {
    if (u === null) return !1;
    const f = u.length;
    let d = 0, p = !1;
    if (!f) return !1;
    let m = u[d];
    if ((m === "-" || m === "+") && (m = u[++d]), m === "0") {
      if (d + 1 === f) return !0;
      if (m = u[++d], m === "b") {
        for (d++; d < f; d++) {
          if (m = u[d], m !== "0" && m !== "1") return !1;
          p = !0;
        }
        return p && isFinite(o(u));
      }
      if (m === "x") {
        for (d++; d < f; d++) {
          if (!e(u.charCodeAt(d))) return !1;
          p = !0;
        }
        return p && isFinite(o(u));
      }
      if (m === "o") {
        for (d++; d < f; d++) {
          if (!n(u.charCodeAt(d))) return !1;
          p = !0;
        }
        return p && isFinite(o(u));
      }
    }
    for (; d < f; d++) {
      if (!i(u.charCodeAt(d)))
        return !1;
      p = !0;
    }
    return p ? isFinite(o(u)) : !1;
  }
  function o(u) {
    let f = u, d = 1, p = f[0];
    if ((p === "-" || p === "+") && (p === "-" && (d = -1), f = f.slice(1), p = f[0]), f === "0") return 0;
    if (p === "0") {
      if (f[1] === "b") return d * parseInt(f.slice(2), 2);
      if (f[1] === "x") return d * parseInt(f.slice(2), 16);
      if (f[1] === "o") return d * parseInt(f.slice(2), 8);
    }
    return d * parseInt(f, 10);
  }
  function a(u) {
    return o(u);
  }
  function c(u) {
    return Object.prototype.toString.call(u) === "[object Number]" && u % 1 === 0 && !r.isNegativeZero(u);
  }
  return ir = new t("tag:yaml.org,2002:int", {
    kind: "scalar",
    resolve: s,
    construct: a,
    predicate: c,
    represent: {
      binary: function(u) {
        return u >= 0 ? "0b" + u.toString(2) : "-0b" + u.toString(2).slice(1);
      },
      octal: function(u) {
        return u >= 0 ? "0o" + u.toString(8) : "-0o" + u.toString(8).slice(1);
      },
      decimal: function(u) {
        return u.toString(10);
      },
      hexadecimal: function(u) {
        return u >= 0 ? "0x" + u.toString(16).toUpperCase() : "-0x" + u.toString(16).toUpperCase().slice(1);
      }
    },
    defaultStyle: "decimal",
    styleAliases: {
      binary: [2, "bin"],
      octal: [8, "oct"],
      decimal: [10, "dec"],
      hexadecimal: [16, "hex"]
    }
  }), ir;
}
var sr, Bi;
function jo() {
  if (Bi) return sr;
  Bi = 1;
  const r = Ft(), t = fe(), e = new RegExp(
    // 2.5e4, 2.5 and integers
    "^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
  ), n = new RegExp(
    "^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
  );
  function i(u) {
    return u === null || !e.test(u) ? !1 : isFinite(parseFloat(u, 10)) ? !0 : n.test(u);
  }
  function s(u) {
    let f = u.toLowerCase();
    const d = f[0] === "-" ? -1 : 1;
    return "+-".indexOf(f[0]) >= 0 && (f = f.slice(1)), f === ".inf" ? d === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY : f === ".nan" ? NaN : d * parseFloat(f, 10);
  }
  const o = /^[-+]?[0-9]+e/;
  function a(u, f) {
    if (isNaN(u))
      switch (f) {
        case "lowercase":
          return ".nan";
        case "uppercase":
          return ".NAN";
        case "camelcase":
          return ".NaN";
      }
    else if (Number.POSITIVE_INFINITY === u)
      switch (f) {
        case "lowercase":
          return ".inf";
        case "uppercase":
          return ".INF";
        case "camelcase":
          return ".Inf";
      }
    else if (Number.NEGATIVE_INFINITY === u)
      switch (f) {
        case "lowercase":
          return "-.inf";
        case "uppercase":
          return "-.INF";
        case "camelcase":
          return "-.Inf";
      }
    else if (r.isNegativeZero(u))
      return "-0.0";
    const d = u.toString(10);
    return o.test(d) ? d.replace("e", ".e") : d;
  }
  function c(u) {
    return Object.prototype.toString.call(u) === "[object Number]" && (u % 1 !== 0 || r.isNegativeZero(u));
  }
  return sr = new t("tag:yaml.org,2002:float", {
    kind: "scalar",
    resolve: i,
    construct: s,
    predicate: c,
    represent: a,
    defaultStyle: "lowercase"
  }), sr;
}
var or, Hi;
function Io() {
  return Hi || (Hi = 1, or = Co().extend({
    implicit: [
      To(),
      $o(),
      Oo(),
      jo()
    ]
  })), or;
}
var ar, zi;
function No() {
  return zi || (zi = 1, ar = Io()), ar;
}
var cr, Ui;
function Ro() {
  if (Ui) return cr;
  Ui = 1;
  const r = fe(), t = new RegExp(
    "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
  ), e = new RegExp(
    "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
  );
  function n(o) {
    return o === null ? !1 : t.exec(o) !== null || e.exec(o) !== null;
  }
  function i(o) {
    let a = 0, c = null, u = t.exec(o);
    if (u === null && (u = e.exec(o)), u === null) throw new Error("Date resolve error");
    const f = +u[1], d = +u[2] - 1, p = +u[3];
    if (!u[4])
      return new Date(Date.UTC(f, d, p));
    const m = +u[4], w = +u[5], k = +u[6];
    if (u[7]) {
      for (a = u[7].slice(0, 3); a.length < 3; )
        a += "0";
      a = +a;
    }
    if (u[9]) {
      const x = +u[10], A = +(u[11] || 0);
      c = (x * 60 + A) * 6e4, u[9] === "-" && (c = -c);
    }
    const _ = new Date(Date.UTC(f, d, p, m, w, k, a));
    return c && _.setTime(_.getTime() - c), _;
  }
  function s(o) {
    return o.toISOString();
  }
  return cr = new r("tag:yaml.org,2002:timestamp", {
    kind: "scalar",
    resolve: n,
    construct: i,
    instanceOf: Date,
    represent: s
  }), cr;
}
var lr, qi;
function Mo() {
  if (qi) return lr;
  qi = 1;
  const r = fe();
  function t(e) {
    return e === "<<" || e === null;
  }
  return lr = new r("tag:yaml.org,2002:merge", {
    kind: "scalar",
    resolve: t
  }), lr;
}
var ur, Wi;
function Lo() {
  if (Wi) return ur;
  Wi = 1;
  const r = fe(), t = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=
\r`;
  function e(o) {
    if (o === null) return !1;
    let a = 0;
    const c = o.length, u = t;
    for (let f = 0; f < c; f++) {
      const d = u.indexOf(o.charAt(f));
      if (!(d > 64)) {
        if (d < 0) return !1;
        a += 6;
      }
    }
    return a % 8 === 0;
  }
  function n(o) {
    const a = o.replace(/[\r\n=]/g, ""), c = a.length, u = t;
    let f = 0;
    const d = [];
    for (let m = 0; m < c; m++)
      m % 4 === 0 && m && (d.push(f >> 16 & 255), d.push(f >> 8 & 255), d.push(f & 255)), f = f << 6 | u.indexOf(a.charAt(m));
    const p = c % 4 * 6;
    return p === 0 ? (d.push(f >> 16 & 255), d.push(f >> 8 & 255), d.push(f & 255)) : p === 18 ? (d.push(f >> 10 & 255), d.push(f >> 2 & 255)) : p === 12 && d.push(f >> 4 & 255), new Uint8Array(d);
  }
  function i(o) {
    let a = "", c = 0;
    const u = o.length, f = t;
    for (let p = 0; p < u; p++)
      p % 3 === 0 && p && (a += f[c >> 18 & 63], a += f[c >> 12 & 63], a += f[c >> 6 & 63], a += f[c & 63]), c = (c << 8) + o[p];
    const d = u % 3;
    return d === 0 ? (a += f[c >> 18 & 63], a += f[c >> 12 & 63], a += f[c >> 6 & 63], a += f[c & 63]) : d === 2 ? (a += f[c >> 10 & 63], a += f[c >> 4 & 63], a += f[c << 2 & 63], a += f[64]) : d === 1 && (a += f[c >> 2 & 63], a += f[c << 4 & 63], a += f[64], a += f[64]), a;
  }
  function s(o) {
    return Object.prototype.toString.call(o) === "[object Uint8Array]";
  }
  return ur = new r("tag:yaml.org,2002:binary", {
    kind: "scalar",
    resolve: e,
    construct: n,
    predicate: s,
    represent: i
  }), ur;
}
var dr, Zi;
function Po() {
  if (Zi) return dr;
  Zi = 1;
  const r = fe(), t = Object.prototype.hasOwnProperty, e = Object.prototype.toString;
  function n(s) {
    if (s === null) return !0;
    const o = {}, a = s;
    for (let c = 0, u = a.length; c < u; c += 1) {
      const f = a[c];
      let d = !1;
      if (e.call(f) !== "[object Object]") return !1;
      let p;
      for (p in f)
        if (t.call(f, p))
          if (!d) d = !0;
          else return !1;
      if (!d || t.call(o, p)) return !1;
      Object.defineProperty(o, p, { value: !0 });
    }
    return !0;
  }
  function i(s) {
    return s !== null ? s : [];
  }
  return dr = new r("tag:yaml.org,2002:omap", {
    kind: "sequence",
    resolve: n,
    construct: i
  }), dr;
}
var fr, Ji;
function Do() {
  if (Ji) return fr;
  Ji = 1;
  const r = fe(), t = Object.prototype.toString;
  function e(i) {
    if (i === null) return !0;
    const s = i, o = new Array(s.length);
    for (let a = 0, c = s.length; a < c; a += 1) {
      const u = s[a];
      if (t.call(u) !== "[object Object]") return !1;
      const f = Object.keys(u);
      if (f.length !== 1) return !1;
      o[a] = [f[0], u[f[0]]];
    }
    return !0;
  }
  function n(i) {
    if (i === null) return [];
    const s = i, o = new Array(s.length);
    for (let a = 0, c = s.length; a < c; a += 1) {
      const u = s[a], f = Object.keys(u);
      o[a] = [f[0], u[f[0]]];
    }
    return o;
  }
  return fr = new r("tag:yaml.org,2002:pairs", {
    kind: "sequence",
    resolve: e,
    construct: n
  }), fr;
}
var pr, Ki;
function Fo() {
  if (Ki) return pr;
  Ki = 1;
  const r = fe(), t = Object.prototype.hasOwnProperty;
  function e(i) {
    if (i === null) return !0;
    const s = i;
    for (const o in s)
      if (t.call(s, o) && s[o] !== null)
        return !1;
    return !0;
  }
  function n(i) {
    return i !== null ? i : {};
  }
  return pr = new r("tag:yaml.org,2002:set", {
    kind: "mapping",
    resolve: e,
    construct: n
  }), pr;
}
var hr, Yi;
function Dr() {
  return Yi || (Yi = 1, hr = No().extend({
    implicit: [
      Ro(),
      Mo()
    ],
    explicit: [
      Lo(),
      Po(),
      Do(),
      Fo()
    ]
  })), hr;
}
var Gi;
function Fu() {
  if (Gi) return cn;
  Gi = 1;
  const r = Ft(), t = Bt(), e = Du(), n = Dr(), i = Object.prototype.hasOwnProperty, s = 1, o = 2, a = 3, c = 4, u = 1, f = 2, d = 3, p = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/, m = /[\x85\u2028\u2029]/, w = /[,\[\]{}]/, k = /^(?:!|!!|![0-9A-Za-z-]+!)$/, _ = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
  function x(l) {
    return Object.prototype.toString.call(l);
  }
  function A(l) {
    return l === 10 || l === 13;
  }
  function N(l) {
    return l === 9 || l === 32;
  }
  function j(l) {
    return l === 9 || l === 32 || l === 10 || l === 13;
  }
  function P(l) {
    return l === 44 || l === 91 || l === 93 || l === 123 || l === 125;
  }
  function z(l) {
    if (l >= 48 && l <= 57)
      return l - 48;
    const b = l | 32;
    return b >= 97 && b <= 102 ? b - 97 + 10 : -1;
  }
  function F(l) {
    return l === 120 ? 2 : l === 117 ? 4 : l === 85 ? 8 : 0;
  }
  function K(l) {
    return l >= 48 && l <= 57 ? l - 48 : -1;
  }
  function Y(l) {
    switch (l) {
      case 48:
        return "\0";
      case 97:
        return "\x07";
      case 98:
        return "\b";
      case 116:
        return "	";
      case 9:
        return "	";
      case 110:
        return `
`;
      case 118:
        return "\v";
      case 102:
        return "\f";
      case 114:
        return "\r";
      case 101:
        return "\x1B";
      case 32:
        return " ";
      case 34:
        return '"';
      case 47:
        return "/";
      case 92:
        return "\\";
      case 78:
        return "";
      case 95:
        return " ";
      case 76:
        return "\u2028";
      case 80:
        return "\u2029";
      default:
        return "";
    }
  }
  function X(l) {
    return l <= 65535 ? String.fromCharCode(l) : String.fromCharCode(
      (l - 65536 >> 10) + 55296,
      (l - 65536 & 1023) + 56320
    );
  }
  function J(l, b, C) {
    b === "__proto__" ? Object.defineProperty(l, b, {
      configurable: !0,
      enumerable: !0,
      writable: !0,
      value: C
    }) : l[b] = C;
  }
  const te = new Array(256), me = new Array(256);
  for (let l = 0; l < 256; l++)
    te[l] = Y(l) ? 1 : 0, me[l] = Y(l);
  function ae(l, b) {
    this.input = l, this.filename = b.filename || null, this.schema = b.schema || n, this.onWarning = b.onWarning || null, this.legacy = b.legacy || !1, this.json = b.json || !1, this.listener = b.listener || null, this.maxDepth = typeof b.maxDepth == "number" ? b.maxDepth : 100, this.maxTotalMergeKeys = typeof b.maxTotalMergeKeys == "number" ? b.maxTotalMergeKeys : 1e4, this.implicitTypes = this.schema.compiledImplicit, this.typeMap = this.schema.compiledTypeMap, this.length = l.length, this.position = 0, this.line = 0, this.lineStart = 0, this.lineIndent = 0, this.depth = 0, this.totalMergeKeys = 0, this.firstTabInLine = -1, this.documents = [], this.anchorMapTransactions = [];
  }
  function Ht(l, b) {
    const C = {
      name: l.filename,
      buffer: l.input.slice(0, -1),
      // omit trailing \0
      position: l.position,
      line: l.line,
      column: l.position - l.lineStart
    };
    return C.snippet = e(C), new t(b, C);
  }
  function U(l, b) {
    throw Ht(l, b);
  }
  function it(l, b) {
    l.onWarning && l.onWarning.call(null, Ht(l, b));
  }
  function $e(l, b, C) {
    const O = l.anchorMapTransactions;
    if (O.length !== 0) {
      const E = O[O.length - 1];
      i.call(E, b) || (E[b] = {
        existed: i.call(l.anchorMap, b),
        value: l.anchorMap[b]
      });
    }
    l.anchorMap[b] = C;
  }
  function On(l) {
    l.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
  }
  function Je(l) {
    const b = l.anchorMapTransactions.pop(), C = l.anchorMapTransactions;
    if (C.length === 0) return;
    const O = C[C.length - 1], E = Object.keys(b);
    for (let L = 0, h = E.length; L < h; L += 1) {
      const S = E[L];
      i.call(O, S) || (O[S] = b[S]);
    }
  }
  function jn(l) {
    const b = l.anchorMapTransactions.pop(), C = Object.keys(b);
    for (let O = C.length - 1; O >= 0; O -= 1) {
      const E = b[C[O]];
      E.existed ? l.anchorMap[C[O]] = E.value : delete l.anchorMap[C[O]];
    }
  }
  function vt(l) {
    return {
      position: l.position,
      line: l.line,
      lineStart: l.lineStart,
      lineIndent: l.lineIndent,
      firstTabInLine: l.firstTabInLine,
      tag: l.tag,
      anchor: l.anchor,
      kind: l.kind,
      result: l.result
    };
  }
  function st(l, b) {
    l.position = b.position, l.line = b.line, l.lineStart = b.lineStart, l.lineIndent = b.lineIndent, l.firstTabInLine = b.firstTabInLine, l.tag = b.tag, l.anchor = b.anchor, l.kind = b.kind, l.result = b.result;
  }
  const zt = {
    YAML: function(b, C, O) {
      b.version !== null && U(b, "duplication of %YAML directive"), O.length !== 1 && U(b, "YAML directive accepts exactly one argument");
      const E = /^([0-9]+)\.([0-9]+)$/.exec(O[0]);
      E === null && U(b, "ill-formed argument of the YAML directive");
      const L = parseInt(E[1], 10), h = parseInt(E[2], 10);
      L !== 1 && U(b, "unacceptable YAML version of the document"), b.version = O[0], b.checkLineBreaks = h < 2, h !== 1 && h !== 2 && it(b, "unsupported YAML version of the document");
    },
    TAG: function(b, C, O) {
      let E;
      O.length !== 2 && U(b, "TAG directive accepts exactly two arguments");
      const L = O[0];
      E = O[1], k.test(L) || U(b, "ill-formed tag handle (first argument) of the TAG directive"), i.call(b.tagMap, L) && U(b, 'there is a previously declared suffix for "' + L + '" tag handle'), _.test(E) || U(b, "ill-formed tag prefix (second argument) of the TAG directive");
      try {
        E = decodeURIComponent(E);
      } catch {
        U(b, "tag prefix is malformed: " + E);
      }
      b.tagMap[L] = E;
    }
  };
  function ge(l, b, C, O) {
    if (b < C) {
      const E = l.input.slice(b, C);
      if (O)
        for (let L = 0, h = E.length; L < h; L += 1) {
          const S = E.charCodeAt(L);
          S === 9 || S >= 32 && S <= 1114111 || U(l, "expected valid JSON character");
        }
      else p.test(E) && U(l, "the stream contains non-printable characters");
      l.result += E;
    }
  }
  function Me(l, b, C, O) {
    r.isObject(C) || U(l, "cannot merge mappings; the provided source object is unacceptable");
    const E = Object.keys(C);
    for (let L = 0, h = E.length; L < h; L += 1) {
      const S = E[L];
      l.maxTotalMergeKeys !== -1 && ++l.totalMergeKeys > l.maxTotalMergeKeys && U(l, "merge keys exceeded maxTotalMergeKeys (" + l.maxTotalMergeKeys + ")"), i.call(b, S) || (J(b, S, C[S]), O[S] = !0);
    }
  }
  function Oe(l, b, C, O, E, L, h, S, R) {
    if (Array.isArray(E)) {
      E = Array.prototype.slice.call(E);
      for (let T = 0, $ = E.length; T < $; T += 1)
        Array.isArray(E[T]) && U(l, "nested arrays are not supported inside keys"), typeof E == "object" && x(E[T]) === "[object Object]" && (E[T] = "[object Object]");
    }
    if (typeof E == "object" && x(E) === "[object Object]" && (E = "[object Object]"), E = String(E), b === null && (b = {}), O === "tag:yaml.org,2002:merge")
      if (Array.isArray(L))
        for (let T = 0, $ = L.length; T < $; T += 1)
          Me(l, b, L[T], C);
      else
        Me(l, b, L, C);
    else
      !l.json && !i.call(C, E) && i.call(b, E) && (l.line = h || l.line, l.lineStart = S || l.lineStart, l.position = R || l.position, U(l, "duplicated mapping key")), J(b, E, L), delete C[E];
    return b;
  }
  function ot(l) {
    const b = l.input.charCodeAt(l.position);
    b === 10 ? l.position++ : b === 13 ? (l.position++, l.input.charCodeAt(l.position) === 10 && l.position++) : U(l, "a line break is expected"), l.line += 1, l.lineStart = l.position, l.firstTabInLine = -1;
  }
  function re(l, b, C) {
    let O = 0, E = l.input.charCodeAt(l.position);
    for (; E !== 0; ) {
      for (; N(E); )
        E === 9 && l.firstTabInLine === -1 && (l.firstTabInLine = l.position), E = l.input.charCodeAt(++l.position);
      if (b && E === 35)
        do
          E = l.input.charCodeAt(++l.position);
        while (E !== 10 && E !== 13 && E !== 0);
      if (A(E))
        for (ot(l), E = l.input.charCodeAt(l.position), O++, l.lineIndent = 0; E === 32; )
          l.lineIndent++, E = l.input.charCodeAt(++l.position);
      else
        break;
    }
    return C !== -1 && O !== 0 && l.lineIndent < C && it(l, "deficient indentation"), O;
  }
  function at(l) {
    let b = l.position, C = l.input.charCodeAt(b);
    return !!((C === 45 || C === 46) && C === l.input.charCodeAt(b + 1) && C === l.input.charCodeAt(b + 2) && (b += 3, C = l.input.charCodeAt(b), C === 0 || j(C)));
  }
  function je(l, b) {
    b === 1 ? l.result += " " : b > 1 && (l.result += r.repeat(`
`, b - 1));
  }
  function Ut(l, b, C) {
    let O, E, L, h, S, R;
    const T = l.kind, $ = l.result;
    let M = l.input.charCodeAt(l.position);
    if (j(M) || P(M) || M === 35 || M === 38 || M === 42 || M === 33 || M === 124 || M === 62 || M === 39 || M === 34 || M === 37 || M === 64 || M === 96)
      return !1;
    if (M === 63 || M === 45) {
      const I = l.input.charCodeAt(l.position + 1);
      if (j(I) || C && P(I))
        return !1;
    }
    for (l.kind = "scalar", l.result = "", O = E = l.position, L = !1; M !== 0; ) {
      if (M === 58) {
        const I = l.input.charCodeAt(l.position + 1);
        if (j(I) || C && P(I))
          break;
      } else if (M === 35) {
        const I = l.input.charCodeAt(l.position - 1);
        if (j(I))
          break;
      } else {
        if (l.position === l.lineStart && at(l) || C && P(M))
          break;
        if (A(M))
          if (h = l.line, S = l.lineStart, R = l.lineIndent, re(l, !1, -1), l.lineIndent >= b) {
            L = !0, M = l.input.charCodeAt(l.position);
            continue;
          } else {
            l.position = E, l.line = h, l.lineStart = S, l.lineIndent = R;
            break;
          }
      }
      L && (ge(l, O, E, !1), je(l, l.line - h), O = E = l.position, L = !1), N(M) || (E = l.position + 1), M = l.input.charCodeAt(++l.position);
    }
    return ge(l, O, E, !1), l.result ? !0 : (l.kind = T, l.result = $, !1);
  }
  function qt(l, b) {
    let C, O, E = l.input.charCodeAt(l.position);
    if (E !== 39)
      return !1;
    for (l.kind = "scalar", l.result = "", l.position++, C = O = l.position; (E = l.input.charCodeAt(l.position)) !== 0; )
      if (E === 39)
        if (ge(l, C, l.position, !0), E = l.input.charCodeAt(++l.position), E === 39)
          C = l.position, l.position++, O = l.position;
        else
          return !0;
      else A(E) ? (ge(l, C, O, !0), je(l, re(l, !1, b)), C = O = l.position) : l.position === l.lineStart && at(l) ? U(l, "unexpected end of the document within a single quoted scalar") : (l.position++, N(E) || (O = l.position));
    U(l, "unexpected end of the stream within a single quoted scalar");
  }
  function kt(l, b) {
    let C, O, E, L = l.input.charCodeAt(l.position);
    if (L !== 34)
      return !1;
    for (l.kind = "scalar", l.result = "", l.position++, C = O = l.position; (L = l.input.charCodeAt(l.position)) !== 0; ) {
      if (L === 34)
        return ge(l, C, l.position, !0), l.position++, !0;
      if (L === 92) {
        if (ge(l, C, l.position, !0), L = l.input.charCodeAt(++l.position), A(L))
          re(l, !1, b);
        else if (L < 256 && te[L])
          l.result += me[L], l.position++;
        else if ((E = F(L)) > 0) {
          let h = E, S = 0;
          for (; h > 0; h--)
            L = l.input.charCodeAt(++l.position), (E = z(L)) >= 0 ? S = (S << 4) + E : U(l, "expected hexadecimal character");
          l.result += X(S), l.position++;
        } else
          U(l, "unknown escape sequence");
        C = O = l.position;
      } else A(L) ? (ge(l, C, O, !0), je(l, re(l, !1, b)), C = O = l.position) : l.position === l.lineStart && at(l) ? U(l, "unexpected end of the document within a double quoted scalar") : (l.position++, N(L) || (O = l.position));
    }
    U(l, "unexpected end of the stream within a double quoted scalar");
  }
  function Wt(l, b) {
    let C = !0, O, E, L;
    const h = l.tag;
    let S;
    const R = l.anchor;
    let T, $, M, I;
    const B = /* @__PURE__ */ Object.create(null);
    let D, q, W, G = l.input.charCodeAt(l.position);
    if (G === 91)
      T = 93, I = !1, S = [];
    else if (G === 123)
      T = 125, I = !0, S = {};
    else
      return !1;
    for (l.anchor !== null && $e(l, l.anchor, S), G = l.input.charCodeAt(++l.position); G !== 0; ) {
      if (re(l, !0, b), G = l.input.charCodeAt(l.position), G === T)
        return l.position++, l.tag = h, l.anchor = R, l.kind = I ? "mapping" : "sequence", l.result = S, !0;
      if (C ? G === 44 && U(l, "expected the node content, but found ','") : U(l, "missed comma between flow collection entries"), q = D = W = null, $ = M = !1, G === 63) {
        const Q = l.input.charCodeAt(l.position + 1);
        j(Q) && ($ = M = !0, l.position++, re(l, !0, b));
      }
      O = l.line, E = l.lineStart, L = l.position, Ne(l, b, s, !1, !0), q = l.tag, D = l.result, re(l, !0, b), G = l.input.charCodeAt(l.position), (M || l.line === O) && G === 58 && ($ = !0, G = l.input.charCodeAt(++l.position), re(l, !0, b), Ne(l, b, s, !1, !0), W = l.result), I ? Oe(l, S, B, q, D, W, O, E, L) : $ ? S.push(Oe(l, null, B, q, D, W, O, E, L)) : S.push(D), re(l, !0, b), G = l.input.charCodeAt(l.position), G === 44 ? (C = !0, G = l.input.charCodeAt(++l.position)) : C = !1;
    }
    U(l, "unexpected end of the stream within a flow collection");
  }
  function Zt(l, b) {
    let C, O = u, E = !1, L = !1, h = b, S = 0, R = !1, T, $ = l.input.charCodeAt(l.position);
    if ($ === 124)
      C = !1;
    else if ($ === 62)
      C = !0;
    else
      return !1;
    for (l.kind = "scalar", l.result = ""; $ !== 0; )
      if ($ = l.input.charCodeAt(++l.position), $ === 43 || $ === 45)
        u === O ? O = $ === 43 ? d : f : U(l, "repeat of a chomping mode identifier");
      else if ((T = K($)) >= 0)
        T === 0 ? U(l, "bad explicit indentation width of a block scalar; it cannot be less than one") : L ? U(l, "repeat of an indentation width identifier") : (h = b + T - 1, L = !0);
      else
        break;
    if (N($)) {
      do
        $ = l.input.charCodeAt(++l.position);
      while (N($));
      if ($ === 35)
        do
          $ = l.input.charCodeAt(++l.position);
        while (!A($) && $ !== 0);
    }
    for (; $ !== 0; ) {
      for (ot(l), l.lineIndent = 0, $ = l.input.charCodeAt(l.position); (!L || l.lineIndent < h) && $ === 32; )
        l.lineIndent++, $ = l.input.charCodeAt(++l.position);
      if (!L && l.lineIndent > h && (h = l.lineIndent), A($)) {
        S++;
        continue;
      }
      if (!L && h === 0 && U(l, "missing indentation for block scalar"), l.lineIndent < h) {
        O === d ? l.result += r.repeat(`
`, E ? 1 + S : S) : O === u && E && (l.result += `
`);
        break;
      }
      C ? N($) ? (R = !0, l.result += r.repeat(`
`, E ? 1 + S : S)) : R ? (R = !1, l.result += r.repeat(`
`, S + 1)) : S === 0 ? E && (l.result += " ") : l.result += r.repeat(`
`, S) : l.result += r.repeat(`
`, E ? 1 + S : S), E = !0, L = !0, S = 0;
      const M = l.position;
      for (; !A($) && $ !== 0; )
        $ = l.input.charCodeAt(++l.position);
      ge(l, M, l.position, !1);
    }
    return !0;
  }
  function Ie(l, b) {
    const C = l.tag, O = l.anchor, E = [];
    let L = !1;
    if (l.firstTabInLine !== -1) return !1;
    l.anchor !== null && $e(l, l.anchor, E);
    let h = l.input.charCodeAt(l.position);
    for (; h !== 0 && (l.firstTabInLine !== -1 && (l.position = l.firstTabInLine, U(l, "tab characters must not be used in indentation")), h === 45); ) {
      const S = l.input.charCodeAt(l.position + 1);
      if (!j(S))
        break;
      if (L = !0, l.position++, re(l, !0, -1) && l.lineIndent <= b) {
        E.push(null), h = l.input.charCodeAt(l.position);
        continue;
      }
      const R = l.line;
      if (Ne(l, b, a, !1, !0), E.push(l.result), re(l, !0, -1), h = l.input.charCodeAt(l.position), (l.line === R || l.lineIndent > b) && h !== 0)
        U(l, "bad indentation of a sequence entry");
      else if (l.lineIndent < b)
        break;
    }
    return L ? (l.tag = C, l.anchor = O, l.kind = "sequence", l.result = E, !0) : !1;
  }
  function Jt(l, b, C) {
    let O, E, L, h;
    const S = l.tag, R = l.anchor, T = {}, $ = /* @__PURE__ */ Object.create(null);
    let M = null, I = null, B = null, D = !1, q = !1;
    if (l.firstTabInLine !== -1) return !1;
    l.anchor !== null && $e(l, l.anchor, T);
    let W = l.input.charCodeAt(l.position);
    for (; W !== 0; ) {
      !D && l.firstTabInLine !== -1 && (l.position = l.firstTabInLine, U(l, "tab characters must not be used in indentation"));
      const G = l.input.charCodeAt(l.position + 1), Q = l.line;
      if ((W === 63 || W === 58) && j(G))
        W === 63 ? (D && (Oe(l, T, $, M, I, null, E, L, h), M = I = B = null), q = !0, D = !0, O = !0) : D ? (D = !1, O = !0) : U(l, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line"), l.position += 1, W = G;
      else {
        if (E = l.line, L = l.lineStart, h = l.position, !Ne(l, C, o, !1, !0))
          break;
        if (l.line === Q) {
          for (W = l.input.charCodeAt(l.position); N(W); )
            W = l.input.charCodeAt(++l.position);
          if (W === 58)
            W = l.input.charCodeAt(++l.position), j(W) || U(l, "a whitespace character is expected after the key-value separator within a block mapping"), D && (Oe(l, T, $, M, I, null, E, L, h), M = I = B = null), q = !0, D = !1, O = !1, M = l.tag, I = l.result;
          else if (q)
            U(l, "can not read an implicit mapping pair; a colon is missed");
          else
            return l.tag = S, l.anchor = R, !0;
        } else if (q)
          U(l, "can not read a block mapping entry; a multiline key may not be an implicit key");
        else
          return l.tag = S, l.anchor = R, !0;
      }
      if ((l.line === Q || l.lineIndent > b) && (D && (E = l.line, L = l.lineStart, h = l.position), Ne(l, b, c, !0, O) && (D ? I = l.result : B = l.result), D || (Oe(l, T, $, M, I, B, E, L, h), M = I = B = null), re(l, !0, -1), W = l.input.charCodeAt(l.position)), (l.line === Q || l.lineIndent > b) && W !== 0)
        U(l, "bad indentation of a mapping entry");
      else if (l.lineIndent < b)
        break;
    }
    return D && Oe(l, T, $, M, I, null, E, L, h), q && (l.tag = S, l.anchor = R, l.kind = "mapping", l.result = T), q;
  }
  function In(l) {
    let b = !1, C = !1, O, E, L = l.input.charCodeAt(l.position);
    if (L !== 33) return !1;
    l.tag !== null && U(l, "duplication of a tag property"), L = l.input.charCodeAt(++l.position), L === 60 ? (b = !0, L = l.input.charCodeAt(++l.position)) : L === 33 ? (C = !0, O = "!!", L = l.input.charCodeAt(++l.position)) : O = "!";
    let h = l.position;
    if (b) {
      do
        L = l.input.charCodeAt(++l.position);
      while (L !== 0 && L !== 62);
      l.position < l.length ? (E = l.input.slice(h, l.position), L = l.input.charCodeAt(++l.position)) : U(l, "unexpected end of the stream within a verbatim tag");
    } else {
      for (; L !== 0 && !j(L); )
        L === 33 && (C ? U(l, "tag suffix cannot contain exclamation marks") : (O = l.input.slice(h - 1, l.position + 1), k.test(O) || U(l, "named tag handle cannot contain such characters"), C = !0, h = l.position + 1)), L = l.input.charCodeAt(++l.position);
      E = l.input.slice(h, l.position), w.test(E) && U(l, "tag suffix cannot contain flow indicator characters");
    }
    E && !_.test(E) && U(l, "tag name cannot contain such characters: " + E);
    try {
      E = decodeURIComponent(E);
    } catch {
      U(l, "tag name is malformed: " + E);
    }
    return b ? l.tag = E : i.call(l.tagMap, O) ? l.tag = l.tagMap[O] + E : O === "!" ? l.tag = "!" + E : O === "!!" ? l.tag = "tag:yaml.org,2002:" + E : U(l, 'undeclared tag handle "' + O + '"'), !0;
  }
  function Kt(l) {
    let b = l.input.charCodeAt(l.position);
    if (b !== 38) return !1;
    l.anchor !== null && U(l, "duplication of an anchor property"), b = l.input.charCodeAt(++l.position);
    const C = l.position;
    for (; b !== 0 && !j(b) && !P(b); )
      b = l.input.charCodeAt(++l.position);
    return l.position === C && U(l, "name of an anchor node must contain at least one character"), l.anchor = l.input.slice(C, l.position), !0;
  }
  function Yt(l) {
    let b = l.input.charCodeAt(l.position);
    if (b !== 42) return !1;
    b = l.input.charCodeAt(++l.position);
    const C = l.position;
    for (; b !== 0 && !j(b) && !P(b); )
      b = l.input.charCodeAt(++l.position);
    l.position === C && U(l, "name of an alias node must contain at least one character");
    const O = l.input.slice(C, l.position);
    return i.call(l.anchorMap, O) || U(l, 'unidentified alias "' + O + '"'), l.result = l.anchorMap[O], re(l, !0, -1), !0;
  }
  function Nn(l, b, C, O) {
    const E = vt(l);
    return On(l), st(l, b), l.tag = null, l.anchor = null, l.kind = null, l.result = null, Jt(l, C, O) && l.kind === "mapping" ? (Je(l), !0) : (jn(l), st(l, E), !1);
  }
  function Ne(l, b, C, O, E) {
    let L, h, S = 1, R = !1, T = !1, $ = null, M, I, B;
    l.depth >= l.maxDepth && U(l, "nesting exceeded maxDepth (" + l.maxDepth + ")"), l.depth += 1, l.listener !== null && l.listener("open", l), l.tag = null, l.anchor = null, l.kind = null, l.result = null;
    const D = L = h = c === C || a === C;
    if (O && re(l, !0, -1) && (R = !0, l.lineIndent > b ? S = 1 : l.lineIndent === b ? S = 0 : l.lineIndent < b && (S = -1)), S === 1)
      for (; ; ) {
        const q = l.input.charCodeAt(l.position), W = vt(l);
        if (R && (q === 33 && l.tag !== null || q === 38 && l.anchor !== null) || !In(l) && !Kt(l))
          break;
        $ === null && ($ = W), re(l, !0, -1) ? (R = !0, h = D, l.lineIndent > b ? S = 1 : l.lineIndent === b ? S = 0 : l.lineIndent < b && (S = -1)) : h = !1;
      }
    if (h && (h = R || E), S === 1 || c === C)
      if (s === C || o === C ? I = b : I = b + 1, B = l.position - l.lineStart, S === 1)
        if (h && (Ie(l, B) || Jt(l, B, I)) || Wt(l, I))
          T = !0;
        else {
          const q = l.input.charCodeAt(l.position);
          $ !== null && D && !h && q !== 124 && q !== 62 && Nn(
            l,
            $,
            $.position - $.lineStart,
            I
          ) || L && Zt(l, I) || qt(l, I) || kt(l, I) ? T = !0 : Yt(l) ? (T = !0, (l.tag !== null || l.anchor !== null) && U(l, "alias node should not have any properties")) : Ut(l, I, s === C) && (T = !0, l.tag === null && (l.tag = "?")), l.anchor !== null && $e(l, l.anchor, l.result);
        }
      else S === 0 && (T = h && Ie(l, B));
    if (l.tag === null)
      l.anchor !== null && $e(l, l.anchor, l.result);
    else if (l.tag === "?") {
      l.result !== null && l.kind !== "scalar" && U(l, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + l.kind + '"');
      for (let q = 0, W = l.implicitTypes.length; q < W; q += 1)
        if (M = l.implicitTypes[q], M.resolve(l.result)) {
          l.result = M.construct(l.result), l.tag = M.tag, l.anchor !== null && $e(l, l.anchor, l.result);
          break;
        }
    } else if (l.tag !== "!") {
      if (i.call(l.typeMap[l.kind || "fallback"], l.tag))
        M = l.typeMap[l.kind || "fallback"][l.tag];
      else {
        M = null;
        const q = l.typeMap.multi[l.kind || "fallback"];
        for (let W = 0, G = q.length; W < G; W += 1)
          if (l.tag.slice(0, q[W].tag.length) === q[W].tag) {
            M = q[W];
            break;
          }
      }
      M || U(l, "unknown tag !<" + l.tag + ">"), l.result !== null && M.kind !== l.kind && U(l, "unacceptable node kind for !<" + l.tag + '> tag; it should be "' + M.kind + '", not "' + l.kind + '"'), M.resolve(l.result, l.tag) ? (l.result = M.construct(l.result, l.tag), l.anchor !== null && $e(l, l.anchor, l.result)) : U(l, "cannot resolve a node with !<" + l.tag + "> explicit tag");
    }
    return l.listener !== null && l.listener("close", l), l.depth -= 1, l.tag !== null || l.anchor !== null || T;
  }
  function Rn(l) {
    const b = l.position;
    let C = !1, O;
    for (l.version = null, l.checkLineBreaks = l.legacy, l.tagMap = /* @__PURE__ */ Object.create(null), l.anchorMap = /* @__PURE__ */ Object.create(null); (O = l.input.charCodeAt(l.position)) !== 0 && (re(l, !0, -1), O = l.input.charCodeAt(l.position), !(l.lineIndent > 0 || O !== 37)); ) {
      C = !0, O = l.input.charCodeAt(++l.position);
      let E = l.position;
      for (; O !== 0 && !j(O); )
        O = l.input.charCodeAt(++l.position);
      const L = l.input.slice(E, l.position), h = [];
      for (L.length < 1 && U(l, "directive name must not be less than one character in length"); O !== 0; ) {
        for (; N(O); )
          O = l.input.charCodeAt(++l.position);
        if (O === 35) {
          do
            O = l.input.charCodeAt(++l.position);
          while (O !== 0 && !A(O));
          break;
        }
        if (A(O)) break;
        for (E = l.position; O !== 0 && !j(O); )
          O = l.input.charCodeAt(++l.position);
        h.push(l.input.slice(E, l.position));
      }
      O !== 0 && ot(l), i.call(zt, L) ? zt[L](l, L, h) : it(l, 'unknown document directive "' + L + '"');
    }
    if (re(l, !0, -1), l.lineIndent === 0 && l.input.charCodeAt(l.position) === 45 && l.input.charCodeAt(l.position + 1) === 45 && l.input.charCodeAt(l.position + 2) === 45 ? (l.position += 3, re(l, !0, -1)) : C && U(l, "directives end mark is expected"), Ne(l, l.lineIndent - 1, c, !1, !0), re(l, !0, -1), l.checkLineBreaks && m.test(l.input.slice(b, l.position)) && it(l, "non-ASCII line breaks are interpreted as content"), l.documents.push(l.result), l.position === l.lineStart && at(l)) {
      l.input.charCodeAt(l.position) === 46 && (l.position += 3, re(l, !0, -1));
      return;
    }
    l.position < l.length - 1 && U(l, "end of the stream or a document separator is expected");
  }
  function Gt(l, b) {
    l = String(l), b = b || {}, l.length !== 0 && (l.charCodeAt(l.length - 1) !== 10 && l.charCodeAt(l.length - 1) !== 13 && (l += `
`), l.charCodeAt(0) === 65279 && (l = l.slice(1)));
    const C = new ae(l, b), O = l.indexOf("\0");
    for (O !== -1 && (C.position = O, U(C, "null byte is not allowed in input")), C.input += "\0"; C.input.charCodeAt(C.position) === 32; )
      C.lineIndent += 1, C.position += 1;
    for (; C.position < C.length - 1; )
      Rn(C);
    return C.documents;
  }
  function Vt(l, b, C) {
    b !== null && typeof b == "object" && typeof C > "u" && (C = b, b = null);
    const O = Gt(l, C);
    if (typeof b != "function")
      return O;
    for (let E = 0, L = O.length; E < L; E += 1)
      b(O[E]);
  }
  function Mn(l, b) {
    const C = Gt(l, b);
    if (C.length !== 0) {
      if (C.length === 1)
        return C[0];
      throw new t("expected a single document in the stream, but found more");
    }
  }
  return cn.loadAll = Vt, cn.load = Mn, cn;
}
var mr = {}, Vi;
function Bu() {
  if (Vi) return mr;
  Vi = 1;
  const r = Ft(), t = Bt(), e = Dr(), n = Object.prototype.toString, i = Object.prototype.hasOwnProperty, s = 65279, o = 9, a = 10, c = 13, u = 32, f = 33, d = 34, p = 35, m = 37, w = 38, k = 39, _ = 42, x = 44, A = 45, N = 58, j = 61, P = 62, z = 63, F = 64, K = 91, Y = 93, X = 96, J = 123, te = 124, me = 125, ae = {};
  ae[0] = "\\0", ae[7] = "\\a", ae[8] = "\\b", ae[9] = "\\t", ae[10] = "\\n", ae[11] = "\\v", ae[12] = "\\f", ae[13] = "\\r", ae[27] = "\\e", ae[34] = '\\"', ae[92] = "\\\\", ae[133] = "\\N", ae[160] = "\\_", ae[8232] = "\\L", ae[8233] = "\\P";
  const Ht = [
    "y",
    "Y",
    "yes",
    "Yes",
    "YES",
    "on",
    "On",
    "ON",
    "n",
    "N",
    "no",
    "No",
    "NO",
    "off",
    "Off",
    "OFF"
  ], U = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
  function it(h, S) {
    if (S === null) return {};
    const R = {}, T = Object.keys(S);
    for (let $ = 0, M = T.length; $ < M; $ += 1) {
      let I = T[$], B = String(S[I]);
      I.slice(0, 2) === "!!" && (I = "tag:yaml.org,2002:" + I.slice(2));
      const D = h.compiledTypeMap.fallback[I];
      D && i.call(D.styleAliases, B) && (B = D.styleAliases[B]), R[I] = B;
    }
    return R;
  }
  function $e(h) {
    let S, R;
    const T = h.toString(16).toUpperCase();
    if (h <= 255)
      S = "x", R = 2;
    else if (h <= 65535)
      S = "u", R = 4;
    else if (h <= 4294967295)
      S = "U", R = 8;
    else
      throw new t("code point within a string may not be greater than 0xFFFFFFFF");
    return "\\" + S + r.repeat("0", R - T.length) + T;
  }
  const On = 1, Je = 2;
  function jn(h) {
    this.schema = h.schema || e, this.indent = Math.max(1, h.indent || 2), this.noArrayIndent = h.noArrayIndent || !1, this.skipInvalid = h.skipInvalid || !1, this.flowLevel = r.isNothing(h.flowLevel) ? -1 : h.flowLevel, this.styleMap = it(this.schema, h.styles || null), this.sortKeys = h.sortKeys || !1, this.lineWidth = h.lineWidth || 80, this.noRefs = h.noRefs || !1, this.noCompatMode = h.noCompatMode || !1, this.condenseFlow = h.condenseFlow || !1, this.quotingType = h.quotingType === '"' ? Je : On, this.forceQuotes = h.forceQuotes || !1, this.replacer = typeof h.replacer == "function" ? h.replacer : null, this.implicitTypes = this.schema.compiledImplicit, this.explicitTypes = this.schema.compiledExplicit, this.tag = null, this.result = "", this.duplicates = [], this.usedDuplicates = null;
  }
  function vt(h, S) {
    const R = r.repeat(" ", S);
    let T = 0, $ = "";
    const M = h.length;
    for (; T < M; ) {
      let I;
      const B = h.indexOf(`
`, T);
      B === -1 ? (I = h.slice(T), T = M) : (I = h.slice(T, B + 1), T = B + 1), I.length && I !== `
` && ($ += R), $ += I;
    }
    return $;
  }
  function st(h, S) {
    return `
` + r.repeat(" ", h.indent * S);
  }
  function zt(h, S) {
    for (let R = 0, T = h.implicitTypes.length; R < T; R += 1)
      if (h.implicitTypes[R].resolve(S))
        return !0;
    return !1;
  }
  function ge(h) {
    return h === u || h === o;
  }
  function Me(h) {
    return h >= 32 && h <= 126 || h >= 161 && h <= 55295 && h !== 8232 && h !== 8233 || h >= 57344 && h <= 65533 && h !== s || h >= 65536 && h <= 1114111;
  }
  function Oe(h) {
    return Me(h) && h !== s && // - b-char
    h !== c && h !== a;
  }
  function ot(h, S, R) {
    const T = Oe(h), $ = T && !ge(h);
    return (
      // ns-plain-safe
      (R ? T : T && // - c-flow-indicator
      h !== x && h !== K && h !== Y && h !== J && h !== me) && // ns-plain-char
      h !== p && // false on '#'
      !(S === N && !$) || // false on ': '
      Oe(S) && !ge(S) && h === p || // change to true on '[^ ]#'
      S === N && $
    );
  }
  function re(h) {
    return Me(h) && h !== s && !ge(h) && // - s-white
    // - (c-indicator ::=
    // “-” | “?” | “:” | “,” | “[” | “]” | “{” | “}”
    h !== A && h !== z && h !== N && h !== x && h !== K && h !== Y && h !== J && h !== me && // | “#” | “&” | “*” | “!” | “|” | “=” | “>” | “'” | “"”
    h !== p && h !== w && h !== _ && h !== f && h !== te && h !== j && h !== P && h !== k && h !== d && // | “%” | “@” | “`”)
    h !== m && h !== F && h !== X;
  }
  function at(h) {
    return !ge(h) && h !== N;
  }
  function je(h, S) {
    const R = h.charCodeAt(S);
    let T;
    return R >= 55296 && R <= 56319 && S + 1 < h.length && (T = h.charCodeAt(S + 1), T >= 56320 && T <= 57343) ? (R - 55296) * 1024 + T - 56320 + 65536 : R;
  }
  function Ut(h) {
    return /^\n* /.test(h);
  }
  const qt = 1, kt = 2, Wt = 3, Zt = 4, Ie = 5;
  function Jt(h, S, R, T, $, M, I, B) {
    let D, q = 0, W = null, G = !1, Q = !1;
    const zr = T !== -1;
    let St = -1, xt = re(je(h, 0)) && at(je(h, h.length - 1));
    if (S || I)
      for (D = 0; D < h.length; q >= 65536 ? D += 2 : D++) {
        if (q = je(h, D), !Me(q))
          return Ie;
        xt = xt && ot(q, W, B), W = q;
      }
    else {
      for (D = 0; D < h.length; q >= 65536 ? D += 2 : D++) {
        if (q = je(h, D), q === a)
          G = !0, zr && (Q = Q || // Foldable line = too long, and not more-indented.
          D - St - 1 > T && h[St + 1] !== " ", St = D);
        else if (!Me(q))
          return Ie;
        xt = xt && ot(q, W, B), W = q;
      }
      Q = Q || zr && D - St - 1 > T && h[St + 1] !== " ";
    }
    return !G && !Q ? xt && !I && !$(h) ? qt : M === Je ? Ie : kt : R > 9 && Ut(h) ? Ie : I ? M === Je ? Ie : kt : Q ? Zt : Wt;
  }
  function In(h, S, R, T, $) {
    h.dump = function() {
      if (S.length === 0)
        return h.quotingType === Je ? '""' : "''";
      if (!h.noCompatMode && (Ht.indexOf(S) !== -1 || U.test(S)))
        return h.quotingType === Je ? '"' + S + '"' : "'" + S + "'";
      const M = h.indent * Math.max(1, R), I = h.lineWidth === -1 ? -1 : Math.max(Math.min(h.lineWidth, 40), h.lineWidth - M), B = T || // No block styles in flow mode.
      h.flowLevel > -1 && R >= h.flowLevel;
      function D(q) {
        return zt(h, q);
      }
      switch (Jt(
        S,
        B,
        h.indent,
        I,
        D,
        h.quotingType,
        h.forceQuotes && !T,
        $
      )) {
        case qt:
          return S;
        case kt:
          return "'" + S.replace(/'/g, "''") + "'";
        case Wt:
          return "|" + Kt(S, h.indent) + Yt(vt(S, M));
        case Zt:
          return ">" + Kt(S, h.indent) + Yt(vt(Nn(S, I), M));
        case Ie:
          return '"' + Rn(S) + '"';
        default:
          throw new t("impossible error: invalid scalar style");
      }
    }();
  }
  function Kt(h, S) {
    const R = Ut(h) ? String(S) : "", T = h[h.length - 1] === `
`, M = T && (h[h.length - 2] === `
` || h === `
`) ? "+" : T ? "" : "-";
    return R + M + `
`;
  }
  function Yt(h) {
    return h[h.length - 1] === `
` ? h.slice(0, -1) : h;
  }
  function Nn(h, S) {
    const R = /(\n+)([^\n]*)/g;
    let T = function() {
      let B = h.indexOf(`
`);
      return B = B !== -1 ? B : h.length, R.lastIndex = B, Ne(h.slice(0, B), S);
    }(), $ = h[0] === `
` || h[0] === " ", M, I;
    for (; I = R.exec(h); ) {
      const B = I[1], D = I[2];
      M = D[0] === " ", T += B + (!$ && !M && D !== "" ? `
` : "") + Ne(D, S), $ = M;
    }
    return T;
  }
  function Ne(h, S) {
    if (h === "" || h[0] === " ") return h;
    const R = / [^ ]/g;
    let T, $ = 0, M, I = 0, B = 0, D = "";
    for (; T = R.exec(h); )
      B = T.index, B - $ > S && (M = I > $ ? I : B, D += `
` + h.slice($, M), $ = M + 1), I = B;
    return D += `
`, h.length - $ > S && I > $ ? D += h.slice($, I) + `
` + h.slice(I + 1) : D += h.slice($), D.slice(1);
  }
  function Rn(h) {
    let S = "", R = 0;
    for (let T = 0; T < h.length; R >= 65536 ? T += 2 : T++) {
      R = je(h, T);
      const $ = ae[R];
      !$ && Me(R) ? (S += h[T], R >= 65536 && (S += h[T + 1])) : S += $ || $e(R);
    }
    return S;
  }
  function Gt(h, S, R) {
    let T = "";
    const $ = h.tag;
    for (let M = 0, I = R.length; M < I; M += 1) {
      let B = R[M];
      h.replacer && (B = h.replacer.call(R, String(M), B)), (C(h, S, B, !1, !1) || typeof B > "u" && C(h, S, null, !1, !1)) && (T !== "" && (T += "," + (h.condenseFlow ? "" : " ")), T += h.dump);
    }
    h.tag = $, h.dump = "[" + T + "]";
  }
  function Vt(h, S, R, T) {
    let $ = "";
    const M = h.tag;
    for (let I = 0, B = R.length; I < B; I += 1) {
      let D = R[I];
      h.replacer && (D = h.replacer.call(R, String(I), D)), (C(h, S + 1, D, !0, !0, !1, !0) || typeof D > "u" && C(h, S + 1, null, !0, !0, !1, !0)) && ((!T || $ !== "") && ($ += st(h, S)), h.dump && a === h.dump.charCodeAt(0) ? $ += "-" : $ += "- ", $ += h.dump);
    }
    h.tag = M, h.dump = $ || "[]";
  }
  function Mn(h, S, R) {
    let T = "";
    const $ = h.tag, M = Object.keys(R);
    for (let I = 0, B = M.length; I < B; I += 1) {
      let D = "";
      T !== "" && (D += ", "), h.condenseFlow && (D += '"');
      const q = M[I];
      let W = R[q];
      h.replacer && (W = h.replacer.call(R, q, W)), C(h, S, q, !1, !1) && (h.dump.length > 1024 && (D += "? "), D += h.dump + (h.condenseFlow ? '"' : "") + ":" + (h.condenseFlow ? "" : " "), C(h, S, W, !1, !1) && (D += h.dump, T += D));
    }
    h.tag = $, h.dump = "{" + T + "}";
  }
  function l(h, S, R, T) {
    let $ = "";
    const M = h.tag, I = Object.keys(R);
    if (h.sortKeys === !0)
      I.sort();
    else if (typeof h.sortKeys == "function")
      I.sort(h.sortKeys);
    else if (h.sortKeys)
      throw new t("sortKeys must be a boolean or a function");
    for (let B = 0, D = I.length; B < D; B += 1) {
      let q = "";
      (!T || $ !== "") && (q += st(h, S));
      const W = I[B];
      let G = R[W];
      if (h.replacer && (G = h.replacer.call(R, W, G)), !C(h, S + 1, W, !0, !0, !0))
        continue;
      const Q = h.tag !== null && h.tag !== "?" || h.dump && h.dump.length > 1024;
      Q && (h.dump && a === h.dump.charCodeAt(0) ? q += "?" : q += "? "), q += h.dump, Q && (q += st(h, S)), C(h, S + 1, G, !0, Q) && (h.dump && a === h.dump.charCodeAt(0) ? q += ":" : q += ": ", q += h.dump, $ += q);
    }
    h.tag = M, h.dump = $ || "{}";
  }
  function b(h, S, R) {
    const T = R ? h.explicitTypes : h.implicitTypes;
    for (let $ = 0, M = T.length; $ < M; $ += 1) {
      const I = T[$];
      if ((I.instanceOf || I.predicate) && (!I.instanceOf || typeof S == "object" && S instanceof I.instanceOf) && (!I.predicate || I.predicate(S))) {
        if (R ? I.multi && I.representName ? h.tag = I.representName(S) : h.tag = I.tag : h.tag = "?", I.represent) {
          const B = h.styleMap[I.tag] || I.defaultStyle;
          let D;
          if (n.call(I.represent) === "[object Function]")
            D = I.represent(S, B);
          else if (i.call(I.represent, B))
            D = I.represent[B](S, B);
          else
            throw new t("!<" + I.tag + '> tag resolver accepts not "' + B + '" style');
          h.dump = D;
        }
        return !0;
      }
    }
    return !1;
  }
  function C(h, S, R, T, $, M, I) {
    h.tag = null, h.dump = R, b(h, R, !1) || b(h, R, !0);
    const B = n.call(h.dump), D = T;
    T && (T = h.flowLevel < 0 || h.flowLevel > S);
    const q = B === "[object Object]" || B === "[object Array]";
    let W, G;
    if (q && (W = h.duplicates.indexOf(R), G = W !== -1), (h.tag !== null && h.tag !== "?" || G || h.indent !== 2 && S > 0) && ($ = !1), G && h.usedDuplicates[W])
      h.dump = "*ref_" + W;
    else {
      if (q && G && !h.usedDuplicates[W] && (h.usedDuplicates[W] = !0), B === "[object Object]")
        T && Object.keys(h.dump).length !== 0 ? (l(h, S, h.dump, $), G && (h.dump = "&ref_" + W + h.dump)) : (Mn(h, S, h.dump), G && (h.dump = "&ref_" + W + " " + h.dump));
      else if (B === "[object Array]")
        T && h.dump.length !== 0 ? (h.noArrayIndent && !I && S > 0 ? Vt(h, S - 1, h.dump, $) : Vt(h, S, h.dump, $), G && (h.dump = "&ref_" + W + h.dump)) : (Gt(h, S, h.dump), G && (h.dump = "&ref_" + W + " " + h.dump));
      else if (B === "[object String]")
        h.tag !== "?" && In(h, h.dump, S, M, D);
      else {
        if (B === "[object Undefined]")
          return !1;
        if (h.skipInvalid) return !1;
        throw new t("unacceptable kind of an object to dump " + B);
      }
      if (h.tag !== null && h.tag !== "?") {
        let Q = encodeURI(
          h.tag[0] === "!" ? h.tag.slice(1) : h.tag
        ).replace(/!/g, "%21");
        h.tag[0] === "!" ? Q = "!" + Q : Q.slice(0, 18) === "tag:yaml.org,2002:" ? Q = "!!" + Q.slice(18) : Q = "!<" + Q + ">", h.dump = Q + " " + h.dump;
      }
    }
    return !0;
  }
  function O(h, S) {
    const R = [], T = [];
    E(h, R, T);
    const $ = T.length;
    for (let M = 0; M < $; M += 1)
      S.duplicates.push(R[T[M]]);
    S.usedDuplicates = new Array($);
  }
  function E(h, S, R) {
    if (h !== null && typeof h == "object") {
      const T = S.indexOf(h);
      if (T !== -1)
        R.indexOf(T) === -1 && R.push(T);
      else if (S.push(h), Array.isArray(h))
        for (let $ = 0, M = h.length; $ < M; $ += 1)
          E(h[$], S, R);
      else {
        const $ = Object.keys(h);
        for (let M = 0, I = $.length; M < I; M += 1)
          E(h[$[M]], S, R);
      }
    }
  }
  function L(h, S) {
    S = S || {};
    const R = new jn(S);
    R.noRefs || O(h, R);
    let T = h;
    return R.replacer && (T = R.replacer.call({ "": T }, "", T)), C(R, 0, T, !0, !0) ? R.dump + `
` : "";
  }
  return mr.dump = L, mr;
}
var Xi;
function Hu() {
  if (Xi) return ce;
  Xi = 1;
  const r = Fu(), t = Bu();
  function e(n, i) {
    return function() {
      throw new Error("Function yaml." + n + " is removed in js-yaml 4. Use yaml." + i + " instead, which is now safe by default.");
    };
  }
  return ce.Type = fe(), ce.Schema = xo(), ce.FAILSAFE_SCHEMA = Co(), ce.JSON_SCHEMA = Io(), ce.CORE_SCHEMA = No(), ce.DEFAULT_SCHEMA = Dr(), ce.load = r.load, ce.loadAll = r.loadAll, ce.dump = t.dump, ce.YAMLException = Bt(), ce.types = {
    binary: Lo(),
    float: jo(),
    map: Eo(),
    null: To(),
    pairs: Do(),
    set: Fo(),
    timestamp: Ro(),
    bool: $o(),
    int: Oo(),
    merge: Mo(),
    omap: Po(),
    seq: _o(),
    str: Ao()
  }, ce.safeLoad = e("safeLoad", "load"), ce.safeLoadAll = e("safeLoadAll", "loadAll"), ce.safeDump = e("safeDump", "dump"), ce;
}
var zu = Hu();
const Bo = /* @__PURE__ */ Pu(zu), {
  Type: yh,
  Schema: wh,
  FAILSAFE_SCHEMA: bh,
  JSON_SCHEMA: vh,
  CORE_SCHEMA: kh,
  DEFAULT_SCHEMA: Sh,
  load: xh,
  loadAll: Ah,
  dump: _h,
  YAMLException: Eh,
  types: Ch,
  safeLoad: Th,
  safeLoadAll: $h,
  safeDump: Oh
} = Bo, Uu = /* @__PURE__ */ new Set([
  "type",
  "nullable",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "$ref",
  // Documentation, not constraints.
  "title",
  "description",
  "example",
  "examples",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "discriminator",
  "xml",
  "externalDocs"
]);
function qu(r, t, e = t) {
  const n = [], i = /* @__PURE__ */ new Set();
  return nt(r, t, "", n, e, i, 0), { errors: n, unsupportedKeywords: [...i].sort() };
}
const Wu = 64;
function nt(r, t, e, n, i, s, o) {
  if (!(!t || typeof t != "object")) {
    if (o > Wu) {
      n.push(`${ne(e)}: the schema nests too deeply to check — is there a \`$ref\` cycle?`);
      return;
    }
    if (typeof t.$ref == "string") {
      const a = td(t.$ref, i);
      if (!a) {
        n.push(`${ne(e)}: could not resolve ${t.$ref}`);
        return;
      }
      nt(r, a, e, n, i, s, o + 1);
      return;
    }
    for (const a of Object.keys(t))
      Uu.has(a) || s.add(a);
    if (r === null) {
      if (t.nullable === !0 || Fr(t).includes("null")) return;
      t.type !== void 0 && n.push(`${ne(e)}: expected ${Ho(t)}, got null`);
      return;
    }
    Zu(r, t, e, n), Vu(r, t, e, n), ed(r, t, e, n, i, s, o), typeof r == "string" && Yu(r, t, e, n), typeof r == "number" && Gu(r, t, e, n), Array.isArray(r) ? Xu(r, t, e, n, i, s, o) : yt(r) && Qu(r, t, e, n, i, s, o);
  }
}
function Zu(r, t, e, n) {
  const i = Fr(t);
  i.length && (i.some((s) => Ju(r, s)) || n.push(`${ne(e)}: expected ${Ho(t)}, got ${nd(r)}`));
}
function Fr(r) {
  return typeof r.type == "string" ? [r.type] : Array.isArray(r.type) ? r.type.filter((t) => typeof t == "string") : [];
}
function Ju(r, t) {
  switch (t) {
    case "object":
      return yt(r);
    case "array":
      return Array.isArray(r);
    case "string":
      return typeof r == "string";
    case "number":
      return typeof r == "number" && Number.isFinite(r);
    case "integer":
      return typeof r == "number" && Number.isInteger(r);
    case "boolean":
      return typeof r == "boolean";
    case "null":
      return r === null;
    default:
      return !0;
  }
}
const Ku = {
  "date-time": /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  uri: /^[A-Za-z][A-Za-z0-9+.-]*:/,
  ipv4: /^(\d{1,3}\.){3}\d{1,3}$/
};
function Yu(r, t, e, n) {
  if (typeof t.minLength == "number" && r.length < t.minLength && n.push(`${ne(e)}: shorter than ${t.minLength} characters`), typeof t.maxLength == "number" && r.length > t.maxLength && n.push(`${ne(e)}: longer than ${t.maxLength} characters`), typeof t.pattern == "string") {
    let i = null;
    try {
      i = new RegExp(t.pattern);
    } catch {
      n.push(`${ne(e)}: the schema's pattern is not a valid regular expression`);
    }
    i && !i.test(r) && n.push(`${ne(e)}: does not match ${t.pattern}`);
  }
  if (typeof t.format == "string") {
    const i = Ku[t.format];
    i && !i.test(r) && n.push(`${ne(e)}: not a valid ${t.format}`);
  }
}
function Gu(r, t, e, n) {
  const i = t.exclusiveMinimum, s = t.exclusiveMaximum;
  typeof t.minimum == "number" && (i === !0 ? r <= t.minimum : r < t.minimum) && n.push(`${ne(e)}: ${r} is below the minimum of ${t.minimum}`), typeof i == "number" && r <= i && n.push(`${ne(e)}: ${r} must be greater than ${i}`), typeof t.maximum == "number" && (s === !0 ? r >= t.maximum : r > t.maximum) && n.push(`${ne(e)}: ${r} is above the maximum of ${t.maximum}`), typeof s == "number" && r >= s && n.push(`${ne(e)}: ${r} must be less than ${s}`);
}
function Vu(r, t, e, n) {
  Array.isArray(t.enum) && (t.enum.some((i) => Qi(i, r)) || n.push(`${ne(e)}: ${JSON.stringify(r)} is not one of ${JSON.stringify(t.enum)}`)), "const" in t && !Qi(t.const, r) && n.push(`${ne(e)}: expected ${JSON.stringify(t.const)}, got ${JSON.stringify(r)}`);
}
function Xu(r, t, e, n, i, s, o) {
  typeof t.minItems == "number" && r.length < t.minItems && n.push(`${ne(e)}: has ${r.length} items, needs at least ${t.minItems}`), typeof t.maxItems == "number" && r.length > t.maxItems && n.push(`${ne(e)}: has ${r.length} items, allows at most ${t.maxItems}`), t.uniqueItems === !0 && new Set(r.map((c) => JSON.stringify(c))).size !== r.length && n.push(`${ne(e)}: contains duplicate items`), t.items && r.forEach(
    (a, c) => nt(a, t.items, `${e}[${c}]`, n, i, s, o + 1)
  );
}
function Qu(r, t, e, n, i, s, o) {
  const a = t.properties ?? {};
  if (Array.isArray(t.required))
    for (const c of t.required)
      typeof c == "string" && !(c in r) && n.push(`${ne(ln(e, c))}: required, but missing`);
  for (const [c, u] of Object.entries(a))
    c in r && nt(r[c], u, ln(e, c), n, i, s, o + 1);
  if (t.additionalProperties === !1)
    for (const c of Object.keys(r))
      c in a || n.push(`${ne(ln(e, c))}: not allowed by the schema`);
  else if (yt(t.additionalProperties))
    for (const [c, u] of Object.entries(r))
      c in a || nt(u, t.additionalProperties, ln(e, c), n, i, s, o + 1);
}
function ed(r, t, e, n, i, s, o) {
  if (Array.isArray(t.allOf))
    for (const a of t.allOf)
      nt(r, a, e, n, i, s, o + 1);
  if (Array.isArray(t.anyOf) && (t.anyOf.some((c) => gr(r, c, i, o)) || n.push(`${ne(e)}: matches none of the allowed shapes`)), Array.isArray(t.oneOf)) {
    const a = t.oneOf.filter((c) => gr(r, c, i, o)).length;
    a === 0 ? n.push(`${ne(e)}: matches none of the allowed shapes`) : a > 1 && n.push(`${ne(e)}: matches ${a} of the allowed shapes, which must be exactly one`);
  }
  yt(t.not) && gr(r, t.not, i, o) && n.push(`${ne(e)}: matches a shape the schema forbids`);
}
function gr(r, t, e, n) {
  const i = [];
  return nt(r, t, "", i, e, /* @__PURE__ */ new Set(), n + 1), i.length === 0;
}
function td(r, t) {
  if (!r.startsWith("#/")) return null;
  let e = t;
  for (const n of r.slice(2).split("/")) {
    const i = n.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!yt(e)) return null;
    e = e[i];
  }
  return yt(e) ? e : null;
}
function yt(r) {
  return typeof r == "object" && r !== null && !Array.isArray(r);
}
function ln(r, t) {
  return r ? `${r}.${t}` : t;
}
function ne(r) {
  return r ? `\`${r}\`` : "the response body";
}
function Ho(r) {
  const t = Fr(r), e = t.length ? t.join(" or ") : "a value";
  return r.nullable === !0 ? `${e} or null` : e;
}
function nd(r) {
  return r === null ? "null" : Array.isArray(r) ? "an array" : typeof r == "object" ? "an object" : `${typeof r} (${JSON.stringify(r)})`;
}
function Qi(r, t) {
  return JSON.stringify(r) === JSON.stringify(t);
}
const rd = ["get", "post", "put", "patch", "delete", "head", "options"];
async function Br(r) {
  const t = await v.readFile(r, "utf8"), e = /\.ya?ml$/i.test(r) ? Bo.load(t) : JSON.parse(t);
  if (!e || typeof e != "object")
    throw new Error(`${y.basename(r)} did not contain an object.`);
  return e;
}
async function id(r) {
  var o, a, c;
  let t;
  try {
    t = await Br(r);
  } catch (u) {
    return { source: "", title: "", operations: 0, servers: [], error: u.message };
  }
  const e = od(t);
  if (!e.length)
    return {
      source: "",
      title: ((o = t.info) == null ? void 0 : o.title) ?? "",
      operations: 0,
      servers: [],
      error: "The spec declares no paths."
    };
  const n = ad(t), i = ((a = t.info) == null ? void 0 : a.title) ?? y.basename(r), s = [
    `# ${i}${(c = t.info) != null && c.version ? ` ${t.info.version}` : ""}`,
    `# Generated from ${y.basename(r)}. Edit freely — this is now yours.`,
    "",
    `@base = ${n[0] ?? "http://localhost:8080"}`,
    ""
  ];
  n.length > 1 && s.push("# Other servers the spec declares:", ...n.slice(1).map((u) => `#   ${u}`), "");
  for (const u of e)
    s.push(...sd(u, t));
  return { source: s.join(`
`), title: i, operations: e.length, servers: n };
}
function sd(r, t) {
  var f;
  const e = [], n = r.summary || r.operationId || `${r.method} ${r.route}`;
  e.push(`### ${n}`);
  const i = r.parameters ?? [];
  let s = r.route;
  for (const d of i.filter((p) => p.in === "path"))
    s = s.replace(`{${d.name}}`, `{{${d.name}}}`);
  const o = i.filter((d) => d.in === "query" && d.required).map((d) => `${d.name}=${es(d)}`), a = o.length ? `?${o.join("&")}` : "";
  (f = r.security) != null && f.length && e.push("# @auth bearer {{token}}"), e.push(`${r.method.toUpperCase()} {{base}}${s}${a}`);
  for (const d of i.filter((p) => p.in === "header"))
    e.push(`${d.name}: ${es(d)}`);
  const c = ld(r, t);
  c && e.push("Content-Type: application/json", "", c);
  const u = cd(r);
  return u && e.push(
    "",
    "> {%",
    `  nova.test('responds ${u}', () => nova.expect(nova.response.status).toBe(${u}))`,
    "%}"
  ), e.push(""), e;
}
function od(r) {
  const t = [];
  for (const [e, n] of Object.entries(r.paths ?? {})) {
    if (!n || typeof n != "object") continue;
    const i = n.parameters ?? [];
    for (const s of rd) {
      const o = n[s];
      !o || typeof o != "object" || t.push({
        ...o,
        method: s,
        route: e,
        parameters: [...i, ...o.parameters ?? []]
      });
    }
  }
  return t;
}
function ad(r) {
  var e;
  const t = (r.servers ?? []).map((n) => n.url).filter((n) => !!n);
  return t.length ? t : r.host ? [`${((e = r.schemes) == null ? void 0 : e[0]) ?? "https"}://${r.host}${r.basePath ?? ""}`] : [];
}
function cd(r) {
  return Object.keys(r.responses ?? {}).filter((e) => /^2\d\d$/.test(e)).sort()[0] ?? null;
}
function ld(r, t) {
  var i;
  const e = (i = r.requestBody) == null ? void 0 : i.content;
  if (!e) return null;
  const n = e["application/json"] ?? Object.values(e)[0];
  return n ? n.example !== void 0 ? JSON.stringify(n.example, null, 2) : n.schema ? JSON.stringify(He(n.schema, t, 0), null, 2) : null : null;
}
function es(r) {
  if (r.example !== void 0) return String(r.example);
  const t = r.schema ?? {};
  return Array.isArray(t.enum) && t.enum.length ? String(t.enum[0]) : `{{${r.name}}}`;
}
function He(r, t, e) {
  if (!r || e > 4) return null;
  if (typeof r.$ref == "string")
    return He(ud(r.$ref, t), t, e + 1);
  if (r.example !== void 0) return r.example;
  if (Array.isArray(r.enum) && r.enum.length) return r.enum[0];
  if (Array.isArray(r.allOf))
    return Object.assign({}, ...r.allOf.map((n) => He(n, t, e + 1)));
  if (Array.isArray(r.oneOf) && r.oneOf.length)
    return He(r.oneOf[0], t, e + 1);
  if (Array.isArray(r.anyOf) && r.anyOf.length)
    return He(r.anyOf[0], t, e + 1);
  switch (r.type) {
    case "object": {
      const n = {};
      for (const [i, s] of Object.entries(r.properties ?? {}))
        n[i] = He(s, t, e + 1);
      return n;
    }
    case "array":
      return [He(r.items, t, e + 1)];
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return !1;
    case "string":
      return r.format === "date-time" ? (/* @__PURE__ */ new Date(0)).toISOString() : "";
    default:
      return r.properties ? He({ ...r, type: "object" }, t, e) : null;
  }
}
function ud(r, t) {
  if (!r.startsWith("#/")) return;
  let e = t;
  for (const n of r.slice(2).split("/")) {
    const i = n.replace(/~1/g, "/").replace(/~0/g, "~");
    if (typeof e != "object" || e === null) return;
    e = e[i];
  }
  return e;
}
function dd(r, t, e, n, i, s) {
  var m, w, k;
  const o = fd(r, t, e);
  if (!o) return { errors: [], note: `The spec has no ${t.toUpperCase()} for this path.` };
  const a = ((m = o.responses) == null ? void 0 : m[String(n)]) ?? ((w = o.responses) == null ? void 0 : w[`${Math.floor(n / 100)}XX`]) ?? ((k = o.responses) == null ? void 0 : k.default);
  if (!a)
    return { errors: [`The spec does not declare a ${n} response for this operation.`] };
  const c = a.content;
  if (!c) return { errors: [], note: `The spec declares ${n} with no body schema.` };
  const u = c["application/json"] ?? Object.values(c)[0];
  if (!(u != null && u.schema)) return { errors: [], note: `The spec declares ${n} with no schema.` };
  if (!s.includes("json") && !i.trim().startsWith("{") && !i.trim().startsWith("["))
    return { errors: [`Expected a JSON body for ${n}, got ${s || "no content type"}.`] };
  let f;
  try {
    f = JSON.parse(i);
  } catch (_) {
    return { errors: [`The response body is not valid JSON: ${_.message}`] };
  }
  const d = qu(f, u.schema, r), p = [...d.errors];
  return d.unsupportedKeywords.length && p.push(
    `Note: not checked — ${d.unsupportedKeywords.join(", ")} (unsupported schema keyword).`
  ), { errors: p };
}
function fd(r, t, e) {
  let n;
  try {
    n = new URL(e).pathname;
  } catch {
    n = e;
  }
  const i = t.toLowerCase(), s = ts(n).split("/");
  let o = null;
  for (const [a, c] of Object.entries(r.paths ?? {})) {
    const u = c == null ? void 0 : c[i];
    if (!u) continue;
    const f = ts(a).split("/");
    if (f.length !== s.length) continue;
    let d = 0;
    f.every((m, w) => m.startsWith("{") && m.endsWith("}") ? !0 : (d++, m === s[w])) && (!o || d > o.literals) && (o = {
      operation: { ...u, method: i, route: a },
      literals: d
    });
  }
  return (o == null ? void 0 : o.operation) ?? null;
}
function ts(r) {
  return r.replace(/^\/+|\/+$/g, "");
}
async function pd(r, t) {
  var f, d;
  const e = Date.now(), n = {
    file: r,
    startedAt: e,
    durationMs: 0,
    steps: [],
    passed: 0,
    failed: 0,
    variables: {}
  };
  let i;
  try {
    i = await v.readFile(r, "utf8");
  } catch {
    return n.error = `Could not read ${y.basename(r)}.`, n.durationMs = Date.now() - e, n;
  }
  const s = Dt(i), o = y.dirname(r), a = t.validate ?? await md(s.requests, o), c = {}, u = t.only ? s.requests.filter((p) => p.id === t.only) : s.requests;
  for (const p of u) {
    if (p.protocol === "websocket" || p.protocol === "sse" || p.protocol === "grpc") {
      const w = {
        requestId: p.id,
        name: p.name,
        method: p.method,
        url: p.url,
        protocol: p.protocol,
        status: 0,
        durationMs: 0,
        tests: [],
        logs: [`${p.protocol} is a stream — run it from the panel, not as part of a suite.`]
      };
      n.steps.push(w), (f = t.onStep) == null || f.call(t, w);
      continue;
    }
    const m = await gd(p, o);
    for (const [w, k] of m.entries()) {
      const _ = await hd(p, {
        ...t,
        validate: a,
        environment: { ...t.environment, ...c, ...k },
        baseDir: o,
        variables: s.variables,
        runVars: c,
        dataRow: m.length > 1 || p.dataPath ? w : void 0
      });
      n.steps.push(_), (d = t.onStep) == null || d.call(t, _), n.passed += _.tests.filter((A) => A.passed).length, n.failed += _.tests.filter((A) => !A.passed).length;
      const x = !!_.error || _.tests.some((A) => !A.passed);
      if (t.bail && x)
        return Object.assign(n.variables, c), n.durationMs = Date.now() - e, n;
    }
  }
  return Object.assign(n.variables, c), n.durationMs = Date.now() - e, n;
}
async function hd(r, t) {
  var c, u, f;
  const e = oo(r, t.variables, t.environment), n = [], i = {
    requestId: r.id,
    name: r.name,
    method: e.method,
    url: e.url,
    protocol: e.protocol,
    status: 0,
    durationMs: 0,
    tests: [],
    logs: n,
    dataRow: t.dataRow
  };
  if (t.environment.__dataError)
    return i.error = t.environment.__dataError, i;
  let s = e;
  if (r.preScript) {
    const d = ju(
      r.preScript,
      {
        method: e.method,
        url: e.url,
        headers: Object.fromEntries(e.headers.map((p) => [p.name, p.value])),
        body: e.body.kind === "text" ? e.body.text : ""
      },
      t.environment
    );
    if (n.push(...d.logs), Object.assign(t.runVars, d.variables), d.error)
      return i.error = `Pre-request script failed: ${d.error}`, i;
    d.request && (s = {
      ...e,
      url: d.request.url,
      headers: Object.entries(d.request.headers).map(([p, m]) => ({ name: p, value: m })),
      body: e.body.kind === "text" || e.body.kind === "none" ? { kind: "text", text: d.request.body } : e.body
    });
  }
  const o = await co(s, t.context);
  s.protocol === "graphql" && !o.error && (o.graphqlErrors = fo(o.body, o.contentType)), i.status = o.status, i.durationMs = o.durationMs, i.url = ((c = o.sent) == null ? void 0 : c.url) ?? s.url, o.error && (i.error = o.error);
  const a = (u = t.validate) == null ? void 0 : u.call(t, r, o);
  if (a != null && a.length && (i.contract = a), r.postScript && !o.error) {
    const d = Iu(r.postScript, o, t.environment);
    n.push(...d.logs), Object.assign(t.runVars, d.variables), i.tests.push(...d.tests), d.error && i.tests.push({
      name: "response script",
      passed: !1,
      message: d.error,
      durationMs: 0
    });
  }
  return (f = i.contract) != null && f.length && i.tests.push(
    ...i.contract.map(
      (d) => ({
        name: "matches the contract",
        passed: !1,
        message: d,
        durationMs: 0
      })
    )
  ), i;
}
async function md(r, t) {
  const e = [...new Set(r.map((i) => i.specPath).filter((i) => !!i))];
  if (!e.length) return;
  const n = /* @__PURE__ */ new Map();
  for (const i of e)
    try {
      n.set(i, await Br(y.resolve(t, i)));
    } catch (s) {
      n.set(i, `Could not read the spec ${i}: ${s.message}`);
    }
  return (i, s) => {
    var c;
    if (!i.specPath) return;
    const o = n.get(i.specPath);
    if (typeof o == "string") return [o];
    if (!o || s.error) return;
    const a = dd(
      o,
      i.method,
      ((c = s.sent) == null ? void 0 : c.url) ?? i.url,
      s.status,
      s.body,
      s.contentType
    );
    return a.errors.length ? a.errors : void 0;
  };
}
async function gd(r, t) {
  if (!r.dataPath) return [{}];
  const e = y.resolve(t, r.dataPath);
  let n;
  try {
    n = await v.readFile(e, "utf8");
  } catch {
    return [{ __dataError: `Could not read the data file ${r.dataPath}.` }];
  }
  if (/\.json$/i.test(e))
    try {
      const i = JSON.parse(n);
      return (Array.isArray(i) ? i : [i]).map((o) => wd(o));
    } catch (i) {
      return [{ __dataError: `${r.dataPath} is not valid JSON: ${i.message}` }];
    }
  return yd(n);
}
function yd(r) {
  const t = [];
  let e = [], n = "", i = !1;
  for (let c = 0; c < r.length; c++) {
    const u = r[c];
    if (i) {
      u === '"' ? r[c + 1] === '"' ? (n += '"', c++) : i = !1 : n += u;
      continue;
    }
    u === '"' ? i = !0 : u === "," ? (e.push(n), n = "") : u === `
` ? (e.push(n), t.push(e), e = [], n = "") : u !== "\r" && (n += u);
  }
  (n || e.length) && (e.push(n), t.push(e));
  const [s, ...o] = t.filter((c) => c.some((u) => u.trim()));
  if (!s) return [];
  const a = s.map((c) => c.trim());
  return o.map((c) => {
    const u = {};
    return a.forEach((f, d) => {
      u[f] = (c[d] ?? "").trim();
    }), u;
  });
}
function wd(r) {
  const t = {};
  for (const [e, n] of Object.entries(r ?? {}))
    t[e] = typeof n == "string" ? n : JSON.stringify(n);
  return t;
}
class bd {
  constructor() {
    H(this, "server", null);
    H(this, "spec", null);
    H(this, "specFile", "");
    H(this, "port", 0);
    H(this, "served", 0);
    H(this, "error", "");
  }
  async start(t, e = 0) {
    await this.stop(), this.error = "", this.served = 0;
    try {
      this.spec = await Br(t), this.specFile = t;
    } catch (i) {
      return this.error = i.message, this.status();
    }
    this.server = Rs.createServer((i, s) => this.handle(i, s));
    try {
      await new Promise((i, s) => {
        this.server.once("error", s), this.server.listen(e, "127.0.0.1", i);
      });
    } catch (i) {
      return this.error = i.code === "EADDRINUSE" ? `Port ${e} is already in use.` : i.message, this.server = null, this.status();
    }
    const n = this.server.address();
    return this.port = typeof n == "object" && n ? n.port : 0, this.status();
  }
  async stop() {
    if (this.server) {
      const t = this.server;
      this.server = null, await new Promise((e) => t.close(() => e()));
    }
    return this.port = 0, this.status();
  }
  status() {
    return {
      running: !!this.server,
      port: this.port,
      url: this.port ? `http://127.0.0.1:${this.port}` : "",
      spec: this.specFile,
      served: this.served,
      error: this.error || void 0
    };
  }
  handle(t, e) {
    var d;
    this.served++;
    const n = new URL(t.url ?? "/", `http://${t.headers.host ?? "localhost"}`), i = (t.method ?? "GET").toLowerCase();
    if (e.setHeader("Access-Control-Allow-Origin", "*"), e.setHeader("Access-Control-Allow-Headers", "*"), e.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS"), i === "options")
      return e.writeHead(204), e.end();
    const s = this.findOperation(i, n.pathname);
    if (!s)
      return _t(e, 404, {
        error: "No such operation in the spec",
        path: n.pathname,
        method: i.toUpperCase()
      });
    const o = n.searchParams.get("__status"), { status: a, response: c } = vd(s.operation, o);
    if (!c) return _t(e, a, null);
    const u = ((d = c.content) == null ? void 0 : d["application/json"]) ?? (c.content ? Object.values(c.content)[0] : void 0);
    if (!u)
      return e.writeHead(a), e.end();
    if (u.example !== void 0) return _t(e, a, u.example);
    const f = u.examples && Object.values(u.examples)[0];
    return f && "value" in f ? _t(e, a, f.value) : _t(e, a, u.schema ? ze(u.schema, this.spec, 0) : null);
  }
  /** Literal segments beat templated ones, as they do in the router being faked. */
  findOperation(t, e) {
    if (!this.spec) return null;
    const n = ns(e).split("/");
    let i = null;
    for (const [s, o] of Object.entries(this.spec.paths ?? {})) {
      const a = o == null ? void 0 : o[t];
      if (!a) continue;
      const c = ns(s).split("/");
      if (c.length !== n.length) continue;
      let u = 0;
      c.every((d, p) => d.startsWith("{") && d.endsWith("}") ? !0 : (u++, d === n[p])) && (!i || u > i.literals) && (i = { operation: a, literals: u });
    }
    return i;
  }
}
function vd(r, t) {
  const e = r.responses ?? {};
  if (t && e[t]) return { status: Number(t), response: e[t] };
  const n = Object.keys(e).filter((s) => /^2\d\d$/.test(s)).sort()[0];
  if (n) return { status: Number(n), response: e[n] };
  const i = Object.keys(e)[0];
  return i ? { status: /^\d+$/.test(i) ? Number(i) : 200, response: e[i] } : { status: 200, response: void 0 };
}
function ze(r, t, e) {
  if (!r || e > 5) return null;
  if (typeof r.$ref == "string")
    return ze(Sd(r.$ref, t), t, e + 1);
  if (r.example !== void 0) return r.example;
  if (Array.isArray(r.enum) && r.enum.length) return r.enum[0];
  if (Array.isArray(r.allOf))
    return Object.assign({}, ...r.allOf.map((n) => ze(n, t, e + 1)));
  if (Array.isArray(r.oneOf) && r.oneOf.length)
    return ze(r.oneOf[0], t, e + 1);
  if (Array.isArray(r.anyOf) && r.anyOf.length)
    return ze(r.anyOf[0], t, e + 1);
  switch (r.type) {
    case "object": {
      const n = {};
      for (const [i, s] of Object.entries(r.properties ?? {}))
        n[i] = ze(s, t, e + 1);
      return n;
    }
    case "array":
      return [ze(r.items, t, e + 1)];
    case "integer":
      return typeof r.minimum == "number" ? r.minimum : 1;
    case "number":
      return typeof r.minimum == "number" ? r.minimum : 1.5;
    case "boolean":
      return !0;
    case "string":
      return kd(r);
    default:
      return r.properties ? ze({ ...r, type: "object" }, t, e) : null;
  }
}
function kd(r) {
  switch (r.format) {
    case "date-time":
      return "2024-01-01T00:00:00Z";
    case "date":
      return "2024-01-01";
    case "email":
      return "someone@example.com";
    case "uuid":
      return "00000000-0000-4000-8000-000000000000";
    case "uri":
      return "https://example.com";
    default:
      return "string";
  }
}
function Sd(r, t) {
  if (!r.startsWith("#/")) return;
  let e = t;
  for (const n of r.slice(2).split("/")) {
    const i = n.replace(/~1/g, "/").replace(/~0/g, "~");
    if (typeof e != "object" || e === null) return;
    e = e[i];
  }
  return e;
}
function _t(r, t, e) {
  const n = JSON.stringify(e, null, 2);
  r.writeHead(t, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(n)
  }), r.end(n);
}
function ns(r) {
  return r.replace(/^\/+|\/+$/g, "");
}
const un = 6e4, rs = 8 * 1024 * 1024, xd = 6e4, De = new au(), Ye = new hu(), dn = new bd();
let is = "";
const Ge = /* @__PURE__ */ new Map();
function Ad(r) {
  const t = new mu({
    onMessage: (e) => r.broadcast("http:streamMessage", e),
    onStatus: (e) => r.broadcast("http:streamStatus", e)
  });
  g.handle("http:setRoot", async (e, n) => {
    if (n === is) return;
    is = n;
    const i = y.join(ee.getPath("userData"), "http-client", Ed(n));
    await De.open(i), await Ye.open(i), Zl();
  }), g.handle("http:parse", async (e, n) => Dt(await v.readFile(n, "utf8"))), g.handle("http:environments", async (e, n) => await Tr(n) ?? {}), g.handle("http:collections", (e, n) => _d(n)), g.handle(
    "http:send",
    async (e, n, i, s) => {
      const { request: o, error: a } = await Et(n, i, s);
      if (!o) return ss(i, a);
      const c = await co(o, {
        jar: De,
        baseDir: y.dirname(n),
        defaultTimeoutMs: un,
        maxBodyBytes: rs
      });
      return o.protocol === "graphql" && !c.error && (c.graphqlErrors = fo(c.body, c.contentType)), await Ye.record(n, o.name, o.url, c), c;
    }
  ), g.handle(
    "http:openStream",
    async (e, n, i, s) => {
      const { request: o, error: a } = await Et(n, i, s);
      if (!o) throw new Error(a);
      return t.open(o, De);
    }
  ), g.handle("http:sendStream", (e, n, i) => {
    const s = Ge.get(n);
    return s ? (s.send(i), r.broadcast("http:streamMessage", {
      streamId: n,
      direction: "out",
      data: i,
      at: Date.now()
    }), !0) : t.send(n, i);
  }), g.handle("http:closeStream", (e, n) => {
    const i = Ge.get(n);
    i ? i.finish() : t.close(n);
  }), g.handle("http:cancelStream", (e, n) => {
    var i;
    (i = Ge.get(n)) == null || i.cancel(), t.close(n);
  }), g.handle("http:streams", () => t.list()), g.handle(
    "http:graphqlSchema",
    async (e, n, i, s) => {
      const { request: o, error: a } = await Et(n, i, s);
      if (!o) return { types: [], error: a };
      const c = {};
      for (const u of o.headers) c[u.name] = u.value;
      if (o.useCookies) {
        const u = De.header(o.url);
        u && (c.Cookie = u);
      }
      return bu(o.url, c, o.auth, o.timeoutMs ?? un);
    }
  ), g.handle(
    "http:grpcServices",
    async (e, n, i, s) => {
      const { request: o, error: a } = await Et(n, i, s);
      return o ? Su(o.url, o.protoPath, y.dirname(n)) : { source: "reflection", methods: [], error: a };
    }
  ), g.handle(
    "http:grpcCall",
    async (e, n, i, s) => {
      const { request: o, error: a } = await Et(n, i, s);
      if (!o) throw new Error(a);
      if (!o.grpcMethod)
        throw new Error("This gRPC request has no method — write `GRPC host:port package.Service/Method`.");
      const c = `grpc-${wt.randomUUID()}`, u = {
        streamId: c,
        requestId: i,
        protocol: "grpc",
        state: "connecting",
        url: `${o.url} ${o.grpcMethod}`,
        received: 0,
        sent: 0
      };
      r.broadcast("http:streamStatus", u);
      const f = {};
      for (const w of o.headers) f[w.name.toLowerCase()] = w.value;
      const d = Date.now(), p = (w, k) => {
        w === "in" && u.received++, r.broadcast("http:streamMessage", { streamId: c, direction: w, data: k, at: Date.now() });
      };
      let m;
      try {
        m = await Ou(
          o.url,
          o.grpcMethod,
          o.protoPath,
          y.dirname(n),
          o.body.kind === "text" ? o.body.text : "",
          f,
          o.timeoutMs ?? un,
          {
            onMessage: (w) => {
              p("in", w), r.broadcast("http:streamStatus", { ...u, state: "open" });
            },
            onSystem: (w) => p("system", w)
          }
        );
      } catch (w) {
        const k = w.message;
        return u.state = "error", u.error = k, p("system", k), r.broadcast("http:streamStatus", { ...u }), await Ye.record(n, o.name, o.url, {
          ...ss(i, k),
          protocol: "grpc"
        }), c;
      }
      return Ge.set(c, m), u.state = "open", r.broadcast("http:streamStatus", { ...u }), m.done.then(async (w) => {
        Ge.delete(c), u.state = w.code === 0 ? "closed" : "error", w.code !== 0 && (u.error = w.details), r.broadcast("http:streamStatus", { ...u }), await Ye.record(n, o.name, o.url, {
          requestId: i,
          protocol: "grpc",
          status: w.code,
          statusText: w.details,
          headers: {},
          body: "",
          size: 0,
          contentType: "application/grpc",
          durationMs: Date.now() - d,
          at: d,
          redirects: [],
          cookies: [],
          error: w.code === 0 ? void 0 : w.details || `gRPC status ${w.code}`,
          sent: { method: "GRPC", url: `${o.url}/${o.grpcMethod}`, headers: f, body: "" }
        });
      }), c;
    }
  ), g.handle(
    "http:run",
    async (e, n, i, s) => {
      const o = i ? await Tr(n) ?? {} : {}, a = i ? o[i] ?? {} : {}, c = await pd(n, {
        environment: a,
        only: s == null ? void 0 : s.only,
        bail: s == null ? void 0 : s.bail,
        context: {
          jar: De,
          baseDir: y.dirname(n),
          defaultTimeoutMs: un,
          maxBodyBytes: rs
        },
        // Streamed so a long suite fills in as it goes rather than appearing
        // all at once when the last request finishes.
        onStep: (u) => r.broadcast("http:runStep", { file: n, step: u })
      });
      return r.broadcast("http:runDone", c), c;
    }
  ), g.handle(
    "http:importOpenapi",
    (e, n) => id(n)
  ), g.handle(
    "http:mockStart",
    (e, n, i) => dn.start(n, i ?? 0)
  ), g.handle("http:mockStop", () => dn.stop()), g.handle("http:mockStatus", () => dn.status()), g.handle("http:history", (e, n) => Ye.list(n)), g.handle("http:historyBody", (e, n) => Ye.body(n)), g.handle("http:historyClear", () => Ye.clear()), g.handle("http:cookies", () => De.all()), g.handle("http:clearCookies", (e, n) => De.clear(n)), ee.on("before-quit", () => {
    t.closeAll();
    for (const e of Ge.values()) e.cancel();
    Ge.clear(), dn.stop(), De.flush();
  });
}
async function Et(r, t, e) {
  let n;
  try {
    n = await v.readFile(r, "utf8");
  } catch {
    return { error: `Could not read ${y.basename(r)}.` };
  }
  const i = Dt(n), s = i.requests.find((c) => c.id === t);
  if (!s) return { error: `No request "${t}" in ${y.basename(r)}.` };
  const o = e ? await Tr(r) ?? {} : {}, a = e ? o[e] ?? {} : {};
  return { request: oo(s, i.variables, a), error: "" };
}
function ss(r, t) {
  return {
    requestId: r,
    protocol: "http",
    status: 0,
    statusText: "",
    headers: {},
    body: "",
    size: 0,
    contentType: "",
    durationMs: 0,
    at: Date.now(),
    redirects: [],
    cookies: [],
    error: t
  };
}
async function _d(r) {
  if (!r) return [];
  const t = [];
  for await (const e of et(r, xd))
    if (/\.(http|rest)$/i.test(e))
      try {
        const n = Dt(await v.readFile(e, "utf8"));
        t.push({
          file: e,
          relative: y.relative(r, e),
          name: y.basename(e).replace(/\.(http|rest)$/i, ""),
          requests: n.requests.map((i) => ({
            id: i.id,
            name: i.name,
            method: i.method,
            protocol: i.protocol,
            line: i.line
          }))
        });
      } catch {
      }
  return t.sort((e, n) => e.relative.localeCompare(n.relative));
}
async function Tr(r) {
  let t = y.dirname(r);
  const e = {};
  let n = !1;
  for (let i = 0; i < 12; i++) {
    for (const s of ["http-client.env.json", "http-client.private.env.json"])
      try {
        const o = JSON.parse(await v.readFile(y.join(t, s), "utf8"));
        n = !0;
        for (const [a, c] of Object.entries(o))
          e[a] = { ...e[a] ?? {}, ...c };
      } catch {
      }
    if (n) return e;
    if (t === y.dirname(t)) break;
    t = y.dirname(t);
  }
  return n ? e : null;
}
function Ed(r) {
  return wt.createHash("sha1").update(r).digest("hex").slice(0, 16);
}
const Cd = he(Ms.inflate), Td = he(Ms.deflate), fn = 12, $d = 1e-3;
async function Od(r, t, e, n = {}) {
  const i = r.replace(/[^A-Za-z0-9_-]/g, "-"), s = y.join(e, `${i}.png`), o = y.join(e, `${i}.diff.png`), a = n.maxRatio ?? $d;
  let c = null;
  try {
    c = await v.readFile(s);
  } catch {
    c = null;
  }
  if (!c)
    return await v.mkdir(e, { recursive: !0 }), await v.writeFile(s, t), {
      name: r,
      created: !0,
      matched: !0,
      changedPixels: 0,
      totalPixels: 0,
      ratio: 0
    };
  let u, f;
  try {
    u = await os(c), f = await os(t);
  } catch (x) {
    return {
      name: r,
      created: !1,
      matched: !1,
      changedPixels: 0,
      totalPixels: 0,
      ratio: 1,
      error: `Could not read the images: ${x.message}`
    };
  }
  if (u.width !== f.width || u.height !== f.height)
    return {
      name: r,
      created: !1,
      matched: !1,
      changedPixels: 0,
      totalPixels: u.width * u.height,
      ratio: 1,
      error: `The page is now ${f.width}×${f.height}, the baseline is ${u.width}×${u.height}.`
    };
  const { changed: d, diff: p } = Id(u, f), m = u.width * u.height, w = m ? d / m : 0, k = w <= a;
  let _;
  return !k && n.writeDiff !== !1 && (await v.mkdir(e, { recursive: !0 }), await v.writeFile(o, await Md(p)), _ = o), { name: r, created: !1, matched: k, changedPixels: d, totalPixels: m, ratio: w, diffFile: _ };
}
async function jd(r, t, e) {
  const n = r.replace(/[^A-Za-z0-9_-]/g, "-");
  await v.mkdir(e, { recursive: !0 }), await v.writeFile(y.join(e, `${n}.png`), t), await v.rm(y.join(e, `${n}.diff.png`), { force: !0 }).catch(() => {
  });
}
function Id(r, t) {
  const e = r.data.length, n = Buffer.allocUnsafe(e);
  let i = 0;
  for (let s = 0; s < e; s += 4) {
    const o = Math.abs(r.data[s] - t.data[s]), a = Math.abs(r.data[s + 1] - t.data[s + 1]), c = Math.abs(r.data[s + 2] - t.data[s + 2]), u = Math.abs(r.data[s + 3] - t.data[s + 3]);
    o > fn || a > fn || c > fn || u > fn ? (i++, n[s] = 255, n[s + 1] = 0, n[s + 2] = 255, n[s + 3] = 255) : (n[s] = 255 - Math.round((255 - r.data[s]) * 0.25), n[s + 1] = 255 - Math.round((255 - r.data[s + 1]) * 0.25), n[s + 2] = 255 - Math.round((255 - r.data[s + 2]) * 0.25), n[s + 3] = 255);
  }
  return { changed: i, diff: { width: r.width, height: r.height, data: n } };
}
const zo = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
async function os(r) {
  if (!r.subarray(0, 8).equals(zo)) throw new Error("not a PNG");
  let t = 8, e = 0, n = 0, i = 0, s = 0;
  const o = [];
  for (; t < r.length; ) {
    const m = r.readUInt32BE(t), w = r.toString("ascii", t + 4, t + 8), k = r.subarray(t + 8, t + 8 + m);
    if (t += 12 + m, w === "IHDR") {
      if (e = k.readUInt32BE(0), n = k.readUInt32BE(4), i = k[8], s = k[9], k[12] !== 0) throw new Error("interlaced PNGs are not supported");
    } else if (w === "IDAT")
      o.push(k);
    else if (w === "IEND")
      break;
  }
  if (i !== 8) throw new Error(`unsupported bit depth ${i}`);
  if (s !== 2 && s !== 6) throw new Error(`unsupported colour type ${s}`);
  const a = s === 6 ? 4 : 3, c = await Cd(Buffer.concat(o)), u = e * a, f = Buffer.allocUnsafe(e * n * 4), d = Buffer.alloc(u), p = Buffer.alloc(u);
  for (let m = 0; m < n; m++) {
    const w = m * (u + 1), k = c[w];
    c.copy(d, 0, w + 1, w + 1 + u), Nd(k, d, p, a);
    for (let _ = 0; _ < e; _++) {
      const x = _ * a, A = (m * e + _) * 4;
      f[A] = d[x], f[A + 1] = d[x + 1], f[A + 2] = d[x + 2], f[A + 3] = a === 4 ? d[x + 3] : 255;
    }
    d.copy(p);
  }
  return { width: e, height: n, data: f };
}
function Nd(r, t, e, n) {
  switch (r) {
    case 0:
      return;
    case 1:
      for (let i = n; i < t.length; i++) t[i] = t[i] + t[i - n] & 255;
      return;
    case 2:
      for (let i = 0; i < t.length; i++) t[i] = t[i] + e[i] & 255;
      return;
    case 3:
      for (let i = 0; i < t.length; i++) {
        const s = i >= n ? t[i - n] : 0;
        t[i] = t[i] + (s + e[i] >> 1) & 255;
      }
      return;
    case 4:
      for (let i = 0; i < t.length; i++) {
        const s = i >= n ? t[i - n] : 0, o = e[i], a = i >= n ? e[i - n] : 0;
        t[i] = t[i] + Rd(s, o, a) & 255;
      }
      return;
    default:
      throw new Error(`unknown PNG filter ${r}`);
  }
}
function Rd(r, t, e) {
  const n = r + t - e, i = Math.abs(n - r), s = Math.abs(n - t), o = Math.abs(n - e);
  return i <= s && i <= o ? r : s <= o ? t : e;
}
async function Md(r) {
  const t = r.width * 4, e = Buffer.allocUnsafe((t + 1) * r.height);
  for (let i = 0; i < r.height; i++)
    e[i * (t + 1)] = 0, r.data.copy(e, i * (t + 1) + 1, i * t, (i + 1) * t);
  const n = Buffer.alloc(13);
  return n.writeUInt32BE(r.width, 0), n.writeUInt32BE(r.height, 4), n[8] = 8, n[9] = 6, Buffer.concat([
    zo,
    yr("IHDR", n),
    yr("IDAT", await Td(e)),
    yr("IEND", Buffer.alloc(0))
  ]);
}
function yr(r, t) {
  const e = Buffer.alloc(4);
  e.writeUInt32BE(t.length);
  const n = Buffer.concat([Buffer.from(r, "ascii"), t]), i = Buffer.alloc(4);
  return i.writeUInt32BE(Pd(n)), Buffer.concat([e, n, i]);
}
const Ld = (() => {
  const r = new Int32Array(256);
  for (let t = 0; t < 256; t++) {
    let e = t;
    for (let n = 0; n < 8; n++) e = e & 1 ? 3988292384 ^ e >>> 1 : e >>> 1;
    r[t] = e;
  }
  return r;
})();
function Pd(r) {
  let t = -1;
  for (let e = 0; e < r.length; e++) t = Ld[(t ^ r[e]) & 255] ^ t >>> 8;
  return (t ^ -1) >>> 0;
}
const as = y.join("e2e", "__screenshots__");
function Dd() {
  g.handle(
    "e2e:compareScreenshot",
    async (r, t, e, n) => {
      const i = (o) => ({
        name: e,
        created: !1,
        matched: !1,
        changedPixels: 0,
        totalPixels: 0,
        ratio: 1,
        error: o
      });
      if (!t) return i("Open a project before capturing a baseline.");
      const s = await cs(n);
      return s ? Od(e, s, y.join(t, as)) : i(
        "Could not capture the page. It has to be visible, and DevTools must not be open on it."
      );
    }
  ), g.handle(
    "e2e:acceptScreenshot",
    async (r, t, e, n) => {
      if (!t) return !1;
      const i = await cs(n);
      return i ? (await jd(e, i, y.join(t, as)), !0) : !1;
    }
  );
}
function Fd(r) {
  return new Promise((t) => {
    let e = !1;
    const n = (i, s, o) => {
      s !== "Page.screencastFrame" || e || (e = !0, r.debugger.off("message", n), r.debugger.sendCommand("Page.screencastFrameAck", { sessionId: o.sessionId }).catch(() => {
      }), r.debugger.sendCommand("Page.stopScreencast").catch(() => {
      }), t(Buffer.from(String(o.data ?? ""), "base64")));
    };
    r.debugger.on("message", n), r.debugger.sendCommand("Page.startScreencast", { format: "png", everyNthFrame: 1 }).catch(() => {
      e || (e = !0, r.debugger.off("message", n), t(null));
    });
  });
}
async function cs(r) {
  const t = sa.fromId(r);
  if (!t || t.isDestroyed()) return null;
  let e = !1;
  try {
    t.debugger.isAttached() || (t.debugger.attach("1.3"), e = !0);
  } catch {
    return null;
  }
  try {
    await t.debugger.sendCommand("Page.enable").catch(() => {
    });
    const n = await Promise.race([
      Fd(t),
      new Promise((i) => setTimeout(() => i(null), 8e3))
    ]);
    return n != null && n.length ? n : null;
  } catch {
    return null;
  } finally {
    if (e)
      try {
        t.debugger.detach();
      } catch {
      }
  }
}
const ls = 3, ue = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"], le = [".py"], pe = [".php"], lt = [".java", ".kt"], Ce = [".rb"], Fe = [".go"], Bd = [...ue, ".html", ".vue", ".svelte"], Uo = [
  /* ---------------- injection ---------------- */
  {
    id: "sql-injection",
    title: "SQL built by string concatenation",
    severity: "high",
    confidence: "likely",
    cwe: "CWE-89",
    extensions: [...ue, ...le, ...pe, ...lt, ...Ce, ...Fe],
    // A SQL keyword followed by an interpolation or a concatenation.
    pattern: /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WHERE|VALUES)\b[^;'"`\n]*(?:\$\{[^}]+\}|["'`]\s*\+\s*\w|%\s*\(?\w|\.format\(|f["'])/i,
    detail: "A SQL statement is assembled from a variable rather than parameterised.",
    remediation: "Use a parameterised query — `?` or `$1` placeholders with the values passed separately. Escaping by hand is not a substitute.",
    // A parameterised call that happens to also concatenate a table name.
    unless: /\?\s*\)|\$\d|:\w+\s*[,)]|execute\([^,]+,\s*[[(]/
  },
  {
    id: "command-injection",
    title: "Shell command built from a variable",
    severity: "critical",
    confidence: "likely",
    cwe: "CWE-78",
    extensions: [...ue, ...le, ...pe, ...Ce],
    pattern: /\b(exec|execSync|spawnSync|system|popen|shell_exec|passthru|os\.system|subprocess\.(?:call|run|Popen))\s*\([^)]*(?:\$\{[^}]+\}|["'`]\s*\+\s*\w|%\s*\w|f["'])/,
    detail: "A shell command is built by interpolating a value into a string.",
    remediation: "Pass the command and its arguments as an array, so the shell never parses the value. Where a shell is genuinely needed, allow-list the input."
  },
  {
    id: "shell-true",
    title: "Subprocess run through a shell",
    severity: "medium",
    confidence: "possible",
    cwe: "CWE-78",
    extensions: le,
    pattern: /subprocess\.(?:call|run|Popen|check_output)\([^)]*shell\s*=\s*True/,
    detail: "`shell=True` makes the whole command string subject to shell parsing.",
    remediation: "Drop `shell=True` and pass the arguments as a list."
  },
  {
    id: "code-eval",
    title: "Dynamic code execution",
    severity: "high",
    confidence: "likely",
    cwe: "CWE-95",
    extensions: [...ue, ...le, ...pe, ...Ce],
    pattern: /\b(eval|new\s+Function|setTimeout\s*\(\s*["'`]|exec)\s*\(\s*(?!["'`]\s*\))[^)]*\w/,
    detail: "Code is compiled from a string at runtime.",
    remediation: "Replace it with a lookup table, `JSON.parse`, or a real parser. If it must stay, the input has to be a value the program produced, never one it received.",
    unless: /eval\s*\(\s*["'`][^"'`]*["'`]\s*\)/
  },
  {
    id: "path-traversal",
    title: "File path built from a variable",
    severity: "high",
    confidence: "possible",
    cwe: "CWE-22",
    extensions: [...ue, ...le, ...pe, ...Ce, ...Fe],
    pattern: /\b(readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|open|sendFile|file_get_contents|File\.read)\s*\([^)]*(?:\$\{[^}]+\}|["'`]\s*\+\s*\w|\+\s*req\.|os\.path\.join\([^)]*\w)/,
    detail: "A path is assembled from a value, which may escape the intended directory.",
    remediation: "Resolve the path, then check it still starts with the directory you meant. Stripping `..` is not enough — symlinks and encodings get around it."
  },
  /* ---------------- web ---------------- */
  {
    id: "xss-innerhtml",
    title: "Untrusted value written as HTML",
    severity: "high",
    confidence: "likely",
    cwe: "CWE-79",
    extensions: Bd,
    pattern: /\.(innerHTML|outerHTML)\s*=\s*(?!["'`][^"'`]*["'`]\s*[;\n])|\bdocument\.write\s*\(/,
    detail: "Assigning to `innerHTML` renders whatever the value contains, including script.",
    remediation: "Use `textContent` for text. Where markup is genuinely needed, sanitise with a library such as DOMPurify."
  },
  {
    id: "react-dangerous-html",
    title: "dangerouslySetInnerHTML",
    severity: "high",
    confidence: "possible",
    cwe: "CWE-79",
    extensions: ue,
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\{/,
    detail: "React escapes everything except this, which is why it is named the way it is.",
    remediation: "Render the value as text, or sanitise the HTML before it gets here."
  },
  {
    id: "cors-wildcard",
    title: "CORS open to every origin",
    severity: "medium",
    confidence: "likely",
    cwe: "CWE-942",
    extensions: [...ue, ...le, ...pe, ...Fe],
    pattern: /Access-Control-Allow-Origin["'\s:,]+\*|origin\s*:\s*["']\*["']/i,
    detail: "Any site can read responses from this endpoint.",
    remediation: "Name the origins you trust. A wildcard with credentials is refused by browsers anyway, which is usually how this is discovered."
  },
  {
    id: "csrf-disabled",
    title: "CSRF protection turned off",
    severity: "high",
    confidence: "likely",
    cwe: "CWE-352",
    extensions: [...ue, ...le, ...pe, ...Ce],
    pattern: /csrf\s*[:=]\s*(?:false|False|None|null)|@csrf_exempt|skip_before_action\s+:verify_authenticity_token/,
    detail: "State-changing requests can be made from another site on a user’s behalf.",
    remediation: "Re-enable the protection. For an API called by non-browser clients, prefer a token in a header, which is not sent cross-site automatically."
  },
  /* ---------------- crypto and transport ---------------- */
  {
    id: "weak-hash",
    title: "Broken hash function",
    severity: "medium",
    confidence: "likely",
    cwe: "CWE-327",
    extensions: [...ue, ...le, ...pe, ...lt, ...Ce, ...Fe],
    pattern: /\b(?:createHash\s*\(\s*["'](?:md5|sha1)["']|hashlib\.(?:md5|sha1)\s*\(|MessageDigest\.getInstance\s*\(\s*["'](?:MD5|SHA-?1)["']|md5\s*\()/i,
    detail: "MD5 and SHA-1 are broken for anything that needs to resist an attacker.",
    remediation: "Use SHA-256 for integrity, and bcrypt, scrypt or Argon2 for passwords. A fast hash is the wrong tool for a password whatever its strength.",
    // Non-security uses are legitimate and common.
    unless: /etag|cache[_-]?key|checksum|fingerprint|dedup|bucket|shard/i
  },
  {
    id: "weak-cipher",
    title: "Broken cipher",
    severity: "high",
    confidence: "likely",
    cwe: "CWE-327",
    extensions: [...ue, ...le, ...pe, ...lt, ...Fe],
    pattern: /\b(?:DES|RC4|3DES|Blowfish|createCipher\s*\()|AES\/ECB|MODE_ECB/,
    detail: "This cipher or mode does not provide the confidentiality it appears to.",
    remediation: "Use AES-GCM or ChaCha20-Poly1305 — an authenticated mode, so tampering is detected rather than decrypted."
  },
  {
    id: "tls-verification-off",
    title: "TLS certificate checking disabled",
    severity: "critical",
    confidence: "likely",
    cwe: "CWE-295",
    extensions: [...ue, ...le, ...pe, ...Fe, ...Ce],
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0)|VERIFY_NONE/,
    detail: "The connection is encrypted but unauthenticated, so anyone in the path can read it.",
    remediation: "Turn verification back on. For a self-signed certificate, add that CA to the trust store rather than disabling the check."
  },
  {
    id: "insecure-random",
    title: "Predictable randomness used for a secret",
    severity: "medium",
    confidence: "possible",
    cwe: "CWE-338",
    extensions: [...ue, ...le, ...lt, ...pe],
    pattern: /\b(?:Math\.random\s*\(|random\.random\s*\(|mt_rand\s*\(|new\s+Random\s*\(|\brand\s*\(\s*\))/,
    // Only a finding when the value is used for something that must not be
    // guessable; `Math.random()` for a jitter or a demo colour is fine.
    // `id` is deliberately absent: `elementId` and `videoId` are everywhere,
    // and a random DOM id is not a security problem.
    nearby: /\b(?:token|secret|password|passwd|key|nonce|salt|otp|session|csrf|uuid|apikey)\b/i,
    detail: "A general-purpose random number generator is predictable from its output.",
    remediation: "Use `crypto.randomBytes`, `secrets.token_urlsafe`, or `SecureRandom` — a generator meant for values an attacker must not guess."
  },
  {
    id: "http-url",
    title: "Plaintext HTTP endpoint",
    severity: "low",
    confidence: "possible",
    cwe: "CWE-319",
    extensions: [...ue, ...le, ...pe, ...lt, ...Ce, ...Fe],
    pattern: /["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|example\.|schemas?\.|www\.w3\.org|xmlns)[^"'`\s]+/,
    detail: "Traffic to this address is readable and modifiable in transit.",
    remediation: "Use HTTPS. If the service genuinely has no TLS, that is the finding."
  },
  /* ---------------- deserialization and misc ---------------- */
  {
    id: "unsafe-deserialization",
    title: "Unsafe deserialization",
    severity: "critical",
    confidence: "likely",
    cwe: "CWE-502",
    extensions: [...le, ...pe, ...Ce, ...lt],
    pattern: /\b(?:pickle\.loads?|yaml\.load\s*\((?![^)]*Safe)|unserialize\s*\(|Marshal\.load|readObject\s*\(|ObjectInputStream)/,
    detail: "Deserializing untrusted data can execute code during the deserialization itself.",
    remediation: "Use a data-only format — JSON, or `yaml.safe_load`. If an object graph is genuinely needed, sign the payload and verify before reading it."
  },
  {
    id: "jwt-none-algorithm",
    title: "JWT signature not verified",
    severity: "critical",
    confidence: "likely",
    cwe: "CWE-347",
    extensions: [...ue, ...le, ...pe],
    pattern: /\b(?:jwt\.decode\s*\([^)]*verify\s*[:=]\s*(?:false|False)|algorithms?\s*[:=]\s*\[?\s*["']none["']|decode\s*\([^)]*\{\s*complete)/,
    detail: "A token is read without checking who signed it, so anyone can mint one.",
    remediation: "Verify with an explicit algorithm allow-list. Never accept the algorithm named in the token itself."
  },
  {
    id: "debug-enabled",
    title: "Debug mode enabled",
    severity: "medium",
    confidence: "possible",
    cwe: "CWE-489",
    extensions: [...le, ...pe, ...ue, ...Ce],
    pattern: /\bDEBUG\s*[:=]\s*True\b|app\.run\([^)]*debug\s*=\s*True|display_errors\s*[:=]\s*(?:On|1)/,
    detail: "Debug mode exposes stack traces, configuration, and sometimes an interactive console.",
    remediation: "Drive it from an environment variable, defaulting to off."
  },
  {
    id: "wildcard-bind",
    title: "Service bound to every interface",
    severity: "low",
    confidence: "possible",
    cwe: "CWE-668",
    extensions: [...le, ...ue, ...Fe],
    pattern: /["'](?:0\.0\.0\.0|::)["']\s*(?:,|\)|:)|host\s*=\s*["']0\.0\.0\.0["']/,
    detail: "The service is reachable from any network the host is on, not just locally.",
    remediation: "Bind to `127.0.0.1` unless it genuinely needs to be reachable, in which case make sure a firewall is what is deciding."
  }
];
new Map(Uo.map((r) => [r.id, r]));
const us = /\b(?:nova-ignore|nosec|nosemgrep|noqa\s*:\s*S\d+|eslint-disable[^\n]*security)\b/, Hd = /^\s*(?:\/\/|#(?!!)|\*|\/\*|<!--|--\s)/, zd = /(?:^|[/\\])(?:node_modules|vendor|dist|build|out|coverage|\.git|__pycache__|\.venv|venv|target)[/\\]|\.min\.(?:js|css)$|\.(?:map|lock)$/;
function Ud(r) {
  return !zd.test(r);
}
function qd(r, t, e = Uo) {
  var a;
  const n = y.extname(r).toLowerCase(), i = e.filter(
    (c) => c.extensions.length === 0 || c.extensions.includes(n)
  );
  if (!i.length) return [];
  const s = [], o = t.split(/\r?\n/);
  for (let c = 0; c < o.length; c++) {
    const u = o[c];
    if (!(u.length > 2e3) && !Hd.test(u) && !us.test(u) && !(c > 0 && us.test(o[c - 1])))
      for (const f of i) {
        f.pattern.lastIndex = 0;
        const d = f.pattern.exec(u);
        d && ((a = f.unless) != null && a.test(u) || f.nearby && !f.nearby.test(Wd(o, c)) || s.push({
          severity: f.severity,
          confidence: f.confidence,
          rule: f.id,
          title: f.title,
          detail: f.detail.replace("$1", d[1] ?? ""),
          remediation: f.remediation,
          relative: r,
          line: c + 1,
          column: d.index + 1,
          endColumn: d.index + d[0].length + 1,
          excerpt: u.trim().slice(0, 200),
          cwe: f.cwe
        }));
      }
  }
  return s;
}
function Wd(r, t) {
  return r.slice(Math.max(0, t - ls), t + ls + 1).join(`
`).replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}
const Zd = [
  {
    rule: "aws-access-key",
    title: "AWS access key id",
    pattern: /\b((?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16})\b/g,
    severity: "critical",
    remediation: "Deactivate the key in IAM, rotate it, and read it from the environment instead."
  },
  {
    rule: "github-token",
    title: "GitHub token",
    pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,255})\b/g,
    severity: "critical",
    remediation: "Revoke it in GitHub → Settings → Developer settings, and use a secret store."
  },
  {
    rule: "slack-token",
    title: "Slack token",
    pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    severity: "high",
    remediation: "Revoke it in the Slack app settings and re-issue it into the environment."
  },
  {
    rule: "stripe-key",
    title: "Stripe secret key",
    pattern: /\b(sk_(?:live|test)_[A-Za-z0-9]{16,})\b/g,
    severity: "critical",
    remediation: "Roll the key in the Stripe dashboard. A live key here is a payments incident."
  },
  {
    rule: "google-api-key",
    title: "Google API key",
    pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/g,
    severity: "high",
    remediation: "Regenerate it in the Google Cloud console and restrict it by referrer or IP."
  },
  {
    rule: "openai-key",
    title: "OpenAI API key",
    pattern: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g,
    severity: "critical",
    remediation: "Revoke it in the OpenAI dashboard and read it from the environment."
  },
  {
    rule: "anthropic-key",
    title: "Anthropic API key",
    pattern: /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
    severity: "critical",
    remediation: "Revoke it in the Anthropic console and read it from the environment."
  },
  {
    rule: "private-key",
    title: "Private key",
    pattern: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----)/g,
    severity: "critical",
    remediation: "Treat the key as compromised: generate a new pair and rotate everything trusting it."
  },
  {
    rule: "jwt",
    title: "JSON Web Token",
    pattern: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
    severity: "medium",
    remediation: "A signed token in source is a live session. Revoke it and issue tokens at runtime."
  },
  {
    rule: "connection-string",
    title: "Connection string with a password",
    // A URL with credentials in the authority. `:` then non-`@` then `@host`.
    pattern: /\b((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp|ftp):\/\/[^\s:/@]+:[^\s@/]{3,}@[^\s/]+)/gi,
    severity: "high",
    remediation: "Move the credential to an environment variable and build the URL at runtime."
  }
], Jd = /\b(?:api[_-]?key|apikey|secret|passwd|password|pwd|token|auth[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key|credential|session[_-]?key|encryption[_-]?key)\b/i, ds = /([A-Za-z_][A-Za-z0-9_.-]*)\s*(?::=|=>|[:=])\s*(?:"([^"\n]{8,})"|'([^'\n]{8,})'|`([^`\n]{8,})`)/g, Kd = /^(?:x{3,}|\*{3,}|\.{3,}|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|%[sd]|null|none|true|false|undefined|changeme|example|placeholder|your[_-]?\w+[_-]?here|todo|test|dummy|sample|redacted|insert[_-]?\w+|replace[_-]?\w+)$/i, Yd = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // UUID
  /^(?:sha\d{3}|sha1|md5)[-:]/i,
  // subresource integrity / digest prefix
  /^data:[a-z]+\/[a-z0-9.+-]+;base64,/i,
  // inline asset
  /^[0-9a-f]{32,}$/i,
  // a bare hex digest
  /^https?:\/\//i,
  // a URL with no credential in it
  /^[/.~]/,
  // a path
  /^\d+(?:\.\d+)*$/
  // a version
], Gd = /(?:\.example|\.sample|\.template|\.dist)(?:$|\.)|(?:^|[/\\])(?:fixtures?|__fixtures__|testdata|examples?)[/\\]/i;
function Vd(r, t) {
  const e = [], n = t.split(/\r?\n/), i = Gd.test(r);
  for (let s = 0; s < n.length; s++) {
    const o = n[s];
    o.length > 2e3 || /\bnosec\b|\bnova-ignore\b|\bgitleaks:allow\b/.test(o) || (e.push(...Xd(o, s + 1, i)), e.push(...Qd(o, s + 1, i)));
  }
  return e;
}
function Xd(r, t, e) {
  const n = [];
  for (const i of Zd) {
    i.pattern.lastIndex = 0;
    let s;
    for (; s = i.pattern.exec(r); ) {
      const o = s[1];
      n.push({
        rule: i.rule,
        title: i.title,
        detail: `A ${i.title.toLowerCase()} appears in this file.`,
        remediation: i.remediation,
        // In a sample file the shape is the point, so it is reported quietly
        // rather than not at all — a real key does end up in `.env.example`.
        severity: e ? "low" : i.severity,
        confidence: e ? "possible" : "confirmed",
        line: t,
        column: s.index + 1,
        endColumn: s.index + o.length + 1,
        excerpt: qo(r, s.index, o.length),
        cwe: "CWE-798"
      });
    }
  }
  return n;
}
function Qd(r, t, e) {
  const n = [];
  ds.lastIndex = 0;
  let i;
  for (; i = ds.exec(r); ) {
    const s = i[1], o = i[2] ?? i[3] ?? i[4] ?? "";
    if (!Jd.test(s) || !ef(o)) continue;
    const a = r.indexOf(o, i.index);
    n.push({
      rule: "hardcoded-credential",
      title: "Hardcoded credential",
      detail: `\`${s}\` is assigned a literal value that looks like a credential.`,
      remediation: "Read it from the environment or a secret store, and rotate it — anything committed should be treated as public.",
      severity: e ? "low" : "high",
      // Never better than `likely`: this is a name and a shape, not proof.
      confidence: e ? "possible" : "likely",
      line: t,
      column: a + 1,
      endColumn: a + o.length + 1,
      excerpt: qo(r, a, o.length),
      cwe: "CWE-798"
    });
  }
  return n;
}
function ef(r) {
  return r.length < 8 || Kd.test(r) || Yd.some((t) => t.test(r)) || /^[a-z]+(?:[ _-][a-z]+){2,}$/i.test(r) ? !1 : tf(r) >= 3.2 || /^[A-Za-z0-9+/=_-]{24,}$/.test(r);
}
function tf(r) {
  const t = /* @__PURE__ */ new Map();
  for (const n of r) t.set(n, (t.get(n) ?? 0) + 1);
  let e = 0;
  for (const n of t.values()) {
    const i = n / r.length;
    e -= i * Math.log2(i);
  }
  return e;
}
function qo(r, t, e) {
  const n = r.slice(t, t + e), i = n.length > 8 ? n.slice(-4) : "", s = `${"•".repeat(Math.min(12, Math.max(4, n.length - 4)))}${i}`, o = r.slice(0, t) + s + r.slice(t + e);
  return o.length > 200 ? `${o.slice(0, 200)}…` : o;
}
const nf = "https://api.osv.dev/v1/querybatch", rf = "https://api.osv.dev/v1/vulns", fs = 500;
async function ps(r) {
  const t = [];
  for (const [n, i] of [
    ["package-lock.json", sf],
    ["pnpm-lock.yaml", of],
    ["yarn.lock", af],
    ["requirements.txt", cf],
    ["poetry.lock", lf],
    ["Cargo.lock", uf],
    ["go.sum", df],
    ["Gemfile.lock", ff],
    ["composer.lock", pf]
  ])
    try {
      const s = await v.readFile(y.join(r, n), "utf8");
      t.push(...i(s, n));
    } catch {
    }
  const e = /* @__PURE__ */ new Set();
  return t.filter((n) => {
    const i = `${n.ecosystem}|${n.name}|${n.version}`;
    return e.has(i) ? !1 : (e.add(i), !0);
  });
}
function sf(r, t) {
  let e;
  try {
    e = JSON.parse(r);
  } catch {
    return [];
  }
  const n = [];
  for (const [i, s] of Object.entries(e.packages ?? {})) {
    if (!i || !(s != null && s.version)) continue;
    const o = i.replace(/^.*?node_modules\//, "");
    o && n.push({ name: o, version: s.version, ecosystem: "npm", lockfile: t, dev: !!s.dev });
  }
  if (!n.length)
    for (const [i, s] of Object.entries(e.dependencies ?? {}))
      s != null && s.version && n.push({ name: i, version: s.version, ecosystem: "npm", lockfile: t, dev: !!s.dev });
  return n;
}
function of(r, t) {
  const e = [], n = /^\s{2}\/?(@?[^/\s@][^\s@]*(?:\/[^\s@]+)?)[@/](\d[^\s:(]*)/gm;
  let i;
  for (; i = n.exec(r); )
    e.push({ name: i[1], version: i[2], ecosystem: "npm", lockfile: t, dev: !1 });
  return e;
}
function af(r, t) {
  var i, s;
  const e = [], n = r.split(/\n(?=\S)/);
  for (const o of n) {
    const a = o.split(`
`)[0], c = (i = /^\s+version:?\s+"?([^"\s]+)"?/m.exec(o)) == null ? void 0 : i[1];
    if (!c) continue;
    const u = (s = /^"?(@?[^@\s"]+(?:\/[^@\s"]+)?)@/.exec(a.trim())) == null ? void 0 : s[1];
    u && e.push({ name: u, version: c, ecosystem: "npm", lockfile: t, dev: !1 });
  }
  return e;
}
function cf(r, t) {
  const e = [];
  for (const n of r.split(/\r?\n/)) {
    const i = n.split("#")[0].trim();
    if (!i || i.startsWith("-")) continue;
    const s = /^([A-Za-z0-9._-]+)\s*==\s*([A-Za-z0-9._-]+)/.exec(i);
    s && e.push({ name: s[1], version: s[2], ecosystem: "PyPI", lockfile: t, dev: !1 });
  }
  return e;
}
function lf(r, t) {
  var n, i, s;
  const e = [];
  for (const o of r.split(/\[\[package\]\]/).slice(1)) {
    const a = (n = /^\s*name\s*=\s*"([^"]+)"/m.exec(o)) == null ? void 0 : n[1], c = (i = /^\s*version\s*=\s*"([^"]+)"/m.exec(o)) == null ? void 0 : i[1], u = (s = /^\s*category\s*=\s*"([^"]+)"/m.exec(o)) == null ? void 0 : s[1];
    a && c && e.push({ name: a, version: c, ecosystem: "PyPI", lockfile: t, dev: u === "dev" });
  }
  return e;
}
function uf(r, t) {
  var n, i;
  const e = [];
  for (const s of r.split(/\[\[package\]\]/).slice(1)) {
    const o = (n = /^\s*name\s*=\s*"([^"]+)"/m.exec(s)) == null ? void 0 : n[1], a = (i = /^\s*version\s*=\s*"([^"]+)"/m.exec(s)) == null ? void 0 : i[1];
    o && a && e.push({ name: o, version: a, ecosystem: "crates.io", lockfile: t, dev: !1 });
  }
  return e;
}
function df(r, t) {
  const e = [];
  for (const n of r.split(/\r?\n/)) {
    const i = /^(\S+)\s+(v[^\s/]+)\s+h1:/.exec(n);
    i && e.push({ name: i[1], version: i[2], ecosystem: "Go", lockfile: t, dev: !1 });
  }
  return e;
}
function ff(r, t) {
  var i;
  const e = [], n = ((i = /GEM\n(?:.*\n)*?\s+specs:\n((?:\s{4}\S.*\n)+)/.exec(r)) == null ? void 0 : i[1]) ?? "";
  for (const s of n.split(`
`)) {
    const o = /^\s{4}(\S+)\s+\(([^)]+)\)/.exec(s);
    o && e.push({ name: o[1], version: o[2], ecosystem: "RubyGems", lockfile: t, dev: !1 });
  }
  return e;
}
function pf(r, t) {
  let e;
  try {
    e = JSON.parse(r);
  } catch {
    return [];
  }
  const n = [];
  for (const [i, s] of [
    [e.packages ?? [], !1],
    [e["packages-dev"] ?? [], !0]
  ])
    for (const o of i)
      !o.name || !o.version || n.push({
        name: o.name,
        version: o.version.replace(/^v/, ""),
        ecosystem: "Packagist",
        lockfile: t,
        dev: s
      });
  return n;
}
async function hf(r, t, e = {}) {
  var a;
  const n = e.productionOnly ? t.filter((c) => !c.dev) : t;
  if (!n.length) return { findings: [] };
  const i = e.fetchImpl ?? fetch, s = [], o = /* @__PURE__ */ new Map();
  for (let c = 0; c < n.length; c += fs) {
    const u = n.slice(c, c + fs);
    let f;
    try {
      f = await i(nf, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: u.map((p) => ({
            version: p.version,
            package: { name: p.name, ecosystem: p.ecosystem }
          }))
        }),
        signal: AbortSignal.timeout(e.timeoutMs ?? 3e4)
      });
    } catch (p) {
      return {
        findings: s,
        note: `Could not reach the advisory database: ${p.message}. Dependencies were not checked.`
      };
    }
    if (!f.ok)
      return { findings: s, note: `The advisory database returned ${f.status}. Dependencies were not checked.` };
    let d;
    try {
      d = await f.json();
    } catch {
      return { findings: s, note: "The advisory database returned something unreadable." };
    }
    for (const [p, m] of (d.results ?? []).entries()) {
      const w = u[p];
      if (!(!w || !((a = m == null ? void 0 : m.vulns) != null && a.length)))
        for (const k of m.vulns)
          k.id && o.set(k.id, k), s.push(gf(r, w, k));
    }
  }
  return await mf(s, o, i, e.timeoutMs ?? 3e4), { findings: s };
}
async function mf(r, t, e, n) {
  var s;
  const i = [...new Set(r.flatMap((o) => o.references ?? []))].filter((o) => {
    var a;
    return !((a = t.get(o)) != null && a.summary);
  }).slice(0, 40);
  await Promise.all(
    i.map(async (o) => {
      try {
        const a = await e(`${rf}/${o}`, {
          signal: AbortSignal.timeout(n)
        });
        a.ok && t.set(o, await a.json());
      } catch {
      }
    })
  );
  for (const o of r) {
    const a = (s = o.references) == null ? void 0 : s[0], c = a ? t.get(a) : void 0;
    if (!c) continue;
    c.summary && (o.title = `${o.packageName}: ${c.summary}`), c.details && (o.detail = c.details.slice(0, 500));
    const u = Wo(c, o.packageName ?? "");
    u && (o.fixedIn = u, o.remediation = `Upgrade ${o.packageName} to ${u} or later.`);
    const f = Zo(c);
    f && (o.severity = f);
  }
}
function gf(r, t, e) {
  const n = [e.id, ...e.aliases ?? []].filter(
    (s) => !!s
  ), i = Wo(e, t.name);
  return {
    source: "dependency",
    // Only downgraded from the advisory's own rating once it is known; until
    // then `high` avoids under-reporting something that turns out to be critical.
    severity: Zo(e) ?? "high",
    // The version is inside a published affected range. This is the one thing
    // the whole scanner can state as fact.
    confidence: "confirmed",
    rule: "vulnerable-dependency",
    title: `${t.name} ${t.version} has a known vulnerability`,
    detail: e.summary ?? `${n[0] ?? "An advisory"} affects this version.`,
    remediation: i ? `Upgrade ${t.name} to ${i} or later.` : `No fixed version is published yet. Check ${n[0] ?? "the advisory"} for a workaround.`,
    file: y.join(r, t.lockfile),
    relative: t.lockfile,
    line: 1,
    column: 1,
    endColumn: 1,
    excerpt: `${t.name}@${t.version}${t.dev ? " (dev)" : ""}`,
    references: n,
    packageName: t.name,
    packageVersion: t.version,
    fixedIn: i
  };
}
function Wo(r, t) {
  var e;
  for (const n of r.affected ?? [])
    if (!((e = n.package) != null && e.name && n.package.name !== t)) {
      for (const i of n.ranges ?? [])
        for (const s of i.events ?? [])
          if (s.fixed) return s.fixed;
    }
}
function Zo(r) {
  var i, s, o, a;
  const t = (s = (i = r.database_specific) == null ? void 0 : i.severity) == null ? void 0 : s.toLowerCase();
  if (t === "critical" || t === "high" || t === "moderate" || t === "low")
    return t === "moderate" ? "medium" : t;
  const e = (a = (o = r.severity) == null ? void 0 : o.find((c) => {
    var u;
    return (u = c.type) == null ? void 0 : u.startsWith("CVSS");
  })) == null ? void 0 : a.score;
  if (!e) return;
  const n = yf(e);
  if (n !== null)
    return n >= 9 ? "critical" : n >= 7 ? "high" : n >= 4 ? "medium" : "low";
}
function yf(r) {
  const t = Number(r);
  if (Number.isFinite(t)) return t;
  const e = /\/?(\d+\.\d+)$/.exec(r.trim());
  return e ? Number(e[1]) : null;
}
const wf = 1024 * 1024, bf = 2e4, vf = /* @__PURE__ */ new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".php",
  ".go",
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".cs",
  ".swift",
  ".m",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".rs",
  ".ex",
  ".exs",
  ".pl",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".sql",
  ".html",
  ".vue",
  ".svelte",
  ".yml",
  ".yaml",
  ".json",
  ".toml",
  ".ini",
  ".env",
  ".cfg",
  ".conf",
  ".tf",
  ".tfvars",
  ".properties",
  ".xml",
  ".gradle"
]), kf = /* @__PURE__ */ new Set(["Dockerfile", "Makefile", "Procfile", ".env", ".npmrc", ".netrc"]);
let wr = !1;
function Sf(r) {
  g.handle(
    "security:scan",
    async (t, e, n) => {
      const i = Date.now(), s = {
        findings: [],
        startedAt: i,
        durationMs: 0,
        filesScanned: 0,
        notes: []
      };
      if (!e)
        return s.notes.push("Open a project first."), s;
      if (wr)
        return s.notes.push("A scan is already running."), s;
      wr = !0;
      try {
        if (n.sast || n.secrets) {
          const o = await Af(e);
          for (const [a, c] of o.entries()) {
            a % 25 === 0 && r.broadcast("security:progress", {
              phase: n.sast ? "sast" : "secrets",
              scanned: a,
              total: o.length,
              message: y.relative(e, c)
            });
            let u;
            try {
              if ((await v.stat(c)).size > wf) continue;
              u = await v.readFile(c, "utf8");
            } catch {
              continue;
            }
            if (u.includes("\0")) continue;
            const f = y.relative(e, c);
            if (s.filesScanned++, n.sast)
              for (const d of qd(f, u))
                s.findings.push({ ...d, id: br(), source: "sast", file: c });
            if (n.secrets)
              for (const d of Vd(f, u))
                s.findings.push({
                  id: br(),
                  source: "secret",
                  severity: d.severity,
                  confidence: d.confidence,
                  rule: d.rule,
                  title: d.title,
                  detail: d.detail,
                  remediation: d.remediation,
                  file: c,
                  relative: f,
                  line: d.line,
                  column: d.column,
                  endColumn: d.endColumn,
                  excerpt: d.excerpt,
                  cwe: d.cwe
                });
          }
        }
        if (n.dependencies) {
          r.broadcast("security:progress", {
            phase: "dependencies",
            scanned: 0,
            total: 0,
            message: "Checking dependencies against published advisories"
          });
          const o = await ps(e);
          if (!o.length)
            s.notes.push("No lockfile found, so dependencies were not checked.");
          else {
            const { findings: a, note: c } = await hf(e, o);
            for (const u of a) s.findings.push({ ...u, id: br() });
            c && s.notes.push(c);
          }
        }
        s.findings.sort(xf);
      } finally {
        wr = !1, r.broadcast("security:progress", { phase: "done", scanned: 0, total: 0 });
      }
      return s.durationMs = Date.now() - i, s;
    }
  ), g.handle("security:dependencies", (t, e) => ps(e));
}
const hs = ["critical", "high", "medium", "low", "info"], ms = ["confirmed", "likely", "possible"];
function xf(r, t) {
  const e = hs.indexOf(r.severity) - hs.indexOf(t.severity);
  if (e !== 0) return e;
  const n = ms.indexOf(r.confidence) - ms.indexOf(t.confidence);
  return n !== 0 ? n : r.relative.localeCompare(t.relative) || r.line - t.line;
}
async function Af(r) {
  const t = [];
  for await (const e of et(r, bf)) {
    const n = y.relative(r, e);
    if (!Ud(n)) continue;
    const i = y.basename(e), s = y.extname(e).toLowerCase();
    !vf.has(s) && !kf.has(i) && !i.startsWith(".env") || t.push(e);
  }
  return t.sort();
}
function br() {
  return `f-${wt.randomUUID()}`;
}
function _f(r, t) {
  return r && t ? 'video/webm; codecs="vp8,opus"' : r ? 'video/webm; codecs="vp8"' : 'audio/webm; codecs="opus"';
}
const Jo = /(?:^|[/\\])(?:\.env(?:\..*)?|\.npmrc|\.netrc|id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.p12|.*\.pfx|.*\.keystore|credentials|\.aws|\.ssh)(?:$|[/\\])/i, Ef = 512 * 1024, Cf = 4e3, Tf = 8 * 1024 * 1024;
function gs() {
  return { header: null, segments: [], bytes: 0, nextSeq: 0, waiters: /* @__PURE__ */ new Set() };
}
async function $f(r) {
  const t = wt.randomBytes(16).toString("hex"), e = [], n = /* @__PURE__ */ new Set();
  let i = { activeFile: "" }, s = jf(), o = Of();
  const a = {
    main: gs(),
    camera: gs()
  }, c = Rs.createServer((x, A) => {
    u(x, A).catch(() => {
      A.headersSent || A.writeHead(500), A.end();
    });
  });
  async function u(x, A) {
    if (x.method !== "GET" && x.method !== "HEAD")
      return A.writeHead(405, { Allow: "GET" }), A.end();
    const N = new URL(x.url ?? "/", "http://localhost"), j = `/s/${t}`;
    if (!N.pathname.startsWith(j))
      return A.writeHead(404, { "Content-Type": "text/plain" }), A.end("Not found");
    const P = N.pathname.slice(j.length) || "/";
    if (P === "/" || P === "/index.html")
      return Pf(A, Df(r, t));
    if (P === "/events") return f(x, A);
    if (P === "/tree")
      return Be(A, { name: r.projectName, files: await Rf(r.root, e) });
    if (P === "/presence") return Be(A, i);
    if (P === "/file") {
      const z = N.searchParams.get("path") ?? "", F = await Nf(r.root, z, e);
      return "error" in F ? Be(A, { error: F.error }, F.status) : Be(A, { path: z, content: F.content });
    }
    if (P === "/collection")
      return r.file ? Be(A, await Mf(r.root, r.file)) : Be(A, { error: "No collection is being shared." }, 404);
    if (P === "/broadcast") return Be(A, s);
    if (P === "/agent") return Be(A, o);
    if (P === "/media") {
      const z = N.searchParams.get("channel") === "camera" ? "camera" : "main", F = Number(N.searchParams.get("from"));
      return d(x, A, z, Number.isFinite(F) ? F : -1);
    }
    A.writeHead(404, { "Content-Type": "text/plain" }), A.end("Not found");
  }
  function f(x, A) {
    A.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // The tunnel sits in front of this; without it the proxy buffers and
      // nothing arrives until the connection ends.
      "X-Accel-Buffering": "no"
    }), A.write(`event: presence
data: ${JSON.stringify(i)}

`), n.add(A);
    const N = setInterval(() => A.write(`: keep-alive

`), 2e4), j = () => {
      clearInterval(N), n.delete(A);
    };
    x.on("close", j), x.on("error", j);
  }
  async function d(x, A, N, j) {
    const P = a[N], z = j < 0;
    let F = p(P, j);
    !F.length && s.active && (await m(P, 2500), F = p(P, j));
    const K = [];
    z && P.header && K.push(P.header);
    for (const X of F) K.push(X.bytes);
    const Y = F.length ? F[F.length - 1].seq + 1 : Math.max(j, P.nextSeq);
    A.writeHead(200, {
      // Opaque on purpose: intermediaries transform and buffer media types for
      // their own optimisation, and there is nothing to gain from them trying.
      // The player learns the real type from the MIME string it hands to
      // `addSourceBuffer`, not from here.
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store, no-transform",
      "X-Next-Seq": String(Y),
      // How a viewer learns the broadcast ended, without a second request.
      "X-Live": s.active ? "1" : "0",
      "X-Robots-Tag": "noindex, nofollow"
    }), A.end(Buffer.concat(K));
  }
  function p(x, A) {
    return A < 0 ? x.segments.slice(-2) : x.segments.filter((N) => N.seq >= A);
  }
  function m(x, A) {
    return new Promise((N) => {
      const j = () => {
        clearTimeout(P), x.waiters.delete(j), N();
      }, P = setTimeout(j, A);
      x.waiters.add(j);
    });
  }
  await new Promise((x, A) => {
    c.once("error", A), c.listen(0, "127.0.0.1", x);
  });
  const w = c.address();
  return {
    port: typeof w == "object" && w ? w.port : 0,
    token: t,
    excluded: e,
    viewers: () => n.size,
    update(x) {
      i = x;
      const A = `event: presence
data: ${JSON.stringify(x)}

`;
      for (const N of n)
        try {
          N.write(A);
        } catch {
          n.delete(N);
        }
    },
    setBroadcast(x) {
      if (s = x, !x.active)
        for (const N of ["main", "camera"]) _(N);
      const A = `event: broadcast
data: ${JSON.stringify(x)}

`;
      for (const N of n)
        try {
          N.write(A);
        } catch {
          n.delete(N);
        }
    },
    pushMedia(x, A) {
      if (!A.length || !s.active) return;
      const N = a[x];
      if (!N.header && If(A)) {
        N.header = A;
        return;
      }
      for (N.segments.push({ seq: N.nextSeq++, bytes: A }), N.bytes += A.length; N.segments.length > 1 && N.bytes > Tf; )
        N.bytes -= N.segments.shift().bytes.length;
      for (const j of [...N.waiters]) j();
    },
    resetMedia(x) {
      _(x);
    },
    setAgent(x) {
      o = x;
      const A = `event: agent
data: ${JSON.stringify(x)}

`;
      for (const N of n)
        try {
          N.write(A);
        } catch {
          n.delete(N);
        }
    },
    async close() {
      for (const x of n)
        try {
          x.end();
        } catch {
        }
      n.clear();
      for (const x of ["main", "camera"]) _(x);
      await new Promise((x) => c.close(() => x()));
    }
  };
  function _(x) {
    const A = a[x];
    A.header = null, A.segments = [], A.bytes = 0;
    for (const N of [...A.waiters]) N();
  }
}
function Of() {
  return { active: !1, request: "", status: "", steps: [], edits: [], running: !1 };
}
function jf() {
  return { active: !1, screen: !1, camera: !1, microphone: !1, startedAt: 0 };
}
function If(r) {
  return r.length >= 4 && r[0] === 26 && r[1] === 69 && r[2] === 223 && r[3] === 163;
}
async function Nf(r, t, e) {
  if (!t) return { error: "No path given.", status: 400 };
  const n = y.resolve(r, t), i = y.relative(r, n);
  if (!i || i.startsWith("..") || y.isAbsolute(i))
    return { error: "Outside the shared project.", status: 403 };
  if (Jo.test(i))
    return e.includes(i) || e.push(i), { error: "This file is withheld from shares.", status: 403 };
  if (fa(r, n)) return { error: "Not shared.", status: 403 };
  let s;
  try {
    s = await v.stat(n);
  } catch {
    return { error: "No such file.", status: 404 };
  }
  if (!s.isFile()) return { error: "Not a file.", status: 400 };
  if (s.size > Ef) return { error: "Too large to share.", status: 413 };
  const o = await v.readFile(n, "utf8");
  return o.includes("\0") ? { error: "Binary file.", status: 415 } : { content: o };
}
async function Rf(r, t) {
  const e = [];
  for await (const n of et(r, Cf)) {
    const i = y.relative(r, n);
    if (Jo.test(i)) {
      t.includes(i) || t.push(i);
      continue;
    }
    e.push(i);
  }
  return e.sort();
}
async function Mf(r, t) {
  const e = y.resolve(r, t);
  if (y.relative(r, e).startsWith("..")) return { error: "Outside the shared project." };
  let i;
  try {
    i = await v.readFile(e, "utf8");
  } catch {
    return { error: "Could not read the collection." };
  }
  const s = Dt(i);
  return {
    name: y.basename(t),
    // Variables are shown as names only. A `@token = …` line in a shared file
    // would otherwise be a credential handed to whoever has the URL.
    variables: Object.keys(s.variables),
    requests: s.requests.map((o) => ({
      name: o.name,
      method: o.method,
      protocol: o.protocol,
      url: o.url,
      headers: o.headers.map((a) => ({
        name: a.name,
        value: /^(authorization|cookie|x-api-key|proxy-authorization)$/i.test(a.name) ? "••••" : a.value
      })),
      auth: o.auth.kind,
      body: Lf(o.body),
      hasTests: !!o.postScript
    }))
  };
}
function Lf(r) {
  var t;
  switch (r.kind) {
    case "text":
      return String(r.text ?? "");
    case "file":
      return `< ${String(r.path ?? "")}`;
    case "graphql":
      return String(r.query ?? "");
    case "multipart":
      return ((t = r.parts) == null ? void 0 : t.map((e) => e.name).join(", ")) ?? "";
    default:
      return "";
  }
}
function Pf(r, t) {
  r.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    // Nothing here loads anything remote, and saying so means an injected
    // string cannot turn the page into a request to somewhere else.
    // `media-src blob:` is what Media Source Extensions needs: the player is
    // fed from a blob URL this page creates, not from anywhere on the network.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; media-src blob:",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow"
  }), r.end(t);
}
function Be(r, t, e = 200) {
  const n = JSON.stringify(t);
  r.writeHead(e, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow"
  }), r.end(n);
}
function Df(r, t) {
  const e = `/s/${t}`, n = r.mode === "collection" ? "Shared collection" : `${r.projectName} — shared`;
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${ys(n)}</title>
<style>
  :root { color-scheme: dark; --bg:#0f1116; --panel:#12151c; --border:#232733;
          --text:#dfe4ee; --dim:#98a0b3; --faint:#646c7e; --accent:#82aaff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
         font:13px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif; }
  header { display:flex; align-items:center; gap:10px; padding:9px 14px;
           border-bottom:1px solid var(--border); background:var(--panel); }
  header b { font-weight:600; }
  .dot { width:8px; height:8px; border-radius:50%; background:#4ec9b0; }
  .dot.off { background:var(--faint); }
  main { display:flex; height:calc(100vh - 41px); }
  nav { width:270px; overflow:auto; border-right:1px solid var(--border);
        background:var(--panel); padding:6px 0; flex-shrink:0; }
  nav button { display:block; width:100%; text-align:left; padding:3px 12px;
               background:none; border:0; color:var(--dim); font:inherit;
               font-size:11.5px; cursor:pointer; white-space:nowrap;
               overflow:hidden; text-overflow:ellipsis; }
  nav button:hover { background:#ffffff0d; color:var(--text); }
  nav button.active { background:#82aaff22; color:var(--accent); }
  section { flex:1; overflow:auto; min-width:0; }
  pre { margin:0; padding:14px; font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
        white-space:pre; tab-size:2; }
  .empty { padding:24px; color:var(--faint); }
  .req { border-bottom:1px solid var(--border); padding:12px 16px; }
  .req h3 { margin:0 0 4px; font-size:13px; font-weight:600; }
  .m { display:inline-block; min-width:64px; padding:1px 6px; border-radius:3px;
       background:#ffffff10; font:600 10px/1.6 ui-monospace,monospace;
       letter-spacing:.04em; margin-right:8px; }
  .u { font:11.5px ui-monospace,monospace; color:var(--dim); word-break:break-all; }
  .kv { margin-top:6px; font:11px ui-monospace,monospace; color:var(--faint); }
  .body { margin-top:8px; padding:8px 10px; border-radius:4px; background:#00000040;
          font:11px/1.55 ui-monospace,monospace; white-space:pre-wrap; word-break:break-word; }
  .tag { margin-left:8px; padding:1px 6px; border-radius:9px; background:#ffffff10;
         font-size:9.5px; color:var(--faint); }
  footer { padding:8px 14px; border-top:1px solid var(--border); color:var(--faint);
           font-size:11px; background:var(--panel); }

  /* the live player */
  #live { display:none; border-bottom:1px solid var(--border); background:#000;
          position:relative; }
  #live.on { display:block; }
  #main-video { display:block; width:100%; max-height:60vh; background:#000; }
  #main-video.audio-only { height:64px; }
  #cam-wrap { display:none; position:absolute; right:12px; bottom:12px; width:180px;
              border:1px solid var(--border); border-radius:6px; overflow:hidden;
              background:#000; box-shadow:0 4px 18px #0009; }
  #cam-wrap.on { display:block; }
  #cam-video { display:block; width:100%; }
  .live-bar { display:flex; align-items:center; gap:8px; padding:6px 12px;
              background:var(--panel); border-bottom:1px solid var(--border);
              font-size:11px; color:var(--dim); }
  .live-bar .pill { display:inline-flex; align-items:center; gap:4px; padding:1px 7px;
                    border-radius:9px; background:#ffffff10; font-size:10px; }
  .live-bar .rec { width:7px; height:7px; border-radius:50%; background:#f2555a;
                   animation:pulse 1.6s infinite; }
  @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }
  .live-hint { padding:6px 12px; color:var(--faint); font-size:11px; background:var(--panel); }

  /* the agent panel */
  #agent { display:none; border-bottom:1px solid var(--border); background:var(--panel);
           padding:9px 14px; }
  #agent.on { display:block; }
  #agent h4 { margin:0 0 5px; font-size:12px; display:flex; align-items:center; gap:7px; }
  #agent .req { color:var(--dim); font-size:11.5px; margin-bottom:7px; }
  #agent ol { margin:0; padding-left:18px; font-size:11.5px; color:var(--dim); }
  #agent li.done { color:var(--text); }
  #agent li.running { color:var(--accent); }
  #agent li.skipped { text-decoration:line-through; color:var(--faint); }
  #agent .files { margin-top:7px; font:11px ui-monospace,monospace; color:var(--faint);
                  display:flex; flex-wrap:wrap; gap:10px; }
  #agent .add { color:#4ec9b0; }
  #agent .del { color:#f2555a; }
  #agent .verdict { margin-top:7px; font-size:11px; }
  #agent .verdict.passed { color:#4ec9b0; }
  #agent .verdict.failed { color:#f2555a; }
</style>

<header>
  <span class="dot" id="dot"></span>
  <b>${ys(r.mode === "collection" ? y.basename(r.file ?? "") : r.projectName)}</b>
  <span style="color:var(--faint)">${r.mode === "collection" ? "shared collection" : "shared session — read only"}</span>
  <span style="flex:1"></span>
  <span style="color:var(--faint)" id="now"></span>
</header>

<div id="live">
  <div class="live-bar">
    <span class="rec"></span><b style="color:var(--text)">Live</b>
    <span id="live-what"></span>
    <span style="flex:1"></span>
    <span class="pill" id="live-hint-pill">audio starts muted — click the player to unmute</span>
  </div>
  <div style="position:relative">
    <video id="main-video" autoplay playsinline muted controls></video>
    <div id="cam-wrap"><video id="cam-video" autoplay playsinline muted></video></div>
  </div>
</div>

<div id="agent"></div>

<main>
  ${r.mode === "project" ? '<nav id="tree"></nav>' : ""}
  <section id="view"><p class="empty">Loading…</p></section>
</main>

<script>
(() => {
  const BASE = ${JSON.stringify(e)}
  const MODE = ${JSON.stringify(r.mode)}
  // Injected rather than written out again, so the type this page asks for is
  // by construction the one the presenter recorded.
  const shareMediaMime = ${_f.toString()}
  const view = document.getElementById('view')
  const dot = document.getElementById('dot')
  const now = document.getElementById('now')

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]))

  /* ---------------- the live player ---------------- */

  const live = document.getElementById('live')
  const liveWhat = document.getElementById('live-what')
  const camWrap = document.getElementById('cam-wrap')
  const players = {}

  /**
   * Plays one channel by feeding a MediaSource from the chunked response.
   *
   * The appends are queued rather than fired as they arrive: SourceBuffer
   * rejects an append while one is in flight, and a live stream produces the
   * next chunk long before the last has been processed.
   */
  function play(channel, el, mime) {
    if (players[channel]) return
    const source = new MediaSource()
    const state = { source, abort: new AbortController() }
    players[channel] = state
    el.src = URL.createObjectURL(source)

    source.addEventListener('sourceopen', async () => {
      let buffer
      const queue = []
      let appending = false

      const pump = () => {
        if (appending || !queue.length || source.readyState !== 'open') return
        if (buffer.updating) return
        appending = true
        try {
          // Peeked, not shifted: an append that throws must leave the chunk in
          // the queue to be retried. Removing it first loses a segment, and a
          // missing segment is a hole the decoder stalls on rather than an
          // error anyone sees.
          buffer.appendBuffer(queue[0])
          queue.shift()
        } catch (err) {
          appending = false
          // QuotaExceeded is the expected one on a long stream: drop what has
          // already been played and try the same chunk again.
          if (err && err.name === 'QuotaExceededError' && buffer.buffered.length) {
            try { buffer.remove(buffer.buffered.start(0), Math.max(0, el.currentTime - 8)) } catch {}
          }
        }
      }

      /*
       * Playback recovery.
       *
       * A live MSE stream stalls for reasons that are invisible from here: the
       * element runs to the end of what is buffered before the next segment
       * lands, a seek puts it in a gap, or autoplay was refused and the first
       * play() rejected. All of them look identical — a frozen picture with
       * data still arriving — and none of them fire an error. So rather than
       * enumerate the causes, watch the symptom: if the clock is not moving and
       * there is buffered media ahead, go to it.
       */
      let lastSeen = -1
      state.watchdog = setInterval(() => {
        if (source.readyState !== 'open' || !buffer) return
        const ahead = buffer.buffered.length
          ? buffer.buffered.end(buffer.buffered.length - 1)
          : 0
        const stuck = el.currentTime === lastSeen
        lastSeen = el.currentTime
        if (!stuck) return

        // Landing further back than the very edge on purpose: a player parked
        // on the last frame it has drops straight back to waiting for data, so
        // recovering to the edge just stalls again a moment later.
        if (ahead > el.currentTime + 0.5 && !buffer.updating) {
          el.currentTime = Math.max(0, ahead - 1.5)
        }
        if (el.paused) el.play().catch(() => undefined)
      }, 1000)

      // Polling for segments rather than reading one endless response: a
      // response that finishes is forwarded by every proxy in the path, while
      // one held open is buffered by some of them until it ends — which for a
      // live broadcast means never.
      let from = -1
      try {
        for (;;) {
          const res = await fetch(
            BASE + '/media?channel=' + channel + '&from=' + from,
            { signal: state.abort.signal, cache: 'no-store' },
          )
          if (!res.ok) break
          from = Number(res.headers.get('X-Next-Seq') ?? from)
          const bytes = new Uint8Array(await res.arrayBuffer())

          if (bytes.length) {
            if (!buffer) {
              buffer = source.addSourceBuffer(mime)
              buffer.mode = 'sequence'
              buffer.addEventListener('updateend', () => { appending = false; pump() })
            }
            queue.push(bytes)
            pump()

            // Chasing the live edge: a backgrounded tab builds a backlog, and a
            // viewer wants what is happening now, not a faithful replay of the
            // delay they accumulated. The landing point keeps a couple of
            // seconds in hand — jumping to the very edge leaves the player with
            // less than one segment and it stalls waiting for the next.
            if (buffer.buffered.length) {
              const end = buffer.buffered.end(buffer.buffered.length - 1)
              if (end - el.currentTime > 6) el.currentTime = Math.max(0, end - 2)
            }
            if (el.paused) el.play().catch(() => { /* autoplay policy */ })
          }

          if (res.headers.get('X-Live') === '0') break
          if (!players[channel]) break
        }
      } catch (err) {
        /* the viewer left, or the share went away */
      }
    })

    el.play().catch(() => { /* autoplay policy — the controls are there */ })
  }

  function stopPlay(channel, el) {
    const state = players[channel]
    if (!state) return
    delete players[channel]
    if (state.watchdog) clearInterval(state.watchdog)
    try { state.abort.abort() } catch {}
    try { el.removeAttribute('src'); el.load() } catch {}
  }

  function applyBroadcast(b) {
    const mainEl = document.getElementById('main-video')
    const camEl = document.getElementById('cam-video')

    if (!b || !b.active) {
      live.classList.remove('on')
      camWrap.classList.remove('on')
      stopPlay('main', mainEl)
      stopPlay('camera', camEl)
      return
    }

    const parts = []
    if (b.screen) parts.push('screen')
    if (b.camera) parts.push('camera')
    if (b.microphone) parts.push('microphone')
    liveWhat.textContent = parts.length ? 'sharing ' + parts.join(' + ') : ''

    const hasVideo = Boolean(b.screen || b.camera)
    mainEl.classList.toggle('audio-only', !hasVideo)
    live.classList.add('on')
    play('main', mainEl, shareMediaMime(hasVideo, Boolean(b.microphone)))

    // A camera only gets its own channel when a screen is occupying the main one.
    const separateCamera = Boolean(b.screen && b.camera)
    camWrap.classList.toggle('on', separateCamera)
    if (separateCamera) play('camera', camEl, shareMediaMime(true, false))
    else stopPlay('camera', camEl)
  }

  /*
   * Server-Sent Events are the fast path, and polling is the one that always
   * works. Some networks — corporate proxies and scanning middleboxes in
   * particular — buffer a response until it completes, which for an event
   * stream means the viewer is told nothing at all. Asking every few seconds
   * costs one small request and makes the page correct on those networks
   * instead of silently stale.
   */
  /* ---------------- what the agent is doing ---------------- */

  const agentEl = document.getElementById('agent')

  function applyAgent(a) {
    if (!a || !a.active) { agentEl.classList.remove('on'); return }
    agentEl.classList.add('on')

    const steps = (a.steps || []).map((s) =>
      '<li class="' + esc(s.status) + '">' + esc(s.text) + '</li>').join('')

    const files = (a.edits || []).map((e) =>
      '<span>' + esc(e.path) + ' <span class="add">+' + e.additions +
      '</span> <span class="del">−' + e.deletions + '</span></span>').join('')

    const v = a.verification
    const verdict = v
      ? '<div class="verdict ' + esc(v.state) + '">' +
        (v.state === 'running' ? 'Running the project’s tests…'
          : v.state === 'unavailable' ? 'No test suite to check this against'
          : v.passed + '/' + v.total + ' tests pass' + (v.failed ? ' — ' + v.failed + ' failed' : '') +
            ' (' + esc(v.framework) + ')') + '</div>'
      : ''

    agentEl.innerHTML =
      '<h4>' + (a.running ? '<span class="rec"></span>' : '') +
      'Assistant · ' + esc(a.status) + '</h4>' +
      (a.request ? '<div class="req">' + esc(a.request) + '</div>' : '') +
      (steps ? '<ol>' + steps + '</ol>' : '') +
      (files ? '<div class="files">' + files + '</div>' : '') +
      verdict
  }

  let lastAgent = ''
  const readAgent = () =>
    fetch(BASE + '/agent', { cache: 'no-store' })
      .then((r) => r.json())
      .then((a) => {
        const seen = JSON.stringify(a)
        if (seen === lastAgent) return
        lastAgent = seen
        applyAgent(a)
      })
      .catch(() => {})

  readAgent()
  setInterval(readAgent, 3000)

  let lastBroadcast = ''
  const readBroadcast = () =>
    fetch(BASE + '/broadcast', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => {
        dot.classList.remove('off')
        const seen = JSON.stringify(b)
        if (seen === lastBroadcast) return
        lastBroadcast = seen
        applyBroadcast(b)
      })
      .catch(() => dot.classList.add('off'))

  readBroadcast()
  setInterval(readBroadcast, 3000)

  const events = new EventSource(BASE + '/events')
  events.addEventListener('agent', (e) => {
    lastAgent = e.data
    applyAgent(JSON.parse(e.data))
  })
  events.addEventListener('broadcast', (e) => {
    lastBroadcast = e.data
    applyBroadcast(JSON.parse(e.data))
  })
  events.onerror = () => dot.classList.add('off')

  /* ---------------- the shared content ---------------- */

  if (MODE === 'collection') {
    fetch(BASE + '/collection').then((r) => r.json()).then((data) => {
      if (data.error) { view.innerHTML = '<p class="empty">' + esc(data.error) + '</p>'; return }
      view.innerHTML = data.requests.map((r) =>
        '<div class="req"><h3><span class="m">' + esc(r.method) + '</span>' + esc(r.name) +
        (r.hasTests ? '<span class="tag">has tests</span>' : '') +
        (r.auth !== 'none' ? '<span class="tag">' + esc(r.auth) + '</span>' : '') +
        '</h3><div class="u">' + esc(r.url) + '</div>' +
        (r.headers.length ? '<div class="kv">' + r.headers.map((h) =>
          esc(h.name) + ': ' + esc(h.value)).join('<br>') + '</div>' : '') +
        (r.body ? '<div class="body">' + esc(r.body) + '</div>' : '') +
        '</div>').join('') || '<p class="empty">This collection has no requests.</p>'
      now.textContent = data.requests.length + ' requests'
    })
    return
  }

  let active = ''
  const tree = document.getElementById('tree')

  const show = (path, content) => {
    active = path
    view.innerHTML = '<pre>' + esc(content) + '</pre>'
    for (const b of tree.children) b.classList.toggle('active', b.dataset.path === path)
    const chosen = tree.querySelector('[data-path="' + CSS.escape(path) + '"]')
    if (chosen) chosen.scrollIntoView({ block: 'nearest' })
  }

  const open = (path) =>
    fetch(BASE + '/file?path=' + encodeURIComponent(path))
      .then((r) => r.json())
      .then((d) => show(path, d.error ? '(' + d.error + ')' : d.content))

  fetch(BASE + '/tree').then((r) => r.json()).then((data) => {
    tree.innerHTML = ''
    for (const file of data.files) {
      const b = document.createElement('button')
      b.textContent = file
      b.dataset.path = file
      b.onclick = () => open(file)
      tree.appendChild(b)
    }
    now.textContent = data.files.length + ' files'
  })

  // The editor pushes where it is; a viewer follows unless they have clicked
  // something else, which would otherwise yank the page out from under them.
  let following = true
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest('nav')) following = false
  })

  let lastPresence = ''
  const applyPresence = (p) => {
    dot.classList.remove('off')
    if (!p || !p.activeFile) return
    if (following && p.content !== undefined) show(p.activeFile, p.content)
    else if (following) open(p.activeFile)
  }

  events.addEventListener('presence', (e) => {
    lastPresence = e.data
    applyPresence(JSON.parse(e.data))
  })

  // The same fallback the broadcast state uses, and for the same reason: an
  // event stream a proxy is holding onto tells the viewer nothing.
  setInterval(() => {
    fetch(BASE + '/presence', { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => {
        const seen = JSON.stringify(p)
        if (seen === lastPresence) return
        lastPresence = seen
        applyPresence(p)
      })
      .catch(() => dot.classList.add('off'))
  }, 3000)
})()
<\/script>

<footer>Read-only. Nothing you do here changes anything on the other side.</footer>
`;
}
function ys(r) {
  return r.replace(/[&<>"]/g, (t) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[t]);
}
const Ff = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i, ws = 45e3;
class pn extends Error {
  constructor(t, e) {
    super(t), this.hint = e, this.name = "TunnelError";
  }
}
async function Ko() {
  return Re("cloudflared");
}
async function Bf(r, t) {
  const e = await Ko();
  if (!e)
    throw new pn("cloudflared is not installed.", "brew install cloudflared");
  const n = qe(
    e,
    [
      "tunnel",
      "--url",
      `http://127.0.0.1:${r}`,
      // Quick tunnels print their banner and progress to stderr; asking for
      // structured output makes the URL findable without scraping a box-drawn
      // banner.
      "--no-autoupdate",
      "--loglevel",
      "info"
    ],
    { env: we(), stdio: ["ignore", "pipe", "pipe"] }
  );
  return new Promise((i, s) => {
    var m, w;
    let o = !1, a = "";
    const c = () => Hf(n), u = (k) => {
      o || (o = !0, clearTimeout(d), i({ url: k, stop: c }));
    }, f = (k) => {
      o || (o = !0, clearTimeout(d), c(), s(k));
    }, d = setTimeout(() => {
      f(
        new pn(
          `The tunnel did not come up within ${ws / 1e3}s.`,
          a.slice(-400) || "Check that outbound HTTPS is allowed."
        )
      );
    }, ws), p = (k) => {
      const _ = k.toString("utf8");
      a += _, a.length > 2e4 && (a = a.slice(-8e3));
      for (const A of _.split(`
`))
        A.trim() && (t == null || t(A.trim()));
      const x = Ff.exec(_);
      x && u(x[1]);
    };
    (m = n.stdout) == null || m.on("data", p), (w = n.stderr) == null || w.on("data", p), n.on("error", (k) => {
      f(new pn(`Could not start cloudflared: ${k.message}`));
    }), n.on("exit", (k) => {
      o || f(
        new pn(
          `cloudflared exited with code ${k ?? "unknown"} before opening a tunnel.`,
          a.slice(-400)
        )
      );
    });
  });
}
function Hf(r) {
  return r.exitCode !== null || r.signalCode ? Promise.resolve() : new Promise((t) => {
    const e = () => {
      clearTimeout(n), t();
    };
    r.once("exit", e);
    const n = setTimeout(() => {
      try {
        r.kill("SIGKILL");
      } catch {
      }
      t();
    }, 4e3);
    try {
      r.kill("SIGTERM");
    } catch {
      e();
    }
  });
}
let V = null, pt = null, oe = Tt();
function Yo() {
  return { active: !1, screen: !1, camera: !1, microphone: !1, startedAt: 0 };
}
function Tt() {
  return {
    state: "stopped",
    mode: "project",
    url: "",
    localUrl: "",
    sharing: "",
    viewers: 0,
    startedAt: 0,
    excluded: [],
    broadcast: Yo()
  };
}
function zf(r) {
  const t = () => (oe = { ...oe, viewers: (V == null ? void 0 : V.viewers()) ?? 0, excluded: (V == null ? void 0 : V.excluded) ?? [] }, r.broadcast("share:status", oe), oe);
  g.handle("share:status", () => t()), g.handle("share:available", async () => !!await Ko()), g.handle(
    "share:start",
    async (e, n, i) => {
      if (!n)
        return oe = { ...Tt(), state: "error", error: "Open a project first." }, t();
      await hn(), oe = {
        ...Tt(),
        state: "starting",
        mode: i.mode,
        startedAt: Date.now(),
        sharing: i.mode === "collection" ? y.basename(i.file ?? "") : y.basename(n)
      }, t();
      try {
        V = await $f({
          root: n,
          mode: i.mode,
          file: i.file,
          projectName: y.basename(n)
        });
      } catch (s) {
        return oe = { ...oe, state: "error", error: `Could not start the share server: ${s.message}` }, t();
      }
      oe = { ...oe, localUrl: `http://127.0.0.1:${V.port}/s/${V.token}/` }, t();
      try {
        pt = await Bf(V.port, (s) => r.broadcast("share:log", s));
      } catch (s) {
        const o = s;
        return await hn(), oe = {
          ...Tt(),
          state: "error",
          error: o.hint ? `${o.message} ${o.hint}` : o.message
        }, t();
      }
      return oe = {
        ...oe,
        state: "live",
        url: `${pt.url}/s/${V.token}/`
      }, t();
    }
  ), g.handle("share:stop", async () => (await hn(), oe = Tt(), t())), g.handle("share:presence", (e, n) => (V == null || V.update(n), t())), g.handle("share:screenSources", async () => {
    const { width: e } = Ur.getPrimaryDisplay().size, n = Ur.getPrimaryDisplay().size.height, i = 320 / Math.max(e, 1);
    return (await oa.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: Math.round(n * i) || 180 },
      fetchWindowIcons: !1
    })).map((o) => ({
      id: o.id,
      name: o.name,
      thumbnail: o.thumbnail.isEmpty() ? "" : o.thumbnail.toDataURL(),
      kind: o.id.startsWith("screen:") ? "screen" : "window"
    }));
  }), g.handle(
    "share:broadcast",
    (e, n, i) => {
      const s = n && (n.screen || n.camera || n.microphone) ? {
        active: !0,
        screen: n.screen,
        camera: n.camera,
        microphone: n.microphone,
        startedAt: oe.broadcast.active ? oe.broadcast.startedAt : Date.now(),
        error: i
      } : { ...Yo(), error: i };
      return oe = { ...oe, broadcast: s }, V == null || V.setBroadcast(s), t();
    }
  ), g.on("share:media", (e, n, i) => {
    V == null || V.pushMedia(n, Buffer.from(i));
  }), g.handle("share:agent", (e, n) => {
    oe.mode === "project" && (V == null || V.setAgent(n));
  }), g.handle("share:mediaReset", (e, n) => {
    V == null || V.resetMedia(n);
  }), ee.on("before-quit", () => void hn());
}
async function hn() {
  const r = [pt == null ? void 0 : pt.stop(), V == null ? void 0 : V.close()];
  pt = null, V = null, await Promise.all(r.map((t) => t == null ? void 0 : t.catch(() => {
  })));
}
const Te = he(de);
function Uf() {
  const r = We.homedir();
  return [
    process.env.ANDROID_HOME ?? "",
    process.env.ANDROID_SDK_ROOT ?? "",
    y.join(r, "Library", "Android", "sdk"),
    y.join(r, "Android", "Sdk"),
    y.join(r, "AppData", "Local", "Android", "Sdk"),
    "/usr/local/share/android-sdk",
    "/opt/android-sdk"
  ].filter(Boolean);
}
async function bs(r) {
  try {
    return (await v.stat(r)).isFile();
  } catch {
    return !1;
  }
}
let ut = null;
async function Ze() {
  if (ut) return ut;
  for (const r of Uf()) {
    const t = y.join(r, "platform-tools", "adb"), e = y.join(r, "emulator", "emulator");
    if (await bs(t))
      return ut = { root: r, adb: t, emulator: await bs(e) ? e : "" }, ut;
  }
  try {
    const { stdout: r } = await Te("/bin/sh", ["-lc", "command -v adb"]), t = r.trim().split(`
`)[0];
    if (t)
      return ut = { root: y.dirname(y.dirname(t)), adb: t, emulator: "" }, ut;
  } catch {
  }
  return null;
}
async function qf() {
  const r = await Ze();
  if (!r)
    return {
      platform: "android",
      available: !1,
      binary: "",
      version: "",
      detail: "No Android SDK found. Install Android Studio, or set ANDROID_HOME to an existing SDK."
    };
  let t = "";
  try {
    const { stdout: e } = await Te(r.adb, ["version"], { timeout: 8e3 });
    t = e.trim().split(`
`)[0] ?? "";
  } catch {
  }
  return r.emulator ? { platform: "android", available: !0, binary: r.adb, version: t, detail: "" } : {
    platform: "android",
    available: !1,
    binary: r.adb,
    version: t,
    detail: `Found adb at ${r.adb}, but no emulator. Install it from Android Studio › SDK Manager › SDK Tools › Android Emulator.`
  };
}
async function Wf(r) {
  if (!r.emulator) return [];
  try {
    const { stdout: t } = await Te(r.emulator, ["-list-avds"], { timeout: 15e3 });
    return t.split(`
`).map((e) => e.trim()).filter((e) => e && !e.includes(" ") && !e.startsWith("INFO"));
  } catch {
    return [];
  }
}
async function Zf(r) {
  var n;
  const t = /* @__PURE__ */ new Map();
  let e = "";
  try {
    ({ stdout: e } = await Te(r.adb, ["devices"], { timeout: 1e4 }));
  } catch {
    return t;
  }
  for (const i of e.split(`
`).slice(1)) {
    const [s, o] = i.trim().split(/\s+/);
    if (!s || !o || o === "offline") continue;
    let a = "", c = !1;
    try {
      const { stdout: u } = await Te(r.adb, ["-s", s, "emu", "avd", "name"], { timeout: 5e3 });
      a = ((n = u.split(`
`)[0]) == null ? void 0 : n.trim()) ?? "";
    } catch {
    }
    try {
      const { stdout: u } = await Te(r.adb, ["-s", s, "shell", "getprop", "sys.boot_completed"], {
        timeout: 5e3
      });
      c = u.trim() === "1";
    } catch {
    }
    t.set(s, { avd: a, ready: c });
  }
  return t;
}
async function Jf() {
  const r = await Ze();
  if (!r) return [];
  const t = await Zf(r), e = [], n = /* @__PURE__ */ new Set();
  for (const [i, s] of t) {
    s.avd && n.add(s.avd);
    let o = "";
    try {
      const { stdout: a } = await Te(r.adb, ["-s", i, "shell", "getprop", "ro.build.version.sdk"], {
        timeout: 5e3
      });
      a.trim() && (o = `API ${a.trim()}`);
    } catch {
    }
    e.push({
      id: i,
      name: s.avd || i,
      platform: "android",
      state: s.ready ? "booted" : "booting",
      api: o,
      kind: i.startsWith("emulator-") ? "emulator" : "physical",
      avd: s.avd || void 0
    });
  }
  for (const i of await Wf(r))
    n.has(i) || e.push({ id: `avd:${i}`, name: i, platform: "android", state: "shutdown", api: "", kind: "emulator", avd: i });
  return e;
}
async function Kf(r) {
  const t = await Ze();
  if (!(t != null && t.emulator)) return { ok: !1, error: "No Android emulator binary was found." };
  try {
    return qe(t.emulator, ["-avd", r, "-netdelay", "none", "-netspeed", "full"], {
      detached: !0,
      stdio: "ignore"
    }).unref(), { ok: !0 };
  } catch (e) {
    return { ok: !1, error: e instanceof Error ? e.message : String(e) };
  }
}
async function Yf(r) {
  const t = await Ze();
  t && await Te(t.adb, ["-s", r, "emu", "kill"], { timeout: 1e4 }).catch(() => {
  });
}
async function Gf(r) {
  const t = await Ze();
  if (!t) return null;
  try {
    const { stdout: e } = await Vf(t.adb, ["-s", r, "exec-out", "screencap", "-p"]);
    return e.length ? e : null;
  } catch {
    return null;
  }
}
function Vf(r, t) {
  return new Promise((e, n) => {
    de(r, t, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: 2e4 }, (i, s) => {
      i ? n(i) : e({ stdout: s });
    });
  });
}
const Xf = {
  home: "KEYCODE_HOME",
  back: "KEYCODE_BACK",
  menu: "KEYCODE_MENU",
  power: "KEYCODE_POWER",
  enter: "KEYCODE_ENTER",
  delete: "KEYCODE_DEL",
  appswitch: "KEYCODE_APP_SWITCH"
};
async function Qf(r, t) {
  const e = await Ze();
  if (!e) return;
  const n = (i) => Te(e.adb, ["-s", r, "shell", ...i], { timeout: 15e3 }).catch(() => {
  });
  switch (t.kind) {
    case "tap":
      await n(["input", "tap", String(Math.round(t.x)), String(Math.round(t.y))]);
      return;
    case "swipe":
      await n([
        "input",
        "swipe",
        String(Math.round(t.x)),
        String(Math.round(t.y)),
        String(Math.round(t.toX)),
        String(Math.round(t.toY)),
        String(t.durationMs ?? 250)
      ]);
      return;
    case "text":
      await n(["input", "text", JSON.stringify(t.text.replace(/ /g, "%s"))]);
      return;
    case "key":
      await n(["input", "keyevent", Xf[t.key] ?? "KEYCODE_HOME"]);
      return;
  }
}
async function ep(r, t) {
  const e = await Ze();
  if (!e) return { ok: !1, output: "No Android SDK found." };
  try {
    const { stdout: n, stderr: i } = await Te(e.adb, ["-s", r, "install", "-r", t], {
      timeout: 18e4,
      maxBuffer: 16777216
    }), s = `${n}${i}`.trim();
    return { ok: /Success/i.test(s), output: s };
  } catch (n) {
    const i = n;
    return { ok: !1, output: (i.stderr || i.stdout || i.message || String(n)).trim() };
  }
}
async function tp(r, t) {
  const e = await Ze();
  if (!e) return null;
  const n = qe(e.adb, ["-s", r, "logcat", "-T", "200", "-v", "brief"], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let i = "";
  return n.stdout.on("data", (s) => {
    i += s.toString("utf8");
    const o = i.split(`
`);
    i = o.pop() ?? "";
    for (const a of o) a.trim() && t(a);
  }), n;
}
const Hr = he(de);
function rt(r, t = 3e4) {
  return Hr("xcrun", ["simctl", ...r], { timeout: t, maxBuffer: 32 * 1024 * 1024 });
}
async function np() {
  if (process.platform !== "darwin")
    return {
      platform: "ios",
      available: !1,
      binary: "",
      version: "",
      detail: "iOS simulators only exist on macOS."
    };
  try {
    await rt(["help"], 15e3);
  } catch {
    return {
      platform: "ios",
      available: !1,
      binary: "",
      version: "",
      detail: "simctl was not found. It ships with Xcode, not the Command Line Tools — install Xcode, then run: sudo xcode-select -s /Applications/Xcode.app"
    };
  }
  let r = "";
  try {
    const { stdout: t } = await Hr("xcodebuild", ["-version"], { timeout: 15e3 });
    r = t.trim().split(`
`)[0] ?? "";
  } catch {
  }
  return { platform: "ios", available: !0, binary: "xcrun simctl", version: r, detail: "" };
}
async function rp() {
  if (process.platform !== "darwin") return [];
  let r;
  try {
    const { stdout: e } = await rt(["list", "devices", "available", "--json"]);
    r = JSON.parse(e);
  } catch {
    return [];
  }
  const t = [];
  for (const [e, n] of Object.entries(r.devices ?? {})) {
    const i = e.split(".").pop().replace(/-/g, " ").replace(/^(\w+) (\d+) (\d+)$/, "$1 $2.$3");
    for (const s of n)
      s.isAvailable !== !1 && t.push({
        id: s.udid,
        name: s.name,
        platform: "ios",
        state: s.state === "Booted" ? "booted" : s.state === "Booting" ? "booting" : "shutdown",
        api: i,
        kind: "simulator"
      });
  }
  return t;
}
async function ip(r) {
  try {
    await rt(["boot", r], 12e4);
  } catch (t) {
    const e = t instanceof Error ? t.message : String(t);
    if (!/current state: Booted|Unable to boot device in current state/i.test(e))
      return { ok: !1, error: e };
  }
  return await Hr("open", ["-a", "Simulator"], { timeout: 3e4 }).catch(() => {
  }), { ok: !0 };
}
async function sp(r) {
  await rt(["shutdown", r], 6e4).catch(() => {
  });
}
async function op(r) {
  return new Promise((t) => {
    de(
      "xcrun",
      ["simctl", "io", r, "screenshot", "--type=png", "-"],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: 2e4 },
      (e, n) => {
        const i = n;
        t(e || !(i != null && i.length) ? null : i);
      }
    );
  });
}
async function ap(r, t) {
  if (t.kind === "text")
    try {
      return await rt(["pbcopy", r], 15e3), !1;
    } catch {
      return !1;
    }
  return t.kind === "key" && t.key === "home", !1;
}
async function cp(r, t) {
  try {
    return await rt(["install", r, t], 18e4), { ok: !0, output: `Installed ${t}` };
  } catch (e) {
    const n = e;
    return { ok: !1, output: (n.stderr || n.message || String(e)).trim() };
  }
}
async function lp(r, t) {
  try {
    const { stdout: e } = await rt(["launch", r, t], 6e4);
    return { ok: !0, output: e.trim() };
  } catch (e) {
    const n = e;
    return { ok: !1, output: (n.stderr || n.message || String(e)).trim() };
  }
}
const Xe = /* @__PURE__ */ new Map(), An = /* @__PURE__ */ new Map(), up = 400;
function dp(r) {
  return g.handle(
    "devices:status",
    async () => Promise.all([qf(), np()])
  ), g.handle("devices:list", async () => {
    const [t, e] = await Promise.all([Jf(), rp()]);
    return [...t, ...e];
  }), g.handle(
    "devices:capabilities",
    (t, e) => e === "android" ? { mirror: !0, input: !0, install: !0, logs: !0 } : {
      mirror: !0,
      input: !1,
      install: !0,
      logs: !1,
      note: "simctl cannot send taps or read a device log. Those need Apple’s XCUITest or the third-party `idb`."
    }
  ), g.handle(
    "devices:boot",
    async (t, e) => e.platform === "android" ? Kf(e.avd ?? e.name) : ip(e.id)
  ), g.handle("devices:shutdown", async (t, e) => {
    mn(e.id), gn(e.id), e.platform === "android" ? await Yf(e.id) : await sp(e.id);
  }), g.handle("devices:startMirror", (t, e) => {
    mn(e.id);
    const n = async () => {
      const i = Xe.get(e.id);
      if (!i || i.busy) return;
      i.busy = !0;
      const s = i;
      try {
        const o = e.platform === "android" ? await Gf(e.id) : await op(e.id), a = o ? {
          deviceId: e.id,
          image: `data:image/png;base64,${o.toString("base64")}`,
          ...fp(o),
          capturedAt: Date.now()
        } : {
          deviceId: e.id,
          image: "",
          width: 0,
          height: 0,
          capturedAt: Date.now(),
          error: "The device did not return a frame. It may still be booting."
        };
        Xe.get(e.id) === s && r.broadcast("devices:frame", a);
      } finally {
        const o = Xe.get(e.id);
        o && (o.busy = !1);
      }
    };
    Xe.set(e.id, {
      platform: e.platform,
      timer: setInterval(() => void n(), up),
      busy: !1
    }), n();
  }), g.handle("devices:stopMirror", (t, e) => mn(e)), g.handle("devices:input", async (t, e, n) => e.platform === "android" ? (await Qf(e.id, n), !0) : ap(e.id, n)), g.handle(
    "devices:install",
    async (t, e, n) => e.platform === "android" ? ep(e.id, n) : cp(e.id, n)
  ), g.handle(
    "devices:launch",
    async (t, e, n) => e.platform === "ios" ? lp(e.id, n) : { ok: !1, output: "Launching by bundle id is an iOS concept; install the APK instead." }
  ), g.handle("devices:startLogs", async (t, e) => {
    if (gn(e.id), e.platform !== "android") return !1;
    const n = await tp(
      e.id,
      (i) => r.broadcast("devices:log", { deviceId: e.id, text: i, at: Date.now() })
    );
    return n ? (An.set(e.id, n), !0) : !1;
  }), g.handle("devices:stopLogs", (t, e) => gn(e)), {
    /** Nothing should outlive the window that asked for it. */
    dispose() {
      for (const t of [...Xe.keys()]) mn(t);
      for (const t of [...An.keys()]) gn(t);
    }
  };
}
function mn(r) {
  const t = Xe.get(r);
  t && (clearInterval(t.timer), Xe.delete(r));
}
function gn(r) {
  const t = An.get(r);
  if (t) {
    try {
      t.kill("SIGTERM");
    } catch {
    }
    An.delete(r);
  }
}
function fp(r) {
  return r.length < 24 ? { width: 0, height: 0 } : { width: r.readUInt32BE(16), height: r.readUInt32BE(20) };
}
const pp = he(de), hp = 3 * 60 * 1e3;
async function _e(r) {
  try {
    return await v.access(r), !0;
  } catch {
    return !1;
  }
}
async function mp(r) {
  const t = [];
  return (await _e(y.join(r, "build.gradle")) || await _e(y.join(r, "build.gradle.kts"))) && t.push(await yp(r)), await _e(y.join(r, "pom.xml")) && t.push(await bp(r)), await _e(y.join(r, "package.json")) && t.push(await gp(r)), await _e(y.join(r, "Cargo.toml")) && t.push(await Sp(r)), await _e(y.join(r, "Makefile")) && t.push(await Ap(r)), t;
}
async function gp(r) {
  const t = y.join(r, "package.json"), e = {
    tool: "npm",
    label: "npm",
    file: t,
    command: "npm",
    tasks: []
  };
  await _e(y.join(r, "pnpm-lock.yaml")) ? (e.tool = "pnpm", e.label = "pnpm", e.command = "pnpm") : await _e(y.join(r, "yarn.lock")) && (e.tool = "yarn", e.label = "Yarn", e.command = "yarn");
  try {
    const n = JSON.parse(await v.readFile(t, "utf8"));
    e.tasks = Object.entries(n.scripts ?? {}).map(([i, s]) => ({
      id: `run:${i}`,
      name: i,
      description: s,
      group: "Scripts"
    })), e.dependencies = [
      ...vs(n.dependencies, "dependencies"),
      ...vs(n.devDependencies, "devDependencies")
    ];
  } catch (n) {
    e.error = `Could not read package.json: ${$n(n)}`;
  }
  return e;
}
function vs(r, t) {
  return Object.entries(r ?? {}).map(([e, n]) => ({
    id: `${t}:${e}`,
    name: e,
    version: n,
    scope: t,
    children: []
  }));
}
async function yp(r) {
  const t = y.join(r, "gradlew"), e = await _e(t) ? "./gradlew" : "gradle";
  return {
    tool: "gradle",
    label: "Gradle",
    file: await _e(y.join(r, "build.gradle.kts")) ? y.join(r, "build.gradle.kts") : y.join(r, "build.gradle"),
    command: e,
    // Common lifecycle tasks, shown immediately. `loadGradleTasks` replaces
    // these with the real list, which needs a daemon start we do not want to
    // pay for just because the panel was opened.
    tasks: [
      { id: "build", name: "build", description: "Assemble and test the project", group: "Build" },
      { id: "assemble", name: "assemble", description: "Assemble the outputs", group: "Build" },
      { id: "clean", name: "clean", description: "Delete the build directory", group: "Build" },
      { id: "test", name: "test", description: "Run the unit tests", group: "Verification" },
      { id: "check", name: "check", description: "Run all checks", group: "Verification" }
    ]
  };
}
async function wp(r, t) {
  const { stdout: e } = await bn(r, t, ["tasks", "--all", "--console=plain", "-q"]), n = [];
  let i = "Other";
  for (const s of e.split(/\r?\n/)) {
    const o = s.trimEnd();
    if (!o) continue;
    if (/^[A-Z][\w ]+ tasks$/.test(o)) {
      i = o.replace(/ tasks$/, "");
      continue;
    }
    if (/^-+$/.test(o)) continue;
    const a = /^([\w:.-]+)(?:\s+-\s+(.*))?$/.exec(o);
    a && n.push({ id: a[1], name: a[1], description: a[2] ?? "", group: i });
  }
  return n;
}
async function bp(r) {
  const t = y.join(r, "mvnw"), e = await _e(t) ? "./mvnw" : "mvn", n = {
    tool: "maven",
    label: "Maven",
    file: y.join(r, "pom.xml"),
    command: e,
    tasks: [
      { id: "clean", name: "clean", description: "Delete target/", group: "Lifecycle" },
      { id: "compile", name: "compile", description: "Compile the sources", group: "Lifecycle" },
      { id: "test", name: "test", description: "Run the unit tests", group: "Lifecycle" },
      { id: "package", name: "package", description: "Build the artifact", group: "Lifecycle" },
      { id: "verify", name: "verify", description: "Run checks on the built artifact", group: "Lifecycle" },
      { id: "install", name: "install", description: "Install into the local repository", group: "Lifecycle" }
    ]
  };
  try {
    const i = await v.readFile(n.file, "utf8");
    n.dependencies = vp(i);
  } catch (i) {
    n.error = `Could not read pom.xml: ${$n(i)}`;
  }
  return n;
}
function vp(r) {
  var n, i, s, o, a, c, u, f;
  const t = [], e = r.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, "");
  for (const d of e.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const p = d[1], m = ((i = (n = /<groupId>(.*?)<\/groupId>/.exec(p)) == null ? void 0 : n[1]) == null ? void 0 : i.trim()) ?? "", w = ((o = (s = /<artifactId>(.*?)<\/artifactId>/.exec(p)) == null ? void 0 : s[1]) == null ? void 0 : o.trim()) ?? "", k = ((c = (a = /<version>(.*?)<\/version>/.exec(p)) == null ? void 0 : a[1]) == null ? void 0 : c.trim()) ?? "managed", _ = ((f = (u = /<scope>(.*?)<\/scope>/.exec(p)) == null ? void 0 : u[1]) == null ? void 0 : f.trim()) ?? "compile";
    w && t.push({ id: `${m}:${w}`, name: m ? `${m}:${w}` : w, version: k, scope: _, children: [] });
  }
  return t;
}
function kp(r) {
  const t = [], e = [];
  let n = 0;
  for (const i of r.split(/\r?\n/)) {
    const s = i.replace(/^\[INFO\]\s?/, ""), o = /[+\\]-\s/.exec(s);
    if (!o) continue;
    const a = Math.floor(o.index / 3) + 1, c = s.slice(o.index + o[0].length).trim(), u = c.split(":");
    if (u.length < 4) continue;
    const f = {
      id: `${c}#${n++}`,
      name: `${u[0]}:${u[1]}`,
      version: u[3],
      scope: u[4] ?? "compile",
      children: []
    };
    for (; e.length && e[e.length - 1].depth >= a; ) e.pop();
    e.length ? e[e.length - 1].node.children.push(f) : t.push(f), e.push({ depth: a, node: f });
  }
  return t;
}
async function Sp(r) {
  const t = {
    tool: "cargo",
    label: "Cargo",
    file: y.join(r, "Cargo.toml"),
    command: "cargo",
    tasks: [
      { id: "build", name: "build", description: "Compile the package", group: "Build" },
      { id: "run", name: "run", description: "Build and run the binary", group: "Build" },
      { id: "test", name: "test", description: "Run the tests", group: "Verification" },
      { id: "clippy", name: "clippy", description: "Lint with Clippy", group: "Verification" },
      { id: "fmt", name: "fmt", description: "Format the sources", group: "Verification" },
      { id: "clean", name: "clean", description: "Remove target/", group: "Build" }
    ]
  };
  try {
    const e = await v.readFile(t.file, "utf8");
    t.dependencies = xp(e);
  } catch (e) {
    t.error = `Could not read Cargo.toml: ${$n(e)}`;
  }
  return t;
}
function xp(r) {
  var n;
  const t = [], e = r.split(/^\[/m);
  for (const i of e) {
    const s = i.slice(0, i.indexOf("]"));
    if (!/^(dev-|build-)?dependencies$/.test(s)) continue;
    const o = s;
    for (const a of i.slice(i.indexOf("]") + 1).split(/\r?\n/)) {
      const c = a.trim();
      if (!c || c.startsWith("#")) continue;
      const u = /^([\w-]+)\s*=\s*(.*)$/.exec(c);
      if (!u) continue;
      const f = u[2].trim(), d = f.startsWith('"') ? f.slice(1, f.indexOf('"', 1)) : ((n = /version\s*=\s*"([^"]+)"/.exec(f)) == null ? void 0 : n[1]) ?? "*";
      t.push({ id: `${o}:${u[1]}`, name: u[1], version: d, scope: o, children: [] });
    }
  }
  return t;
}
async function Ap(r) {
  const t = y.join(r, "Makefile"), e = { tool: "make", label: "Make", file: t, command: "make", tasks: [] };
  try {
    const n = await v.readFile(t, "utf8"), i = /* @__PURE__ */ new Set();
    for (const s of n.split(/\r?\n/)) {
      const o = /^([A-Za-z0-9][\w.-]*)\s*:(?!=)/.exec(s);
      !o || i.has(o[1]) || (i.add(o[1]), e.tasks.push({ id: o[1], name: o[1], description: "", group: "Targets" }));
    }
  } catch (n) {
    e.error = `Could not read Makefile: ${$n(n)}`;
  }
  return e;
}
async function _p(r, t) {
  switch (t.tool) {
    case "maven": {
      const { stdout: e } = await bn(r, t.command, ["dependency:tree", "-B"]);
      return kp(e);
    }
    case "gradle": {
      const { stdout: e } = await bn(r, t.command, ["dependencies", "--console=plain", "-q"]);
      return Ep(e);
    }
    case "cargo": {
      const { stdout: e } = await bn(r, "cargo", ["tree", "--prefix", "depth"]);
      return Cp(e);
    }
    default:
      return t.dependencies ?? [];
  }
}
function Ep(r) {
  const t = [], e = [];
  let n = 0, i = "compile";
  for (const s of r.split(/\r?\n/)) {
    const o = /^(\w+)\s+-\s/.exec(s);
    if (o) {
      i = o[1];
      continue;
    }
    const a = /[+\\]---\s/.exec(s);
    if (!a) continue;
    const c = Math.floor(a.index / 5) + 1;
    let u = s.slice(a.index + a[0].length).trim(), f;
    const d = u.indexOf(" -> ");
    d !== -1 && (f = u.slice(0, d).split(":").pop(), u = `${u.slice(0, d).split(":").slice(0, 2).join(":")}:${u.slice(d + 4)}`), u = u.replace(/\s*\(\*\)\s*$/, "").replace(/\s*\(n\)\s*$/, "");
    const p = u.split(":");
    if (p.length < 2) continue;
    const m = {
      id: `${u}#${n++}`,
      name: `${p[0]}:${p[1]}`,
      version: p[2] ?? "",
      scope: i,
      children: [],
      resolvedFrom: f
    };
    for (; e.length && e[e.length - 1].depth >= c; ) e.pop();
    e.length ? e[e.length - 1].node.children.push(m) : t.push(m), e.push({ depth: c, node: m });
  }
  return t;
}
function Cp(r) {
  const t = [], e = [];
  let n = 0;
  for (const i of r.split(/\r?\n/)) {
    const s = /^(\d+)(\S+)\s+v(\S+)/.exec(i.trim());
    if (!s) continue;
    const o = Number(s[1]), a = {
      id: `${s[2]}@${s[3]}#${n++}`,
      name: s[2],
      version: s[3],
      scope: "dependencies",
      children: []
    };
    for (; e.length && e[e.length - 1].depth >= o; ) e.pop();
    e.length ? e[e.length - 1].node.children.push(a) : t.push(a), e.push({ depth: o, node: a });
  }
  return t;
}
function bn(r, t, e) {
  return pp(t, e, {
    cwd: r,
    timeout: hp,
    maxBuffer: 64 * 1024 * 1024,
    env: we()
  });
}
function $n(r) {
  return r instanceof Error ? r.message : String(r);
}
function Tp() {
  g.handle("build:detect", (r, t) => mp(t)), g.handle(
    "build:tasks",
    async (r, t, e) => e.tool !== "gradle" ? e.tasks : wp(t, e.command)
  ), g.handle(
    "build:dependencies",
    (r, t, e) => _p(t, e)
  );
}
function $p(r) {
  var i;
  const t = [];
  let e = "";
  const n = () => {
    e && (t.push({ kind: "literal", text: e }), e = "");
  };
  for (let s = 0; s < r.length; s++) {
    const o = r[s];
    if (o === "$") {
      const a = r.indexOf("$", s + 1), c = a === -1 ? "" : r.slice(s + 1, a);
      if (a !== -1 && /^[A-Za-z_][\w]*$/.test(c)) {
        n(), t.push({ kind: "hole", name: c }), s = a;
        continue;
      }
    }
    if (/\s/.test(o)) {
      for (n(), ((i = t[t.length - 1]) == null ? void 0 : i.kind) !== "gap" && t.push({ kind: "gap" }); s + 1 < r.length && /\s/.test(r[s + 1]); ) s++;
      continue;
    }
    e += o;
  }
  return n(), t;
}
const Op = { "(": ")", "[": "]", "{": "}" }, jp = /* @__PURE__ */ new Set([")", "]", "}"]);
function Ip(r, t, e) {
  let n = 0, i = t, s = null;
  for (; i < r.length; ) {
    const a = r[i];
    if (s) {
      a === "\\" ? i++ : a === s && (s = null), i++;
      continue;
    }
    if (a === '"' || a === "'" || a === "`") {
      s = a, i++;
      continue;
    }
    if (Op[a]) {
      n++, i++;
      continue;
    }
    if (jp.has(a)) {
      if (n === 0) break;
      n--, i++;
      continue;
    }
    if (n === 0 && e && r.startsWith(e, i) || n === 0 && a === "," && e !== ",") break;
    i++;
  }
  const o = r.slice(t, i).trim();
  return o ? { value: o, end: i } : null;
}
function Np(r, t, e) {
  let n = t;
  const i = {};
  for (let s = 0; s < e.length; s++) {
    const o = e[s];
    if (o.kind === "literal") {
      if (!r.startsWith(o.text, n)) return null;
      n += o.text.length;
      continue;
    }
    if (o.kind === "gap") {
      for (; n < r.length && /\s/.test(r[n]); ) n++;
      continue;
    }
    let a = e[s + 1];
    (a == null ? void 0 : a.kind) === "gap" && (a = e[s + 2]);
    const c = (a == null ? void 0 : a.kind) === "literal" ? a.text : null;
    for (; n < r.length && /\s/.test(r[n]); ) n++;
    const u = Ip(r, n, c);
    if (!u || i[o.name] !== void 0 && i[o.name] !== u.value) return null;
    i[o.name] = u.value, n = u.end;
  }
  return { end: n, captures: i };
}
function Go(r, t) {
  const e = $p(t);
  if (!e.length) return [];
  const n = e[0].kind === "literal" ? e[0].text : null, i = [], s = [0];
  for (let c = 0; c < r.length; c++)
    r[c] === `
` && s.push(c + 1);
  const o = (c) => {
    let u = 0, f = s.length - 1;
    for (; u < f; ) {
      const d = Math.ceil((u + f) / 2);
      s[d] <= c ? u = d : f = d - 1;
    }
    return { line: u + 1, column: c - s[u] + 1 };
  };
  let a = 0;
  for (; a < r.length; ) {
    if (n) {
      const u = r.indexOf(n, a);
      if (u === -1) break;
      a = u;
    }
    const c = Np(r, a, e);
    if (c) {
      const u = o(a), f = o(c.end);
      i.push({
        line: u.line,
        column: u.column,
        // A multi-line match is reported against its first line; the panel
        // shows the full text, so the column is only used for navigation.
        endColumn: f.line === u.line ? f.column : u.column + 1,
        text: r.slice(a, c.end),
        captures: c.captures
      }), a = c.end > a ? c.end : a + 1;
    } else
      a++;
  }
  return i;
}
function Rp(r, t) {
  return r.replace(
    /\$([A-Za-z_]\w*)\$/g,
    (e, n) => t[n] !== void 0 ? t[n] : e
  );
}
function Mp(r, t, e) {
  const n = Go(r, t);
  let i = r;
  for (let s = n.length - 1; s >= 0; s--) {
    const o = n[s], a = Lp(r, o.line, o.column);
    i = i.slice(0, a) + Rp(e, o.captures) + i.slice(a + o.text.length);
  }
  return i;
}
function Lp(r, t, e) {
  let n = 0;
  for (let i = 1; i < t; i++) {
    const s = r.indexOf(`
`, n);
    if (s === -1) return n;
    n = s + 1;
  }
  return n + e - 1;
}
const Pp = 2 * 1024 * 1024;
function Dp() {
  g.handle(
    "structural:search",
    async (r, t, e, n) => {
      var a;
      if (!e.trim()) return [];
      const i = Math.max(1, Math.min((n == null ? void 0 : n.limit) ?? 500, 2e3)), s = (a = n == null ? void 0 : n.include) == null ? void 0 : a.trim(), o = [];
      for await (const c of et(t, 2e4)) {
        if (o.length >= i) break;
        if (Ot.has(y.extname(c).toLowerCase()) || s && !Fp(y.relative(t, c), s)) continue;
        let u;
        try {
          if ((await v.stat(c)).size > Pp) continue;
          u = await v.readFile(c, "utf8");
        } catch {
          continue;
        }
        if (!u.includes("\0")) {
          for (const f of Go(u, e))
            if (o.push({
              path: c,
              line: f.line,
              column: f.column,
              text: f.text,
              captures: f.captures
            }), o.length >= i) break;
        }
      }
      return o;
    }
  ), g.handle(
    "structural:replace",
    async (r, t, e, n) => {
      const i = [];
      for (const s of t)
        try {
          const o = await v.readFile(s, "utf8"), a = Mp(o, e, n);
          a !== o && i.push({ path: s, before: o, after: a });
        } catch {
        }
      return i;
    }
  );
}
function Fp(r, t) {
  return t.split(",").some((e) => {
    const n = e.trim();
    if (!n) return !1;
    const i = n.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/ /g, ".*");
    try {
      return new RegExp(i).test(r);
    } catch {
      return !1;
    }
  });
}
const Bp = he(de), ks = 6e4, Ss = 5e3, Vo = {
  postgres: { binary: "psql", hint: "Install the PostgreSQL client tools (`brew install libpq`)." },
  mysql: { binary: "mysql", hint: "Install the MySQL client (`brew install mysql-client`)." },
  sqlite: { binary: "sqlite3", hint: "Install SQLite (`brew install sqlite`)." }
};
function $r() {
  return y.join(ee.getPath("userData"), "databases.json");
}
function vn() {
  return y.join(ee.getPath("userData"), "database-secrets.bin");
}
async function dt() {
  try {
    const r = JSON.parse(await v.readFile($r(), "utf8"));
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}
async function xs(r) {
  await v.mkdir(y.dirname($r()), { recursive: !0 }), await v.writeFile($r(), JSON.stringify(r, null, 2), "utf8");
}
async function Xo() {
  if (!Ue.isEncryptionAvailable()) return {};
  try {
    const r = await v.readFile(vn());
    return JSON.parse(Ue.decryptString(r));
  } catch {
    return {};
  }
}
async function vr(r, t) {
  if (!Ue.isEncryptionAvailable()) return !1;
  const e = await Xo();
  t === null ? delete e[r] : e[r] = t;
  const n = Ue.encryptString(JSON.stringify(e));
  return await v.mkdir(y.dirname(vn()), { recursive: !0 }), await v.writeFile(vn(), n), await v.chmod(vn(), 384).catch(() => {
  }), !0;
}
function Hp() {
  g.handle("db:drivers", async () => {
    const r = [];
    for (const [t, e] of Object.entries(Vo)) {
      const n = await Re(e.binary);
      let i = "";
      if (n)
        try {
          const { stdout: s } = await Bp(n, ["--version"], { timeout: 5e3, env: we() });
          i = s.trim().split(`
`)[0];
        } catch {
          i = "";
        }
      r.push({ kind: t, binary: e.binary, available: !!n, version: i, hint: e.hint });
    }
    return r;
  }), g.handle("db:connections", () => dt()), g.handle(
    "db:save",
    async (r, t, e) => {
      const n = await dt(), i = n.findIndex((o) => o.id === t.id), s = { ...t };
      return e !== void 0 && (s.hasStoredPassword = e ? await vr(t.id, e) : !1, e || await vr(t.id, null)), i === -1 ? n.push(s) : n[i] = s, await xs(n), n;
    }
  ), g.handle("db:remove", async (r, t) => {
    const e = (await dt()).filter((n) => n.id !== t);
    return await vr(t, null), await xs(e), e;
  }), g.handle("db:test", async (r, t) => {
    const e = (await dt()).find((i) => i.id === t);
    if (!e) return { ok: !1, message: "No such connection." };
    const n = await Or(e, "SELECT 1;");
    return n.error ? { ok: !1, message: n.error } : { ok: !0, message: "Connected." };
  }), g.handle("db:schema", async (r, t) => {
    const e = (await dt()).find((n) => n.id === t);
    return e ? qp(e) : { connectionId: t, tables: [], error: "No such connection." };
  }), g.handle("db:query", async (r, t, e) => {
    const n = (await dt()).find((i) => i.id === t);
    return n ? Or(n, e) : { columns: [], rows: [], rowCount: 0, durationMs: 0, error: "No such connection." };
  });
}
async function Or(r, t) {
  const e = Vo[r.kind], n = await Re(e.binary), i = Date.now();
  if (!n)
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: 0,
      error: `\`${e.binary}\` is not on PATH. ${e.hint}`
    };
  const o = (await Xo())[r.id];
  let a;
  const c = we();
  switch (r.kind) {
    case "postgres":
      a = ["-X", "-A", "-F", kr, "-R", As, "--pset", "footer=off", r.url], o && (c.PGPASSWORD = o);
      break;
    case "mysql":
      a = ["--batch", "--raw", ...zp(r.url)], o && (c.MYSQL_PWD = o);
      break;
    case "sqlite":
      a = ["-header", "-separator", kr, r.url];
      break;
  }
  try {
    const { stdout: u, stderr: f } = await Up(n, a, t, {
      timeout: ks,
      maxBuffer: 67108864,
      env: c
    }), d = r.kind === "mysql" ? _s(u, "	", `
`) : _s(u, kr, r.kind === "postgres" ? As : `
`);
    if (!d.columns.length)
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: Date.now() - i,
        message: f.trim() || u.trim() || "Statement completed."
      };
    const p = d.rows.length > Ss;
    return {
      columns: d.columns,
      rows: p ? d.rows.slice(0, Ss) : d.rows,
      rowCount: d.rows.length,
      durationMs: Date.now() - i,
      truncated: p
    };
  } catch (u) {
    const f = u;
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: Date.now() - i,
      error: f.killed ? `Query timed out after ${ks / 1e3}s.` : (f.stderr || f.message || "Query failed.").trim()
    };
  }
}
const kr = "", As = "";
function _s(r, t, e) {
  const n = r.replace(/\n$/, "");
  if (!n.trim()) return { columns: [], rows: [] };
  const i = n.split(e).filter((a) => a.length > 0);
  if (!i.length) return { columns: [], rows: [] };
  const s = i[0].split(t).map((a) => a.replace(/^\n+/, "")), o = i.slice(1).map((a) => a.replace(/^\n+/, "").split(t));
  return { columns: s, rows: o };
}
function zp(r) {
  try {
    const t = new URL(r), e = [];
    t.hostname && e.push("-h", t.hostname), t.port && e.push("-P", t.port), t.username && e.push("-u", decodeURIComponent(t.username));
    const n = t.pathname.replace(/^\//, "");
    return n && e.push("-D", decodeURIComponent(n)), e;
  } catch {
    return [r];
  }
}
function Up(r, t, e, n) {
  return new Promise((i, s) => {
    var a;
    (a = de(r, t, n, (c, u, f) => {
      c ? s(Object.assign(c, { stdout: u, stderr: f })) : i({ stdout: u, stderr: f });
    }).stdin) == null || a.end(e.endsWith(";") || e.trim().endsWith(";") ? e : `${e};`);
  });
}
async function qp(r) {
  const t = Wp[r.kind], e = await Or(r, t);
  if (e.error) return { connectionId: r.id, tables: [], error: e.error };
  const n = /* @__PURE__ */ new Map();
  for (const i of e.rows) {
    const [s, o, a, c, u, f, d] = i;
    if (!o) continue;
    const p = `${s}.${o}`, m = n.get(p) ?? { schema: s || "", name: o, kind: a || "table", columns: [] };
    c && m.columns.push({
      name: c,
      type: u || "",
      nullable: f === "YES" || f === "1" || f === "t",
      primaryKey: d === "1" || d === "t" || d === "YES"
    }), n.set(p, m);
  }
  return {
    connectionId: r.id,
    tables: Array.from(n.values()).sort(
      (i, s) => i.schema.localeCompare(s.schema) || i.name.localeCompare(s.name)
    )
  };
}
const Wp = {
  postgres: `
    SELECT c.table_schema, c.table_name,
           CASE t.table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END,
           c.column_name, c.data_type, c.is_nullable,
           CASE WHEN pk.column_name IS NOT NULL THEN 't' ELSE 'f' END
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    LEFT JOIN (
      SELECT kcu.table_schema, kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
    ) pk ON pk.table_schema = c.table_schema
        AND pk.table_name = c.table_name
        AND pk.column_name = c.column_name
    WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY c.table_schema, c.table_name, c.ordinal_position;
  `,
  mysql: `
    SELECT c.TABLE_SCHEMA, c.TABLE_NAME,
           CASE t.TABLE_TYPE WHEN 'VIEW' THEN 'view' ELSE 'table' END,
           c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE,
           CASE WHEN c.COLUMN_KEY = 'PRI' THEN '1' ELSE '0' END
    FROM information_schema.COLUMNS c
    JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
    WHERE c.TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
    ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION;
  `,
  // SQLite has no information_schema; pragma_table_info is the equivalent.
  sqlite: `
    SELECT '' AS sch, m.name, m.type, p.name, p.type, CASE p."notnull" WHEN 0 THEN 'YES' ELSE 'NO' END, CAST(p.pk AS TEXT)
    FROM sqlite_master m
    JOIN pragma_table_info(m.name) p
    WHERE m.type IN ('table','view') AND m.name NOT LIKE 'sqlite_%'
    ORDER BY m.name, p.cid;
  `
}, Zp = he(de), Jp = 5 * 60 * 1e3;
function Kp() {
  g.handle("profile:open", async (r, t) => {
    const e = await v.readFile(t, "utf8");
    return Es(e, t);
  }), g.handle(
    "profile:run",
    async (r, t, e, n = []) => {
      const i = await v.mkdtemp(y.join(We.tmpdir(), "nova-prof-"));
      try {
        await Zp("node", ["--cpu-prof", "--cpu-prof-dir", i, e, ...n], {
          cwd: t,
          timeout: Jp,
          maxBuffer: 64 * 1024 * 1024,
          env: we()
        });
      } catch (c) {
        const u = c;
        if (!(await v.readdir(i).catch(() => [])).length)
          throw new Error((u.stderr || u.message || "Profiling run failed.").slice(-4e3));
      }
      const s = (await v.readdir(i)).filter((c) => c.endsWith(".cpuprofile"));
      if (!s.length) throw new Error("The run produced no .cpuprofile.");
      let o = y.join(i, s[0]), a = 0;
      for (const c of s) {
        const u = y.join(i, c), { size: f } = await v.stat(u);
        f > a && (a = f, o = u);
      }
      return Es(await v.readFile(o, "utf8"), o);
    }
  );
}
function Es(r, t) {
  var N;
  let e;
  try {
    e = JSON.parse(r);
  } catch {
    throw new Error("That file is not valid JSON, so it is not a .cpuprofile.");
  }
  if (!Array.isArray(e.nodes))
    throw new Error("That JSON has no `nodes` array, so it is not a V8 CPU profile.");
  const n = (e.endTime - e.startTime) / 1e3, i = e.nodes.reduce((j, P) => j + (P.hitCount ?? 0), 0), s = i > 0 && n > 0 ? n / i : 1, o = /* @__PURE__ */ new Map();
  for (const j of e.nodes) o.set(j.id, j);
  const a = /* @__PURE__ */ new Set();
  for (const j of e.nodes) for (const P of j.children ?? []) a.add(P);
  const c = e.nodes.find((j) => !a.has(j.id)) ?? e.nodes[0], u = /* @__PURE__ */ new Map(), f = [], d = [c.id], p = /* @__PURE__ */ new Set();
  for (; d.length; ) {
    const j = d.pop();
    if (p.has(j)) continue;
    p.add(j);
    const P = o.get(j);
    if (P) {
      u.set(j, {
        id: j,
        functionName: P.callFrame.functionName || "(anonymous)",
        url: P.callFrame.url ?? "",
        lineNumber: (P.callFrame.lineNumber ?? -1) + 1,
        selfTime: (P.hitCount ?? 0) * s,
        totalTime: 0,
        children: []
      }), f.push(j);
      for (const z of P.children ?? []) d.push(z);
    }
  }
  for (const j of f) {
    const P = o.get(j), z = u.get(j);
    if (!(!P || !z))
      for (const F of P.children ?? []) {
        const K = u.get(F);
        K && z.children.push(K);
      }
  }
  for (let j = f.length - 1; j >= 0; j--) {
    const P = u.get(f[j]);
    P && (P.totalTime = P.selfTime + P.children.reduce((z, F) => z + F.totalTime, 0));
  }
  const m = u.get(c.id), w = /* @__PURE__ */ new Map(), k = (j) => `${j.functionName}@${j.url}:${j.lineNumber}`, _ = [
    { frame: m, ancestors: /* @__PURE__ */ new Set() }
  ];
  for (; _.length; ) {
    const { frame: j, ancestors: P } = _.pop(), z = k(j), F = w.get(z) ?? {
      functionName: j.functionName,
      url: j.url,
      lineNumber: j.lineNumber,
      selfTime: 0,
      totalTime: 0,
      selfPercent: 0,
      totalPercent: 0
    };
    if (F.selfTime += j.selfTime, P.has(z) || (F.totalTime += j.totalTime), w.set(z, F), j.children.length) {
      const K = new Set(P);
      K.add(z);
      for (const Y of j.children) _.push({ frame: Y, ancestors: K });
    }
  }
  const x = m.totalTime || n || 1, A = Array.from(w.values()).map((j) => ({
    ...j,
    selfPercent: j.selfTime / x * 100,
    totalPercent: j.totalTime / x * 100
  })).filter((j) => j.selfTime > 0).sort((j, P) => P.selfTime - j.selfTime).slice(0, 500);
  return {
    source: t,
    durationMs: n,
    sampleCount: ((N = e.samples) == null ? void 0 : N.length) ?? i,
    root: m,
    hot: A
  };
}
const Yp = he(de), Gp = 3e4;
async function ve(r, t) {
  const e = await Re(r);
  if (!e) throw new Error(`\`${r}\` is not on PATH.`);
  const { stdout: n } = await Yp(e, t, {
    timeout: Gp,
    maxBuffer: 32 * 1024 * 1024,
    env: we()
  });
  return n;
}
function Vp() {
  g.handle("infra:available", async () => {
    const [r, t, e] = await Promise.all([Re("docker"), Re("kubectl"), Re("ssh")]);
    return { docker: !!r, kubectl: !!t, ssh: !!e };
  }), g.handle("docker:containers", async (r, t) => {
    const e = ["ps", "--format", "{{json .}}"];
    t && e.push("-a");
    const n = await ve("docker", e);
    return Cs(n).map((i) => ({
      id: String(i.ID ?? ""),
      name: String(i.Names ?? ""),
      image: String(i.Image ?? ""),
      status: String(i.Status ?? ""),
      state: String(i.State ?? ""),
      ports: String(i.Ports ?? "")
    }));
  }), g.handle("docker:images", async () => {
    const r = await ve("docker", ["images", "--format", "{{json .}}"]);
    return Cs(r).map((t) => ({
      id: String(t.ID ?? ""),
      repository: String(t.Repository ?? ""),
      tag: String(t.Tag ?? ""),
      size: String(t.Size ?? ""),
      created: String(t.CreatedSince ?? "")
    }));
  }), g.handle("docker:action", async (r, t, e) => {
    const i = {
      start: ["start", e],
      stop: ["stop", e],
      restart: ["restart", e],
      remove: ["rm", "-f", e],
      pause: ["pause", e],
      unpause: ["unpause", e]
    }[t];
    if (!i) throw new Error(`Unsupported docker action "${t}".`);
    return ve("docker", i);
  }), g.handle("docker:inspect", (r, t) => ve("docker", ["inspect", t])), g.handle(
    "docker:logs",
    (r, t, e = 500) => ve("docker", ["logs", "--tail", String(e), t])
  ), g.handle("kube:contexts", async () => {
    const t = (await ve("kubectl", [
      "config",
      "get-contexts",
      "-o",
      "name"
    ])).split(`
`).map((n) => n.trim()).filter(Boolean);
    let e = "";
    try {
      e = (await ve("kubectl", ["config", "current-context"])).trim();
    } catch {
    }
    return t.map((n) => ({ name: n, cluster: "", namespace: "", current: n === e }));
  }), g.handle(
    "kube:use",
    (r, t) => ve("kubectl", ["config", "use-context", t])
  ), g.handle("kube:namespaces", async () => (await ve("kubectl", [
    "get",
    "namespaces",
    "-o",
    'jsonpath={range .items[*]}{.metadata.name}{"\\n"}{end}'
  ])).split(`
`).map((t) => t.trim()).filter(Boolean)), g.handle(
    "kube:resources",
    async (r, t, e) => {
      if (!(/* @__PURE__ */ new Set(["pods", "deployments", "services", "nodes", "statefulsets", "jobs"])).has(t)) throw new Error(`Unsupported resource kind "${t}".`);
      const i = ["get", t, "--no-headers"];
      t === "nodes" ? i.push("-o", "wide") : e === "*" ? i.push("--all-namespaces") : e && i.push("-n", e);
      const s = await ve("kubectl", i), o = e === "*" && t !== "nodes";
      return s.split(`
`).map((a) => a.trim()).filter(Boolean).map((a) => {
        const c = a.split(/\s+/), u = o ? c.shift() : e === "*" ? "" : e, [f, d, p, m, w] = c;
        return {
          kind: t,
          name: f ?? "",
          namespace: u ?? "",
          ready: d ?? "",
          status: p ?? "",
          restarts: m ?? "",
          age: w ?? ""
        };
      });
    }
  ), g.handle(
    "kube:logs",
    (r, t, e, n = 500) => ve("kubectl", ["logs", t, ...e ? ["-n", e] : [], "--tail", String(n)])
  ), g.handle(
    "kube:describe",
    (r, t, e, n) => ve("kubectl", ["describe", t, e, ...n ? ["-n", n] : []])
  ), g.handle("ssh:hosts", async () => Xp());
}
function Cs(r) {
  const t = [];
  for (const e of r.split(`
`)) {
    const n = e.trim();
    if (n)
      try {
        t.push(JSON.parse(n));
      } catch {
      }
  }
  return t;
}
async function Xp() {
  const r = y.join(We.homedir(), ".ssh", "config");
  let t;
  try {
    t = await v.readFile(r, "utf8");
  } catch {
    return [];
  }
  const e = [];
  let n = null;
  for (const i of t.split(`
`)) {
    const s = i.trim();
    if (!s || s.startsWith("#")) continue;
    const o = /^(\w+)\s+(.*)$/.exec(s);
    if (!o) continue;
    const a = o[1].toLowerCase(), c = o[2].trim();
    if (a === "host") {
      n && e.push(n), n = c.includes("*") || c.includes("?") ? null : { name: c.split(/\s+/)[0], hostname: "", user: "", port: "22", fromConfig: !0 };
      continue;
    }
    n && (a === "hostname" ? n.hostname = c : a === "user" ? n.user = c : a === "port" && (n.port = c));
  }
  return n && e.push(n), e.map((i) => ({ ...i, hostname: i.hostname || i.name }));
}
const Qp = 50;
function Qo() {
  return y.join(ee.getPath("userData"), "chats");
}
function ea(r) {
  const t = ua("sha256").update(r).digest("hex").slice(0, 16);
  return y.join(Qo(), `${t}.json`);
}
async function yn(r) {
  try {
    const t = JSON.parse(await v.readFile(ea(r), "utf8"));
    return Array.isArray(t == null ? void 0 : t.chats) ? t.chats : [];
  } catch {
    return [];
  }
}
async function Ts(r, t) {
  await v.mkdir(Qo(), { recursive: !0 }), await v.writeFile(ea(r), JSON.stringify({ root: r, chats: t }, null, 2), "utf8");
}
function eh() {
  g.handle("chats:list", async (r, t) => (await yn(t)).map((n) => ({
    id: n.id,
    title: n.title,
    messageCount: n.messages.length,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt
  })).sort((n, i) => i.updatedAt - n.updatedAt)), g.handle("chats:get", async (r, t, e) => (await yn(t)).find((n) => n.id === e) ?? null), g.handle("chats:save", async (r, t, e) => {
    const n = await yn(t), i = n.findIndex((a) => a.id === e.id), s = { ...e, updatedAt: Date.now() };
    i === -1 ? n.push(s) : n[i] = s, n.sort((a, c) => c.updatedAt - a.updatedAt);
    const o = n.slice(0, Qp);
    return await Ts(t, o), o.map((a) => ({
      id: a.id,
      title: a.title,
      messageCount: a.messages.length,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt
    }));
  }), g.handle("chats:delete", async (r, t, e) => {
    const n = (await yn(t)).filter((i) => i.id !== e);
    return await Ts(t, n), n.map((i) => ({
      id: i.id,
      title: i.title,
      messageCount: i.messages.length,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt
    }));
  });
}
const ta = y.dirname(jr(import.meta.url));
ee.setName("Nova");
{
  const r = y.join(ee.getPath("appData"), "nova-ide");
  js(r) && ee.setPath("userData", r);
}
process.env.NOVA_DEBUG_PORT && ee.commandLine.appendSwitch("remote-debugging-port", process.env.NOVA_DEBUG_PORT);
process.env.APP_ROOT = y.join(ta, "..");
const $s = process.env.VITE_DEV_SERVER_URL, th = y.join(process.env.APP_ROOT, "dist"), na = y.join(process.env.APP_ROOT, "build", "icon.png");
let se = null;
function Os() {
  se = new _n({
    width: 1600,
    height: 1e3,
    minWidth: 900,
    minHeight: 600,
    show: !1,
    title: "Nova",
    icon: na,
    backgroundColor: "#111318",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: y.join(ta, "preload.cjs"),
      contextIsolation: !0,
      nodeIntegration: !1,
      sandbox: !1,
      // Powers the built-in Chromium browser pane and the live UI preview.
      webviewTag: !0,
      spellcheck: !1
    }
  }), se.once("ready-to-show", () => se == null ? void 0 : se.show()), se.webContents.setWindowOpenHandler(({ url: r }) => (/^https?:/.test(r) && kn.openExternal(r), { action: "deny" })), se.webContents.on("will-attach-webview", (r, t) => {
    delete t.preload, t.nodeIntegration = !1, t.contextIsolation = !0;
  }), se.webContents.on("did-attach-webview", (r, t) => {
    t.setWindowOpenHandler(({ url: e }) => (/^https?:/.test(e) && t.loadURL(e), { action: "deny" }));
  }), $s ? se.loadURL($s) : se.loadFile(y.join(th, "index.html")), se.on("closed", () => {
    se = null;
  });
}
function ye(r, t) {
  for (const e of _n.getAllWindows())
    e.isDestroyed() || e.webContents.send(r, t);
}
ee.whenReady().then(() => {
  var i;
  if (aa.themeSource = "dark", process.platform === "darwin" && !ee.isPackaged)
    try {
      (i = ee.dock) == null || i.setIcon(na);
    } catch {
    }
  const r = jc({ broadcast: ye }), t = Fc({ broadcast: ye }), e = dl({ broadcast: ye }), n = Tl({ broadcast: ye });
  ee.on("before-quit", () => {
    t.dispose(), e.dispose(), n.dispose();
  }), gc({ broadcast: ye, getWindow: () => se }), Ca({ broadcast: ye, onFileChanged: r.onFileChanged }), Ra(), sl({ broadcast: ye }), ol(), Ya({ broadcast: ye, mcpServers: n.mcpServers }), rc({ broadcast: ye }), Ad({ broadcast: ye }), Dd(), Sf({ broadcast: ye }), zf({ broadcast: ye }), dp({ broadcast: ye }), Tp(), Dp(), Hp(), Kp(), Vp(), eh(), n.start(), g.handle("window:action", (s, o) => {
    se && (o === "minimize" ? se.minimize() : o === "maximize" ? se.isMaximized() ? se.unmaximize() : se.maximize() : o === "close" ? se.close() : o === "devtools" && se.webContents.toggleDevTools());
  }), Os(), ee.on("activate", () => {
    _n.getAllWindows().length === 0 && Os();
  });
});
ee.on("window-all-closed", () => {
  process.platform !== "darwin" && ee.quit();
});
