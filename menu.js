const db = supabase.createClient(CFG.url, CFG.key);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => "\u20B9" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0 });
const ICONS = { coffee: "\u2615", tea: "\uD83C\uDF75", bakery: "\uD83E\uDD50", dessert: "\uD83C\uDF70", cold: "\uD83E\uDDCA", juice: "\uD83E\uDD64", snack: "\uD83E\uDD6A", breakfast: "\uD83C\uDF73" };
const icon = c => { const k = Object.keys(ICONS).find(k => String(c).toLowerCase().includes(k)); return k ? ICONS[k] : "\uD83C\uDF7D\uFE0F"; };
const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { return null; } };

let items = [], cat = "All", cart = {}, form = { name: "", note: "" }, view = "cart", timer = null;
let table = (new URLSearchParams(location.search).get("table") || "").trim().slice(0, 10);
if (table) { $("tbl").textContent = "TABLE " + table; $("tbl").hidden = false; }

async function load() {
  const { data, error } = await db.from("menu_items").select("*").order("category").order("name");
  if (error) { $("grid").innerHTML = `<p class="empty">Could not load the menu: ${esc(error.message)}</p>`; $("lt").textContent = "OFFLINE"; return; }
  items = data;
  $("lt").textContent = "LIVE " + new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  kpis(); chips(); render(); bar();
}
function kpis() {
  const k = (v, l) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  $("kpis").innerHTML = k(items.length, "items on the menu") + k(items.filter(i => i.available).length, "available now") + k(new Set(items.map(i => i.category)).size, "categories");
}
function chips() {
  const count = c => items.filter(i => c === "All" || i.category === c).length;
  $("chips").innerHTML = ["All", ...new Set(items.map(i => i.category))].map(c => `<button class="chip${c === cat ? " on" : ""}" data-c="${esc(c)}">${esc(c)}<small>${count(c)}</small></button>`).join("");
}
$("chips").onclick = e => { const b = e.target.closest("button"); if (!b) return; cat = b.dataset.c; chips(); render(); };
$("q").oninput = render; $("hide").onchange = render; $("sort").onchange = render;
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeDrawer();
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $("q").focus(); }
});

/* ---------- menu grid ---------- */
const qty = id => cart[id] || 0;
const act = i => !i.available ? '<span class="cl">Unavailable</span>'
  : qty(i.id) ? `<div class="step"><button data-a="dec" data-id="${i.id}" aria-label="Remove one ${esc(i.name)}">&minus;</button><b>${qty(i.id)}</b><button data-a="inc" data-id="${i.id}" aria-label="Add one ${esc(i.name)}">+</button></div>`
  : `<button class="add" data-a="inc" data-id="${i.id}">Add</button>`;
const card = i => `<article class="card${i.available ? "" : " out"}">
  <div class="ctop"><div class="tile" aria-hidden="true">${icon(i.category)}</div><span class="led"><i></i>${i.available ? "AVAILABLE" : "SOLD OUT"}</span></div>
  <div><h3>${esc(i.name)}</h3><span class="cl">${esc(i.category)}</span></div><p>${esc(i.description || "")}</p>
  <div class="cbot"><span class="price">${money(i.price)}</span>${act(i)}</div></article>`;

function render() {
  const q = $("q").value.toLowerCase(), hide = $("hide").checked, s = $("sort").value;
  const list = items.filter(i => (cat === "All" || i.category === cat) && (!hide || i.available) &&
    (i.name + " " + (i.description || "") + " " + i.category).toLowerCase().includes(q));
  list.sort((a, b) => s === "lo" ? a.price - b.price : s === "hi" ? b.price - a.price : s === "az" ? a.name.localeCompare(b.name) : 0);
  $("grid").innerHTML = list.length ? list.map(card).join("") : '<p class="empty">No items match your search.</p>';
}
$("grid").onclick = e => { const b = e.target.closest("[data-a]"); if (b) bump(b.dataset.id, b.dataset.a === "inc" ? 1 : -1); };

/* ---------- cart ---------- */
const lines = () => Object.entries(cart).map(([id, q]) => ({ item: items.find(i => String(i.id) === id), q })).filter(l => l.item && l.item.available);
const total = () => lines().reduce((t, l) => t + l.item.price * l.q, 0);
function saveForm() {
  if ($("tn")) table = $("tn").value.trim().slice(0, 10);
  if ($("cn")) form.name = $("cn").value;
  if ($("cnote")) form.note = $("cnote").value;
}
function bump(id, d) {
  const n = Math.max(0, Math.min(20, qty(id) + d));
  n ? (cart[id] = n) : delete cart[id];
  saveForm(); render(); bar();
  if (view === "cart" && !$("drawer").hidden) cartView();
}
function bar() {
  const n = lines().reduce((t, l) => t + l.q, 0);
  $("cartbar").hidden = !n;
  $("cc").textContent = n + (n === 1 ? " item" : " items");
  $("ct").textContent = money(total());
}
const openDrawer = () => { $("drawer").hidden = false; $("scrim").hidden = false; };
function closeDrawer() { $("drawer").hidden = true; $("scrim").hidden = true; }
$("openCart").onclick = () => { view = "cart"; cartView(); openDrawer(); };
$("closeCart").onclick = closeDrawer; $("scrim").onclick = closeDrawer;
$("trackBtn").onclick = () => { const id = store("mm_order"); if (id) track(id, true); };

function cartView() {
  const L = lines();
  if (!L.length) { $("dbody").innerHTML = '<p class="empty">Your order is empty. Add something from the menu.</p>'; return; }
  $("dbody").innerHTML = `<ul class="ol">${L.map(l => `<li><div><b>${esc(l.item.name)}</b><small>${money(l.item.price)} each</small></div>
    <div class="step"><button data-a="dec" data-id="${l.item.id}" aria-label="Remove one">&minus;</button><b>${l.q}</b><button data-a="inc" data-id="${l.item.id}" aria-label="Add one">+</button></div></li>`).join("")}</ul>
    <label>Table number<input id="tn" value="${esc(table)}" maxlength="10" placeholder="e.g. 5"></label>
    <label>Your name (optional)<input id="cn" value="${esc(form.name)}" maxlength="40"></label>
    <label>Note for the kitchen (optional)<input id="cnote" value="${esc(form.note)}" maxlength="200" placeholder="Less sugar, no onion..."></label>
    <div class="tot"><span>Total</span><b>${money(total())}</b></div>
    <button class="btn wide" id="place">Place order</button><p id="perr" class="err" role="alert"></p>`;
}

$("dbody").onclick = async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.a) return bump(b.dataset.id, b.dataset.a === "inc" ? 1 : -1);
  if (b.id === "again") { store("mm_order", null); $("trackBtn").hidden = true; clearInterval(timer); view = "cart"; closeDrawer(); return; }
  if (b.id !== "place") return;
  saveForm();
  if (!table) return ($("perr").textContent = "Please enter your table number.");
  b.disabled = true; b.textContent = "Sending...";
  const { data, error } = await db.rpc("place_order", { p_table: table, p_name: form.name, p_note: form.note, p_items: lines().map(l => ({ id: l.item.id, qty: l.q })) });
  if (error) {
    b.disabled = false; b.textContent = "Place order";
    $("perr").textContent = /not available/i.test(error.message) ? "One item just sold out. Please check your order." : "Could not send the order: " + error.message;
    load(); return;
  }
  cart = {}; form.note = ""; store("mm_order", data); render(); bar(); track(data, true);
};

/* ---------- order tracking ---------- */
const STEPS = ["new", "preparing", "ready", "served"];
const LAB = { new: "Order received", preparing: "Being prepared", ready: "Ready, coming to your table", served: "Served. Enjoy!" };
function trackView(s, id) {
  const at = STEPS.indexOf(s);
  const body = s === "cancelled" ? '<p class="err">This order was cancelled. Please ask the staff.</p>'
    : `<ol class="trk">${STEPS.map((k, i) => `<li class="${i < at ? "done" : i === at ? "now" : ""}"><i></i>${LAB[k]}</li>`).join("")}</ol>`;
  $("dbody").innerHTML = `<p class="cl">ORDER #${id.slice(0, 4).toUpperCase()}${table ? " &middot; TABLE " + esc(table) : ""}</p>${body}<button class="btn wide" id="again">Order more</button>`;
}
function track(id, open) {
  clearInterval(timer); view = "track";
  const poll = async () => {
    const { data } = await db.rpc("order_status", { p_id: id });
    const done = !data || data === "served" || data === "cancelled";
    if (done && !open && view === "track" && $("drawer").hidden) { store("mm_order", null); $("trackBtn").hidden = true; clearInterval(timer); view = "cart"; return; }
    if (!data) { store("mm_order", null); $("trackBtn").hidden = true; clearInterval(timer); view = "cart"; cartView(); return; }
    trackView(data, id); $("trackBtn").hidden = false;
    if (done) clearInterval(timer);
  };
  poll(); timer = setInterval(poll, 5000);
  if (open) openDrawer();
}

load();
{ const sid = store("mm_order"); if (sid) track(sid, false); }
db.channel("menu-live").on("postgres_changes", { event: "*", schema: "public", table: "menu_items" }, load).subscribe();
setInterval(load, 30000);
