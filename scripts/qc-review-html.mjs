/**
 * docs/103 首图质检 · 人工复核页生成器
 *
 *   node scripts/qc-review-html.mjs
 *   → data-cache/media-qc-review.html（单文件本地页，不进 git、不部署）
 *
 * 输入：data-cache/media-qc/multimodal.jsonl（断点真源）+ public/data/thumbs.json + species-index
 * 功能：分页 100/条页 · 图懒加载 + 首音试听 · 人工三态（合格/要换/待定，localStorage 持久）
 *       · 筛选（问题优先/reject/suspect/missing/wrong_species/我标过）· 进度 · 导出人工结果
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const QC = 'data-cache/media-qc/multimodal.jsonl'
if (!existsSync(QC)) {
  console.error('缺少', QC)
  process.exit(1)
}
const rows = [...new Map(readFileSync(QC, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.speciesId, r])).values()]

const thumbs = JSON.parse(readFileSync('public/data/thumbs.json', 'utf8'))
// audio: { speciesId: "audio-1.mp3" }（dict）；有键即有音频
const audioMap = thumbs.audio && typeof thumbs.audio === 'object' ? thumbs.audio : {}
const hasAudio = (id) => Boolean(audioMap[id])
const audioFile = (id) => (typeof audioMap[id] === 'string' ? audioMap[id] : 'audio-1.mp3')
const idx = JSON.parse(readFileSync('public/data/species-index.json', 'utf8')).species
const NAME = {}
for (const e of idx) NAME[e.nameSci.toLowerCase().replace(/\s+/g, '-')] = { zh: e.nameZh || '', sci: e.nameSci }

const data = rows.map((r) => ({
  id: r.speciesId,
  zh: NAME[r.speciesId]?.zh || '',
  sci: NAME[r.speciesId]?.sci || r.speciesId,
  verdict: r.verdict,
  reasons: r.reasons || [],
  note: r.note || '',
  model: r.model || '',
  img: r.thumbUrl || thumbs.base + r.speciesId + '/' + (thumbs.thumb[r.speciesId] || ''),
  audio: hasAudio(r.speciesId) ? `${thumbs.base}${r.speciesId}/${audioFile(r.speciesId)}` : null,
}))
// 默认排序：问题优先（reject → suspect → missing → pass），组内按 id
const RANK = { reject: 0, suspect: 1, missing: 2, pass: 3 }
data.sort((a, b) => RANK[a.verdict] - RANK[b.verdict] || (a.id < b.id ? -1 : 1))

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>首图质检 · 人工复核（${data.length} 种）</title>
<style>
  body { font-family: -apple-system, "PingFang SC", sans-serif; background: #f4fbf7; margin: 0; padding: 16px 20px 60px; }
  h1 { font-size: 1.05rem; color: #2d6a4f; margin: 0 0 8px; }
  .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: .8rem; color: #6b7c74; margin-bottom: 10px; position: sticky; top: 0; background: #f4fbf7; padding: 6px 0; z-index: 5; }
  .bar button { padding: 5px 12px; border: 1px solid #dde9e2; border-radius: 99px; background: #fff; cursor: pointer; font-size: .76rem; font-weight: 700; color: #6b7c74; }
  .bar button.on { background: #2d6a4f; color: #fff; border-color: #2d6a4f; }
  .bar .export { margin-left: auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(430px, 1fr)); gap: 10px; }
  .card { display: flex; gap: 10px; background: #fff; border: 2px solid #dde9e2; border-radius: 10px; padding: 10px; }
  .card img { width: 190px; height: 142px; object-fit: cover; border-radius: 6px; background: #eee; flex-shrink: 0; }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; font-size: .78rem; }
  .name { font-weight: 700; font-size: .86rem; }
  .sci { color: #6b7c74; font-style: italic; }
  .badge { display: inline-block; padding: 1px 9px; border-radius: 99px; font-size: .7rem; font-weight: 700; }
  .pass { background: #d8f3dc; color: #1b4332; }
  .suspect { background: #fff3bf; color: #7a5c00; }
  .reject { background: #fde0e2; color: #9b2226; }
  .missing { background: #e2e3e5; color: #41464b; }
  .ws { background: #ffe5d9; color: #9c3d10; }
  .reasons { color: #6b7c74; }
  .note { color: #9b2226; }
  audio { width: 100%; height: 28px; }
  .btns { display: flex; gap: 6px; margin-top: auto; }
  .btns button { flex: 1; padding: 5px 0; border: 1.5px solid #dde9e2; border-radius: 6px; background: #fff; cursor: pointer; font-size: .74rem; }
  .btns button.on-ok { background: #d8f3dc; border-color: #74c69d; font-weight: 700; }
  .btns button.on-swap { background: #fff3bf; border-color: #e9c46a; font-weight: 700; }
  .btns button.on-hold { background: #e2e3e5; border-color: #adb5bd; font-weight: 700; }
  .pager { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 1px solid #dde9e2; padding: 8px 20px; display: flex; gap: 10px; align-items: center; font-size: .8rem; z-index: 6; }
  .pager button { padding: 5px 14px; border: 1px solid #dde9e2; border-radius: 6px; background: #fff; cursor: pointer; }
  .pager button:disabled { opacity: .4; cursor: default; }
</style>
</head>
<body>
<h1>首图质检 · 人工复核</h1>
<div class="bar">
  <span id="prog"></span>
  <button data-f="problem" class="on">问题优先</button>
  <button data-f="reject">reject</button>
  <button data-f="suspect">suspect</button>
  <button data-f="missing">missing</button>
  <button data-f="wrong_species">种疑(wrong_species)</button>
  <button data-f="mine">我标过</button>
  <button data-f="pass">pass</button>
  <button data-f="all">全部</button>
  <button class="export" id="export">导出人工结果</button>
</div>
<div class="grid" id="grid"></div>
<div class="pager">
  <button id="prev">‹ 上一页</button>
  <span id="pageinfo"></span>
  <button id="next">下一页 ›</button>
</div>
<script>
const ROWS = ${JSON.stringify(data)};
const PAGE = 100;
const KEY = "qc-manual-v1";
const store = JSON.parse(localStorage.getItem(KEY) || "{}");
let filter = "problem";
let page = 0;

const rank = { reject: 0, suspect: 1, missing: 2, pass: 3 };
function visible() {
  let list;
  if (filter === "all") list = ROWS;
  else if (filter === "mine") list = ROWS.filter((r) => store[r.id]);
  else if (filter === "problem") list = ROWS.filter((r) => r.verdict !== "pass");
  else if (filter === "wrong_species") list = ROWS.filter((r) => r.reasons.includes("wrong_species"));
  else list = ROWS.filter((r) => r.verdict === filter);
  return list;
}
function card(r) {
  const m = (store[r.id] || {}).v || "";
  const ws = r.reasons.includes("wrong_species") ? ' <span class="badge ws">种疑</span>' : "";
  return \`<div class="card">
    <img src="\${r.img}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" />
    <div class="info">
      <span><span class="badge \${r.verdict}">\${r.verdict}</span>\${ws}</span>
      <span class="name">\${r.zh || r.id}</span>
      <span class="sci">\${r.sci}</span>
      <span class="reasons">\${(r.reasons || []).join(" · ") || "—"}</span>
      <span class="note">\${r.note || ""}</span>
      \${r.audio ? \`<audio controls preload="none" src="\${r.audio}"></audio>\` : "<span class='reasons'>（无音频）</span>"}
      <div class="btns">
        <button data-v="ok" class="\${m === "ok" ? "on-ok" : ""}">合格</button>
        <button data-v="swap" class="\${m === "swap" ? "on-swap" : ""}">要换</button>
        <button data-v="hold" class="\${m === "hold" ? "on-hold" : ""}">待定</button>
      </div>
    </div>
  </div>\`;
}
function render() {
  const list = visible();
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  if (page >= pages) page = pages - 1;
  const slice = list.slice(page * PAGE, page * PAGE + PAGE);
  document.getElementById("grid").innerHTML = slice.map(card).join("");
  document.getElementById("grid").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.closest(".card").querySelector(".sci").textContent;
      store[id] = { v: b.dataset.v, at: Date.now() };
      localStorage.setItem(KEY, JSON.stringify(store));
      render();
    }),
  );
  document.getElementById("pageinfo").textContent = \`第 \${page + 1} / \${pages} 页 · 本视图 \${list.length} 条 · 已标 \${Object.keys(store).length}/\${ROWS.length}\`;
  document.getElementById("prog").textContent = \`共 \${ROWS.length} 种（reject \${ROWS.filter((r) => r.verdict === "reject").length} · suspect \${ROWS.filter((r) => r.verdict === "suspect").length} · missing \${ROWS.filter((r) => r.verdict === "missing").length}）· 已标 \${Object.keys(store).length}\`;
  document.getElementById("prev").disabled = page === 0;
  document.getElementById("next").disabled = page >= pages - 1;
  window.scrollTo(0, 0);
}
document.querySelectorAll(".bar button[data-f]").forEach((b) =>
  b.addEventListener("click", () => {
    filter = b.dataset.f;
    page = 0;
    document.querySelectorAll(".bar button[data-f]").forEach((x) => x.classList.toggle("on", x === b));
    render();
  }),
);
document.getElementById("prev").addEventListener("click", () => { page--; render(); });
document.getElementById("next").addEventListener("click", () => { page++; render(); });
document.getElementById("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(store, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "media-qc-review-export.json";
  a.click();
});
render();
</script>
</body>
</html>
`
writeFileSync('data-cache/media-qc-review.html', html)
console.log(`已生成 data-cache/media-qc-review.html · ${data.length} 种 · 大小 ${(html.length / 1024 / 1024).toFixed(1)} MB`)
