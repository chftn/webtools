/* store.js — shared local-first storage + CSV import/export for the webtools portfolio.
   No dependencies. Attaches `Store` to window. */
(function (global) {
  "use strict";

  /* ---------- localStorage wrapper (namespaced) ---------- */
  const PREFIX = "webtools:";
  function nsKey(name) { return PREFIX + name; }

  const Store = {
    version: "1.0.0",

    /* get/set arbitrary JSON values under a namespace */
    get(name, fallback) {
      try {
        const raw = localStorage.getItem(nsKey(name));
        if (raw == null) return fallback;
        return JSON.parse(raw);
      } catch (e) { console.warn("Store.get", e); return fallback; }
    },
    set(name, value) {
      try { localStorage.setItem(nsKey(name), JSON.stringify(value)); return true; }
      catch (e) { console.warn("Store.set", e); return false; }
    },
    remove(name) { localStorage.removeItem(nsKey(name)); },

    /* list every webtools key (for backup-all) */
    keys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) out.push(k.slice(PREFIX.length));
      }
      return out.sort();
    },

    /* ---------- formatting helpers ---------- */
    money(n, cur) {
      const c = cur || "A$";
      if (n == null || isNaN(n)) return c + "0";
      const sign = n < 0 ? "-" : "";
      return sign + c + Math.abs(Number(n)).toLocaleString(undefined,
        { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    num(n, dp) {
      if (n == null || isNaN(n)) return "0";
      return Number(n).toLocaleString(undefined,
        { minimumFractionDigits: dp || 0, maximumFractionDigits: dp == null ? 2 : dp });
    },
    /* Format a Date as a LOCAL "YYYY-MM-DD".
       NOT toISOString(): that slices the UTC day, so in any timezone with a non-zero
       offset the returned day is shifted by one. Local calendar arithmetic (e.g.
       addDays/streak walks) then round-trips a "next day" back onto the same string,
       which makes `while (x <= today) x = addDays(x, 1)` loop forever. Format locally. */
    date(d) {
      if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      const x = (d instanceof Date) ? d : new Date(d);
      if (isNaN(x)) return "";
      const p = (n) => String(n).padStart(2, "0");
      return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
    },
    today() { return Store.date(new Date()); },
    uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
    esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    },

    /* ---------- CSV (RFC 4180) ---------- */
    toCSV(rows, columns) {
      // rows: array of objects OR array of arrays; columns: optional array of keys
      if (!rows || !rows.length) {
        return columns ? columns.join(",") + "\n" : "";
      }
      const cols = columns || (Array.isArray(rows[0]) ? rows[0].map((_, i) => i)
        : Object.keys(rows[0]));
      const cell = (v) => {
        if (v == null) v = "";
        v = String(v);
        return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      };
      const head = cols.map(cell).join(",");
      const body = rows.map(r => cols.map(c => cell(Array.isArray(r) ? r[c] : r[c])).join(",")).join("\n");
      return head + "\n" + body + "\n";
    },

    parseCSV(text) {
      // returns array of arrays; handles quotes, embedded commas/newlines
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
      const rows = []; let row = []; let field = ""; let inQ = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
          if (c === '"') {
            if (text[i + 1] === '"') { field += '"'; i++; }
            else inQ = false;
          } else field += c;
        } else {
          if (c === '"') inQ = true;
          else if (c === ",") { row.push(field); field = ""; }
          else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
          else if (c === "\r") { /* skip */ }
          else field += c;
        }
      }
      if (field.length || row.length) { row.push(field); rows.push(row); }
      return rows.filter(r => !(r.length === 1 && r[0] === ""));
    },

    csvToObjects(text) {
      const rows = Store.parseCSV(text);
      if (!rows.length) return [];
      const head = rows[0].map(h => h.trim());
      return rows.slice(1).map(r => {
        const o = {};
        head.forEach((h, i) => { o[h] = r[i] == null ? "" : r[i]; });
        return o;
      });
    },

    /* ---------- file download / upload ---------- */
    download(filename, content, mime) {
      const blob = new Blob([content], { type: mime || "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    exportCSV(filename, rows, columns) {
      const stamp = Store.today();
      const fn = filename.replace(/\.csv$/, "") + "-" + stamp + ".csv";
      Store.download(fn, Store.toCSV(rows, columns));
      Store.toast("Exported " + fn);
    },

    exportJSON(filename, obj) {
      const stamp = Store.today();
      const fn = filename.replace(/\.json$/, "") + "-" + stamp + ".json";
      Store.download(fn, JSON.stringify(obj, null, 2), "application/json");
      Store.toast("Exported " + fn);
    },

    /* pick a file; cb(text, file). Accepts CSV or JSON by extension. */
    pickFile(cb, accept) {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = accept || ".csv,.json,text/csv,text/plain";
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => cb(String(r.result), f);
        r.readAsText(f);
      };
      inp.click();
    },

    importCSV(cb) {
      Store.pickFile((text, file) => {
        try {
          const objs = Store.csvToObjects(text);
          cb(objs, file);
          Store.toast("Imported " + objs.length + " row(s)");
        } catch (e) { Store.toast("Import failed: " + e.message); }
      });
    },

    importJSON(cb) {
      Store.pickFile((text, file) => {
        try { cb(JSON.parse(text), file); Store.toast("Imported " + file.name); }
        catch (e) { Store.toast("Import failed: " + e.message); }
      }, ".json,application/json");
    },

    /* ---------- tiny UI ---------- */
    toast(msg) {
      let el = document.querySelector(".toast");
      if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
      el.textContent = msg; el.classList.add("show");
      clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2200);
    }
  };

  global.Store = Store;
})(window);
