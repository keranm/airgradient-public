/**
 * AirGradient Map Card
 *
 * A Lovelace card that shows a public AirGradient location the way the
 * AirGradient map does: an animated scene with a mascot whose mood follows
 * the US EPA PM2.5 category, and a tap-to-expand detail view with a 24 h
 * chart, 12/24 h averages, WHO guideline comparison, cigarette equivalent
 * and a 10-day-by-hour heatmap built from Home Assistant's own recorder
 * statistics.
 *
 * Data: AirGradient (CC BY-SA 4.0). Artwork here is original.
 */

const CATEGORIES = [
  { max: 9.0, key: "good", label: "Good", color: "#43a047", sky: ["#dcf3dd", "#f2faf0"], ground: "#66bb6a", mood: "happy" },
  { max: 35.4, key: "moderate", label: "Moderate", color: "#fbc02d", sky: ["#fdf3d5", "#fbfaf2"], ground: "#c9b458", mood: "ok" },
  { max: 55.4, key: "usg", label: "Unhealthy for Sensitive Groups", color: "#ef6c00", sky: ["#fde5cc", "#fdf6ef"], ground: "#e09a52", mood: "meh" },
  { max: 125.4, key: "unhealthy", label: "Unhealthy", color: "#e53935", sky: ["#fbdad8", "#fdf1f0"], ground: "#d96a63", mood: "sad" },
  { max: 225.4, key: "very_unhealthy", label: "Very Unhealthy", color: "#8e24aa", sky: ["#ecd9f2", "#f8f1fa"], ground: "#a35cb5", mood: "sad" },
  { max: Infinity, key: "hazardous", label: "Hazardous", color: "#7f0f3e", sky: ["#f0d3de", "#faf0f4"], ground: "#9c4a6b", mood: "sad" },
];

const WHO_ANNUAL_PM25 = 5.0; // µg/m³, WHO 2021 annual guideline
const UG_PER_CIGARETTE_DAY = 22; // Berkeley Earth: 22 µg/m³ over 24 h ≈ 1 cigarette

const categoryFor = (pm25) =>
  CATEGORIES.find((c) => pm25 <= c.max) ?? CATEGORIES[CATEGORIES.length - 1];

const fmt = (v, digits = 1) =>
  v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(digits).replace(/\.0$/, "");

class AirGradientMapCard extends HTMLElement {
  static getStubConfig(hass) {
    const entity = Object.keys(hass?.states ?? {}).find(
      (id) => hass.states[id]?.attributes?.device_class === "pm25"
    );
    // Generic name so the picker preview doesn't display whichever real
    // sensor the stub happened to grab. Cleared or replaced in the editor.
    return { entity: entity ?? "sensor.pm2_5", name: "Air Quality" };
  }

  static async getConfigElement() {
    return document.createElement("airgradient-map-card-editor");
  }

  setConfig(config) {
    if (!config?.entity) {
      throw new Error("airgradient-map-card: 'entity' (a PM2.5 sensor) is required");
    }
    this._config = config;
    this._statsCacheAt = 0;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    const state = hass.states[this._config.entity];
    const fingerprint = state
      ? `${state.state}|${state.last_updated}|${this._relatedIds(state).join()}`
      : "missing";
    if (!this._built) this._build();
    if (fingerprint !== this._fingerprint) {
      this._fingerprint = fingerprint;
      this._update();
    }
  }

  getCardSize() {
    return 4;
  }

  /* ------------------------------------------------------------------ */
  /* Entity discovery: find sibling sensors on the same device           */
  /* ------------------------------------------------------------------ */

  _relatedIds(state) {
    if (this._related && this._relatedFor === this._config.entity) {
      return Object.values(this._related).filter(Boolean);
    }
    const hass = this._hass;
    const related = { pm25: this._config.entity };
    const reg = hass.entities?.[this._config.entity];
    if (reg?.device_id && hass.entities) {
      const siblings = Object.values(hass.entities).filter(
        (e) => e.device_id === reg.device_id
      );
      for (const sib of siblings) {
        const st = hass.states[sib.entity_id];
        const dc = st?.attributes?.device_class;
        if (dc === "temperature") related.temperature ??= sib.entity_id;
        else if (dc === "humidity") related.humidity ??= sib.entity_id;
        else if (dc === "carbon_dioxide") related.co2 ??= sib.entity_id;
      }
    }
    for (const k of ["temperature", "humidity", "co2"]) {
      if (this._config[k]) related[k] = this._config[k];
    }
    this._related = related;
    this._relatedFor = this._config.entity;
    return Object.values(related).filter(Boolean);
  }

  /* ------------------------------------------------------------------ */
  /* DOM                                                                  */
  /* ------------------------------------------------------------------ */

  _build() {
    this._built = true;
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${AirGradientMapCard.styles}</style>
      <ha-card>
        <div class="scene" role="button" tabindex="0" aria-label="Show air quality details">
          <div class="sky"></div>
          <div class="clouds">
            <div class="cloud c1"></div><div class="cloud c2"></div><div class="cloud c3"></div>
          </div>
          <svg class="hills" viewBox="0 0 400 90" preserveAspectRatio="none" aria-hidden="true">
            <path class="hill hill-back" d="M0,58 C60,30 130,44 200,50 C280,56 330,34 400,48 L400,90 L0,90 Z"></path>
            <path class="hill hill-front" d="M0,74 C80,56 150,70 230,66 C310,62 350,72 400,64 L400,90 L0,90 Z"></path>
            <g class="trees"></g>
          </svg>
          <div class="head">
            <div class="titles">
              <div class="name"></div>
              <div class="category"></div>
            </div>
            <div class="mascot-badge"><svg class="mascot" viewBox="0 0 80 80"></svg></div>
          </div>
          <div class="strip">
            <div class="pm"><span class="pm-label">PM<sub>2.5</sub></span> <b class="pm-value"></b> <span class="pm-unit">µg/m³</span></div>
            <div class="chips"></div>
          </div>
        </div>
      </ha-card>
      <div class="overlay" hidden></div>
      <div class="tooltip" hidden></div>
    `;
    const scene = root.querySelector(".scene");
    scene.addEventListener("click", () => this._openOverlay());
    scene.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        this._openOverlay();
      }
    });
    const trees = root.querySelector(".trees");
    const treeXs = [26, 52, 196, 318, 352];
    trees.innerHTML = treeXs
      .map(
        (x, i) => `
        <g class="tree t${i}" transform="translate(${x},${62 + (i % 2) * 8})">
          <rect x="-1.6" y="0" width="3.2" height="9" rx="1" class="trunk"></rect>
          <path d="M0,-16 L8,2 L-8,2 Z" class="leaves"></path>
          <path d="M0,-9 L9.5,6 L-9.5,6 Z" class="leaves"></path>
        </g>`
      )
      .join("");
  }

  _mascotSvg(mood) {
    const face = {
      happy: `<path d="M30 47 Q40 56 50 47" class="mouth"/><circle cx="31" cy="38" r="3.2" class="eye"/><circle cx="49" cy="38" r="3.2" class="eye"/>`,
      ok: `<path d="M31 49 L49 49" class="mouth"/><circle cx="31" cy="38" r="3.2" class="eye"/><circle cx="49" cy="38" r="3.2" class="eye"/>`,
      meh: `<path d="M31 51 Q40 46 49 51" class="mouth"/><circle cx="31" cy="38" r="3.2" class="eye"/><circle cx="49" cy="38" r="3.2" class="eye"/>`,
      sad: `<path d="M30 52 Q40 44 50 52" class="mouth"/><path d="M26 36 L36 39" class="brow"/><path d="M54 36 L44 39" class="brow"/><circle cx="31" cy="41" r="3" class="eye"/><circle cx="49" cy="41" r="3" class="eye"/>`,
    }[mood];
    return `
      <path d="M22 12 h36 a8 8 0 0 1 8 8 v34 a14 14 0 0 1 -14 14 h-24 a14 14 0 0 1 -14 -14 v-34 a8 8 0 0 1 8 -8 Z" class="body"/>
      <path d="M22 12 h36 a8 8 0 0 1 8 8 v6 h-52 v-6 a8 8 0 0 1 8 -8 Z" class="cap"/>
      <circle cx="25" cy="47" r="2.6" class="blush"/><circle cx="55" cy="47" r="2.6" class="blush"/>
      ${face}`;
  }

  _update() {
    const root = this.shadowRoot;
    const hass = this._hass;
    const state = hass.states[this._config.entity];
    const scene = root.querySelector(".scene");

    const name =
      this._config.name ||
      state?.attributes?.friendly_name?.replace(/\s*PM2\.?5$/i, "") ||
      this._config.entity;
    root.querySelector(".name").textContent = name;

    if (!state || state.state === "unavailable" || state.state === "unknown") {
      scene.dataset.category = "offline";
      root.querySelector(".category").textContent = "Offline";
      root.querySelector(".pm-value").textContent = "–";
      root.querySelector(".mascot").innerHTML = this._mascotSvg("ok");
      root.querySelector(".chips").innerHTML = "";
      return;
    }

    const pm25 = Number(state.state);
    const cat = categoryFor(pm25);
    scene.dataset.category = cat.key;
    scene.style.setProperty("--cat-color", cat.color);
    scene.style.setProperty("--cat-sky-top", cat.sky[0]);
    scene.style.setProperty("--cat-sky-bottom", cat.sky[1]);
    scene.style.setProperty("--cat-ground", cat.ground);
    root.querySelector(".category").textContent = cat.label;
    root.querySelector(".pm-value").textContent = fmt(pm25);
    root.querySelector(".mascot").innerHTML = this._mascotSvg(cat.mood);

    const chips = [];
    const chip = (id, icon, unit, digits = 0) => {
      const st = id && hass.states[id];
      if (!st || isNaN(Number(st.state))) return;
      chips.push(
        `<span class="chip"><ha-icon icon="${icon}"></ha-icon>${fmt(Number(st.state), digits)}${unit}</span>`
      );
    };
    this._relatedIds(state);
    chip(this._related.temperature, "mdi:thermometer", "°");
    chip(this._related.humidity, "mdi:water-percent", "%");
    chip(this._related.co2, "mdi:molecule-co2", "");
    root.querySelector(".chips").innerHTML = chips.join("");

    if (!root.querySelector(".overlay").hidden) this._renderOverlay();
  }

  /* ------------------------------------------------------------------ */
  /* Expanded view                                                        */
  /* ------------------------------------------------------------------ */

  async _openOverlay() {
    const overlay = this.shadowRoot.querySelector(".overlay");
    overlay.hidden = false;
    document.body.style.setProperty("overflow", "hidden");
    this._escHandler = (ev) => ev.key === "Escape" && this._closeOverlay();
    window.addEventListener("keydown", this._escHandler);
    this._renderOverlay();
    await this._loadStats();
    this._renderOverlay();
  }

  _closeOverlay() {
    this.shadowRoot.querySelector(".overlay").hidden = true;
    this.shadowRoot.querySelector(".tooltip").hidden = true;
    document.body.style.removeProperty("overflow");
    window.removeEventListener("keydown", this._escHandler);
  }

  async _loadStats() {
    if (Date.now() - this._statsCacheAt < 5 * 60 * 1000) return;
    const hass = this._hass;
    const id = this._config.entity;
    const now = new Date();
    const dayMs = 24 * 3600 * 1000;
    const iso = (d) => new Date(d).toISOString();

    const call = (period, startMs) =>
      hass
        .callWS({
          type: "recorder/statistics_during_period",
          start_time: iso(startMs),
          end_time: iso(now),
          statistic_ids: [id],
          period,
          types: ["mean"],
        })
        .then((r) => r?.[id] ?? [])
        .catch(() => []);

    const [short, hourly, daily] = await Promise.all([
      call("5minute", now - dayMs),
      call("hour", now - 10 * dayMs),
      call("day", now - 30 * dayMs),
    ]);
    this._stats = { short, hourly, daily };
    this._statsCacheAt = Date.now();
  }

  _renderOverlay() {
    const overlay = this.shadowRoot.querySelector(".overlay");
    const hass = this._hass;
    const state = hass.states[this._config.entity];
    const pm25 = state ? Number(state.state) : NaN;
    const cat = Number.isNaN(pm25) ? null : categoryFor(pm25);
    const stats = this._stats ?? { short: [], hourly: [], daily: [] };
    const startOf = (row) =>
      typeof row.start === "number" ? row.start : Date.parse(row.start);

    const meanOfLast = (rows, ms) => {
      const cutoff = Date.now() - ms;
      const vals = rows.filter((r) => startOf(r) >= cutoff && r.mean != null);
      if (!vals.length) return null;
      return vals.reduce((a, r) => a + r.mean, 0) / vals.length;
    };
    const avg24 = meanOfLast(stats.short.length ? stats.short : stats.hourly, 24 * 3600e3);
    const avg12 = meanOfLast(stats.short.length ? stats.short : stats.hourly, 12 * 3600e3);
    const dailyMeans = stats.daily.filter((r) => r.mean != null);
    const avg30d = dailyMeans.length
      ? dailyMeans.reduce((a, r) => a + r.mean, 0) / dailyMeans.length
      : null;
    const cigarettes = dailyMeans.length
      ? dailyMeans.reduce((a, r) => a + r.mean / UG_PER_CIGARETTE_DAY, 0)
      : null;

    const name = this.shadowRoot.querySelector(".name").textContent;
    const tile = (title, value, sub) => `
      <div class="tile">
        <div class="tile-title">${title}</div>
        <div class="tile-value">${value}</div>
        <div class="tile-sub">${sub}</div>
      </div>`;

    const whoTile = () => {
      if (avg30d == null)
        return tile("WHO annual guideline", "…", "Collecting data — check back soon");
      const ratio = avg30d / WHO_ANNUAL_PM25;
      return tile(
        `${ratio.toFixed(1)}× the WHO annual guideline`,
        `${fmt(avg30d)} µg/m³`,
        `${dailyMeans.length}-day average · guideline ${WHO_ANNUAL_PM25} µg/m³`
      );
    };
    const cigTile = () => {
      if (cigarettes == null)
        return tile("Cigarettes smoked", "…", "Collecting data — check back soon");
      return tile(
        "Cigarettes smoked",
        cigarettes.toFixed(1),
        `Equivalent pollution over the last ${dailyMeans.length} day${dailyMeans.length === 1 ? "" : "s"}`
      );
    };

    overlay.innerHTML = `
      <div class="backdrop"></div>
      <div class="sheet" role="dialog" aria-label="${name} air quality details">
        <button class="close" aria-label="Close">✕</button>
        <div class="sheet-head" style="--cat-color:${cat?.color ?? "#9e9e9e"}">
          <svg class="mascot big" viewBox="0 0 80 80">${this._mascotSvg(cat?.mood ?? "ok")}</svg>
          <div>
            <div class="sheet-name">${name}</div>
            <div class="sheet-cat">${cat?.label ?? "Offline"}</div>
            <div class="sheet-pm">PM<sub>2.5</sub> <b>${fmt(pm25)}</b> µg/m³</div>
          </div>
        </div>
        <div class="tiles">
          ${tile("Last 24 h", avg24 == null ? "…" : `${fmt(avg24)} µg/m³`, "average PM2.5")}
          ${tile("Last 12 h", avg12 == null ? "…" : `${fmt(avg12)} µg/m³`, "average PM2.5")}
          ${whoTile()}
          ${cigTile()}
        </div>
        <div class="section">
          <h3>PM<sub>2.5</sub> — last 24 hours <span class="unit">µg/m³</span></h3>
          <div class="chart24"></div>
        </div>
        <div class="section">
          <h3>PM<sub>2.5</sub> — last 10 days by hour</h3>
          <div class="heatmap"></div>
          <div class="legend"></div>
        </div>
        <div class="attribution">
          Air quality data by <a href="https://www.airgradient.com/" target="_blank" rel="noopener">AirGradient</a>
          under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.
          History recorded by Home Assistant.
        </div>
      </div>`;

    overlay.querySelector(".backdrop").addEventListener("click", () => this._closeOverlay());
    overlay.querySelector(".close").addEventListener("click", () => this._closeOverlay());

    this._render24hChart(overlay.querySelector(".chart24"), stats);
    this._renderHeatmap(overlay.querySelector(".heatmap"), stats.hourly);
    overlay.querySelector(".legend").innerHTML = CATEGORIES.map(
      (c) => `<span class="lg"><i style="background:${c.color}"></i>${c.label}</span>`
    ).join("");
  }

  _hourLabel(date) {
    return date.toLocaleTimeString(this._hass?.locale?.language, { hour: "numeric" });
  }

  _render24hChart(el, stats) {
    // 48 half-hour buckets from 5-minute statistics; hourly fallback.
    const now = Date.now();
    const bucketMs = 30 * 60e3;
    const src = stats.short.length ? stats.short : stats.hourly;
    const startOf = (r) => (typeof r.start === "number" ? r.start : Date.parse(r.start));
    const buckets = new Array(48).fill(null).map(() => []);
    const t0 = now - 48 * bucketMs;
    for (const r of src) {
      if (r.mean == null) continue;
      const i = Math.floor((startOf(r) - t0) / bucketMs);
      if (i >= 0 && i < 48) buckets[i].push(r.mean);
    }
    const values = buckets.map((b) =>
      b.length ? b.reduce((a, v) => a + v, 0) / b.length : null
    );
    if (!values.some((v) => v != null)) {
      el.innerHTML = `<div class="empty">No history yet — the chart fills in as Home Assistant records data.</div>`;
      return;
    }

    const W = 520, H = 150, padL = 30, padB = 20, padT = 8;
    const plotW = W - padL - 6, plotH = H - padT - padB;
    const maxV = Math.max(5, ...values.filter((v) => v != null)) * 1.15;
    const bw = plotW / 48;
    const y = (v) => padT + plotH - (v / maxV) * plotH;

    let bars = "", hits = "";
    values.forEach((v, i) => {
      const x = padL + i * bw;
      if (v != null) {
        const c = categoryFor(v);
        const h = Math.max(2, plotH - (y(v) - padT));
        bars += `<rect x="${(x + 0.75).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 1.5).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${c.color}" stroke="rgba(0,0,0,.14)" stroke-width="0.5"/>`;
      }
      const when = new Date(t0 + i * bucketMs);
      hits += `<rect class="hit" x="${x}" y="0" width="${bw}" height="${H - padB}" fill="transparent"
        data-tip="${v == null ? "no data" : `${fmt(v)} µg/m³ · ${categoryFor(v).label}`} — ${this._hourLabel(when)}"/>`;
    });

    const ticks = [0, Math.round(maxV / 2), Math.round(maxV)];
    const grid = ticks
      .map(
        (t) => `
        <line x1="${padL}" y1="${y(t)}" x2="${W - 6}" y2="${y(t)}" class="grid"/>
        <text x="${padL - 5}" y="${y(t) + 3}" class="axis" text-anchor="end">${t}</text>`
      )
      .join("");
    let hourTicks = "";
    for (let i = 0; i < 48; i += 8) {
      const when = new Date(t0 + i * bucketMs);
      hourTicks += `<text x="${padL + i * bw}" y="${H - 6}" class="axis">${this._hourLabel(when)}</text>`;
    }

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart">${grid}${bars}${hourTicks}${hits}</svg>`;
    this._attachTooltips(el);
  }

  _renderHeatmap(el, hourly) {
    const startOf = (r) => (typeof r.start === "number" ? r.start : Date.parse(r.start));
    const byKey = new Map();
    for (const r of hourly) {
      if (r.mean == null) continue;
      const d = new Date(startOf(r));
      byKey.set(`${d.toDateString()}|${d.getHours()}`, r.mean);
    }
    if (!byKey.size) {
      el.innerHTML = `<div class="empty">No hourly statistics yet — this view builds up over the next days.</div>`;
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let rows = "";
    for (let day = 0; day < 10; day++) {
      const date = new Date(today.getTime() - day * 24 * 3600e3);
      const label =
        day === 0 ? "Today" : day === 1 ? "Yesterday"
        : date.toLocaleDateString(this._hass?.locale?.language, { weekday: "long" });
      let cells = "";
      for (let h = 0; h < 24; h++) {
        const v = byKey.get(`${date.toDateString()}|${h}`);
        if (v == null) {
          cells += `<i class="cell empty-cell" data-tip="no data — ${label} ${h}:00"></i>`;
        } else {
          const c = categoryFor(v);
          cells += `<i class="cell" style="background:${c.color}" data-tip="${fmt(v)} µg/m³ · ${c.label} — ${label} ${h}:00"></i>`;
        }
      }
      rows += `<div class="hm-row">${cells}<span class="hm-label">${label}</span></div>`;
    }
    let hours = "";
    for (let h = 0; h < 24; h += 6) hours += `<span style="grid-column:${h + 1}">${String(h).padStart(2, "0")}</span>`;
    el.innerHTML = `<div class="hm-hours">${hours}</div>${rows}`;
    this._attachTooltips(el);
  }

  _attachTooltips(scope) {
    const tooltip = this.shadowRoot.querySelector(".tooltip");
    scope.querySelectorAll("[data-tip]").forEach((node) => {
      node.addEventListener("mouseenter", () => {
        tooltip.textContent = node.dataset.tip;
        tooltip.hidden = false;
      });
      node.addEventListener("mousemove", (ev) => {
        tooltip.style.left = `${Math.min(ev.clientX + 12, window.innerWidth - 180)}px`;
        tooltip.style.top = `${ev.clientY + 14}px`;
      });
      node.addEventListener("mouseleave", () => (tooltip.hidden = true));
    });
  }

  /* ------------------------------------------------------------------ */

  static styles = `
    :host { display: block; }
    ha-card { overflow: hidden; }
    .scene {
      position: relative; height: 190px; cursor: pointer; outline: none;
      display: flex; flex-direction: column; justify-content: space-between;
    }
    .scene:focus-visible { box-shadow: inset 0 0 0 2px var(--primary-color); }
    .sky { position: absolute; inset: 0;
      background: linear-gradient(var(--cat-sky-top, #dcf3dd), var(--cat-sky-bottom, #f2faf0)); }
    .scene[data-category="offline"] .sky { background: linear-gradient(#e0e0e0, #f5f5f5); }
    .clouds { position: absolute; inset: 0; overflow: hidden; }
    .cloud { position: absolute; background: rgba(255,255,255,.85); border-radius: 999px; }
    .cloud::before, .cloud::after { content:""; position:absolute; background:inherit; border-radius:999px; }
    .c1 { width: 52px; height: 14px; top: 26px; animation: drift 46s linear infinite; }
    .c1::before { width: 22px; height: 18px; top: -9px; left: 9px; }
    .c2 { width: 38px; height: 11px; top: 58px; animation: drift 64s linear infinite; animation-delay: -30s; }
    .c2::before { width: 16px; height: 13px; top: -7px; left: 8px; }
    .c3 { width: 30px; height: 9px; top: 14px; animation: drift 80s linear infinite; animation-delay: -55s; }
    .c3::before { width: 13px; height: 11px; top: -5px; left: 7px; }
    @keyframes drift { from { left: -70px; } to { left: 105%; } }
    .hills { position: absolute; left: 0; right: 0; bottom: 34px; height: 80px; width: 100%; }
    .hill-back { fill: var(--cat-ground, #66bb6a); opacity: .45; }
    .hill-front { fill: var(--cat-ground, #66bb6a); opacity: .8; }
    .trunk { fill: #7a5b41; }
    .leaves { fill: var(--cat-ground, #2e7d32); filter: brightness(.72); }
    .tree { transform-box: fill-box; transform-origin: bottom center; }
    .head { position: relative; display: flex; justify-content: space-between; padding: 14px 16px 0; }
    .name { font-size: 1.05rem; font-weight: 600; color: rgba(0,0,0,.75); }
    .category { font-size: 1.5rem; font-weight: 700; color: rgba(0,0,0,.85); line-height: 1.2; max-width: 70%; }
    .mascot-badge {
      width: 64px; height: 64px; border-radius: 50%; flex: none;
      background: rgba(255,255,255,.75); border: 3px solid var(--cat-color, #43a047);
      display: grid; place-items: center; animation: bob 4s ease-in-out infinite;
    }
    @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
    .mascot { width: 52px; height: 52px; }
    .mascot .body { fill: #fff; stroke: rgba(0,0,0,.18); stroke-width: 1.5; }
    .mascot .cap { fill: var(--cat-color, #43a047); opacity: .9; }
    .mascot .eye { fill: #37474f; }
    .mascot .mouth, .mascot .brow { stroke: #37474f; stroke-width: 2.4; fill: none; stroke-linecap: round; }
    .mascot .blush { fill: #f8bbd0; }
    .strip {
      position: relative; display: flex; justify-content: space-between; align-items: center;
      padding: 8px 16px; background: var(--cat-color, #43a047); color: #fff;
    }
    .scene[data-category="moderate"] .strip { color: rgba(0,0,0,.8); }
    .scene[data-category="offline"] .strip { background: #9e9e9e; }
    .pm-value { font-size: 1.25rem; }
    .chips { display: flex; gap: 10px; font-size: .9rem; }
    .chip { display: inline-flex; align-items: center; gap: 2px; }
    .chip ha-icon { --mdc-icon-size: 16px; }

    /* Expanded sheet */
    .overlay { position: fixed; inset: 0; z-index: 999; }
    .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.45); }
    .sheet {
      position: absolute; top: 24px; left: 50%; transform: translateX(-50%);
      max-height: calc(100% - 48px);
      width: min(620px, calc(100vw - 24px));
      background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121);
      border-radius: 16px; overflow-y: auto; padding: 20px; box-sizing: border-box;
      box-shadow: 0 8px 40px rgba(0,0,0,.4);
    }
    .close {
      position: absolute; top: 12px; right: 12px; border: none; cursor: pointer;
      width: 34px; height: 34px; border-radius: 50%; font-size: 15px;
      background: var(--secondary-background-color, #eee); color: var(--primary-text-color, #212121);
    }
    .sheet-head { display: flex; gap: 16px; align-items: center; margin-bottom: 16px; }
    .mascot.big { width: 72px; height: 72px; flex: none; }
    .sheet-name { font-weight: 600; }
    .sheet-cat { font-size: 1.6rem; font-weight: 700; color: var(--cat-color); }
    .sheet-pm b { font-size: 1.15rem; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .tile { background: var(--secondary-background-color, #f5f5f5); border-radius: 12px; padding: 12px; }
    .tile-title { font-size: .8rem; color: var(--secondary-text-color, #666); }
    .tile-value { font-size: 1.4rem; font-weight: 700; margin: 2px 0; }
    .tile-sub { font-size: .75rem; color: var(--secondary-text-color, #666); }
    .section { margin-top: 20px; }
    .section h3 { font-size: .95rem; margin: 0 0 8px; }
    .section .unit { font-weight: 400; font-size: .75rem; color: var(--secondary-text-color, #666); }
    .chart { width: 100%; height: auto; }
    .grid { stroke: var(--divider-color, #e0e0e0); stroke-width: 1; }
    .axis { font-size: 9px; fill: var(--secondary-text-color, #666); }
    .empty { font-size: .85rem; color: var(--secondary-text-color, #666); padding: 12px 0; }
    .hm-hours { display: grid; grid-template-columns: repeat(24, 1fr); font-size: .65rem;
      color: var(--secondary-text-color, #666); margin: 0 84px 3px 0; }
    .hm-row { display: grid; grid-template-columns: repeat(24, 1fr) 84px; gap: 3px; margin-bottom: 3px; align-items: center; }
    .cell { display: block; aspect-ratio: 1; border-radius: 3px; min-width: 0;
      box-shadow: inset 0 0 0 0.5px rgba(0,0,0,.12); }
    .empty-cell { background: transparent; box-shadow: inset 0 0 0 1px var(--divider-color, #e0e0e0); }
    .hm-label { font-size: .72rem; color: var(--secondary-text-color, #666); padding-left: 6px; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 10px; font-size: .72rem;
      color: var(--secondary-text-color, #666); }
    .lg { display: inline-flex; align-items: center; gap: 4px; }
    .lg i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .attribution { margin-top: 18px; font-size: .72rem; color: var(--secondary-text-color, #666); }
    .attribution a { color: inherit; }
    .tooltip {
      position: fixed; z-index: 1000; pointer-events: none; max-width: 170px;
      background: rgba(33,33,33,.94); color: #fff; font-size: .74rem;
      padding: 5px 8px; border-radius: 6px;
    }
    @media (prefers-reduced-motion: reduce) {
      .cloud, .tree, .mascot-badge { animation: none; }
    }
  `;
}

/* ---------------------------------------------------------------------- */
/* Visual editor                                                            */
/* ---------------------------------------------------------------------- */

class AirGradientMapCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  async _render() {
    if (!this._form) {
      // Make sure ha-form and its selectors are registered.
      const helpers = await window.loadCardHelpers?.();
      await helpers?.createCardElement({ type: "entities", entities: [] })
        ?.constructor?.getConfigElement?.();
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) =>
        ({ entity: "PM2.5 sensor", name: "Name (optional)" })[s.name] ?? s.name;
      this._form.addEventListener("value-changed", (ev) => {
        const config = { type: "custom:airgradient-map-card", ...ev.detail.value };
        this.dispatchEvent(
          new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })
        );
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = this._config;
    this._form.schema = [
      {
        name: "entity",
        required: true,
        selector: { entity: { domain: "sensor", device_class: "pm25" } },
      },
      { name: "name", selector: { text: {} } },
    ];
  }
}

customElements.define("airgradient-map-card", AirGradientMapCard);
customElements.define("airgradient-map-card-editor", AirGradientMapCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "airgradient-map-card",
  name: "AirGradient Map Card",
  description:
    "Animated air-quality card for a public AirGradient location, with tap-to-expand charts.",
  preview: true,
  documentationURL: "https://github.com/keranm/airgradient-public",
});
