const fs = require("fs"), path = require("path");
const SRC = process.argv[2], OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const outName = (f) => f === "Main.dc.html" ? "index.html" : f.replace(".dc.html", ".html");
function parse(file) {
  const t = fs.readFileSync(path.join(SRC, file), "utf8").replace(/\r\n/g, "\n");
  const title = (t.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "HISADA";
  const xdc = t.match(/<x-dc>([\s\S]*?)<\/x-dc>/)[1];
  const helmet = (xdc.match(/<helmet>([\s\S]*?)<\/helmet>/) || [])[1] || "";
  let tpl = xdc.replace(/<helmet>[\s\S]*?<\/helmet>/, "").trim();
  const code = t.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  const imports = [...tpl.matchAll(/<dc-import name="(\w+)"/g)].map((m) => m[1]);
  tpl = tpl
    .replace(/<sc-for list="\{\{\s*([^}]+?)\s*\}\}" as="(\w+)"[^>]*>/g, '<template v-for="($2, $$index) in $1">')
    .replace(/<\/sc-for>/g, "</template>")
    .replace(/<sc-if value="\{\{\s*([^}]+?)\s*\}\}"[^>]*>/g, '<template v-if="$1">')
    .replace(/<\/sc-if>/g, "</template>")
    .replace(/<dc-import name="(\w+)"([^>]*)><\/dc-import>/g, (m, n, rest) => "<" + n.toLowerCase() + "-c" + rest.replace(/\shint-[\w-]+="[^"]*"/g, "") + "></" + n.toLowerCase() + "-c>")
    .replace(/\s([a-zA-Z][\w-]*)="([^"]*\{\{[^"]*)"/g, (m, name, val) => {
      const whole = val.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
      const ev = { onClick: "@click", onChange: "@change", onSubmit: "@submit", onInput: "@input" }[name];
      const expr = whole ? whole[1] : "`" + val.replace(/\{\{\s*([^}]+?)\s*\}\}/g, "${$1}") + "`";
      return " " + (ev || ":" + name) + '="' + expr + '"';
    });
  const props = [...t.matchAll(/data-props='([^']*)'/g)].map((m) => Object.keys(JSON.parse(m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'"))).filter((k) => k[0] !== "$"))[0] || [];
  return { title, helmet: helmet.trim(), tpl, code, imports, props };
}
const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".dc.html"));
const all = {};
for (const f of files) all[f.replace(".dc.html", "")] = parse(f);
const fix = (s) => s.replace(/Main\.dc\.html/g, "index.html").replace(/\.dc\.html/g, ".html");
const defJs = (name) => {
  const d = all[name];
  return "DEFS[" + JSON.stringify(name) + "] = { props: " + JSON.stringify(d.props) + ", template: " + JSON.stringify(fix(d.tpl)) +
    ", Cls: (function(){ class DCLogic { constructor(props){ this.props = props || {}; this.state = {}; } setState(){} forceUpdate(){} }\n" + fix(d.code) + "\nreturn Component; })() };\n";
};
const defsFor = (name) => { const seen = new Set(); const walk = (n) => { if (seen.has(n)) return; seen.add(n); all[n].imports.forEach(walk); }; walk(name); return [...seen]; };
// (defs-all.js hanya untuk pengujian, tidak ditulis)
for (const f of files) {
  const name = f.replace(".dc.html", "");
  if (name === "Sidebar") continue;
  const d = all[name];
  const html = '<!doctype html>\n<html lang="id">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + d.title + "</title>\n" + d.helmet + "\n</head>\n<body>\n<div id=\"app\"></div>\n<script src=\"vue.global.prod.js\"></script>\n<script src=\"dc-shim.js\"></script>\n<script>\nvar DEFS = {};\n" + defsFor(name).map(defJs).join("") + "DCMount(" + JSON.stringify(name) + ", DEFS);\n</script>\n</body>\n</html>\n";
  fs.writeFileSync(path.join(OUT, outName(f)), html);
}
console.log("built", files.length - 1, "pages");
