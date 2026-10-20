/* LinkPulse — browser-only link management prototype.
 * The browser is the data store here, so security-sensitive rules are demonstrative only.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "linkpulse.database.v1";
  const MAX_CLICK_EVENTS = 5000;
  const MAX_ACTIVITY_ITEMS = 100;
  const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
  const MAX_IMPORT_ROWS = 2000;
  const ALIAS_PATTERN = /^[a-zA-Z0-9_-]{3,40}$/;
  const RESERVED_ALIASES = new Set([
    "overview", "links", "campaigns", "analytics", "safety", "settings",
    "create", "import", "export", "assets", "styles", "app", "index",
    "favicon", "robots", "admin", "api", "help", "null", "undefined"
  ]);

  const viewRoot = document.getElementById("view-root");
  const modal = document.getElementById("app-modal");
  const modalContent = document.getElementById("modal-content");
  const toastRegion = document.getElementById("toast-region");
  const sidebar = document.getElementById("sidebar");
  const mobileScrim = document.getElementById("mobile-scrim");

  let currentView = "overview";
  let selectedAnalyticsRange = "7d";
  let selectedAnalyticsCampaign = "all";
  let selectedLinksCampaign = "all";
  let pendingImport = null;
  let importFileName = "";
  let toastCounter = 0;

  function emptyDatabase() {
    return { version: 1, links: [], campaigns: [], clicks: [], blocklist: [], activity: [] };
  }

  function loadDatabase() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return emptyDatabase();
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== "object") return emptyDatabase();
      const links = (Array.isArray(parsed.links) ? parsed.links : []).filter(isObject).map((item) => ({
        ...item,
        id: typeof item.id === "string" && item.id ? item.id : createId("link"),
        alias: typeof item.alias === "string" ? item.alias : "",
        destination: typeof item.destination === "string" ? item.destination : "",
        title: typeof item.title === "string" ? item.title : String(item.alias || "Untitled link"),
        campaignId: typeof item.campaignId === "string" ? item.campaignId : null,
        tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === "string").slice(0, 20) : [],
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : (item.createdAt || new Date().toISOString()),
        expiresAt: typeof item.expiresAt === "string" ? item.expiresAt : null,
        clickLimit: Number.isInteger(Number(item.clickLimit)) && Number(item.clickLimit) > 0 ? Number(item.clickLimit) : null,
        clickCount: Number.isFinite(Number(item.clickCount)) && Number(item.clickCount) >= 0 ? Math.floor(Number(item.clickCount)) : 0,
        disabled: Boolean(item.disabled),
        password: typeof item.password === "string" && item.password ? item.password : null,
        demoData: Boolean(item.demoData)
      })).filter((item) => item.alias && item.destination);
      const linkIds = new Set(links.map((item) => item.id));
      const campaigns = (Array.isArray(parsed.campaigns) ? parsed.campaigns : []).filter(isObject).map((item) => ({
        ...item,
        id: typeof item.id === "string" && item.id ? item.id : createId("campaign"),
        name: typeof item.name === "string" ? item.name.trim() : "",
        description: typeof item.description === "string" ? item.description : "",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        demoData: Boolean(item.demoData)
      })).filter((item) => item.name);
      const campaignIds = new Set(campaigns.map((item) => item.id));
      links.forEach((link) => { if (link.campaignId && !campaignIds.has(link.campaignId)) link.campaignId = null; });
      const clicks = (Array.isArray(parsed.clicks) ? parsed.clicks : []).filter(isObject).map((item) => ({
        ...item,
        id: typeof item.id === "string" && item.id ? item.id : createId("click"),
        linkId: typeof item.linkId === "string" ? item.linkId : "",
        campaignId: typeof item.campaignId === "string" ? item.campaignId : null,
        timestamp: typeof item.timestamp === "string" ? item.timestamp : "",
        referrer: typeof item.referrer === "string" ? item.referrer : "",
        browser: typeof item.browser === "string" ? item.browser : "Unknown",
        device: typeof item.device === "string" ? item.device : "Unknown"
      })).filter((item) => linkIds.has(item.linkId) && item.timestamp && Number.isFinite(new Date(item.timestamp).getTime())).slice(-MAX_CLICK_EVENTS);
      const blocklist = (Array.isArray(parsed.blocklist) ? parsed.blocklist : []).filter(isObject).map((item) => ({
        ...item,
        id: typeof item.id === "string" && item.id ? item.id : createId("block"),
        domain: typeof item.domain === "string" ? item.domain.toLowerCase().trim() : "",
        reason: typeof item.reason === "string" ? item.reason : "",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString()
      })).filter((item) => item.domain);
      const activity = (Array.isArray(parsed.activity) ? parsed.activity : []).filter(isObject).map((item) => ({
        ...item,
        id: typeof item.id === "string" && item.id ? item.id : createId("act"),
        type: typeof item.type === "string" ? item.type : "update",
        title: typeof item.title === "string" ? item.title : "Workspace updated",
        detail: typeof item.detail === "string" ? item.detail : "",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString()
      })).slice(0, MAX_ACTIVITY_ITEMS);
      return { version: 1, links, campaigns, clicks, blocklist, activity };
    } catch (error) {
      console.warn("LinkPulse could not read saved browser data.", error);
      return emptyDatabase();
    }
  }

  function saveDatabase(database) {
    database.clicks = database.clicks.slice(-MAX_CLICK_EVENTS);
    database.activity = database.activity.slice(0, MAX_ACTIVITY_ITEMS);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
      return true;
    } catch (error) {
      console.error("LinkPulse could not save browser data.", error);
      showToast("The browser could not save this change. Storage may be full or unavailable.", "error");
      return false;
    }
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function createId(prefix) {
    let idPart;
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      idPart = window.crypto.randomUUID();
    } else {
      idPart = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
    }
    return `${prefix}_${idPart}`;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  function shorten(value, maxLength = 42) {
    const text = String(value ?? "");
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function formatDate(value, includeTime = false) {
    if (!value) return "No expiry";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Invalid date";
    return new Intl.DateTimeFormat(undefined, includeTime
      ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", year: "numeric" }).format(date);
  }

  function timeAgo(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown time";
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
    if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)} days ago`;
    return formatDate(value, false);
  }

  function showToast(message, type = "success") {
    const toastId = `toast-${++toastCounter}`;
    const toast = document.createElement("div");
    toast.className = `toast ${type === "error" ? "error" : type === "warning" ? "warning" : ""}`.trim();
    toast.id = toastId;
    toast.innerHTML = `<span class="toast-mark" aria-hidden="true">${type === "error" ? "!" : type === "warning" ? "△" : "✓"}</span><span>${escapeHTML(message)}</span>`;
    toastRegion.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  function openModal(content, options = {}) {
    pendingImport = options.keepImport ? pendingImport : null;
    importFileName = options.keepImport ? importFileName : "";
    modal.classList.toggle("wide", Boolean(options.wide));
    modalContent.innerHTML = content;
    if (!modal.open) modal.showModal();
    const firstControl = modalContent.querySelector("input:not([type='hidden']), select, textarea, button");
    if (firstControl) window.setTimeout(() => firstControl.focus(), 30);
  }

  function closeModal() {
    if (modal.open) modal.close();
    modalContent.innerHTML = "";
    pendingImport = null;
    importFileName = "";
  }

  function isDomainBlocked(destination, database = loadDatabase()) {
    let hostname;
    try {
      hostname = new URL(destination).hostname.toLowerCase();
    } catch {
      return true;
    }
    return database.blocklist.some((entry) => {
      const blocked = String(entry.domain || "").toLowerCase();
      return blocked && (hostname === blocked || hostname.endsWith(`.${blocked}`));
    });
  }

  function getLinkStatus(link, database = loadDatabase()) {
    if (link.disabled) return "Disabled";
    if (link.expiresAt) {
      const expiry = new Date(link.expiresAt).getTime();
      if (Number.isFinite(expiry) && expiry <= Date.now()) return "Expired";
    }
    if (link.clickLimit !== null && link.clickLimit !== undefined && link.clickLimit !== "") {
      const limit = Number(link.clickLimit);
      if (Number.isInteger(limit) && limit > 0 && Number(link.clickCount || 0) >= limit) {
        return "Click limit reached";
      }
    }
    if (isDomainBlocked(link.destination, database)) return "Blocked";
    return "Active";
  }

  function statusClass(status) {
    if (status === "Active") return "status-active";
    if (status === "Expired") return "status-expired";
    if (status === "Click limit reached") return "status-capped";
    return "status-disabled";
  }

  function statusBadge(status) {
    return `<span class="status-pill ${statusClass(status)}">${escapeHTML(status)}</span>`;
  }

  function campaignName(campaignId, database = loadDatabase()) {
    if (!campaignId) return "Unassigned";
    const campaign = database.campaigns.find((item) => item.id === campaignId);
    return campaign ? campaign.name : "Unassigned";
  }

  function linkClicksForCampaign(campaignId, database) {
    return database.links
      .filter((link) => link.campaignId === campaignId)
      .reduce((total, link) => total + Number(link.clickCount || 0), 0);
  }

  function addActivity(database, type, title, detail = "", options = {}) {
    database.activity.unshift({
      id: createId("act"), type, title, detail,
      createdAt: new Date().toISOString(), demoData: Boolean(options.demoData)
    });
    database.activity = database.activity.slice(0, MAX_ACTIVITY_ITEMS);
  }

  function getAppBaseURL() {
    const base = new URL(window.location.href);
    base.search = "";
    base.hash = "";
    if (/\/index\.html?$/i.test(base.pathname)) {
      base.pathname = base.pathname.replace(/index\.html?$/i, "");
    }
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    return base.toString();
  }

  function makeShortURL(alias) {
    return `${getAppBaseURL()}?go=${encodeURIComponent(alias)}`;
  }

  function normalizeDestination(value) {
    const input = String(value || "").trim();
    if (!input) return { ok: false, message: "Enter a destination URL." };
    let url;
    try {
      url = new URL(input);
    } catch {
      return { ok: false, message: "Enter a complete URL, including https:// or http://." };
    }
    if (!/^https?:$/.test(url.protocol)) {
      return { ok: false, message: "Only HTTP and HTTPS destination URLs are allowed." };
    }
    if (!url.hostname || url.hostname.includes(" ")) {
      return { ok: false, message: "That destination does not contain a valid hostname." };
    }
    return { ok: true, value: url.toString() };
  }

  function aliasError(alias, database, ignoredLinkId = null) {
    if (!alias) return "Choose a custom alias or leave the field empty for automatic generation.";
    if (!ALIAS_PATTERN.test(alias)) return "Use 3–40 letters, numbers, hyphens, or underscores.";
    if (RESERVED_ALIASES.has(alias.toLowerCase())) return "That alias is reserved by the application.";
    if (database.links.some((link) => link.id !== ignoredLinkId && String(link.alias).toLowerCase() === alias.toLowerCase())) {
      return "That alias is already in use. Choose a different one.";
    }
    return "";
  }

  function generateAlias(database) {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    let candidate = "";
    do {
      candidate = Array.from({ length: 7 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    } while (database.links.some((link) => link.alias === candidate) || RESERVED_ALIASES.has(candidate));
    return candidate;
  }

  async function copyText(value) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const temporaryInput = document.createElement("textarea");
        temporaryInput.value = value;
        temporaryInput.setAttribute("readonly", "");
        temporaryInput.style.position = "fixed";
        temporaryInput.style.opacity = "0";
        document.body.appendChild(temporaryInput);
        temporaryInput.select();
        const copied = document.execCommand("copy");
        temporaryInput.remove();
        if (!copied) throw new Error("Clipboard permission was unavailable.");
      }
      showToast("Short link copied to the clipboard.");
    } catch (error) {
      console.warn("Copy action failed.", error);
      openModal(`
        <div class="modal-head"><div><h2 id="modal-title">Copy short link</h2><p>Clipboard access was unavailable. Select and copy the link below.</p></div><button class="modal-x" data-close-modal aria-label="Close">×</button></div>
        <div class="modal-body"><div class="copy-field"><input class="text-input" id="copy-fallback-input" value="${escapeHTML(value)}" readonly><button class="button button-secondary" id="select-copy-text">Select text</button></div><div class="modal-actions"><button class="button button-secondary" data-close-modal>Close</button></div></div>
      `);
      const copyInput = document.getElementById("copy-fallback-input");
      document.getElementById("select-copy-text")?.addEventListener("click", () => { copyInput.focus(); copyInput.select(); });
    }
  }

  function navigateTo(view) {
    if (!new Set(["overview", "links", "campaigns", "analytics", "safety", "settings"]).has(view)) return;
    currentView = view;
    closeMobileNav();
    renderCurrentView();
    document.getElementById("breadcrumb-current").textContent = ({
      overview: "Overview", links: "Links", campaigns: "Campaigns", analytics: "Analytics",
      safety: "Safety & admin", settings: "Settings"
    })[view];
    document.querySelectorAll(".nav-item[data-view]").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function openMobileNav() {
    sidebar.classList.add("is-open");
    mobileScrim.hidden = false;
    document.getElementById("mobile-menu-button").setAttribute("aria-expanded", "true");
  }

  function closeMobileNav() {
    sidebar.classList.remove("is-open");
    mobileScrim.hidden = true;
    document.getElementById("mobile-menu-button").setAttribute("aria-expanded", "false");
  }

  function renderCurrentView() {
    const database = loadDatabase();
    document.getElementById("nav-link-count").textContent = formatNumber(database.links.length);
    if (currentView === "overview") viewRoot.innerHTML = renderOverview(database);
    if (currentView === "links") viewRoot.innerHTML = renderLinksPage(database);
    if (currentView === "campaigns") viewRoot.innerHTML = renderCampaignsPage(database);
    if (currentView === "analytics") viewRoot.innerHTML = renderAnalyticsPage(database);
    if (currentView === "safety") viewRoot.innerHTML = renderSafetyPage(database);
    if (currentView === "settings") viewRoot.innerHTML = renderSettingsPage(database);
  }

  function renderViewHeading(eyebrow, title, description, actions = "") {
    return `<div class="view-heading"><div><span class="eyebrow">${escapeHTML(eyebrow)}</span><h1>${escapeHTML(title)}</h1><p>${escapeHTML(description)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ""}</div>`;
  }

  function renderOverview(database) {
    const totalClicks = database.links.reduce((sum, link) => sum + Number(link.clickCount || 0), 0);
    const activeLinks = database.links.filter((link) => getLinkStatus(link, database) === "Active").length;
    const restrictedLinks = database.links.length - activeLinks;
    const campaignCount = database.campaigns.length;
    const actions = `<button class="button button-secondary" data-action="load-demo">Load demo data</button><button class="button button-primary" data-action="create-link">＋ Create link</button>`;
    const chart = buildActivityChart(database.clicks, "7d", "Click activity over the last 7 days");
    const sortedCampaigns = database.campaigns.map((campaign) => ({
      ...campaign, clicks: linkClicksForCampaign(campaign.id, database),
      count: database.links.filter((link) => link.campaignId === campaign.id).length
    })).sort((a, b) => b.clicks - a.clicks).slice(0, 4);
    const maxCampaignClicks = Math.max(1, ...sortedCampaigns.map((campaign) => campaign.clicks));
    const activity = database.activity.slice(0, 5);
    const topLinks = database.links.slice().sort((a, b) => Number(b.clickCount || 0) - Number(a.clickCount || 0)).slice(0, 4);

    return `${renderViewHeading("Your workspace", "Good to see you.", "One place to create, control, and understand every short link.", actions)}
      <section class="stats-grid" aria-label="Workspace summary">
        ${renderStatCard("Total links", formatNumber(database.links.length), "Across all campaigns", "↗", "")}
        ${renderStatCard("Tracked clicks", formatNumber(totalClicks), "Recorded in this browser", "⌁", "blue")}
        ${renderStatCard("Active links", formatNumber(activeLinks), "Ready to redirect", "✓", "")}
        ${renderStatCard("Restricted links", formatNumber(restrictedLinks), "Disabled, expired, capped or blocked", "⛨", "amber")}
        ${renderStatCard("Campaigns", formatNumber(campaignCount), "Organized link groups", "▤", "purple")}
      </section>
      <section class="dashboard-grid">
        <article class="panel"><div class="panel-header"><div><h2>Click activity</h2><p class="panel-subtitle">Successful redirects recorded by LinkPulse</p></div><span class="chart-legend"><i class="legend-dot"></i> Clicks</span></div>${chart}</article>
        <article class="panel"><div class="panel-header"><div><h2>Campaign performance</h2><p class="panel-subtitle">Clicks by campaign</p></div><button class="text-link" data-view="campaigns">View all</button></div><div class="panel-body">${sortedCampaigns.length ? `<div class="campaign-performance">${sortedCampaigns.map((campaign) => `<div class="performance-row"><div class="performance-name"><span>${escapeHTML(campaign.name)}</span><span>${formatNumber(campaign.clicks)}</span></div><div class="progress-track"><div class="progress-bar" style="width:${Math.max(0, campaign.clicks / maxCampaignClicks * 100)}%"></div></div></div>`).join("")}</div><div class="performance-foot"><span>${formatNumber(campaignCount)} total campaigns</span><span>All-time link totals</span></div>` : `<div class="chart-empty"><div><strong>No campaigns yet</strong>Create a campaign to group links and measure results.<br><button class="text-link" data-action="create-campaign">Create a campaign →</button></div></div>`}</div></article>
      </section>
      <section class="dashboard-bottom-grid">
        <article class="panel"><div class="panel-header"><div><h2>Recent activity</h2><p class="panel-subtitle">A timeline of changes in this workspace</p></div><button class="text-link" data-view="analytics">Explore analytics</button></div><div class="panel-body"><div class="activity-list">${activity.length ? activity.map(renderActivityItem).join("") : `<div class="chart-empty"><div><strong>No activity to show</strong>Create a link or load demo data to get started.</div></div>`}</div></div></article>
        <article class="panel"><div class="panel-header"><div><h2>Top links</h2><p class="panel-subtitle">Ranked by recorded clicks</p></div><button class="text-link" data-view="links">All links</button></div><div class="panel-body"><div class="top-link-list">${topLinks.length ? topLinks.map((link) => `<div class="top-link-item"><span class="link-favicon" aria-hidden="true">↗</span><div class="top-link-copy"><strong>${escapeHTML(link.title || link.alias)}</strong><span>${escapeHTML(link.alias)} · ${escapeHTML(campaignName(link.campaignId, database))}</span></div><div class="top-link-clicks">${formatNumber(link.clickCount)}<small>clicks</small></div></div>`).join("") : `<div class="chart-empty"><div><strong>No links yet</strong>Your highest-performing links will appear here.</div></div>`}</div></div></article>
      </section>`;
  }

  function renderStatCard(label, value, note, icon, color) {
    return `<article class="stat-card"><div class="stat-top"><div><span class="stat-label">${escapeHTML(label)}</span><strong class="stat-value">${escapeHTML(value)}</strong></div><span class="stat-icon ${color}" aria-hidden="true">${escapeHTML(icon)}</span></div><p class="stat-note"><span class="neutral">${escapeHTML(note)}</span></p></article>`;
  }

  function renderActivityItem(item) {
    const type = String(item.type || "");
    const icon = type === "click" ? "↗" : type === "disable" || type === "block" ? "⛨" : type === "campaign" ? "▤" : type === "delete" ? "×" : "＋";
    const colorClass = type === "disable" || type === "block" ? "warn" : type === "delete" ? "gray" : "";
    return `<div class="activity-item"><span class="activity-icon ${colorClass}" aria-hidden="true">${icon}</span><div class="activity-copy"><p>${escapeHTML(item.title || "Workspace updated")}${item.detail ? ` <strong>${escapeHTML(item.detail)}</strong>` : ""}</p><time datetime="${escapeHTML(item.createdAt || "")}">${escapeHTML(timeAgo(item.createdAt))}</time></div></div>`;
  }

  function renderLinksPage(database) {
    const actions = `<button class="button button-secondary" data-action="import-csv">Import CSV</button><button class="button button-secondary" data-action="export-csv">Export CSV</button><button class="button button-primary" data-action="create-link">＋ Create link</button>`;
    const campaignOptions = database.campaigns.map((campaign) => `<option value="${escapeHTML(campaign.id)}" ${selectedLinksCampaign === campaign.id ? "selected" : ""}>${escapeHTML(campaign.name)}</option>`).join("");
    return `${renderViewHeading("Link operations", "Your links", "Manage destinations, link lifecycles, and click rules from one table.", actions)}
      <section class="panel">
        <div class="toolbar"><div class="search-wrap"><input class="text-input" id="link-search" type="search" placeholder="Search title, alias, or destination…" aria-label="Search links"></div>
          <select class="select-input" id="link-status-filter" aria-label="Filter links by status"><option value="all">All statuses</option><option>Active</option><option>Disabled</option><option>Expired</option><option>Click limit reached</option><option>Blocked</option></select>
          <select class="select-input" id="link-campaign-filter" aria-label="Filter links by campaign"><option value="all">All campaigns</option>${campaignOptions}</select>
          <select class="select-input" id="link-sort" aria-label="Sort links"><option value="created-desc">Newest first</option><option value="clicks-desc">Most clicks</option><option value="title-asc">Title A–Z</option><option value="expiry-asc">Expiry soonest</option></select>
        </div>
        <div id="links-table-container">${renderLinksTable(database, { query: "", status: "all", campaign: selectedLinksCampaign, sort: "created-desc" })}</div>
      </section>`;
  }

  function filteredLinks(database, filters) {
    let links = database.links.slice();
    const query = String(filters.query || "").trim().toLowerCase();
    if (query) links = links.filter((link) => [link.title, link.alias, link.destination].some((field) => String(field || "").toLowerCase().includes(query)));
    if (filters.status && filters.status !== "all") links = links.filter((link) => getLinkStatus(link, database) === filters.status);
    if (filters.campaign && filters.campaign !== "all") links = links.filter((link) => link.campaignId === filters.campaign);
    if (filters.sort === "clicks-desc") links.sort((a, b) => Number(b.clickCount || 0) - Number(a.clickCount || 0));
    else if (filters.sort === "title-asc") links.sort((a, b) => String(a.title || a.alias).localeCompare(String(b.title || b.alias)));
    else if (filters.sort === "expiry-asc") links.sort((a, b) => {
      const aTime = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
    else links.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    return links;
  }

  function renderLinksTable(database, filters) {
    const links = filteredLinks(database, filters);
    if (!links.length) {
      const noLinks = database.links.length === 0;
      return `<div class="table-empty"><div class="empty-illustration" aria-hidden="true">↗</div><h3>${noLinks ? "Your first short link starts here" : "No matching links"}</h3><p>${noLinks ? "Create a short link, attach it to a campaign, and start tracking successful redirects." : "Try a different search term or clear one of your filters."}</p>${noLinks ? `<button class="button button-primary" data-action="create-link">＋ Create your first link</button>` : `<button class="button button-secondary" data-action="clear-link-filters">Clear filters</button>`}</div>`;
    }
    return `<div class="table-wrap"><table><thead><tr><th>Link</th><th>Short URL</th><th>Campaign</th><th>Clicks</th><th>Lifecycle</th><th>Actions</th></tr></thead><tbody>${links.map((link) => {
      const status = getLinkStatus(link, database);
      const shortURL = makeShortURL(link.alias);
      const destinationHost = (() => { try { return new URL(link.destination).hostname; } catch { return link.destination; } })();
      return `<tr><td><span class="table-title">${escapeHTML(link.title || link.alias)}</span><span class="table-muted">${escapeHTML(destinationHost)}</span></td><td><span class="short-url">${escapeHTML(shorten(shortURL, 34))}</span><span class="table-muted">/${escapeHTML(link.alias)}</span></td><td>${escapeHTML(campaignName(link.campaignId, database))}</td><td><strong>${formatNumber(link.clickCount)}</strong>${link.clickLimit ? `<span class="table-muted">of ${formatNumber(link.clickLimit)}</span>` : `<span class="table-muted">no cap</span>`}</td><td>${statusBadge(status)}${link.expiresAt ? `<span class="table-muted">${escapeHTML(formatDate(link.expiresAt))}</span>` : ""}</td><td><div class="table-actions"><button class="action-button" data-action="copy-link" data-id="${escapeHTML(link.id)}" aria-label="Copy ${escapeHTML(link.alias)}" title="Copy link">⧉</button><button class="action-button" data-action="view-link" data-id="${escapeHTML(link.id)}" aria-label="View ${escapeHTML(link.alias)}" title="View details">⌕</button><button class="action-button" data-action="edit-link" data-id="${escapeHTML(link.id)}" aria-label="Edit ${escapeHTML(link.alias)}" title="Edit link">✎</button><button class="action-button" data-action="qr-link" data-id="${escapeHTML(link.id)}" aria-label="QR code for ${escapeHTML(link.alias)}" title="QR code">▦</button><button class="action-button" data-action="toggle-link" data-id="${escapeHTML(link.id)}" aria-label="${link.disabled ? "Enable" : "Disable"} ${escapeHTML(link.alias)}" title="${link.disabled ? "Enable" : "Disable"}">${link.disabled ? "▶" : "Ⅱ"}</button><button class="action-button danger" data-action="delete-link" data-id="${escapeHTML(link.id)}" aria-label="Delete ${escapeHTML(link.alias)}" title="Delete">×</button></div></td></tr>`;
    }).join("")}</tbody></table></div><div class="table-footer"><span>Showing ${formatNumber(links.length)} of ${formatNumber(database.links.length)} links</span><span>Click counts persist in this browser</span></div>`;
  }

  function renderCampaignsPage(database) {
    const actions = `<button class="button button-primary" data-action="create-campaign">＋ New campaign</button>`;
    const cards = database.campaigns.map((campaign) => {
      const links = database.links.filter((link) => link.campaignId === campaign.id);
      const active = links.filter((link) => getLinkStatus(link, database) === "Active").length;
      const clicks = linkClicksForCampaign(campaign.id, database);
      return `<article class="panel campaign-card"><div class="campaign-card-top"><span class="campaign-symbol" aria-hidden="true">▤</span><div class="campaign-action-row"><button class="action-button" data-action="edit-campaign" data-id="${escapeHTML(campaign.id)}" aria-label="Edit ${escapeHTML(campaign.name)}" title="Edit campaign">✎</button><button class="action-button danger" data-action="delete-campaign" data-id="${escapeHTML(campaign.id)}" aria-label="Delete ${escapeHTML(campaign.name)}" title="Delete campaign">×</button></div></div><h3 style="margin-top:15px">${escapeHTML(campaign.name)}</h3><p class="campaign-description">${escapeHTML(campaign.description || "No description added yet.")}</p><div class="campaign-stats"><div class="campaign-stat"><strong>${formatNumber(links.length)}</strong><span>Links</span></div><div class="campaign-stat"><strong>${formatNumber(clicks)}</strong><span>Clicks</span></div><div class="campaign-stat"><strong>${formatNumber(active)}</strong><span>Active</span></div></div><div class="campaign-card-footer"><span style="color:#9aa6ae;font-size:10px">Created ${escapeHTML(formatDate(campaign.createdAt))}</span><button class="text-link" data-action="campaign-analytics" data-id="${escapeHTML(campaign.id)}">View analytics →</button></div></article>`;
    }).join("");
    return `${renderViewHeading("Organize & measure", "Campaigns", "Bring related links together and compare performance without fixed or placeholder metrics.", actions)}
      ${database.campaigns.length ? `<div class="campaign-grid">${cards}</div>` : `<section class="panel"><div class="table-empty"><div class="empty-illustration" aria-hidden="true">▤</div><h3>Create your first campaign</h3><p>Campaigns keep related links organized and let you compare their recorded click performance.</p><button class="button button-primary" data-action="create-campaign">＋ Create a campaign</button></div></section>`}`;
  }

  function getAnalyticsEvents(database, range, campaignId) {
    const now = Date.now();
    let cutoff = 0;
    if (range === "7d") cutoff = now - 7 * 86400000;
    if (range === "30d") cutoff = now - 30 * 86400000;
    return database.clicks.filter((event) => {
      const timestamp = new Date(event.timestamp).getTime();
      if (!Number.isFinite(timestamp)) return false;
      if (cutoff && timestamp < cutoff) return false;
      if (campaignId !== "all" && event.campaignId !== campaignId) return false;
      return true;
    });
  }

  function renderAnalyticsPage(database) {
    const events = getAnalyticsEvents(database, selectedAnalyticsRange, selectedAnalyticsCampaign);
    const distinctLinks = new Set(events.map((event) => event.linkId)).size;
    const campaignOptions = database.campaigns.map((campaign) => `<option value="${escapeHTML(campaign.id)}" ${selectedAnalyticsCampaign === campaign.id ? "selected" : ""}>${escapeHTML(campaign.name)}</option>`).join("");
    const rangeLabel = selectedAnalyticsRange === "7d" ? "last 7 days" : selectedAnalyticsRange === "30d" ? "last 30 days" : "all retained events";
    const activeCampaign = selectedAnalyticsCampaign === "all" ? "All campaigns" : campaignName(selectedAnalyticsCampaign, database);
    const clickCountsByLink = new Map();
    events.forEach((event) => clickCountsByLink.set(event.linkId, (clickCountsByLink.get(event.linkId) || 0) + 1));
    const topLinks = [...clickCountsByLink.entries()].map(([id, clicks]) => ({ link: database.links.find((link) => link.id === id), clicks }))
      .filter((item) => item.link).sort((a, b) => b.clicks - a.clicks).slice(0, 5);
    const referrerCounts = new Map();
    events.forEach((event) => {
      let label = "Direct / unavailable";
      try { if (event.referrer) label = new URL(event.referrer).hostname; } catch { /* keep generic bucket */ }
      referrerCounts.set(label, (referrerCounts.get(label) || 0) + 1);
    });
    const sourceData = [...referrerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const totalSources = sourceData.reduce((sum, item) => sum + item[1], 0);
    const firstShare = totalSources ? sourceData[0][1] / totalSources : 0;
    const deviceCounts = new Map();
    events.forEach((event) => {
      const label = event.device || "Unknown";
      deviceCounts.set(label, (deviceCounts.get(label) || 0) + 1);
    });
    const deviceData = [...deviceCounts.entries()].sort((a, b) => b[1] - a[1]);

    return `${renderViewHeading("Understand your reach", "Analytics", "Explore successful click events collected by this browser. No visitors or locations are fabricated.", `<div class="analytics-filter"><select id="analytics-range" class="select-input" aria-label="Analytics date range"><option value="7d" ${selectedAnalyticsRange === "7d" ? "selected" : ""}>Last 7 days</option><option value="30d" ${selectedAnalyticsRange === "30d" ? "selected" : ""}>Last 30 days</option><option value="all" ${selectedAnalyticsRange === "all" ? "selected" : ""}>All retained events</option></select><select id="analytics-campaign" class="select-input" aria-label="Analytics campaign"><option value="all">All campaigns</option>${campaignOptions}</select></div>`)}
      <div class="notice" style="margin-bottom:18px"><span aria-hidden="true">ⓘ</span><div>Currently showing <strong>${escapeHTML(rangeLabel)}</strong> for <strong>${escapeHTML(activeCampaign)}</strong>. Event storage keeps the most recent ${formatNumber(MAX_CLICK_EVENTS)} click events; lifetime link counts are shown separately on the Links page.</div></div>
      <section class="stats-grid" aria-label="Filtered analytics summary">
        ${renderStatCard("Successful clicks", formatNumber(events.length), `Within ${rangeLabel}`, "⌁", "")}
        ${renderStatCard("Links receiving clicks", formatNumber(distinctLinks), "Distinct links in this range", "↗", "blue")}
        ${renderStatCard("Campaigns represented", formatNumber(new Set(events.map((event) => event.campaignId).filter(Boolean)).size), "With successful clicks", "▤", "purple")}
        ${renderStatCard("Top source share", totalSources ? `${Math.round(firstShare * 100)}%` : "—", sourceData.length ? sourceData[0][0] : "No referrer data", "⌖", "amber")}
      </section>
      <section class="analytics-grid"><article class="panel"><div class="panel-header"><div><h2>Daily click activity</h2><p class="panel-subtitle">Event timestamps grouped by day</p></div><span class="chart-legend"><i class="legend-dot"></i> Clicks</span></div>${buildActivityChart(events, selectedAnalyticsRange, "Daily click activity for the selected range")}</article>
        <article class="panel"><div class="panel-header"><div><h2>Top-performing links</h2><p class="panel-subtitle">Based on events inside this range</p></div></div><div class="panel-body"><div class="top-link-list">${topLinks.length ? topLinks.map(({ link, clicks }) => `<div class="top-link-item"><span class="link-favicon" aria-hidden="true">↗</span><div class="top-link-copy"><strong>${escapeHTML(link.title || link.alias)}</strong><span>${escapeHTML(link.alias)}</span></div><div class="top-link-clicks">${formatNumber(clicks)}<small>clicks</small></div></div>`).join("") : `<div class="chart-empty"><div><strong>No click events in this range</strong>Open an active short link to record a successful click.</div></div>`}</div></div></article>
      </section>
      <section class="analytics-grid"><article class="panel"><div class="panel-header"><div><h2>Referrer breakdown</h2><p class="panel-subtitle">Based on available document referrer values</p></div></div><div class="panel-body">${renderBreakdownList(sourceData, totalSources, "No referrer information available yet")}</div></article>
        <article class="panel"><div class="panel-header"><div><h2>Device categories</h2><p class="panel-subtitle">A simple user-agent category, not identity tracking</p></div></div><div class="panel-body">${renderBreakdownList(deviceData, events.length, "No device information available yet")}</div></article></section>`;
  }

  function renderBreakdownList(items, total, emptyMessage) {
    if (!items.length) return `<div class="chart-empty"><div><strong>No data yet</strong>${escapeHTML(emptyMessage)}</div></div>`;
    return `<div class="bar-list">${items.map(([label, count], index) => `<div class="bar-list-row"><div class="bar-list-label"><span>${escapeHTML(label)}</span><strong>${formatNumber(count)} · ${total ? Math.round(count / total * 100) : 0}%</strong></div><div class="progress-track"><div class="progress-bar" style="width:${total ? count / total * 100 : 0}%;opacity:${Math.max(.48, 1 - index * .11)}"></div></div></div>`).join("")}</div>`;
  }

  function buildActivityChart(events, range, accessibleLabel) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let buckets = [];
    if (range === "all") {
      const monthCursor = new Date(today.getFullYear(), today.getMonth() - 5, 1);
      buckets = Array.from({ length: 6 }, (_, index) => {
        const date = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + index, 1);
        return { key: `${date.getFullYear()}-${date.getMonth()}`, date, label: date.toLocaleDateString(undefined, { month: "short" }), count: 0, title: date.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
      });
    } else {
      const days = range === "30d" ? 30 : 7;
      buckets = Array.from({ length: days }, (_, index) => {
        const date = new Date(today);
        date.setDate(today.getDate() - (days - index - 1));
        return { key: date.toDateString(), date, label: range === "7d" ? date.toLocaleDateString(undefined, { weekday: "short" }) : (index % 5 === 0 || index === days - 1 ? date.getDate().toString() : ""), count: 0, title: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) };
      });
    }
    const bucketIndex = new Map(buckets.map((bucket, index) => [bucket.key, index]));
    events.forEach((event) => {
      const date = new Date(event.timestamp);
      if (Number.isNaN(date.getTime())) return;
      const key = range === "all" ? `${date.getFullYear()}-${date.getMonth()}` : new Date(date.getFullYear(), date.getMonth(), date.getDate()).toDateString();
      const index = bucketIndex.get(key);
      if (index !== undefined) buckets[index].count += 1;
    });

    const hasClicks = buckets.some((bucket) => bucket.count > 0);
    if (!hasClicks) return `<div class="chart-empty"><div><strong>No click activity yet</strong>Once someone opens an active short link, click activity will appear here.</div></div>`;

    const width = 650;
    const height = 200;
    const left = 24;
    const right = 12;
    const top = 12;
    const bottom = 29;
    const plotHeight = height - top - bottom;
    const plotWidth = width - left - right;
    const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
    const gap = buckets.length > 14 ? 5 : 13;
    const barWidth = Math.max(3, (plotWidth - gap * (buckets.length - 1)) / buckets.length);
    const grid = [0, .5, 1].map((fraction) => {
      const y = top + plotHeight * fraction;
      return `<line class="chart-grid-line" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"/><text class="chart-label" x="${left - 7}" y="${y + 3}" text-anchor="end">${Math.round(max * (1 - fraction))}</text>`;
    }).join("");
    const bars = buckets.map((bucket, index) => {
      const barHeight = bucket.count ? Math.max(3, bucket.count / max * (plotHeight - 3)) : 0;
      const x = left + index * (barWidth + gap);
      const y = top + plotHeight - barHeight;
      const isToday = range !== "all" && bucket.date.toDateString() === today.toDateString();
      const label = bucket.label ? `<text class="chart-label" x="${x + barWidth / 2}" y="${height - 8}" text-anchor="middle">${escapeHTML(bucket.label)}</text>` : "";
      return `<g><title>${escapeHTML(bucket.title)}: ${bucket.count} clicks</title><rect class="chart-bar ${isToday ? "today" : ""}" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="${Math.min(4, barWidth / 2)}"/>${label}</g>`;
    }).join("");
    return `<div class="chart-area"><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(accessibleLabel)}">${grid}${bars}</svg></div>`;
  }

  function renderSafetyPage(database) {
    const actions = `<button class="button button-primary" data-action="add-blocked-domain">＋ Block a domain</button>`;
    const blockedRows = database.blocklist.map((entry) => `<tr><td><span class="table-title">${escapeHTML(entry.domain)}</span><span class="table-muted">${escapeHTML(entry.reason || "No reason supplied")}</span></td><td>${escapeHTML(formatDate(entry.createdAt, true))}</td><td><button class="action-button danger" data-action="remove-blocked-domain" data-id="${escapeHTML(entry.id)}" aria-label="Remove ${escapeHTML(entry.domain)} from blocklist">× Remove</button></td></tr>`).join("");
    const restrictedLinks = database.links.filter((link) => ["Disabled", "Expired", "Click limit reached", "Blocked"].includes(getLinkStatus(link, database)));
    return `${renderViewHeading("Control center", "Safety & administration", "Apply demo safety rules, review link status, and immediately stop permitted redirects.", actions)}
      <div class="notice warning" style="margin-bottom:18px"><span aria-hidden="true">⚠</span><div><strong>Prototype limitation:</strong> these controls are stored in this browser, not enforced by a trusted server. They demonstrate the workflow, but they are not secure production administration or global rate limiting.</div></div>
      <section class="dashboard-grid"><article class="panel"><div class="panel-header"><div><h2>Domain blocklist</h2><p class="panel-subtitle">Blocked hosts and their subdomains cannot be created or redirected</p></div><span class="status-pill status-disabled">${formatNumber(database.blocklist.length)} domains</span></div>
        ${database.blocklist.length ? `<div class="table-wrap"><table><thead><tr><th>Blocked host</th><th>Added</th><th>Action</th></tr></thead><tbody>${blockedRows}</tbody></table></div>` : `<div class="table-empty"><div class="empty-illustration" aria-hidden="true">⛨</div><h3>No blocked domains</h3><p>Add a host to block it for new links and existing links that point to that host.</p><button class="button button-secondary" data-action="add-blocked-domain">Add a domain</button></div>`}</article>
        <article class="panel"><div class="panel-header"><div><h2>Safety checks</h2><p class="panel-subtitle">Applied before a demo redirect is allowed</p></div></div><div class="panel-body"><div class="activity-list">
          <div class="activity-item"><span class="activity-icon">✓</span><div class="activity-copy"><p><strong>Protocol validation</strong></p><time>HTTP and HTTPS only; unsafe URL schemes rejected.</time></div></div>
          <div class="activity-item"><span class="activity-icon">✓</span><div class="activity-copy"><p><strong>Lifecycle validation</strong></p><time>Disabled, expired, and capped links do not redirect.</time></div></div>
          <div class="activity-item"><span class="activity-icon">✓</span><div class="activity-copy"><p><strong>Current blocklist</strong></p><time>Destination host checked again at redirect time.</time></div></div>
          <div class="activity-item"><span class="activity-icon warn">!</span><div class="activity-copy"><p><strong>Browser-only enforcement</strong></p><time>Users can edit localStorage or client-side JavaScript.</time></div></div>
        </div></div></article></section>
      <section class="panel" style="margin-top:18px"><div class="panel-header"><div><h2>Links requiring attention</h2><p class="panel-subtitle">Disable or re-enable links and verify their current state</p></div><span class="status-pill status-expired">${formatNumber(restrictedLinks.length)} restricted</span></div>
        ${restrictedLinks.length ? `<div class="table-wrap"><table><thead><tr><th>Link</th><th>Destination</th><th>Status</th><th>Clicks</th><th>Action</th></tr></thead><tbody>${restrictedLinks.map((link) => `<tr><td><span class="table-title">${escapeHTML(link.title || link.alias)}</span><span class="table-muted">/${escapeHTML(link.alias)}</span></td><td><span class="table-muted">${escapeHTML(shorten(link.destination, 52))}</span></td><td>${statusBadge(getLinkStatus(link, database))}</td><td>${formatNumber(link.clickCount)}</td><td><div class="table-actions"><button class="action-button" data-action="view-link" data-id="${escapeHTML(link.id)}">Details</button><button class="action-button" data-action="toggle-link" data-id="${escapeHTML(link.id)}">${link.disabled ? "Enable" : "Disable"}</button></div></td></tr>`).join("")}</tbody></table></div>` : `<div class="chart-empty"><div><strong>Everything is clear</strong>No links are currently disabled, expired, capped, or blocked.</div></div>`}</section>`;
  }

  function renderSettingsPage(database) {
    const demoCount = database.links.filter((link) => link.demoData).length;
    return `${renderViewHeading("Workspace preferences", "Settings", "Manage browser data and learn how to run the LinkPulse prototype.")}
      <div class="settings-layout"><section class="panel"><div class="settings-section"><h2>Data &amp; demonstration</h2><p class="panel-subtitle">Your records are saved to this browser only.</p></div>
        <div class="settings-section"><div class="settings-row"><div><strong>Sample data</strong><p>Add clearly labelled example campaigns, links, click events, and activity so the dashboard is ready for a hackathon presentation. Existing non-demo records are preserved.</p></div><button class="button button-secondary button-small" data-action="load-demo">Load demo data</button></div>
          <div class="settings-row"><div><strong>Remove demo records</strong><p>Delete the seeded demo links and campaigns and their click history. Your own links and campaigns remain.</p></div><button class="button button-secondary button-small" data-action="reset-demo" ${demoCount ? "" : "disabled"}>Remove demo data (${demoCount})</button></div>
          <div class="settings-row"><div><strong>Export links</strong><p>Download the current link definitions in a CSV file. Password gate values are intentionally excluded.</p></div><button class="button button-secondary button-small" data-action="export-csv" ${database.links.length ? "" : "disabled"}>Export CSV</button></div>
          <div class="settings-row"><div><strong>Clear all local data</strong><p>Remove links, campaigns, click events, activity, and the domain blocklist from this browser. This cannot be undone.</p></div><button class="button button-danger button-small" data-action="clear-all" ${database.links.length || database.campaigns.length || database.blocklist.length ? "" : "disabled"}>Clear workspace</button></div>
        </div><div class="settings-section"><h2>Data footprint</h2><div class="settings-row" style="margin-top:15px"><div><strong>Saved records</strong><p>Links, campaigns, blocked domains, and activity items stored in localStorage.</p></div><strong>${formatNumber(database.links.length + database.campaigns.length + database.blocklist.length + database.activity.length)}</strong></div><div class="settings-row"><div><strong>Retained click events</strong><p>Only the most recent ${formatNumber(MAX_CLICK_EVENTS)} events are kept to avoid unbounded storage growth.</p></div><strong>${formatNumber(database.clicks.length)} / ${formatNumber(MAX_CLICK_EVENTS)}</strong></div></div>
      </section><aside class="panel"><div class="settings-section"><h2>About this build</h2><p class="panel-subtitle">LinkPulse · YUKTI-x hackathon MVP</p><div class="notice" style="margin-top:17px"><span aria-hidden="true">ⓘ</span><div><strong>Static-first application</strong><br>Built using HTML, CSS, and vanilla JavaScript. No framework or install step is required.</div></div></div>
        <div class="settings-section"><h3>How short links work</h3><p class="panel-subtitle" style="margin-top:8px;line-height:1.7">Links use a static-hosting-compatible format such as <span class="code-chip">?go=abc123</span>. The client loads the alias, checks the saved rules, records the event, then navigates to the destination.</p></div>
        <div class="settings-section"><h3>Security note</h3><p class="panel-subtitle" style="margin-top:8px;line-height:1.7">LocalStorage is not a secure database. Password gates, admin actions, click caps, and persistence work only as a demonstration in this browser. Production use needs a trusted backend.</p></div>
      </aside></div>`;
  }

  function linkFormMarkup(database, link = null) {
    const editing = Boolean(link);
    const campaignOptions = database.campaigns.map((campaign) => `<option value="${escapeHTML(campaign.id)}" ${link && link.campaignId === campaign.id ? "selected" : ""}>${escapeHTML(campaign.name)}</option>`).join("");
    const dateValue = link?.expiresAt ? toLocalDateTimeInput(link.expiresAt) : "";
    return `<div class="modal-head"><div><span class="eyebrow">${editing ? "Update destination" : "Build a new route"}</span><h2 id="modal-title">${editing ? "Edit link" : "Create a short link"}</h2><p>${editing ? "Change link details while preserving its click history." : "Add the destination and choose how the link should behave."}</p></div><button class="modal-x" data-close-modal aria-label="Close">×</button></div>
      <div class="modal-body"><form class="modal-form" id="link-form" novalidate data-edit-id="${editing ? escapeHTML(link.id) : ""}">
        <div class="form-grid">
          <div class="field full"><label for="link-destination">Destination URL <span aria-hidden="true">*</span></label><input class="text-input" id="link-destination" name="destination" type="url" placeholder="https://example.com/your-page" required value="${escapeHTML(link?.destination || "")}"><span class="field-hint">Only HTTP and HTTPS URLs are accepted.</span><span class="field-error" id="error-destination"></span></div>
          <div class="field"><label for="link-title">Link title <span aria-hidden="true">*</span></label><input class="text-input" id="link-title" name="title" type="text" maxlength="100" placeholder="Summer campaign landing page" required value="${escapeHTML(link?.title || "")}"><span class="field-error" id="error-title"></span></div>
          <div class="field"><label for="link-alias">Custom alias <span class="optional">(optional)</span></label><input class="text-input" id="link-alias" name="alias" type="text" maxlength="40" placeholder="summer-launch" value="${escapeHTML(link?.alias || "")}"><span class="field-hint">Leave blank to generate a unique alias. 3–40 letters, numbers, - or _.</span><span class="field-error" id="error-alias"></span></div>
          <div class="field"><label for="link-campaign">Campaign <span class="optional">(optional)</span></label><select class="select-input" id="link-campaign" name="campaignId" style="width:100%"><option value="">Unassigned</option>${campaignOptions}</select><span class="field-hint">${database.campaigns.length ? "Group this link with related routes." : "You can create a campaign from the Campaigns page."}</span></div>
          <div class="field"><label for="link-tags">Tags <span class="optional">(optional)</span></label><input class="text-input" id="link-tags" name="tags" type="text" placeholder="social, spring, email" value="${escapeHTML((link?.tags || []).join(", "))}"><span class="field-hint">Separate tags with commas.</span></div>
          <div class="form-divider">ADVANCED RULES</div>
          <div class="field"><label for="link-expiry">Expiry date &amp; time <span class="optional">(optional)</span></label><input class="text-input" id="link-expiry" name="expiresAt" type="datetime-local" value="${escapeHTML(dateValue)}"><span class="field-hint">Use your local time. Expired links will not redirect.</span><span class="field-error" id="error-expiry"></span></div>
          <div class="field"><label for="link-click-limit">Maximum clicks <span class="optional">(optional)</span></label><input class="text-input" id="link-click-limit" name="clickLimit" type="number" min="1" step="1" inputmode="numeric" placeholder="No limit" value="${escapeHTML(link?.clickLimit ?? "")}"><span class="field-hint">Only successful permitted redirects count.</span><span class="field-error" id="error-click-limit"></span></div>
          <div class="field full"><label for="link-password">Demo password gate <span class="optional">(optional)</span></label><input class="text-input" id="link-password" name="password" type="password" autocomplete="new-password" placeholder="${editing && link.password ? "Leave blank to keep current demo password" : "Set a demo-only password"}"><span class="field-hint">For demonstration only. This password is stored in browser data and is not secure. Never enter a real password.</span>${editing && link.password ? `<label class="checkbox-row"><input type="checkbox" id="link-remove-password"> Remove the existing password gate</label>` : ""}</div>
        </div>
        <div class="modal-actions"><button class="button button-secondary" type="button" data-close-modal>Cancel</button><button class="button button-primary" type="submit">${editing ? "Save changes" : "Create short link"}</button></div>
      </form></div>`;
  }

  function toLocalDateTimeInput(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function openLinkModal(linkId = null) {
    const database = loadDatabase();
    const link = linkId ? database.links.find((item) => item.id === linkId) : null;
    if (linkId && !link) { showToast("That link no longer exists.", "error"); renderCurrentView(); return; }
    openModal(linkFormMarkup(database, link));
    document.getElementById("link-form")?.addEventListener("submit", handleLinkFormSubmit);
  }

  function setFieldError(field, message) {
    const errorElement = document.getElementById(`error-${field}`);
    if (errorElement) errorElement.textContent = message;
  }

  function clearLinkFieldErrors() {
    ["destination", "title", "alias", "expiry", "click-limit"].forEach((field) => setFieldError(field, ""));
  }

  function handleLinkFormSubmit(event) {
    event.preventDefault();
    clearLinkFieldErrors();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const existingId = form.dataset.editId || null;
    const database = loadDatabase();
    const existing = existingId ? database.links.find((link) => link.id === existingId) : null;
    const title = String(formData.get("title") || "").trim();
    const destination = normalizeDestination(formData.get("destination"));
    let alias = String(formData.get("alias") || "").trim();
    const campaignId = String(formData.get("campaignId") || "");
    const tags = [...new Set(String(formData.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
    const expiryInput = String(formData.get("expiresAt") || "").trim();
    const clickLimitInput = String(formData.get("clickLimit") || "").trim();
    const passwordInput = String(formData.get("password") || "");
    const removePassword = document.getElementById("link-remove-password")?.checked || false;
    let hasError = false;

    if (!destination.ok) { setFieldError("destination", destination.message); hasError = true; }
    else if (isDomainBlocked(destination.value, database)) { setFieldError("destination", "This destination host is currently on the blocklist."); hasError = true; }
    if (!title) { setFieldError("title", "Enter a title so you can identify this link later."); hasError = true; }

    if (!alias && existing) alias = existing.alias;
    if (!alias && !existing) alias = generateAlias(database);
    if (alias) {
      const aliasMessage = aliasError(alias, database, existingId);
      if (aliasMessage) { setFieldError("alias", aliasMessage); hasError = true; }
    }

    let expiresAt = null;
    if (expiryInput) {
      const parsedExpiry = new Date(expiryInput);
      if (Number.isNaN(parsedExpiry.getTime())) {
        setFieldError("expiry", "Enter a valid date and time."); hasError = true;
      } else if (!existing && parsedExpiry.getTime() <= Date.now()) {
        setFieldError("expiry", "Choose a future expiry date and time."); hasError = true;
      } else {
        expiresAt = parsedExpiry.toISOString();
      }
    }

    let clickLimit = null;
    if (clickLimitInput) {
      const parsedLimit = Number(clickLimitInput);
      if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
        setFieldError("click-limit", "Enter a positive whole number, or leave this empty for no limit."); hasError = true;
      } else clickLimit = parsedLimit;
    }
    const validCampaign = campaignId && database.campaigns.some((campaign) => campaign.id === campaignId) ? campaignId : null;
    if (hasError) return;

    const now = new Date().toISOString();
    let password = existing ? existing.password || null : null;
    if (removePassword) password = null;
    else if (passwordInput.trim()) password = passwordInput;
    const link = {
      ...(existing || {}),
      id: existing ? existing.id : createId("link"),
      alias,
      destination: destination.value,
      title,
      campaignId: validCampaign,
      tags,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      expiresAt,
      clickLimit,
      clickCount: existing ? Number(existing.clickCount || 0) : 0,
      disabled: existing ? Boolean(existing.disabled) : false,
      password: password || null,
      demoData: existing ? Boolean(existing.demoData) : false
    };

    if (existing) {
      const index = database.links.findIndex((item) => item.id === existing.id);
      database.links[index] = link;
      addActivity(database, "edit", "Link updated", `/${link.alias}`);
    } else {
      database.links.unshift(link);
      addActivity(database, "create", "New short link created", `/${link.alias}`);
    }
    if (!saveDatabase(database)) return;
    closeModal();
    renderCurrentView();
    showToast(existing ? "Link changes saved." : "Short link created.");
    if (!existing) openCreatedLinkModal(link);
  }

  function openCreatedLinkModal(link) {
    const shortURL = makeShortURL(link.alias);
    openModal(`<div class="modal-head"><div><span class="eyebrow">Route created</span><h2 id="modal-title">Your short link is ready</h2><p>Copy it, test the redirect, or generate a QR code.</p></div><button class="modal-x" data-close-modal aria-label="Close">×</button></div><div class="modal-body"><div class="notice" style="margin-bottom:18px"><span aria-hidden="true">✓</span><div><strong>${escapeHTML(link.title)}</strong><br>The alias <span class="code-chip">${escapeHTML(link.alias)}</span> is saved in this browser.</div></div><div class="field"><label for="created-short-url">Short URL</label><div class="copy-field"><input id="created-short-url" class="text-input" value="${escapeHTML(shortURL)}" readonly><button class="button button-secondary" id="copy-created-link">Copy</button></div></div><div class="modal-actions" style="margin-top:18px"><button class="button button-secondary" data-action="qr-link" data-id="${escapeHTML(link.id)}">Show QR code</button><button class="button button-secondary" data-action="test-link" data-id="${escapeHTML(link.id)}">Test redirect ↗</button><button class="button button-primary" data-close-modal>Done</button></div></div>`);
    document.getElementById("copy-created-link")?.addEventListener("click", () => copyText(shortURL));
  }

  function openCampaignModal(campaignId = null) {
    const database = loadDatabase();
    const campaign = campaignId ? database.campaigns.find((item) => item.id === campaignId) : null;
    if (campaignId && !campaign) { showToast("That campaign no longer exists.", "error"); renderCurrentView(); return; }
    openModal(`<div class="modal-head"><div><span class="eyebrow">Campaign management</span><h2 id="modal-title">${campaign ? "Edit campaign" : "Create a campaign"}</h2><p>Group related links so their performance is easier to understand.</p></div><button class="modal-x" data-close-modal aria-label="Close">×</button></div><div class="modal-body"><form class="modal-form" id="campaign-form" data-edit-id="${campaign ? escapeHTML(campaign.id) : ""}" novalidate><div class="field"><label for="campaign-name">Campaign name *</label><input class="text-input" id="campaign-name" name="name" maxlength="80" required placeholder="e.g. Campus Launch" value="${escapeHTML(campaign?.name || "")}"><span class="field-error" id="campaign-name-error"></span></div><div class="field"><label for="campaign-description">Description <span class="optional">(optional)</span></label><textarea class="text-area" id="campaign-description" name="description" maxlength="300" placeholder="What is this campaign for?">${escapeHTML(campaign?.description || "")}</textarea></div><div class="modal-actions"><button class="button button-secondary" type="button" data-close-modal>Cancel</button><button class="button button-primary" type="submit">${campaign ? "Save campaign" : "Create campaign"}</button></div></form></div>`);
    document.getElementById("campaign-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = document.getElementById("campaign-name").value.trim();
      const description = document.getElementById("campaign-description").value.trim();
      const existingId = event.currentTarget.dataset.editId || null;
      const currentDB = loadDatabase();
      const errorElement = document.getElementById("campaign-name-error");
      errorElement.textContent = "";
      if (!name) { errorElement.textContent = "Enter a campaign name."; return; }
      const duplicate = currentDB.campaigns.some((item) => item.id !== existingId && item.name.trim().toLowerCase() === name.toLowerCase());
      if (duplicate) { errorElement.textContent = "A campaign with this name already exists."; return; }
      const existingCampaign = existingId ? currentDB.campaigns.find((item) => item.id === existingId) : null;
      const campaignRecord = { ...(existingCampaign || {}), id: existingId || createId("campaign"), name, description, createdAt: existingCampaign?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), demoData: existingCampaign ? Boolean(existingCampaign.demoData) : false };
      if (existingCampaign) {
        currentDB.campaigns[currentDB.campaigns.findIndex((item) => item.id === existingId)] = campaignRecord;
        addActivity(currentDB, "campaign", "Campaign updated", name);
      } else {
        currentDB.campaigns.unshift(campaignRecord);
        addActivity(currentDB, "campaign", "Campaign created", name);
      }
      if (!saveDatabase(currentDB)) return;
      closeModal();
      renderCurrentView();
      showToast(existingCampaign ? "Campaign updated." : "Campaign created.");
    });
  }

  function showLinkDetails(linkId) {
    const database = loadDatabase();
    const link = database.links.find((item) => item.id === linkId);
    if (!link) { showToast("That link no longer exists.", "error"); renderCurrentView(); return; }
    const status = getLinkStatus(link, database);
    const events = database.clicks.filter((event) => event.linkId === link.id).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 4);
    const shortURL = makeShortURL(link.alias);
    openModal(`<div class="modal-head"><div><span class="eyebrow">Link details</span><h2 id="modal-title">${escapeHTML(link.title || link.alias)}</h2><p>${escapeHTML(shorten(link.destination, 74))}</p></div><button class="modal-x" data-close-modal aria-label="Close">×</button></div><div class="modal-body"><div class="field" style="margin-bottom:16px"><label>Short URL</label><div class="copy-field"><input class="text-input" id="details-short-url" value="${escapeHTML(shortURL)}" readonly><button class="button button-secondary" id="copy-details-link">Copy</button></div></div><div class="detail-grid"><div class="detail-item"><span>Status</span><strong>${statusBadge(status)}</strong></div><div class="detail-item"><span>Recorded clicks</span><strong>${formatNumber(link.clickCount)}${link.clickLimit ? ` / ${formatNumber(link.clickLimit)}` : ""}</strong></div><div class="detail-item"><span>Alias</span><strong>${escapeHTML(link.alias)}</strong></div><div class="detail-item"><span>Campaign</span><strong>${escapeHTML(campaignName(link.campaignId, database))}</strong></div><div class="detail-item"><span>Created</span><strong>${escapeHTML(formatDate(link.createdAt, true))}</strong></div><div class="detail-item"><span>Expiry</span><strong>${escapeHTML(formatDate(link.expiresAt, true))}</strong></div><div class="detail-item wide"><span>Destination</span><strong>${escapeHTML(link.destination)}</strong></div><div class="detail-item wide"><span>Tags</span><strong>${escapeHTML(link.tags?.length ? link.tags.join(", ") : "No tags")}</strong></div><div class="detail-item wide"><span>Recent click events</span><strong>${events.length ? events.map((event) => `${escapeHTML(formatDate(event.timestamp, true))} · ${escapeHTML(event.device || "Unknown device")}`).join("<br>") : "No click events recorded"}</strong></div></div><div class="modal-actions" style="margin-top:18px"><button class="button button-secondary" data-action="qr-link" data-id="${escapeHTML(link.id)}">QR code</button><button class="button button-secondary" data-action="edit-link" data-id="${escapeHTML(link.id)}">Edit link</button><button class="button button-primary" data-action="test-link" data-id="${escapeHTML(link.id)}">Test redirect ↗</button></div></div>`);
    document.getElementById("copy-details-link")?.addEventListener("click", () => copyText(shortURL));
  }

  function openQRCode(linkId) {
    const database = loadDatabase();
    const link = database.links.find((item) => item.id === linkId);
    if (!link) { showToast("That link no longer exists.", "error"); return; }
    const shortURL = makeShortURL(link.alias);
    openModal(`<div class="modal-head"><div><span class="eyebrow">Scan to open</span><h2 id="modal-title">QR code for ${escapeHTML(link.alias)}</h2><p>The QR code encodes this link's short URL, not the destination URL.</p></div><button class="modal-x" data-close-modal aria-label="Close">×</button></div><div class="modal-body"><div class="qr-stage"><div id="qr-code" aria-label="Generated QR code"></div><p id="qr-status" class="field-hint" style="margin:12px 0 0;text-align:center">Preparing QR code…</p></div><div class="field" style="margin-top:18px"><label>Encoded short URL</label><div class="copy-field"><input class="text-input" id="qr-short-url" readonly value="${escapeHTML(shortURL)}"><button class="button button-secondary" id="copy-qr-link">Copy</button></div></div><div class="modal-actions" style="margin-top:16px"><button class="button button-secondary" data-close-modal>Close</button><button class="button button-primary" id="download-qr" disabled>Download PNG</button></div></div>`);
    document.getElementById("copy-qr-link")?.addEventListener("click", () => copyText(shortURL));
    const qrContainer = document.getElementById("qr-code");
    const qrStatus = document.getElementById("qr-status");
    if (typeof window.QRCode !== "function") {
      qrStatus.textContent = "QR generation library did not load. Check your internet connection and reopen this dialog.";
      qrContainer.innerHTML = "<span class='field-hint'>QR unavailable</span>";
      return;
    }
    try {
      qrContainer.innerHTML = "";
      new window.QRCode(qrContainer, { text: shortURL, width: 220, height: 220, colorDark: "#102638", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.H });
      qrStatus.textContent = "Generated for the short URL shown below.";
      const downloadButton = document.getElementById("download-qr");
      downloadButton.disabled = false;
      downloadButton.addEventListener("click", () => downloadQRCode(qrContainer, link.alias));
    } catch (error) {
      console.error("QR code generation failed.", error);
      qrStatus.textContent = "QR generation failed. The rest of LinkPulse is still available.";
    }
  }

  function downloadQRCode(container, alias) {
    const canvas = container.querySelector("canvas");
    const image = container.querySelector("img");
    let dataURL = "";
    try {
      if (canvas) dataURL = canvas.toDataURL("image/png");
      else if (image && image.src.startsWith("data:image/")) dataURL = image.src;
      else throw new Error("No downloadable QR image was created.");
      const anchor = document.createElement("a");
      anchor.href = dataURL;
      anchor.download = `linkpulse-${alias}-qr.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      showToast("QR code download started.");
    } catch (error) {
      console.error("Could not download QR code.", error);
      showToast("The QR image could not be downloaded. Try reopening the QR dialog.", "error");
    }
  }

  function toggleLink(linkId) {
    const database = loadDatabase();
    const link = database.links.find((item) => item.id === linkId);
    if (!link) { showToast("That link no longer exists.", "error"); renderCurrentView(); return; }
    if (link.disabled) {
      if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) {
        showToast("This link is expired. Update its expiry before re-enabling it.", "warning");
        openLinkModal(link.id);
        return;
      }
      if (link.clickLimit && Number(link.clickCount || 0) >= Number(link.clickLimit)) {
        showToast("The click limit has already been reached. Increase the cap before re-enabling this link.", "warning");
        openLinkModal(link.id);
        return;
      }
      if (isDomainBlocked(link.destination, database)) {
        showToast("The destination is blocked. Remove the domain block before re-enabling this link.", "warning");
        return;
      }
      link.disabled = false;
      addActivity(database, "enable", "Link enabled", `/${link.alias}`);
    } else {
      link.disabled = true;
      addActivity(database, "disable", "Link disabled", `/${link.alias}`);
    }
    link.updatedAt = new Date().toISOString();
    if (!saveDatabase(database)) return;
    renderCurrentView();
    showToast(link.disabled ? "Link disabled. New redirects are blocked." : "Link enabled.");
  }

  function deleteLink(linkId) {
    const database = loadDatabase();
    const link = database.links.find((item) => item.id === linkId);
    if (!link) { showToast("That link no longer exists.", "error"); return; }
    const historyCount = database.clicks.filter((event) => event.linkId === linkId).length;
    const confirmed = window.confirm(`Delete “${link.title || link.alias}”? This also removes ${historyCount} retained click event(s) for this link from this browser's analytics. This cannot be undone.`);
    if (!confirmed) return;
    database.links = database.links.filter((item) => item.id !== linkId);
    database.clicks = database.clicks.filter((event) => event.linkId !== linkId);
    addActivity(database, "delete", "Link deleted", `/${link.alias}`);
    if (!saveDatabase(database)) return;
    renderCurrentView();
    showToast("Link and its retained click history deleted.");
  }

  function deleteCampaign(campaignId) {
    const database = loadDatabase();
    const campaign = database.campaigns.find((item) => item.id === campaignId);
    if (!campaign) { showToast("That campaign no longer exists.", "error"); return; }
    const linksInCampaign = database.links.filter((link) => link.campaignId === campaignId).length;
    if (!window.confirm(`Delete campaign “${campaign.name}”? Its ${linksInCampaign} link(s) will remain, but will become unassigned. Click history is preserved.`)) return;
    database.campaigns = database.campaigns.filter((item) => item.id !== campaignId);
    database.links.forEach((link) => { if (link.campaignId === campaignId) { link.campaignId = null; link.updatedAt = new Date().toISOString(); } });
    addActivity(database, "delete", "Campaign deleted", campaign.name);
    if (!saveDatabase(database)) return;
    if (selectedAnalyticsCampaign === campaignId) selectedAnalyticsCampaign = "all";
    if (selectedLinksCampaign === campaignId) selectedLinksCampaign = "all";
    renderCurrentView();
    showToast("Campaign deleted. Its links were preserved.");
  }

  function openBlockDomainModal() {
    openModal(`<div class="modal-head"><div><span class="eyebrow">Destination policy</span><h2 id="modal-title">Block a domain</h2><p>New links and existing links to this host or its subdomains will be stopped.</p></div><button class="modal-x" data-close-modal aria-label="Close">×</button></div><div class="modal-body"><form class="modal-form" id="block-domain-form" novalidate><div class="field"><label for="blocked-domain">Domain or URL *</label><input class="text-input" id="blocked-domain" name="domain" placeholder="example.com" required><span class="field-hint">You can enter a host name or a full HTTP/HTTPS URL. The host only will be saved.</span><span class="field-error" id="blocked-domain-error"></span></div><div class="field"><label for="blocked-reason">Reason <span class="optional">(optional)</span></label><input class="text-input" id="blocked-reason" name="reason" maxlength="200" placeholder="e.g. suspicious destination reported"></div><div class="modal-actions"><button class="button button-secondary" type="button" data-close-modal>Cancel</button><button class="button button-primary" type="submit">Add to blocklist</button></div></form></div>`);
    document.getElementById("block-domain-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const raw = document.getElementById("blocked-domain").value.trim();
      const reason = document.getElementById("blocked-reason").value.trim();
      const errorElement = document.getElementById("blocked-domain-error");
      errorElement.textContent = "";
      let url;
      try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); }
      catch { errorElement.textContent = "Enter a valid domain, such as example.com."; return; }
      if (!/^https?:$/.test(url.protocol) || !url.hostname || url.hostname.includes(" ")) {
        errorElement.textContent = "Only HTTP/HTTPS host names can be blocked."; return;
      }
      const domain = url.hostname.toLowerCase().replace(/^www\./, "");
      const database = loadDatabase();
      if (database.blocklist.some((entry) => entry.domain === domain)) {
        errorElement.textContent = "That domain is already on the blocklist."; return;
      }
      database.blocklist.unshift({ id: createId("block"), domain, reason, createdAt: new Date().toISOString(), demoData: false });
      addActivity(database, "block", "Domain added to blocklist", domain);
      if (!saveDatabase(database)) return;
      closeModal();
      renderCurrentView();
      showToast(`Blocked ${domain}. Existing matching links are now denied.`);
    });
  }

  function removeBlockedDomain(blockId) {
    const database = loadDatabase();
    const entry = database.blocklist.find((item) => item.id === blockId);
    if (!entry) { showToast("That domain is no longer on the blocklist.", "error"); return; }
    if (!window.confirm(`Remove ${entry.domain} from the domain blocklist? Links to it may become eligible to redirect again if their other rules permit it.`)) return;
    database.blocklist = database.blocklist.filter((item) => item.id !== blockId);
    addActivity(database, "unblock", "Domain removed from blocklist", entry.domain);
    if (!saveDatabase(database)) return;
    renderCurrentView();
    showToast(`${entry.domain} removed from the blocklist.`);
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCSV() {
    const database = loadDatabase();
    if (!database.links.length) { showToast("There are no links to export yet.", "warning"); return; }
    const headers = ["Title", "Alias", "Destination", "Campaign", "Tags", "Status", "Expiry", "ClickLimit", "ClickCount"];
    const rows = database.links.map((link) => [
      link.title, link.alias, link.destination, campaignName(link.campaignId, database),
      (link.tags || []).join(", "), getLinkStatus(link, database), link.expiresAt || "",
      link.clickLimit ?? "", link.clickCount ?? 0
    ]);
    const contents = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadFile(`linkpulse-links-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${contents}`, "text/csv;charset=utf-8");
    showToast(`Exported ${database.links.length} link(s) to CSV.`);
  }

  function parseCSV(text) {
    const input = String(text || "").replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let index = 0; index < input.length; index += 1) {
      const character = input[index];
      if (inQuotes) {
        if (character === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
        else if (character === '"') inQuotes = false;
        else field += character;
      } else if (character === '"' && field.length === 0) {
        inQuotes = true;
      } else if (character === ",") {
        row.push(field); field = "";
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && input[index + 1] === "\n") index += 1;
        row.push(field); field = "";
        if (row.some((cell) => cell.trim() !== "")) rows.push(row);
        row = [];
      } else {
        field += character;
      }
    }
    if (inQuotes) throw new Error("The CSV contains an unclosed quoted field.");
    if (field.length || row.length) {
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    }
    if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error(`The file has more than ${MAX_IMPORT_ROWS} data rows. Split it into smaller files.`);
    return rows;
  }

  function normalizeCSVHeader(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function validateCSVImport(text, database) {
    const rows = parseCSV(text);
    if (!rows.length) throw new Error("The selected CSV file is empty.");
    const headers = rows[0].map(normalizeCSVHeader);
    const indexByHeader = new Map(headers.map((header, index) => [header, index]));
    const findIndex = (...names) => {
      for (const name of names) if (indexByHeader.has(name)) return indexByHeader.get(name);
      return -1;
    };
    const columns = {
      title: findIndex("title", "name"),
      alias: findIndex("alias", "shortcode", "shortalias"),
      destination: findIndex("destination", "destinationurl", "url", "longurl"),
      campaign: findIndex("campaign", "campaignname"),
      tags: findIndex("tags"),
      status: findIndex("status"),
      expiry: findIndex("expiry", "expiresat", "expirydate"),
      clickLimit: findIndex("clicklimit", "maxclicks", "maximumclicks")
    };
    const requiredMissing = ["title", "alias", "destination"].filter((key) => columns[key] < 0);
    if (requiredMissing.length) throw new Error(`Required CSV column(s) missing: ${requiredMissing.join(", ")}. Use the exported LinkPulse CSV headers as a template.`);
    const usedAliases = new Set(database.links.map((link) => String(link.alias || "").toLowerCase()));
    const campaignLookup = new Map(database.campaigns.map((campaign) => [campaign.name.trim().toLowerCase(), campaign.id]));
    const preview = [];
    rows.slice(1).forEach((values, rowIndex) => {
      const lineNumber = rowIndex + 2;
      const getValue = (key) => columns[key] < 0 ? "" : String(values[columns[key]] ?? "").trim();
      const title = getValue("title");
      const alias = getValue("alias");
      const rawDestination = getValue("destination");
      const campaign = getValue("campaign");
      const tags = getValue("tags").split(",").map((tag) => tag.trim()).filter(Boolean);
      const rawExpiry = getValue("expiry");
      const rawLimit = getValue("clickLimit");
      const rawStatus = getValue("status").toLowerCase();
      let problem = "";
      let destination = null;
      let expiresAt = null;
      let clickLimit = null;
      let campaignId = null;
      if (!title) problem = "Missing title";
      else if (!alias) problem = "Missing alias";
      else if (aliasError(alias, database)) problem = aliasError(alias, database);
      else if (usedAliases.has(alias.toLowerCase())) problem = "Duplicate alias";
      else {
        const normalized = normalizeDestination(rawDestination);
        if (!normalized.ok) problem = normalized.message;
        else if (isDomainBlocked(normalized.value, database)) problem = "Destination domain is blocked";
        else destination = normalized.value;
      }
      if (!problem && campaign) {
        campaignId = campaignLookup.get(campaign.toLowerCase()) || null;
        if (!campaignId) problem = `Unknown campaign: ${campaign}`;
      }
      if (!problem && rawExpiry) {
        const date = new Date(rawExpiry);
        if (Number.isNaN(date.getTime())) problem = "Invalid expiry date";
        else expiresAt = date.toISOString();
      }
      if (!problem && rawLimit) {
        const value = Number(rawLimit);
        if (!Number.isInteger(value) || value <= 0) problem = "Click limit must be a positive whole number";
        else clickLimit = value;
      }
      const row = {
        lineNumber, title, alias, destination, campaignId, campaignName: campaign,
        tags, expiresAt, clickLimit, disabled: rawStatus === "disabled", valid: !problem, problem
      };
      if (row.valid) usedAliases.add(alias.toLowerCase());
      preview.push(row);
    });
    return preview;
  }

  function openCSVImport() {
    pendingImport = null;
    importFileName = "";
    openModal(`<div class="modal-head"><div><span class="eyebrow">Bulk link setup</span><h2 id="modal-title">Import links from CSV</h2><p>Review each row before adding anything to your workspace.</p></div><button class="modal-x" data-close-modal aria-label="Close">×</button></div><div class="modal-body"><div class="notice" style="margin-bottom:18px"><span aria-hidden="true">ⓘ</span><div>Required columns: <strong>Title, Alias, Destination</strong>. Optional: Campaign, Tags, Expiry, ClickLimit, Status. Campaign names must already exist. Click counts and password values are not imported.</div></div><div class="field"><label for="csv-file">Choose a CSV file</label><input class="text-input" id="csv-file" type="file" accept=".csv,text/csv"><span class="field-hint">Maximum file size: 2 MB; maximum data rows: ${MAX_IMPORT_ROWS}.</span><span class="field-error" id="csv-file-error"></span></div><div id="csv-preview-container" style="margin-top:18px"></div><div class="modal-actions"><button class="button button-secondary" data-close-modal>Cancel</button><button class="button button-primary" id="confirm-csv-import" disabled>Import valid rows</button></div></div>`, { wide: true });
    document.getElementById("csv-file")?.addEventListener("change", handleCSVFileSelected);
    document.getElementById("confirm-csv-import")?.addEventListener("click", confirmCSVImport);
  }

  function handleCSVFileSelected(event) {
    const file = event.currentTarget.files?.[0];
    const errorElement = document.getElementById("csv-file-error");
    const previewContainer = document.getElementById("csv-preview-container");
    const confirmButton = document.getElementById("confirm-csv-import");
    errorElement.textContent = "";
    confirmButton.disabled = true;
    pendingImport = null;
    previewContainer.innerHTML = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { errorElement.textContent = "This file is larger than 2 MB. Split it into smaller CSV files."; return; }
    importFileName = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const preview = validateCSVImport(String(reader.result || ""), loadDatabase());
        pendingImport = preview;
        renderCSVPreview(preview, previewContainer);
        const validCount = preview.filter((row) => row.valid).length;
        confirmButton.disabled = validCount === 0;
        confirmButton.textContent = `Import ${validCount} valid row${validCount === 1 ? "" : "s"}`;
      } catch (error) {
        errorElement.textContent = error.message || "The selected CSV could not be parsed.";
      }
    };
    reader.onerror = () => { errorElement.textContent = "The file could not be read. Try saving it as UTF-8 CSV."; };
    reader.readAsText(file);
  }

  function renderCSVPreview(rows, container) {
    const validCount = rows.filter((row) => row.valid).length;
    const invalidCount = rows.length - validCount;
    container.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px"><strong style="font-size:12px;color:#344a59">Preview · ${escapeHTML(importFileName)}</strong><span style="font-size:10px;color:#7b8a95">${validCount} valid · ${invalidCount} invalid</span></div><div class="csv-preview"><table><thead><tr><th>Row</th><th>Title</th><th>Alias</th><th>Destination</th><th>Validation</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${row.lineNumber}</td><td>${escapeHTML(shorten(row.title, 36))}</td><td>${escapeHTML(row.alias)}</td><td>${escapeHTML(shorten(row.destination || "", 42))}</td><td class="${row.valid ? "preview-valid" : "preview-invalid"}">${row.valid ? "Ready" : escapeHTML(row.problem)}</td></tr>`).join("")}</tbody></table></div><p class="field-hint" style="margin-top:9px">${invalidCount ? "Invalid rows will be skipped. The preview is revalidated before import." : "All displayed rows are valid and ready to import."}</p>`;
  }

  function confirmCSVImport() {
    if (!pendingImport) return;
    const rows = pendingImport.filter((row) => row.valid);
    if (!rows.length) { showToast("There are no valid rows to import.", "warning"); return; }
    const database = loadDatabase();
    const existingAliases = new Set(database.links.map((link) => String(link.alias).toLowerCase()));
    const now = new Date().toISOString();
    let imported = 0;
    rows.forEach((row) => {
      if (existingAliases.has(row.alias.toLowerCase())) return;
      database.links.unshift({
        id: createId("link"), alias: row.alias, destination: row.destination,
        title: row.title, campaignId: row.campaignId, tags: row.tags,
        createdAt: now, updatedAt: now, expiresAt: row.expiresAt,
        clickLimit: row.clickLimit, clickCount: 0, disabled: row.disabled,
        password: null, demoData: false
      });
      existingAliases.add(row.alias.toLowerCase());
      imported += 1;
    });
    if (!imported) { showToast("All valid rows now conflict with existing aliases. Nothing was imported.", "warning"); return; }
    addActivity(database, "import", "Links imported from CSV", `${imported} record(s)`);
    if (!saveDatabase(database)) return;
    const skipped = pendingImport.length - imported;
    closeModal();
    renderCurrentView();
    showToast(`Imported ${imported} link(s). ${skipped} invalid or duplicate row(s) skipped.`, skipped ? "warning" : "success");
  }

  function createDemoData() {
    const database = loadDatabase();
    if (database.links.some((link) => link.demoData) || database.campaigns.some((campaign) => campaign.demoData)) {
      showToast("Demo data is already loaded. Remove it from Settings before loading it again.", "warning");
      return;
    }
    const now = Date.now();
    const campaignOne = { id: createId("campaign"), name: "Campus Launch", description: "Awareness and sign-up links for the campus launch campaign.", createdAt: new Date(now - 9 * 86400000).toISOString(), updatedAt: new Date(now - 9 * 86400000).toISOString(), demoData: true };
    const campaignTwo = { id: createId("campaign"), name: "Product Notes", description: "A small content campaign for product updates and learning resources.", createdAt: new Date(now - 6 * 86400000).toISOString(), updatedAt: new Date(now - 6 * 86400000).toISOString(), demoData: true };
    database.campaigns.push(campaignOne, campaignTwo);
    const makeDemoLink = (title, alias, destination, campaignId, tags, clickCount, extra = {}) => ({
      id: createId("link"), title, alias: generateAlias(database), destination, campaignId, tags,
      createdAt: new Date(now - extra.ageDays * 86400000).toISOString(),
      updatedAt: new Date(now - extra.ageDays * 86400000).toISOString(),
      expiresAt: null, clickLimit: null, clickCount: 0, disabled: false,
      password: null, demoData: true, desiredAlias: alias, demoClickGoal: clickCount
    });
    const demoLinks = [
      makeDemoLink("Campus welcome page", "campus-welcome", "https://developer.mozilla.org/", campaignOne.id, ["campus", "welcome"], 8, { ageDays: 8 }),
      makeDemoLink("Student resource guide", "student-guide", "https://www.openstreetmap.org/", campaignOne.id, ["resources", "students"], 5, { ageDays: 5 }),
      makeDemoLink("Product update notes", "product-notes", "https://github.com/topics/open-source", campaignTwo.id, ["product", "updates"], 4, { ageDays: 4 }),
      makeDemoLink("Getting started article", "getting-started", "https://web.dev/learn/", campaignTwo.id, ["guide", "learning"], 2, { ageDays: 2 })
    ];
    demoLinks.forEach((link) => {
      // Desired sample aliases are preferred, but stay unique if the workspace already uses them.
      const desired = link.desiredAlias;
      if (!aliasError(desired, database)) link.alias = desired;
      delete link.desiredAlias;
      const goal = link.demoClickGoal;
      delete link.demoClickGoal;
      for (let index = 0; index < goal; index += 1) {
        const eventTime = new Date(now - (index * 1.2 + Math.random() * 1.8) * 86400000).toISOString();
        database.clicks.push({
          id: createId("click"), linkId: link.id, alias: link.alias,
          campaignId: link.campaignId, timestamp: eventTime,
          referrer: index % 3 === 0 ? "https://www.google.com/" : index % 3 === 1 ? "https://www.linkedin.com/" : "",
          browser: index % 2 ? "Chrome" : "Firefox", device: index % 3 === 0 ? "Mobile" : "Desktop",
          demoData: true
        });
      }
      link.clickCount = goal;
      database.links.unshift(link);
    });
    addActivity(database, "campaign", "Demo campaigns loaded", "Campus Launch and Product Notes", { demoData: true });
    addActivity(database, "create", "Demo links loaded", "Four example links added", { demoData: true });
    addActivity(database, "click", "Demo click history added", "Sample events are labelled as demo data", { demoData: true });
    if (!saveDatabase(database)) return;
    renderCurrentView();
    showToast("Demo campaigns, links, and sample click events added.");
  }

  function removeDemoData() {
    const database = loadDatabase();
    const demoLinkIds = new Set(database.links.filter((link) => link.demoData).map((link) => link.id));
    const demoCampaignIds = new Set(database.campaigns.filter((campaign) => campaign.demoData).map((campaign) => campaign.id));
    if (!demoLinkIds.size && !demoCampaignIds.size) { showToast("No demo data is loaded.", "warning"); return; }
    if (!window.confirm("Remove demo links, demo campaigns, and their click history? Your own links and campaigns will be preserved.")) return;
    database.links = database.links.filter((link) => !demoLinkIds.has(link.id));
    database.clicks = database.clicks.filter((event) => !demoLinkIds.has(event.linkId) && !event.demoData);
    database.campaigns = database.campaigns.filter((campaign) => !demoCampaignIds.has(campaign.id));
    database.links.forEach((link) => { if (demoCampaignIds.has(link.campaignId)) link.campaignId = null; });
    database.activity = database.activity.filter((item) => !item.demoData);
    addActivity(database, "delete", "Demo data removed", "Your own records were kept");
    if (!saveDatabase(database)) return;
    if (demoCampaignIds.has(selectedAnalyticsCampaign)) selectedAnalyticsCampaign = "all";
    if (demoCampaignIds.has(selectedLinksCampaign)) selectedLinksCampaign = "all";
    renderCurrentView();
    showToast("Demo data removed. Your own records remain.");
  }

  function clearAllData() {
    if (!window.confirm("Clear the entire LinkPulse workspace from this browser? This removes all links, campaigns, click history, activity, and blocked domains.")) return;
    if (!saveDatabase(emptyDatabase())) return;
    selectedAnalyticsCampaign = "all";
    selectedLinksCampaign = "all";
    renderCurrentView();
    showToast("Workspace data cleared.");
  }

  function openQuickGuide() {
    openModal(`<div class="modal-head"><div><span class="eyebrow">Quick guide</span><h2 id="modal-title">Try the LinkPulse workflow</h2><p>A simple sequence for a live hackathon demonstration.</p></div><button class="modal-x" data-close-modal aria-label="Close">×</button></div><div class="modal-body"><div class="activity-list"><div class="activity-item"><span class="activity-icon">1</span><div class="activity-copy"><p><strong>Create a campaign</strong></p><time>Group the links you will demonstrate.</time></div></div><div class="activity-item"><span class="activity-icon">2</span><div class="activity-copy"><p><strong>Create a short link</strong></p><time>Use a destination, alias, click cap, or expiry rule.</time></div></div><div class="activity-item"><span class="activity-icon">3</span><div class="activity-copy"><p><strong>Copy and open the short URL</strong></p><time>Use the same browser and static-host origin so localStorage is shared.</time></div></div><div class="activity-item"><span class="activity-icon">4</span><div class="activity-copy"><p><strong>Inspect analytics, then disable the link</strong></p><time>The next request should be blocked while earlier click history remains.</time></div></div></div><div class="notice warning" style="margin-top:18px"><span aria-hidden="true">⚠</span><div><strong>Important:</strong> this browser-only prototype is not secure authentication, global persistent data, or server-side redirection. Do not enter real passwords or sensitive information.</div></div><div class="modal-actions"><button class="button button-secondary" data-close-modal>Close</button><button class="button button-primary" data-action="create-campaign">＋ Create campaign</button></div></div>`);
  }

  function handleActionClick(button) {
    const { action, id, view } = button.dataset;
    if (view) { navigateTo(view); return; }
    switch (action) {
      case "create-link": openLinkModal(); break;
      case "edit-link": closeModal(); openLinkModal(id); break;
      case "view-link": closeModal(); showLinkDetails(id); break;
      case "copy-link": {
        const link = loadDatabase().links.find((item) => item.id === id);
        if (link) copyText(makeShortURL(link.alias)); else showToast("That link no longer exists.", "error");
        break;
      }
      case "qr-link": closeModal(); openQRCode(id); break;
      case "test-link": {
        const link = loadDatabase().links.find((item) => item.id === id);
        if (!link) { showToast("That link no longer exists.", "error"); break; }
        window.open(makeShortURL(link.alias), "_blank", "noopener,noreferrer");
        showToast("Opened the short link in a new tab. Use the same browser profile for localStorage.", "warning");
        break;
      }
      case "toggle-link": toggleLink(id); break;
      case "delete-link": deleteLink(id); break;
      case "create-campaign": closeModal(); openCampaignModal(); break;
      case "edit-campaign": closeModal(); openCampaignModal(id); break;
      case "delete-campaign": deleteCampaign(id); break;
      case "campaign-analytics": selectedAnalyticsCampaign = id; selectedAnalyticsRange = "all"; navigateTo("analytics"); break;
      case "add-blocked-domain": openBlockDomainModal(); break;
      case "remove-blocked-domain": removeBlockedDomain(id); break;
      case "import-csv": openCSVImport(); break;
      case "export-csv": exportCSV(); break;
      case "load-demo": createDemoData(); break;
      case "reset-demo": removeDemoData(); break;
      case "clear-all": clearAllData(); break;
      case "clear-link-filters": {
        const search = document.getElementById("link-search");
        const status = document.getElementById("link-status-filter");
        const campaign = document.getElementById("link-campaign-filter");
        const sort = document.getElementById("link-sort");
        if (search) search.value = "";
        if (status) status.value = "all";
        if (campaign) campaign.value = "all";
        if (sort) sort.value = "created-desc";
        selectedLinksCampaign = "all";
        updateLinksTable();
        break;
      }
      default: break;
    }
  }

  function updateLinksTable() {
    if (currentView !== "links") return;
    const database = loadDatabase();
    const container = document.getElementById("links-table-container");
    if (!container) return;
    container.innerHTML = renderLinksTable(database, {
      query: document.getElementById("link-search")?.value || "",
      status: document.getElementById("link-status-filter")?.value || "all",
      campaign: document.getElementById("link-campaign-filter")?.value || "all",
      sort: document.getElementById("link-sort")?.value || "created-desc"
    });
  }

  function handleRootClick(event) {
    const actionButton = event.target.closest("[data-action], [data-view], [data-close-modal]");
    if (!actionButton) return;
    if (actionButton.matches("button") || actionButton.matches("a")) {
      event.preventDefault();
      if (actionButton.hasAttribute("data-close-modal")) { closeModal(); return; }
      handleActionClick(actionButton);
    }
  }

  function initializeApp() {
    document.getElementById("footer-year").textContent = new Date().getFullYear();
    document.querySelectorAll("[data-view]").forEach((element) => element.addEventListener("click", (event) => {
      event.preventDefault();
      navigateTo(element.dataset.view);
    }));
    document.getElementById("top-create-link").addEventListener("click", () => openLinkModal());
    document.getElementById("help-button").addEventListener("click", openQuickGuide);
    document.getElementById("mobile-menu-button").addEventListener("click", () => sidebar.classList.contains("is-open") ? closeMobileNav() : openMobileNav());
    mobileScrim.addEventListener("click", closeMobileNav);
    viewRoot.addEventListener("click", handleRootClick);
    modalContent.addEventListener("click", handleRootClick);
    modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && sidebar.classList.contains("is-open")) closeMobileNav(); });
    viewRoot.addEventListener("input", (event) => { if (event.target.id === "link-search") updateLinksTable(); });
    viewRoot.addEventListener("change", (event) => {
      if (["link-status-filter", "link-campaign-filter", "link-sort"].includes(event.target.id)) {
        if (event.target.id === "link-campaign-filter") selectedLinksCampaign = event.target.value;
        updateLinksTable();
      }
      if (event.target.id === "analytics-range") { selectedAnalyticsRange = event.target.value; renderCurrentView(); }
      if (event.target.id === "analytics-campaign") { selectedAnalyticsCampaign = event.target.value; renderCurrentView(); }
    });
    window.addEventListener("storage", (event) => { if (event.key === STORAGE_KEY) renderCurrentView(); });
    renderCurrentView();
  }

  function detectBrowser(userAgent) {
    if (/Edg\//.test(userAgent)) return "Edge";
    if (/Firefox\//.test(userAgent)) return "Firefox";
    if (/Chrome\//.test(userAgent) && !/Chromium\//.test(userAgent)) return "Chrome";
    if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) return "Safari";
    return "Unknown";
  }

  function detectDevice(userAgent) {
    if (/ipad|tablet/i.test(userAgent)) return "Tablet";
    if (/mobile|iphone|android/i.test(userAgent)) return "Mobile";
    return "Desktop";
  }

  function redirectBlockMessage(link, database) {
    if (!link) return { title: "Link not found", message: "This short link does not exist in the current browser workspace. Open the LinkPulse dashboard where the link was created, or check the alias." };
    if (link.disabled) return { title: "This link is unavailable", message: "The link has been disabled by the workspace administrator. No redirect was performed." };
    if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) return { title: "This link has expired", message: "Its configured expiry time has passed, so LinkPulse has stopped the redirect." };
    if (link.clickLimit !== null && link.clickLimit !== undefined && link.clickLimit !== "" && Number(link.clickCount || 0) >= Number(link.clickLimit)) return { title: "Click limit reached", message: "This link has reached its permitted number of successful clicks and cannot redirect again." };
    const normalized = normalizeDestination(link.destination);
    if (!normalized.ok) return { title: "Destination unavailable", message: "The saved destination is invalid or no longer allowed. No redirect was performed." };
    if (isDomainBlocked(normalized.value, database)) return { title: "Destination blocked", message: "This destination host is on the current domain blocklist. No redirect was performed." };
    return null;
  }

  function renderRedirectShell(title, message, icon = "↗", inside = "") {
    document.body.innerHTML = `<main class="redirect-shell"><section class="redirect-card"><div class="redirect-brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M12.5 19.5 9.8 22.2a5.2 5.2 0 0 1-7.4-7.4l5-5a5.2 5.2 0 0 1 7.4 0"/><path d="m19.5 12.5 2.7-2.7a5.2 5.2 0 0 1 7.4 7.4l-5 5a5.2 5.2 0 0 1-7.4 0"/><path d="m11.5 20.5 9-9"/></svg></span><span>Link<span style="color:#169b88">Pulse</span></span></div><div class="redirect-icon" aria-hidden="true">${icon}</div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(message)}</p>${inside}<div class="redirect-footer">LinkPulse · Fast redirects. Trustworthy analytics.</div></section></main>`;
  }

  function processRedirect(alias) {
    let database = loadDatabase();
    let link = database.links.find((item) => String(item.alias || "").toLowerCase() === alias.toLowerCase());
    const block = redirectBlockMessage(link, database);
    if (block) { renderRedirectShell(block.title, block.message, "⛨"); return; }
    if (link.password) {
      renderRedirectShell("Password required", "This link has a demonstration-only password gate. Enter the password supplied by the link owner to continue.", "⌑", `<form id="redirect-password-form" class="redirect-password" novalidate><div class="field"><label for="redirect-password">Demo password</label><input id="redirect-password" class="text-input" type="password" autocomplete="off" required></div><div id="redirect-password-message" class="redirect-message" role="alert"></div><button class="button button-primary" type="submit">Continue to destination ↗</button></form><p class="redirect-destination" style="margin-top:16px">Destination: ${escapeHTML(shorten(link.destination, 75))}</p>`);
      document.getElementById("redirect-password-form").addEventListener("submit", (event) => {
        event.preventDefault();
        const enteredPassword = document.getElementById("redirect-password").value;
        const message = document.getElementById("redirect-password-message");
        database = loadDatabase();
        link = database.links.find((item) => String(item.alias || "").toLowerCase() === alias.toLowerCase());
        const currentBlock = redirectBlockMessage(link, database);
        if (currentBlock) { renderRedirectShell(currentBlock.title, currentBlock.message, "⛨"); return; }
        if (!link.password || enteredPassword !== link.password) {
          message.textContent = "That password is not correct. No successful click was recorded.";
          return;
        }
        completeRedirect(link);
      });
      return;
    }
    completeRedirect(link);
  }

  function completeRedirect(link) {
    const database = loadDatabase();
    const currentLink = database.links.find((item) => item.id === link.id);
    const block = redirectBlockMessage(currentLink, database);
    if (block) { renderRedirectShell(block.title, block.message, "⛨"); return; }
    const normalized = normalizeDestination(currentLink.destination);
    if (!normalized.ok) { renderRedirectShell("Destination unavailable", "The destination is invalid, so no redirect was performed.", "⛨"); return; }
    // Record before navigation. This is synchronous in one browser context, not a cross-device atomic cap.
    currentLink.clickCount = Number(currentLink.clickCount || 0) + 1;
    currentLink.updatedAt = new Date().toISOString();
    database.clicks.push({
      id: createId("click"), linkId: currentLink.id, alias: currentLink.alias,
      campaignId: currentLink.campaignId || null, timestamp: new Date().toISOString(),
      referrer: document.referrer || "", browser: detectBrowser(navigator.userAgent || ""),
      device: detectDevice(navigator.userAgent || ""), demoData: false
    });
    addActivity(database, "click", "Successful redirect recorded", `/${currentLink.alias}`, { demoData: false });
    if (!saveDatabase(database)) {
      renderRedirectShell("Could not record click", "The browser could not save the click event. The redirect was not continued so the click cap is not silently bypassed.", "!");
      return;
    }
    renderRedirectShell("Redirecting you now", "LinkPulse checked the link rules and recorded this permitted click.", "↗", `<p class="redirect-destination">Destination: ${escapeHTML(shorten(normalized.value, 100))}</p><p class="field-hint">If your browser does not navigate automatically, <a href="${escapeHTML(normalized.value)}" rel="noopener noreferrer">continue to the destination</a>.</p>`);
    window.location.replace(normalized.value);
  }

  const requestedAlias = new URLSearchParams(window.location.search).get("go");
  if (requestedAlias !== null) {
    processRedirect(requestedAlias.trim());
  } else {
    initializeApp();
  }
})();
