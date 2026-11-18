const db = supabase.createClient(CFG.url, CFG.key);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => "\u20B9" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0 });
const toast = t => { const e = $("toast"); e.textContent = t; e.classList.add("show"); setTimeout(() => e.classList.remove("show"), 2500); };
let items = [];

db.auth.onAuthStateChange((_e, s) => {
  $("login").hidden = !!s; $("app").hidden = !s;
  if (s) { $("who").textContent = s.user.email; load(); startOrders(); }
});
$("lf").onsubmit = async e => {
  e.preventDefault(); $("msg").textContent = "";
  const { error } = await db.auth.signInWithPassword({ email: $("em").value.trim(), password: $("pw").value });
  if (error) $("msg").textContent = error.message;
};
$("out").onclick = () => db.auth.signOut();

async function load() {
  const { data, error } = await db.from("menu_items").select("*").order("category").order("name");
  if (error) return toast(error.message);
  items = data; dash(); table();
}

function dash() {
  const on = items.filter(i => i.available).length;
  const avg = items.length ? items.reduce((t, i) => t + Number(i.price), 0) / items.length : 0;
  const s = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  $("stats").innerHTML = s(items.length, "Total items") + s(on, "Available") + s(items.length - on, "Sold out") + s(money(Math.round(avg * 100) / 100), "Average price");
  const by = {}; items.forEach(i => by[i.category] = (by[i.category] || 0) + 1);
  const max = Math.max(1, ...Object.values(by));
  $("bars").innerHTML = Object.entries(by).map(([c, n]) => `<div><span>${esc(c)}</span><i style="width:${(n / max) * 100}%"></i><b>${n}</b></div>`).join("") || '<p class="empty">No items yet.</p>';
  const cats = [...new Set(items.map(i => i.category))];
  $("cats").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
  const cur = $("fc").value;
  $("fc").innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option>${esc(c)}</option>`).join("");
  $("fc").value = cats.includes(cur) ? cur : "";
}

function table() {
  const q = $("s").value.toLowerCase(), c = $("fc").value;
  const list = items.filter(i => (!c || i.category === c) && i.name.toLowerCase().includes(q));
  $("rows").innerHTML = list.map(i => `<tr data-id="${i.id}"><td><b>${esc(i.name)}</b><br><small>${esc(i.description || "")}</small></td><td>${esc(i.category)}</td><td>${money(i.price)}</td>
    <td><label class="sw"><input type="checkbox" data-act="tog" aria-label="Available: ${esc(i.name)}" ${i.available ? "checked" : ""}><span></span></label></td>
    <td class="r"><button data-act="edit">Edit</button> <button class="del" data-act="del">Delete</button></td></tr>`).join("") ||
    '<tr><td colspan="5" class="empty">No items match.</td></tr>';
}
$("s").oninput = table; $("fc").onchange = table;

$("rows").onclick = async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const id = b.closest("tr").dataset.id, it = items.find(x => String(x.id) === id);
  if (b.dataset.act === "edit") {
    $("id").value = id; $("n").value = it.name; $("c").value = it.category; $("p").value = it.price;
    $("d").value = it.description || ""; $("a").checked = it.available;
    $("ft").textContent = "Edit item"; $("cancel").hidden = false; $("f").scrollIntoView({ behavior: "smooth" });
  } else if (b.dataset.act === "del") {
    if (!confirm(`Delete "${it.name}"?`)) return;
    const { error } = await db.from("menu_items").delete().eq("id", id);
    error ? toast(error.message) : (toast("Item deleted"), load());
  }
};
$("rows").onchange = async e => {
  if (e.target.dataset.act !== "tog") return;
  const id = e.target.closest("tr").dataset.id;
  const { error } = await db.from("menu_items").update({ available: e.target.checked }).eq("id", id);
  error ? toast(error.message) : (toast(e.target.checked ? "Marked available" : "Marked sold out"), load());
};

function reset() { $("f").reset(); $("id").value = ""; $("a").checked = true; $("ft").textContent = "Add a menu item"; $("cancel").hidden = true; }
$("cancel").onclick = reset;
$("f").onsubmit = async e => {
  e.preventDefault();
  const row = { name: $("n").value.trim(), category: $("c").value.trim() || "Other", price: parseFloat($("p").value), description: $("d").value.trim() || null, available: $("a").checked };
  const id = $("id").value;
  const { error } = id ? await db.from("menu_items").update(row).eq("id", id) : await db.from("menu_items").insert(row);
  if (error) return toast(error.message);
  toast(id ? "Item updated" : "Item added"); reset(); load();
};

$("csv").onclick = () => {
  const q = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const csv = ["Name,Category,Price,Available,Description", ...items.map(i => [q(i.name), q(i.category), i.price, i.available ? "Yes" : "No", q(i.description)].join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "menu-report.csv"; a.click();
};

/* ---------- Live orders ---------- */
let known = null, started = false;
const NEXT = { new: ["preparing", "Start preparing"], preparing: ["ready", "Mark ready"], ready: ["served", "Mark served"] };
function beep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start();
    setTimeout(() => { o.stop(); a.close(); }, 250);
  } catch {}
}
const orderCard = o => `<article class="oc ${o.status}"><div class="oh"><b>Table ${esc(o.table_no)}</b><span class="st">${o.status}</span></div>
  <small>${new Date(o.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}${o.customer_name ? " &middot; " + esc(o.customer_name) : ""}</small>
  <ul>${o.items.map(i => `<li><span>${i.qty} &times; ${esc(i.name)}</span><span>${money(i.price * i.qty)}</span></li>`).join("")}</ul>
  ${o.note ? `<p class="note">Note: ${esc(o.note)}</p>` : ""}
  <div class="ot"><b>${money(o.total)}</b><div class="acts">${NEXT[o.status] ? `<button class="btn" data-o="${o.id}" data-s="${NEXT[o.status][0]}">${NEXT[o.status][1]}</button>` : ""}${o.status !== "ready" ? `<button class="del" data-o="${o.id}" data-s="cancelled">Cancel</button>` : ""}</div></div></article>`;

async function loadOrders() {
  const { data, error } = await db.from("orders").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) return;
  if (known && $("snd").checked && data.some(o => o.status === "new" && !known.has(o.id))) beep();
  known = new Set(data.map(o => o.id));
  const active = data.filter(o => ["new", "preparing", "ready"].includes(o.status)).reverse();
  const day = new Date().toDateString();
  const today = data.filter(o => new Date(o.created_at).toDateString() === day && o.status !== "cancelled");
  const s = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  $("ostats").innerHTML = s(today.length, "Orders today") + s(money(today.reduce((t, o) => t + Number(o.total), 0)), "Revenue today") + s(active.length, "Active now");
  $("ocnt").textContent = active.length;
  $("orders").innerHTML = active.map(orderCard).join("") || '<p class="empty">No active orders. New orders appear here by themselves.</p>';
}
function startOrders() {
  if (started) return; started = true;
  loadOrders();
  db.channel("orders-live").on("postgres_changes", { event: "*", schema: "public", table: "orders" }, loadOrders).subscribe();
  setInterval(loadOrders, 10000);
}
$("orders").onclick = async e => {
  const b = e.target.closest("[data-s]"); if (!b) return;
  const { error } = await db.from("orders").update({ status: b.dataset.s }).eq("id", b.dataset.o);
  error ? toast(error.message) : loadOrders();
};

/* ---------- Table QR codes ---------- */
$("qurl").value = new URL("index.html", location.href).href;
$("qgo").onclick = () => {
  const base = $("qurl").value.trim();
  if (!base) return toast("Enter your menu page address first.");
  const n = Math.min(60, Math.max(1, parseInt($("qn").value) || 1));
  $("qr").innerHTML = "";
  for (let t = 1; t <= n; t++) {
    const w = document.createElement("div"), box = document.createElement("div");
    w.className = "qrc"; w.appendChild(box); w.append("Table " + t); $("qr").appendChild(w);
    new QRCode(box, { text: base + (base.includes("?") ? "&" : "?") + "table=" + t, width: 140, height: 140 });
  }
  if (/127\.0\.0\.1|localhost/.test(base)) toast("Phones cannot open a local address. Publish the site first.");
};
$("qprint").onclick = () => window.print();

/* ---------- Excel export (all data) ---------- */
async function fetchAllOrders() {
  let all = [], from = 0;
  for (;;) {
    const { data, error } = await db.from("orders").select("*").order("created_at", { ascending: false }).range(from, from + 999);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < 1000) return all;
    from += 1000;
  }
}
$("xls").onclick = async () => {
  if (typeof XLSX === "undefined") return toast("Excel library did not load. Check your internet and refresh.");
  try {
    toast("Preparing Excel file...");
    const orders = await fetchAllOrders();
    const day = d => new Date(d).toLocaleDateString("en-IN");
    const time = d => new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const sid = o => o.id.slice(0, 8).toUpperCase();
    const menu = items.map(i => ({ Name: i.name, Category: i.category, "Price (INR)": Number(i.price), Available: i.available ? "Yes" : "No", Description: i.description || "" }));
    const ord = orders.map(o => ({ "Order ID": sid(o), Date: day(o.created_at), Time: time(o.created_at), Table: o.table_no, Customer: o.customer_name || "", Status: o.status,
      Items: o.items.map(i => `${i.qty} x ${i.name}`).join("; "), Note: o.note || "", "Total (INR)": Number(o.total) }));
    const lines = [], sold = {};
    orders.forEach(o => o.items.forEach(i => {
      lines.push({ "Order ID": sid(o), Date: day(o.created_at), Table: o.table_no, Status: o.status, Item: i.name, Qty: i.qty, "Price (INR)": Number(i.price), "Line total (INR)": Number(i.price) * i.qty });
      if (o.status !== "cancelled") { const s = sold[i.name] || (sold[i.name] = { q: 0, r: 0 }); s.q += i.qty; s.r += Number(i.price) * i.qty; }
    }));
    const top = Object.entries(sold).sort((a, b) => b[1].q - a[1].q).map(([n, s]) => ({ Item: n, "Qty sold": s.q, "Revenue (INR)": s.r }));
    const wb = XLSX.utils.book_new();
    const add = (name, rows, head) => {
      const ws = XLSX.utils.json_to_sheet(rows, { header: head });
      ws["!cols"] = head.map(h => ({ wch: Math.min(50, Math.max(h.length, ...rows.map(r => String(r[h] ?? "").length)) + 2) }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    add("Orders", ord, ["Order ID", "Date", "Time", "Table", "Customer", "Status", "Items", "Note", "Total (INR)"]);
    add("Order items", lines, ["Order ID", "Date", "Table", "Status", "Item", "Qty", "Price (INR)", "Line total (INR)"]);
    add("Menu", menu, ["Name", "Category", "Price (INR)", "Available", "Description"]);
    add("Top sellers", top, ["Item", "Qty sold", "Revenue (INR)"]);
    XLSX.writeFile(wb, `menu-manager-data-${new Date().toLocaleDateString("en-CA")}.xlsx`);
    toast("Excel file downloaded");
  } catch (e) { toast("Could not export: " + (e.message || e)); }
};
