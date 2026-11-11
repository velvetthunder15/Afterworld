/* Afterworld v2.0.0 — Frontend Observatory & Multi-Host Chat */
(() => {
"use strict";

const APP_NAME = "Afterworld";
const NETWORK_ERROR = "Couldn't reach the server. Check your internet connection and try again.";
const KEYS = {
    chats: "afterworld.chats.v1",
    active: "afterworld.active.v1",
    group: "afterworld.groupby.v1",
    sort: "afterworld.sort.v1",
    layout: "afterworld.layout.v1",
    sidebar: "afterworld.sidebar.v1"
};
const LEGACY_KEYS = {
    chats: "crchatbot.chats.v2",
    active: "crchatbot.active.v2",
    group: "crchatbot.groupby.v1"
};

const MAX_CHATS = 100;
const GROUP_KEYS = ["context", "host", "provider", "size", "quality", "input", "none"];
const SORT_KEYS = ["latency", "context", "score", "size", "name"];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_CONTEXT_IMAGES = 6;
const LIVE_REFRESH_MS = 30000;
const DEFAULT_LIMITS = { per_minute: 20, per_day: 50, per_day_with_credits: 1000, credits_threshold: 10 };

const SIZE_SOURCES = {
    id: "Stated in the model's identifier",
    weights: "Stated in the model's Hugging Face repository",
    description: "Stated in the model's official description"
};

const ICONS = {
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    regen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-15.5-6.3L3 8M3 3v5h5M3 12a9 9 0 0 0 15.5 6.3L21 16m0 5v-5h-5"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.2 2.5 4.6 13.4c-.4.5 0 1.2.6 1.2h5.1l-1 6.3c-.1.8.9 1.2 1.4.6l8.6-10.9c.4-.5 0-1.2-.6-1.2h-5.1l1-6.3c.1-.8-.9-1.2-1.4-.6z"/></svg>'
};

const $ = (id) => document.getElementById(id);

const form = $("form");
const input = $("message");
const chatArea = $("chat");
const thread = $("thread");
const sendButton = $("send");
const welcome = $("welcome");
const welcomeBadge = $("welcome-badge");
const welcomeTitle = $("welcome-title");
const welcomeSub = $("welcome-sub");
const sidebar = $("sidebar");
const scrim = $("scrim");
const sidebarToggle = $("sidebar-toggle");
const dashButton = $("dash-btn");
const topFastBtn = $("top-fast-btn");
const brandLink = $("brand-link");
const versionKicker = $("version-kicker");
const modelLabel = $("model-label");
const topLiveDot = $("top-live-dot");
const topLiveText = $("top-live-text");

const chatGroups = $("chat-groups");
const chatEmpty = $("chat-empty");
const chatSearch = $("chat-search");
const sideSearchWrap = $("side-search-wrap");
const chatCountLabel = $("chat-count-label");
const clearChatsBtn = $("clear-chats-btn");

const viewDash = $("view-dashboard");
const viewChat = $("view-chat");
const banner = $("banner");
const dashBody = $("dash-body");
const dashMeta = $("dash-meta");
const hostTabs = $("host-tabs");
const searchInput = $("search");
const searchKbd = $("search-kbd");
const searchClear = $("search-clear");
const groupSeg = $("group-seg");
const sortSelect = $("sort");
const filtersBox = $("filters");
const resetFiltersBtn = $("reset-filters-btn");
const viewSwitch = $("view-switch");

const heroEyebrowText = $("hero-eyebrow-text");
const randomButton = $("random-btn");
const randomLabel = $("random-label");
const randomHint = $("random-hint");
const RANDOM_HINT = randomHint.textContent;
const instantFastestBtn = $("instant-fastest-btn");
const instantFastestLabel = $("instant-fastest-label");

const liveDot = $("live-dot");
const liveStamp = $("live-stamp");
const liveSyncBtn = $("live-sync-btn");
const liveFastestName = $("live-fastest-name");
const liveFastestMs = $("live-fastest-ms");
const liveFastestHost = $("live-fastest-host");
const liveFastestSub = $("live-fastest-sub");
const fastestChatBtn = $("fastest-chat-btn");
const providerStatusBox = $("provider-status");

const attachButton = $("attach-btn");
const attachWrap = $("attach-wrap");
const fileInput = $("file-input");
const attachmentsBox = $("attachments");
const dropOverlay = $("drop-overlay");
const hintBox = $("hint");
const charCount = $("char-count");
const HINT_DEFAULT = hintBox.textContent;

const inspectorModal = $("inspector-modal");
const inspectorHeadMain = $("inspector-head-main");
const inspectorBody = $("inspector-body");
const inspectorFoot = $("inspector-foot");
const inspectorClose = $("inspector-close");

const switchModal = $("switch-modal");
const switchSearch = $("switch-search");
const switchList = $("switch-list");
const switchClose = $("switch-close");
const switchSub = $("switch-sub");

const lightbox = $("lightbox");
const lightboxImg = lightbox.querySelector("img");
const toastEl = $("toast");

class ApiError extends Error {}

let providerStatus = [];
let busy = false;
let controller = null;
let view = "dashboard";
let draft = null;
let catalog = null;
let catalogState = "idle";
let catalogError = "";
let randomBusy = false;
let batchBusy = false;
let pending = [];
let attachEpoch = 0;
let hintTimer = 0;
let toastTimer = 0;
let currentFastestId = null;
let inspectModelId = null;
let switchContext = null; // { carryMessages, carryPrompt }
let confirmingDeleteId = null;
let renamingChatId = null;
let sysDrawerOpen = false;

const live = { state: "idle", loading: false, models: {}, usage: null, limits: null, updatedAt: 0 };
const testing = new Set();
const testNotes = new Map();

/* ==========================================================
   Storage & Preferences
   ========================================================== */
function readStore(name) {
    try {
        let value = localStorage.getItem(KEYS[name]);
        if (value === null && LEGACY_KEYS[name]) value = localStorage.getItem(LEGACY_KEYS[name]);
        return value;
    } catch (_) {
        return null;
    }
}

function writeStore(name, value) {
    try {
        localStorage.setItem(KEYS[name], value);
    } catch (error) {
        console.warn("Could not save " + name + ":", error);
    }
}

const dash = {
    group: (() => { const s = readStore("group"); return GROUP_KEYS.includes(s) ? s : "context"; })(),
    sort: (() => { const s = readStore("sort"); return SORT_KEYS.includes(s) ? s : "latency"; })(),
    layout: (() => { const s = readStore("layout"); return s === "cards" ? "cards" : "table"; })(),
    host: "all",
    query: "",
    filters: new Set()
};

let sidebarCollapsed = readStore("sidebar") === "collapsed";

/* ==========================================================
   DOM & Formatting Helpers
   ========================================================== */
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function showToast(message, ms = 3200) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

function hashHue(text) {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return 195 + (h % 65);
}

function providerTile(provider, sizeClass = "") {
    const name = (provider || "?").trim() || "?";
    const tile = el("span", "tile" + (sizeClass ? " " + sizeClass : ""), name.charAt(0).toUpperCase());
    const hue = hashHue(name);
    tile.style.background = "linear-gradient(135deg, hsl(" + hue + " 72% 36%), hsl(" + (hue + 18) + " 78% 48%))";
    tile.setAttribute("aria-hidden", "true");
    return tile;
}

function markTile(sizeClass = "") {
    const tile = el("span", "mark-tile" + (sizeClass ? " " + sizeClass : ""));
    tile.setAttribute("aria-hidden", "true");
    tile.innerHTML = '<svg><use href="#mark"/></svg>';
    return tile;
}

function hostBadge(host, hostLabel) {
    const key = host || "openrouter";
    const label = hostLabel || (key === "openrouter" ? "OpenRouter" : key === "groq" ? "Groq" : key === "workersai" ? "Workers AI" : key);
    const badge = el("span", "host-pill", label);
    badge.dataset.host = key;
    return badge;
}

function fmtBillions(value) {
    if (value >= 1000) return parseFloat((value / 1000).toFixed(2)) + "T";
    return parseFloat(value.toFixed(2)) + "B";
}

function fmtMs(ms) {
    if (ms < 1000) return Math.round(ms) + " ms";
    return (ms / 1000).toFixed(2) + " s";
}

function speedTone(ms) {
    if (ms <= 450) return "fast";
    if (ms <= 1300) return "mid";
    return "slow";
}

function ago(seconds) {
    if (seconds === null || seconds === undefined) return "just now";
    const s = Math.max(0, Math.round(seconds));
    if (s < 5) return "just now";
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
}

function timeAgo(iso) {
    const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
    return ago(isNaN(seconds) ? 0 : Math.max(0, seconds));
}

function fmtDate(iso) {
    if (!iso) return "";
    const date = new Date(iso + "T00:00:00Z");
    if (isNaN(date.getTime())) return iso;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function snapshot(m) {
    return {
        id: m.id,
        name: m.name,
        provider: m.provider || "",
        host: m.host || (m.id && m.id.includes("::") ? m.id.split("::")[0] : "openrouter"),
        host_label: m.host_label || "",
        context_label: m.context_label || "",
        max_output_label: m.max_output_label || "",
        params_label: m.params_label || "",
        reasoning: !!m.reasoning,
        tools: !!m.tools,
        vision: !!m.vision
    };
}

function abilityTags(m) {
    const list = [];
    if (m.reasoning) list.push({ label: "Reasoning", cls: "reasoning" });
    if (m.tools) list.push({ label: "Tools", cls: "tools" });
    if (m.vision) list.push({ label: "Vision", cls: "vision" });
    if (m.audio) list.push({ label: "Audio", cls: "" });
    if (m.video) list.push({ label: "Video", cls: "" });
    return list;
}

/* ==========================================================
   IndexedDB Image Storage & Preparation
   ========================================================== */
const imageStore = (() => {
    const memory = new Map();
    let dbPromise = null;

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve) => {
            try {
                const request = indexedDB.open("afterworld", 1);
                request.onupgradeneeded = () => request.result.createObjectStore("images", { keyPath: "id" });
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
                request.onblocked = () => resolve(null);
            } catch (_) {
                resolve(null);
            }
        });
        return dbPromise;
    }

    function run(mode, work) {
        return openDb().then((db) => {
            if (!db) return undefined;
            return new Promise((resolve) => {
                try {
                    const tx = db.transaction("images", mode);
                    const request = work(tx.objectStore("images"));
                    tx.oncomplete = () => resolve(request ? request.result : undefined);
                    tx.onerror = () => resolve(undefined);
                    tx.onabort = () => resolve(undefined);
                } catch (_) {
                    resolve(undefined);
                }
            });
        });
    }

    return {
        async put(id, dataUrl) {
            memory.set(id, dataUrl);
            await run("readwrite", (store) => store.put({ id, dataUrl }));
        },
        async get(id) {
            if (memory.has(id)) return memory.get(id);
            const record = await run("readonly", (store) => store.get(id));
            return record ? record.dataUrl : null;
        },
        async remove(ids) {
            if (!ids.length) return;
            ids.forEach((id) => memory.delete(id));
            await run("readwrite", (store) => { ids.forEach((id) => store.delete(id)); });
        }
    };
})();

function loadWithImageElement(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
        image.src = url;
    });
}

function loadBitmap(file) {
    if (window.createImageBitmap) {
        return createImageBitmap(file).catch(() => loadWithImageElement(file));
    }
    return loadWithImageElement(file);
}

async function prepareImage(file) {
    const label = file.name || "That image";
    if (!IMAGE_TYPES.includes(file.type)) throw new Error(label + " isn't a PNG, JPEG, WebP or GIF image.");
    if (file.size > MAX_IMAGE_BYTES) throw new Error(label + " is larger than 20 MB.");

    let source;
    try {
        source = await loadBitmap(file);
    } catch (_) {
        throw new Error("Couldn't read " + label + ".");
    }

    const width = source.width;
    const height = source.height;
    if (!width || !height) throw new Error("Couldn't read " + label + ".");

    let dataUrl = "";
    for (const side of [1600, 1100, 720]) {
        const scale = Math.min(1, side / Math.max(width, height));
        const canvas = document.createElement("canvas");
        // Enforce >= 32px per edge so vision models like Qwen VL (>=28px) never reject small icons
        canvas.width = Math.max(32, Math.round(width * scale));
        canvas.height = Math.max(32, Math.round(height * scale));

        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

        dataUrl = canvas.toDataURL("image/jpeg", 0.88);
        if (dataUrl.length <= 2500000) break;
    }

    if (source.close) source.close();
    return { id: uid(), name: file.name || "image", dataUrl };
}

function removeChatImages(convo) {
    const ids = [];
    convo.messages.forEach((m) => (m.images || []).forEach((img) => ids.push(img.id)));
    return imageStore.remove(ids);
}

/* ==========================================================
   Rich HTML-Safe Markdown Renderer (Tables, Quotes, Code, Lists)
   ========================================================== */
function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function inlineMarkdown(text) {
    let s = escapeHtml(text);
    const codes = [];

    s = s.replace(/`([^`]+)`/g, (_, code) => {
        codes.push(code);
        return "\u0001" + (codes.length - 1) + "\u0001";
    });
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => "<code>" + codes[i] + "</code>");
    return s;
}

function codeBlockHtml(block) {
    return (
        '<div class="code">' +
        '<div class="code-bar"><span>' + escapeHtml(block.lang || "code") + '</span>' +
        '<button type="button" class="mini-btn copy-code">' + ICONS.copy + ' Copy</button></div>' +
        "<pre><code>" + escapeHtml(block.code) + "</code></pre></div>"
    );
}

function isTableSeparator(line) {
    const t = line.trim();
    if (!t.includes("|") && !t.includes("-")) return false;
    const cells = t.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    return cells.length >= 2 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function splitTableCells(line) {
    return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

function renderMarkdown(source) {
    const blocks = [];
    const text = String(source || "").replace(/```([\w+#.-]*)[ \t]*\n([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
        blocks.push({ lang, code: code.replace(/\n$/, "") });
        return "\n\u0000" + (blocks.length - 1) + "\u0000\n";
    });

    const lines = text.split("\n");
    let html = "";
    let listType = null;
    let paragraph = [];
    let quoteLines = [];

    const flushParagraph = () => {
        if (paragraph.length) {
            html += "<p>" + inlineMarkdown(paragraph.join("\n")).replace(/\n/g, "<br>") + "</p>";
            paragraph = [];
        }
    };
    const closeList = () => {
        if (listType) {
            html += "</" + listType + ">";
            listType = null;
        }
    };
    const flushQuote = () => {
        if (quoteLines.length) {
            html += "<blockquote><p>" + inlineMarkdown(quoteLines.join("\n")).replace(/\n/g, "<br>") + "</p></blockquote>";
            quoteLines = [];
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trimEnd();
        let m;

        if (!line.trim()) {
            flushParagraph();
            closeList();
            flushQuote();
            continue;
        }

        if ((m = line.match(/^\u0000(\d+)\u0000$/))) {
            flushParagraph();
            closeList();
            flushQuote();
            html += codeBlockHtml(blocks[Number(m[1])]);
            continue;
        }

        // Markdown table check
        if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            flushParagraph();
            closeList();
            flushQuote();
            const headers = splitTableCells(line);
            i++; // skip separator
            let tbl = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
            headers.forEach((h) => { tbl += "<th>" + inlineMarkdown(h) + "</th>"; });
            tbl += "</tr></thead><tbody>";
            while (i + 1 < lines.length && lines[i + 1].trim() && lines[i + 1].includes("|") && !/^\u0000/.test(lines[i + 1])) {
                i++;
                const rowCells = splitTableCells(lines[i]);
                tbl += "<tr>";
                for (let c = 0; c < headers.length; c++) {
                    tbl += "<td>" + inlineMarkdown(rowCells[c] || "") + "</td>";
                }
                tbl += "</tr>";
            }
            tbl += "</tbody></table></div>";
            html += tbl;
            continue;
        }

        if ((m = line.match(/^>\s?(.*)$/))) {
            flushParagraph();
            closeList();
            quoteLines.push(m[1]);
            continue;
        } else {
            flushQuote();
        }

        if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
            flushParagraph();
            closeList();
            const level = Math.min(6, Math.max(2, m[1].length + 1));
            html += "<h" + level + ">" + inlineMarkdown(m[2]) + "</h" + level + ">";
            continue;
        }

        if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
            flushParagraph();
            closeList();
            html += "<hr>";
            continue;
        }

        if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
            flushParagraph();
            if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; }
            html += "<li>" + inlineMarkdown(m[1]) + "</li>";
            continue;
        }

        if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
            flushParagraph();
            if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; }
            html += "<li>" + inlineMarkdown(m[1]) + "</li>";
            continue;
        }

        closeList();
        paragraph.push(line);
    }

    flushParagraph();
    closeList();
    flushQuote();
    return html;
}

/* ==========================================================
   Chat History & Sidebar Management
   ========================================================== */
function loadChats() {
    try {
        const parsed = JSON.parse(readStore("chats") || "[]");
        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages) && c.model && typeof c.model.id === "string")
            .map((c) => ({
                id: c.id,
                title: typeof c.title === "string" && c.title ? c.title : "New chat",
                updatedAt: Number(c.updatedAt) || 0,
                systemPrompt: typeof c.systemPrompt === "string" ? c.systemPrompt : "",
                model: snapshot(c.model),
                origin: c.origin === "random" ? "random" : "picked",
                note: typeof c.note === "string" ? c.note : "",
                messages: c.messages
                    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
                    .map((m) => ({
                        role: m.role,
                        content: m.content,
                        model: typeof m.model === "string" ? m.model : null,
                        error: m.error === true,
                        stats: m.stats && typeof m.stats === "object" ? m.stats : null,
                        images: Array.isArray(m.images)
                            ? m.images
                                .filter((i) => i && typeof i.id === "string")
                                .map((i) => ({ id: i.id, name: String(i.name || "image") }))
                            : []
                    }))
            }));
    } catch (error) {
        console.warn("Could not read saved chats:", error);
        return [];
    }
}

let chats = loadChats();
let activeId = readStore("active") || null;
if (!chats.some((c) => c.id === activeId)) activeId = null;

function saveChats() { writeStore("chats", JSON.stringify(chats)); }
function saveActive() { writeStore("active", activeId || ""); }
function sortedChats() { return chats.slice().sort((a, b) => b.updatedAt - a.updatedAt); }
function getActiveChat() { return chats.find((c) => c.id === activeId) || null; }

function currentModel() {
    const convo = getActiveChat();
    if (convo) return convo.model;
    return draft ? draft.model : null;
}

function currentOrigin() {
    const convo = getActiveChat();
    if (convo) return { origin: convo.origin, note: convo.note };
    return draft ? { origin: draft.origin, note: draft.note } : { origin: "picked", note: "" };
}

function makeTitle(text) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "Image analysis";
    return clean.length > 44 ? clean.slice(0, 44).trimEnd() + "…" : clean;
}

function bucketLabel(ts) {
    const diff = Date.now() - ts;
    if (diff < 86400000) return "Today";
    if (diff < 7 * 86400000) return "Previous 7 Days";
    return "Older";
}

function renderSidebar() {
    chatGroups.textContent = "";
    const all = sortedChats();
    chatCountLabel.textContent = String(all.length);
    sideSearchWrap.hidden = all.length < 3;
    clearChatsBtn.hidden = all.length === 0;

    const q = (chatSearch.value || "").trim().toLowerCase();
    const list = q
        ? all.filter((c) => (c.title + " " + c.model.name + " " + c.model.provider + " " + (c.model.host_label || "")).toLowerCase().includes(q))
        : all;

    chatEmpty.hidden = list.length > 0;
    if (!list.length) {
        chatEmpty.innerHTML = q
            ? "No matching conversations."
            : "No conversations yet.<br>Select any model or launch a fast chat to begin.";
        return;
    }

    const groups = new Map();
    for (const c of list) {
        const b = bucketLabel(c.updatedAt || 0);
        if (!groups.has(b)) groups.set(b, []);
        groups.get(b).push(c);
    }

    for (const [label, items] of groups.entries()) {
        chatGroups.appendChild(el("div", "chat-group-label", label));
        const ul = el("ul", "chat-list");

        for (const c of items) {
            const isActive = c.id === activeId && view === "chat";
            const isConfirm = confirmingDeleteId === c.id;
            const row = el("li", "chat-row" + (isActive ? " active" : "") + (isConfirm ? " confirming" : ""));

            if (renamingChatId === c.id) {
                const wrap = el("div", "chat-item");
                const inp = el("input", "chat-rename-input");
                inp.type = "text";
                inp.value = c.title;
                inp.addEventListener("keydown", (ev) => {
                    if (ev.key === "Enter") {
                        ev.preventDefault();
                        const val = inp.value.trim();
                        if (val) { c.title = val; saveChats(); }
                        renamingChatId = null;
                        renderSidebar();
                    } else if (ev.key === "Escape") {
                        renamingChatId = null;
                        renderSidebar();
                    }
                });
                inp.addEventListener("blur", () => {
                    const val = inp.value.trim();
                    if (val) { c.title = val; saveChats(); }
                    renamingChatId = null;
                    renderSidebar();
                });
                wrap.appendChild(inp);
                row.appendChild(wrap);
                ul.appendChild(row);
                setTimeout(() => { inp.focus(); inp.select(); }, 0);
                continue;
            }

            const open = el("button", "chat-item");
            open.type = "button";
            open.dataset.id = c.id;
            open.title = c.title + " (" + c.model.id + ")";
            if (isActive) open.setAttribute("aria-current", "true");
            open.appendChild(el("span", "chat-title", c.title));

            const meta = el("span", "chat-meta");
            const hostName = c.model.host_label || (c.model.host === "groq" ? "Groq" : c.model.host === "workersai" ? "Workers AI" : "OpenRouter");
            meta.appendChild(el("span", "chat-meta-host", hostName));
            meta.appendChild(document.createTextNode(" · " + c.model.name));
            open.appendChild(meta);

            const acts = el("div", "chat-actions");
            if (isConfirm) {
                const yes = el("button", "chat-act confirm", "Delete");
                yes.type = "button";
                yes.dataset.confirmDel = c.id;
                acts.appendChild(yes);
            } else {
                const ren = el("button", "chat-act");
                ren.type = "button";
                ren.dataset.rename = c.id;
                ren.title = "Rename conversation";
                ren.setAttribute("aria-label", "Rename conversation");
                ren.innerHTML = ICONS.edit;
                acts.appendChild(ren);

                const del = el("button", "chat-act del");
                del.type = "button";
                del.dataset.del = c.id;
                del.title = "Delete conversation";
                del.setAttribute("aria-label", "Delete conversation");
                del.innerHTML = ICONS.trash;
                acts.appendChild(del);
            }

            row.appendChild(open);
            row.appendChild(acts);
            ul.appendChild(row);
        }

        chatGroups.appendChild(ul);
    }
}

/* ==========================================================
   Sidebar Drawer, Modals & Header Sync
   ========================================================== */
function isMobileLayout() {
    return window.matchMedia("(max-width: 860px)").matches;
}

function applySidebarState() {
    if (isMobileLayout()) {
        document.body.classList.remove("sidebar-collapsed");
        sidebarToggle.setAttribute("aria-expanded", String(sidebar.classList.contains("open")));
    } else {
        document.body.classList.toggle("sidebar-collapsed", sidebarCollapsed);
        sidebarToggle.setAttribute("aria-expanded", String(!sidebarCollapsed));
    }
}

function openDrawer() {
    sidebar.classList.add("open");
    scrim.hidden = false;
    sidebarToggle.setAttribute("aria-expanded", "true");
}

function closeDrawer() {
    sidebar.classList.remove("open");
    scrim.hidden = true;
    applySidebarState();
}

function toggleSidebar() {
    if (isMobileLayout()) {
        if (sidebar.classList.contains("open")) closeDrawer();
        else openDrawer();
    } else {
        sidebarCollapsed = !sidebarCollapsed;
        writeStore("sidebar", sidebarCollapsed ? "collapsed" : "open");
        applySidebarState();
    }
}

function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.hidden = false;
}

function closeLightbox() {
    lightbox.hidden = true;
    lightboxImg.removeAttribute("src");
}

function closeModals() {
    inspectorModal.hidden = true;
    switchModal.hidden = true;
    inspectModelId = null;
    switchContext = null;
}

function updateHeader() {
    const model = currentModel();
    if (view === "chat" && model) {
        const hostText = model.host_label || (model.host === "groq" ? "Groq" : model.host === "workersai" ? "Workers AI" : "OpenRouter");
        modelLabel.textContent = model.name + " · via " + hostText;
        modelLabel.title = model.id;
    } else {
        modelLabel.textContent = "Live Free AI Observatory";
        modelLabel.title = "";
    }
    dashButton.setAttribute("aria-current", view === "dashboard" ? "page" : "false");
}

function showView(name) {
    view = name;
    viewDash.hidden = name !== "dashboard";
    viewChat.hidden = name !== "chat";
    updateHeader();
}

function focusInput() {
    if (view === "chat" && !isMobileLayout()) input.focus();
}

/* ==========================================================
   Chat Header Banner & System Prompt Drawer
   ========================================================== */
function renderBanner() {
    const model = currentModel();
    banner.textContent = "";

    if (!model) {
        banner.hidden = true;
        return;
    }
    banner.hidden = false;

    const convo = getActiveChat();
    const meta = currentOrigin();
    const liveInfo = live.models[model.id];

    const topRow = el("div", "banner-row");
    const main = el("div", "banner-main");
    main.appendChild(providerTile(model.provider, "sm"));

    const text = el("div", "banner-text");
    const titleLine = el("div", "banner-title-line");
    titleLine.appendChild(el("span", "banner-title", model.name));
    titleLine.appendChild(hostBadge(model.host, model.host_label));
    if (meta.origin === "random") titleLine.appendChild(el("span", "tag accent", "Random fast pick"));
    abilityTags(model).forEach((t) => titleLine.appendChild(el("span", "tag " + t.cls, t.label)));
    text.appendChild(titleLine);

    const bits = [];
    if (model.provider) bits.push(model.provider);
    if (model.context_label) bits.push(model.context_label + " context");
    if (model.params_label && model.params_label !== "Size not stated") bits.push(model.params_label);
    if (liveInfo && liveInfo.latency_ms != null) {
        bits.push(fmtMs(liveInfo.latency_ms) + (liveInfo.latency_source === "measured" ? " live TTFT" : " 30m median"));
    }
    if (liveInfo && liveInfo.state === "throttled") bits.push("Rate limited recently");
    text.appendChild(el("span", "banner-sub", bits.join(" · ")));
    if (meta.origin === "random" && meta.note) {
        text.appendChild(el("span", "banner-sub", meta.note));
    }

    main.appendChild(text);
    topRow.appendChild(main);

    const controls = el("div", "banner-controls");

    const curSys = convo ? convo.systemPrompt : (draft ? draft.systemPrompt || "" : "");
    const sysBtn = el("button", "btn btn-sm" + (curSys ? " btn-soft" : ""), curSys ? "System Prompt ●" : "System Prompt");
    sysBtn.type = "button";
    sysBtn.addEventListener("click", () => {
        sysDrawerOpen = !sysDrawerOpen;
        renderBanner();
    });
    controls.appendChild(sysBtn);

    const switchBtn = el("button", "btn btn-sm", "Switch / Fork Model");
    switchBtn.type = "button";
    switchBtn.addEventListener("click", () => {
        const lastUser = convo ? [...convo.messages].reverse().find((m) => m.role === "user") : null;
        openSwitchModal({
            carryMessages: convo ? convo.messages.filter((m) => !m.error) : [],
            carryPrompt: !convo ? input.value.trim() : (lastUser ? lastUser.content : "")
        });
    });
    controls.appendChild(switchBtn);

    if (convo && convo.messages.length) {
        const expBtn = el("button", "btn btn-sm", "Export .md");
        expBtn.type = "button";
        expBtn.addEventListener("click", () => exportChatMarkdown(convo));
        controls.appendChild(expBtn);
    }

    const backBtn = el("button", "btn btn-sm", "All Models");
    backBtn.type = "button";
    backBtn.addEventListener("click", openDashboard);
    controls.appendChild(backBtn);

    topRow.appendChild(controls);
    banner.appendChild(topRow);

    if (sysDrawerOpen) {
        const drawer = el("div", "sys-drawer");
        const lbl = document.createElement("label");
        lbl.innerHTML = '<span>Custom System Instructions (applies to every turn in this chat)</span><span style="color:var(--faint)">Leave blank for default</span>';
        const area = document.createElement("textarea");
        area.placeholder = "You are a helpful chatbot. (e.g., 'Answer concisely with bullet points and code examples.')";
        area.maxLength = 2000;
        area.value = curSys || "";
        area.addEventListener("input", () => {
            if (convo) {
                convo.systemPrompt = area.value;
                saveChats();
            } else if (draft) {
                draft.systemPrompt = area.value;
            }
        });
        drawer.appendChild(lbl);
        drawer.appendChild(area);
        banner.appendChild(drawer);
    }
}

function exportChatMarkdown(convo) {
    const lines = [
        "# " + convo.title,
        "",
        "- **Model:** " + convo.model.name + " (`" + convo.model.id + "`)",
        "- **Host:** " + (convo.model.host_label || convo.model.host || "OpenRouter"),
        "- **Exported:** " + new Date().toISOString(),
        ""
    ];
    if (convo.systemPrompt) {
        lines.push("> **System Prompt:** " + convo.systemPrompt.replace(/\n/g, " "), "");
    }
    lines.push("---", "");
    for (const m of convo.messages) {
        lines.push("### " + (m.role === "user" ? "User" : convo.model.name));
        if (m.stats && m.stats.ttftMs) {
            lines.push("*TTFT: " + m.stats.ttftMs + " ms · Total: " + (m.stats.totalMs / 1000).toFixed(2) + "s*");
        }
        lines.push("", m.content, "");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (convo.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "afterworld-chat") + ".md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Exported conversation as Markdown.");
}

/* ==========================================================
   Dashboard Catalog, Filters, Sorting & Views
   ========================================================== */
async function loadCatalog(force, { silent = false } = {}) {
    if (!silent) {
        catalogState = "loading";
        renderDashboard();
    }

    try {
        const res = await fetch("/api/models" + (force ? "?refresh=1" : ""), { cache: "no-store" });
        if (!res.ok) throw new ApiError(await readError(res));

        catalog = await res.json();
        catalogState = "ready";
        if (catalog.version) versionKicker.textContent = "v" + catalog.version;
    } catch (error) {
        console.error(error);
        catalogError = error instanceof ApiError ? error.message : NETWORK_ERROR;
        if (!catalog) catalogState = "error";
    }

    renderDashboard();
    if (catalogState === "ready" && !silent) loadLive();
}

function latencyOf(model) {
    const info = live.models[model.id];
    return info && info.latency_ms !== null && info.latency_ms !== undefined ? info.latency_ms : null;
}

function filteredModels() {
    if (!catalog) return [];
    const query = dash.query.trim().toLowerCase();

    return catalog.models.filter((m) => {
        const host = m.host || "openrouter";
        if (dash.host !== "all" && host !== dash.host) return false;

        for (const key of dash.filters) {
            if (key === "fast") {
                const ms = latencyOf(m);
                const info = live.models[m.id];
                if (ms === null || ms > 1000 || (info && (info.state === "throttled" || info.state === "degraded"))) return false;
            } else if (!m[key]) {
                return false;
            }
        }

        if (!query) return true;
        return (m.full_name + " " + m.id + " " + m.provider + " " + (m.host_label || "") + " " + (m.description || "")).toLowerCase().includes(query);
    });
}

function sortItems(items) {
    const byName = (a, b) => a.name.localeCompare(b.name);
    const byContext = (a, b) => (b.context - a.context) || byName(a, b);

    if (dash.sort === "name") return items.sort(byName);
    if (dash.sort === "score") {
        return items.sort((a, b) => {
            const sa = a.intelligence ?? -1;
            const sb = b.intelligence ?? -1;
            return (sb - sa) || byContext(a, b);
        });
    }
    if (dash.sort === "size") {
        return items.sort((a, b) => {
            const pa = a.params_total_b ?? -1;
            const pb = b.params_total_b ?? -1;
            return (pb - pa) || byContext(a, b);
        });
    }
    if (dash.sort === "latency") {
        return items.sort((a, b) => {
            const la = latencyOf(a);
            const lb = latencyOf(b);
            if (la === null && lb === null) return byContext(a, b);
            if (la === null) return 1;
            if (lb === null) return -1;
            return (la - lb) || byContext(a, b);
        });
    }
    return items.sort(byContext);
}

function visibleGroups() {
    const models = filteredModels();
    if (!models.length) return [];

    if (dash.group === "none") {
        return [{ group: { key: "all", label: "All Matching Free Models" }, items: sortItems(models.slice()) }];
    }

    const key = catalog.groupings[dash.group] ? dash.group : "context";
    const config = catalog.groupings[key];

    return config.groups
        .map((group) => ({
            group,
            items: sortItems(models.filter((m) => m.tiers[key] === group.key))
        }))
        .filter((entry) => entry.items.length);
}

function renderHostTabs() {
    hostTabs.textContent = "";
    if (!catalog) return;

    const hosts = catalog.hosts && catalog.hosts.length
        ? catalog.hosts
        : [{ key: "openrouter", label: "OpenRouter", count: catalog.count }];

    if (dash.host !== "all" && !hosts.some((h) => h.key === dash.host)) {
        dash.host = "all";
    }

    const makeTab = (key, label, count) => {
        const btn = el("button", "host-tab");
        btn.type = "button";
        btn.dataset.hostKey = key;
        btn.setAttribute("aria-pressed", String(dash.host === key));
        btn.appendChild(document.createTextNode(label + " "));
        btn.appendChild(el("span", "cnt", String(count)));
        return btn;
    };

    hostTabs.appendChild(makeTab("all", "All Hosts", catalog.count));
    hosts.forEach((h) => {
        if (h.count > 0 || h.key === "openrouter") {
            hostTabs.appendChild(makeTab(h.key, h.label, h.count));
        }
    });
}

function fillLatencyCell(cell, id) {
    if (!cell) return;
    cell.textContent = "";

    const info = live.models[id];
    const line = el("div", "speed-line");
    let subText = "";

    if (testing.has(id)) {
        const btn = el("button", "probe-btn", "Probing…");
        btn.type = "button";
        btn.disabled = true;
        line.appendChild(btn);
        subText = "Measuring live TTFT…";
    } else {
        if (info && info.latency_ms !== null && info.latency_ms !== undefined) {
            const pill = el("span", "speed-pill " + speedTone(info.latency_ms), fmtMs(info.latency_ms));
            pill.title = Math.round(info.latency_ms) + " ms to first output";
            line.appendChild(pill);
            subText = info.latency_source === "measured"
                ? "Live · " + ago(info.latency_age_s)
                : "30m median";
        } else {
            line.appendChild(el("span", "v muted", "Unmeasured"));
            subText = "Click Probe to time";
        }

        const test = el("button", "probe-btn");
        test.type = "button";
        test.dataset.test = id;
        test.title = "Send a lightweight probe to measure live TTFT right now";
        test.innerHTML = "⚡ Probe";
        line.appendChild(test);
    }

    const note = testNotes.get(id);
    if (note && note.until > Date.now()) subText = note.text;

    cell.appendChild(line);
    if (subText) cell.appendChild(el("span", "s", subText));
}

function fillHealthCell(cell, id) {
    if (!cell) return;
    cell.textContent = "";

    const model = catalog && catalog.models.find((m) => m.id === id);
    const host = model?.host || "openrouter";
    const prov = providerStatus.find((p) => p.key === host);
    const info = live.models[id];

    let label = "Ready";
    let cls = "ready";
    if (info) {
        if (info.state === "throttled") {
            label = "Throttled " + ago(info.throttled_age_s);
            cls = "warn";
        } else if (info.state === "degraded") {
            label = "Degraded";
            cls = "warn";
        } else if (info.state === "healthy") {
            label = info.uptime != null ? "Healthy · " + Math.round(info.uptime) + "%" : "Verified OK";
            cls = "ok";
        }
    }

    cell.appendChild(el("span", "status-badge " + cls, label));

    let usageSub = "";
    if (prov) {
        const mCounts = prov.scope === "model" ? prov.models?.[id] : prov.usage;
        if (mCounts && (mCounts.minute > 0 || mCounts.day > 0)) {
            usageSub = mCounts.minute + "/min · " + mCounts.day + " today";
        } else {
            usageSub = prov.quota_label || (prov.limit_per_min ? prov.limit_per_min + " req/min shared" : "Free tier");
        }
    } else {
        usageSub = host === "openrouter" ? "20 req/min shared" : "Free tier";
    }
    cell.appendChild(el("span", "s", usageSub));
}

function buildFeatureTags(m) {
    const tags = el("div", "tags");
    abilityTags(m).forEach((t) => tags.appendChild(el("span", "tag " + t.cls, t.label)));
    if (m.intelligence !== null && m.intelligence !== undefined) {
        const sc = el("span", "tag score", "AAII " + parseFloat(m.intelligence.toFixed(1)));
        sc.title = "Artificial Analysis Intelligence Index";
        tags.appendChild(sc);
    }
    if (m.expires) {
        const ex = el("span", "tag warn", "Until " + fmtDate(m.expires));
        tags.appendChild(ex);
    }
    return tags;
}

function modelRow(m) {
    const row = el("div", "row");
    row.dataset.id = m.id;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", "Start a chat with " + m.name);

    const modelCell = el("div", "cell c-model");
    modelCell.appendChild(providerTile(m.provider));
    const text = el("div", "model-text");
    const titleLine = el("div", "model-title-line");
    titleLine.appendChild(el("span", "model-name", m.name));
    titleLine.appendChild(hostBadge(m.host, m.host_label));
    text.appendChild(titleLine);

    const desc = el("div", "model-desc");
    desc.appendChild(el("span", "prov", m.provider));
    if (m.description) desc.appendChild(document.createTextNode(" · " + m.description));
    text.appendChild(desc);
    modelCell.appendChild(text);
    row.appendChild(modelCell);

    const ctxCell = el("div", "cell context");
    ctxCell.dataset.label = "Context";
    ctxCell.appendChild(el("span", "v", m.context_label || "—"));
    ctxCell.appendChild(el("span", "s", m.max_output_label ? m.max_output_label + " max out" : "Dynamic out"));
    row.appendChild(ctxCell);

    const sizeCell = el("div", "cell size");
    sizeCell.dataset.label = "Parameters";
    if (m.params_total_b) {
        const val = el("span", "v", fmtBillions(m.params_total_b));
        val.title = SIZE_SOURCES[m.params_source] || "";
        sizeCell.appendChild(val);
        sizeCell.appendChild(el("span", "s", m.params_active_b ? fmtBillions(m.params_active_b) + " active MoE" : "Dense / total"));
    } else {
        sizeCell.appendChild(el("span", "v muted", "Unlisted"));
        sizeCell.appendChild(el("span", "s", "Not published"));
    }
    row.appendChild(sizeCell);

    const latCell = el("div", "cell latency");
    latCell.dataset.label = "Speed (TTFT)";
    fillLatencyCell(latCell, m.id);
    row.appendChild(latCell);

    const healthCell = el("div", "cell limit");
    healthCell.dataset.label = "Health & Quota";
    fillHealthCell(healthCell, m.id);
    row.appendChild(healthCell);

    const featCell = el("div", "cell features");
    featCell.appendChild(buildFeatureTags(m));
    row.appendChild(featCell);

    const actCell = el("div", "cell row-actions");
    const infoBtn = el("button", "info-btn");
    infoBtn.type = "button";
    infoBtn.dataset.inspect = m.id;
    infoBtn.title = "Inspect model details";
    infoBtn.setAttribute("aria-label", "Inspect " + m.name);
    infoBtn.innerHTML = ICONS.info;
    actCell.appendChild(infoBtn);

    const arrow = el("span", "go-arrow");
    arrow.innerHTML = ICONS.chevron;
    actCell.appendChild(arrow);
    row.appendChild(actCell);

    return row;
}

function modelCard(m) {
    const card = el("article", "mcard");
    card.dataset.id = m.id;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", "Start a chat with " + m.name);

    const top = el("div", "mcard-top");
    top.appendChild(providerTile(m.provider));
    const head = el("div", "mcard-head");
    head.appendChild(el("div", "mcard-name", m.name));
    const prov = el("div", "mcard-prov");
    prov.appendChild(el("span", "", m.provider));
    prov.appendChild(hostBadge(m.host, m.host_label));
    head.appendChild(prov);
    top.appendChild(head);

    const infoBtn = el("button", "info-btn");
    infoBtn.type = "button";
    infoBtn.dataset.inspect = m.id;
    infoBtn.title = "Inspect model details";
    infoBtn.innerHTML = ICONS.info;
    top.appendChild(infoBtn);
    card.appendChild(top);

    card.appendChild(el("p", "mcard-desc", m.description || ("Free chat endpoint served via " + (m.host_label || "OpenRouter") + ".")));

    const stats = el("div", "mcard-stats");
    const s1 = el("div", "mcard-stat");
    s1.appendChild(el("span", "", "Context"));
    s1.appendChild(el("b", "", m.context_label || "—"));
    stats.appendChild(s1);

    const s2 = el("div", "mcard-stat");
    s2.appendChild(el("span", "", "Params"));
    s2.appendChild(el("b", "", m.params_total_b ? fmtBillions(m.params_total_b) : "Unlisted"));
    stats.appendChild(s2);

    const s3 = el("div", "mcard-stat mcard-speed");
    s3.appendChild(el("span", "", "Speed"));
    const info = live.models[m.id];
    s3.appendChild(el("b", "", info && info.latency_ms != null ? fmtMs(info.latency_ms) : "Unmeasured"));
    stats.appendChild(s3);
    card.appendChild(stats);

    card.appendChild(buildFeatureTags(m));

    const foot = el("div", "mcard-foot");
    const probe = el("button", "probe-btn");
    probe.type = "button";
    probe.dataset.test = m.id;
    probe.disabled = testing.has(m.id);
    probe.textContent = testing.has(m.id) ? "Probing…" : "⚡ Live Probe";
    foot.appendChild(probe);

    const startSpan = el("span", "go-arrow");
    startSpan.innerHTML = ICONS.chevron;
    foot.appendChild(startSpan);
    card.appendChild(foot);

    return card;
}

function renderMeta() {
    dashMeta.textContent = "";
    if (!catalog) return;

    const shown = filteredModels();
    const total = catalog.count;
    const hostCount = (catalog.hosts || []).filter((h) => h.count > 0).length || 1;

    heroEyebrowText.textContent = total + " Verified Free Models · " + hostCount + (hostCount === 1 ? " Active Host" : " Active Hosts");

    const left = el("div", "meta-left");
    left.appendChild(el("b", "tabular", shown.length === total ? total + " free models" : "Showing " + shown.length + " of " + total + " models"));

    const hiddenCount = (catalog.excluded_agent_only || 0) + (catalog.excluded_paid || 0);
    if (hiddenCount > 0) {
        const pill = el("span", "meta-pill", hiddenCount + " incompatible/paid auto-hidden");
        pill.title = "Afterworld automatically filters out agent-only and paid-plan-only endpoints.";
        left.appendChild(pill);
    }

    left.appendChild(el("span", "tabular", "Catalog synced " + timeAgo(catalog.fetched_at)));
    dashMeta.appendChild(left);

    const right = el("div", "meta-right");
    const unmeasuredVisible = shown.filter((m) => latencyOf(m) === null && !testing.has(m.id)).slice(0, 3);
    if (unmeasuredVisible.length > 0) {
        const batchBtn = el("button", "btn btn-sm", batchBusy ? "Probing…" : "⚡ Probe " + unmeasuredVisible.length + " Unmeasured");
        batchBtn.type = "button";
        batchBtn.id = "batch-probe-btn";
        batchBtn.disabled = batchBusy;
        batchBtn.title = "Measure live TTFT on up to 3 visible unmeasured models";
        right.appendChild(batchBtn);
    }

    const refreshBtn = el("button", "btn btn-sm", catalogState === "loading" ? "Refreshing…" : "Refresh Catalog");
    refreshBtn.type = "button";
    refreshBtn.id = "refresh-btn";
    refreshBtn.disabled = catalogState === "loading";
    right.appendChild(refreshBtn);

    dashMeta.appendChild(right);
}

function renderDashboard() {
    groupSeg.querySelectorAll("button").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.group === dash.group));
    });
    filtersBox.querySelectorAll(".toggle").forEach((t) => {
        t.setAttribute("aria-pressed", String(dash.filters.has(t.dataset.filter)));
    });
    viewSwitch.querySelectorAll("button").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.layout === dash.layout));
    });
    sortSelect.value = dash.sort;

    const hasActiveFilter = dash.host !== "all" || dash.query.trim() !== "" || dash.filters.size > 0;
    resetFiltersBtn.hidden = !hasActiveFilter;
    searchKbd.hidden = dash.query.length > 0;
    searchClear.hidden = dash.query.length === 0;

    renderHostTabs();
    renderMeta();
    dashBody.textContent = "";

    if (!catalog && catalogState === "loading") {
        for (let i = 0; i < 6; i++) dashBody.appendChild(el("div", "skeleton-row"));
        return;
    }

    if (!catalog) {
        const box = el("div", "state-box err");
        box.appendChild(el("b", "", "Couldn't load the free model catalog"));
        box.appendChild(el("span", "", catalogError || NETWORK_ERROR));
        box.appendChild(document.createElement("br"));
        const retry = el("button", "btn btn-primary", "Try Again");
        retry.type = "button";
        retry.id = "retry-catalog";
        box.appendChild(retry);
        dashBody.appendChild(box);
        return;
    }

    const groups = visibleGroups();
    if (!groups.length) {
        const box = el("div", "state-box");
        box.appendChild(el("b", "", "No models match your current filters"));
        box.appendChild(el("span", "", "Try clearing your search or turning off capability filters."));
        box.appendChild(document.createElement("br"));
        const clear = el("button", "btn", "Reset All Filters");
        clear.type = "button";
        clear.id = "clear-empty-filters";
        box.appendChild(clear);
        dashBody.appendChild(box);
        return;
    }

    const list = el("div", "list");
    if (dash.layout === "table") {
        const head = el("div", "list-head");
        ["Model & Host", "Context", "Params", "Speed (TTFT)", "Health & Quota", "Capabilities", ""].forEach((label) => {
            head.appendChild(el("span", "", label));
        });
        list.appendChild(head);
    }

    for (const entry of groups) {
        const section = el("section", "group");
        if (dash.group !== "none") {
            const gHead = el("div", "group-head");
            gHead.appendChild(el("h2", "group-title", entry.group.label));
            gHead.appendChild(el("span", "group-count", String(entry.items.length)));
            section.appendChild(gHead);
        }

        if (dash.layout === "cards") {
            const grid = el("div", "cards-grid");
            entry.items.forEach((m) => grid.appendChild(modelCard(m)));
            section.appendChild(grid);
        } else {
            const rows = el("div", "rows");
            entry.items.forEach((m) => rows.appendChild(modelRow(m)));
            section.appendChild(rows);
        }
        list.appendChild(section);
    }

    dashBody.appendChild(list);
}

/* ==========================================================
   Model Inspector & Switch/Fork Modals
   ========================================================== */
function openInspector(modelId) {
    if (!catalog) return;
    const m = catalog.models.find((x) => x.id === modelId);
    if (!m) return;
    inspectModelId = m.id;

    inspectorHeadMain.textContent = "";
    inspectorHeadMain.appendChild(providerTile(m.provider, "lg"));
    const hText = el("div", "banner-text");
    const hLine = el("div", "banner-title-line");
    const hTitle = el("h2", "banner-title", m.name);
    hTitle.id = "inspector-title";
    hTitle.style.margin = "0";
    hTitle.style.fontSize = "17px";
    hLine.appendChild(hTitle);
    hLine.appendChild(hostBadge(m.host, m.host_label));
    hText.appendChild(hLine);
    hText.appendChild(el("span", "banner-sub", m.provider + " · Free Chat Endpoint"));
    inspectorHeadMain.appendChild(hText);

    inspectorBody.textContent = "";

    const idRow = el("div", "id-copy-row");
    idRow.appendChild(el("span", "", m.id));
    const copyIdBtn = el("button", "mini-btn", "Copy ID");
    copyIdBtn.type = "button";
    copyIdBtn.addEventListener("click", () => copyText(m.id, copyIdBtn));
    idRow.appendChild(copyIdBtn);
    inspectorBody.appendChild(idRow);

    if (m.description) {
        const descP = el("p", "", m.description);
        descP.style.margin = "0 0 14px";
        descP.style.color = "var(--text-soft)";
        descP.style.lineHeight = "1.6";
        inspectorBody.appendChild(descP);
    }

    const info = live.models[m.id];
    const grid = el("dl", "spec-grid");
    const addSpec = (label, val, sub) => {
        const box = el("div", "spec-box");
        box.appendChild(el("dt", "", label));
        box.appendChild(el("dd", "", val));
        if (sub) box.appendChild(el("small", "", sub));
        grid.appendChild(box);
    };

    addSpec("Context Window", m.context_label || "—", m.context ? m.context.toLocaleString("en-US") + " tokens" : "Not stated");
    addSpec("Max Output", m.max_output_label || "Dynamic", m.max_output ? m.max_output.toLocaleString("en-US") + " tokens" : "Host default");
    addSpec("Parameters", m.params_label || "Unlisted", SIZE_SOURCES[m.params_source] || "Never guessed");
    addSpec(
        "Live Speed (TTFT)",
        info && info.latency_ms != null ? fmtMs(info.latency_ms) : "Unmeasured",
        info && info.latency_ms != null ? (info.latency_source === "measured" ? "Measured " + ago(info.latency_age_s) : "OpenRouter 30m p50") : "Probe below to measure"
    );
    addSpec(
        "Endpoint Health",
        info ? (info.state === "throttled" ? "Rate Limited" : info.state === "healthy" ? "Healthy" : "Ready") : "Ready",
        info && info.uptime != null ? Math.round(info.uptime) + "% 30m uptime" : (m.host_label || "OpenRouter")
    );
    addSpec(
        "AAII Benchmark",
        m.intelligence != null ? String(parseFloat(m.intelligence.toFixed(1))) : "Unranked",
        m.intelligence != null ? "Artificial Analysis Index" : "Not yet evaluated"
    );
    inspectorBody.appendChild(grid);
    inspectorBody.appendChild(buildFeatureTags(m));

    inspectorFoot.textContent = "";
    const probeBtn = el("button", "btn", testing.has(m.id) ? "Probing…" : "⚡ Live Speed Probe");
    probeBtn.type = "button";
    probeBtn.disabled = testing.has(m.id);
    probeBtn.addEventListener("click", async () => {
        probeBtn.disabled = true;
        probeBtn.textContent = "Probing…";
        await testModel(m.id);
        if (inspectModelId === m.id) openInspector(m.id);
    });
    inspectorFoot.appendChild(probeBtn);

    const startBtn = el("button", "btn btn-primary", "Start Chat with " + m.name);
    startBtn.type = "button";
    startBtn.addEventListener("click", () => {
        closeModals();
        startDraft(m, "picked", "");
    });
    inspectorFoot.appendChild(startBtn);

    inspectorModal.hidden = false;
}

function openSwitchModal(context) {
    if (!catalog || !catalog.models.length) {
        openDashboard();
        return;
    }
    switchContext = context || { carryMessages: [], carryPrompt: "" };
    const hasHistory = switchContext.carryMessages && switchContext.carryMessages.length > 0;
    switchSub.textContent = hasHistory
        ? "Pick a model to fork this conversation into a clean session with your history preserved, or start fresh."
        : "Pick a model to start chatting right away.";
    switchSearch.value = "";
    renderSwitchList();
    switchModal.hidden = false;
    setTimeout(() => switchSearch.focus(), 20);
}

function renderSwitchList() {
    switchList.textContent = "";
    if (!catalog) return;
    const q = (switchSearch.value || "").trim().toLowerCase();
    const cur = currentModel();

    const candidates = sortItems(
        catalog.models.filter((m) => {
            if (cur && m.id === cur.id) return false;
            if (!q) return true;
            return (m.name + " " + m.provider + " " + (m.host_label || "") + " " + m.id).toLowerCase().includes(q);
        })
    );

    if (!candidates.length) {
        switchList.appendChild(el("p", "chat-empty", "No matching models found."));
        return;
    }

    for (const m of candidates) {
        const btn = el("button", "switch-row");
        btn.type = "button";

        const left = el("div", "banner-main");
        left.appendChild(providerTile(m.provider, "sm"));
        const txt = el("div", "banner-text");
        const tl = el("div", "banner-title-line");
        tl.appendChild(el("span", "banner-title", m.name));
        tl.appendChild(hostBadge(m.host, m.host_label));
        txt.appendChild(tl);
        const info = live.models[m.id];
        const speedStr = info && info.latency_ms != null ? fmtMs(info.latency_ms) : "Unmeasured";
        txt.appendChild(el("span", "banner-sub", m.provider + " · " + (m.context_label || "—") + " ctx · " + speedStr));
        left.appendChild(txt);
        btn.appendChild(left);

        btn.appendChild(el("span", "btn btn-sm btn-soft", switchContext?.carryMessages?.length ? "Fork Chat →" : "Use Model →"));
        btn.addEventListener("click", () => {
            const ctx = switchContext;
            closeModals();
            if (ctx && ctx.carryMessages && ctx.carryMessages.length > 0) {
                forkChatToModel(m, ctx.carryMessages);
            } else {
                const promptText = ctx?.carryPrompt || "";
                startDraft(m, "picked", "");
                if (promptText) {
                    input.value = promptText;
                    autosize();
                    updateSendState();
                }
            }
        });
        switchList.appendChild(btn);
    }
}

function forkChatToModel(model, messages) {
    const cleanCopy = messages.map((m) => ({
        role: m.role,
        content: m.content,
        model: m.model,
        error: false,
        stats: m.stats || null,
        images: (m.images || []).map((img) => ({ id: img.id, name: img.name }))
    }));
    const firstUser = cleanCopy.find((m) => m.role === "user");
    const convo = {
        id: uid(),
        title: makeTitle(firstUser ? firstUser.content : "Forked chat"),
        updatedAt: Date.now(),
        systemPrompt: getActiveChat()?.systemPrompt || "",
        model: snapshot(model),
        origin: "picked",
        note: "Forked conversation to " + model.name,
        messages: cleanCopy
    };
    chats.unshift(convo);
    activeId = convo.id;
    draft = null;
    saveChats();
    saveActive();

    showView("chat");
    renderChat(convo);
    renderBanner();
    setComposerModel();
    renderSidebar();
    focusInput();

    // If the last message in the forked chat is a user prompt awaiting an answer, generate immediately!
    if (convo.messages.length && convo.messages[convo.messages.length - 1].role === "user") {
        streamReply(convo);
    }
}

/* ==========================================================
   Real-Time Live Telemetry, Speed Probes & Random Fast Pick
   ========================================================== */
function findFastestModel() {
    const FRESH_S = 15 * 60;
    const listed = new Set(catalog ? catalog.models.map((m) => m.id) : []);
    const pick = (ok) => {
        let top = null;
        for (const [id, info] of Object.entries(live.models)) {
            if (catalog && !listed.has(id)) continue;
            if (info.latency_ms === null || info.latency_ms === undefined) continue;
            if (info.state === "throttled" || info.state === "degraded") continue;
            if (!ok(info)) continue;
            if (!top || info.latency_ms < top.ms) top = { id, ms: info.latency_ms, info };
        }
        return top;
    };
    let best = pick((i) => i.latency_source === "measured" && i.latency_age_s !== null && i.latency_age_s <= FRESH_S);
    if (best) return { ...best, basis: "measured" };
    best = pick((i) => i.latency_source === "openrouter");
    if (best) return { ...best, basis: "openrouter" };
    return null;
}

function renderProviderStatus() {
    providerStatusBox.textContent = "";
    if (!providerStatus.length) {
        if (live.state === "error") {
            providerStatusBox.appendChild(el("div", "prov-item", "Provider telemetry temporarily unavailable."));
        }
        return;
    }

    for (const p of providerStatus) {
        const card = el("div", "prov-item");
        const top = el("div", "prov-top");

        const nameWrap = el("div", "prov-name-wrap");
        nameWrap.appendChild(hostBadge(p.key, p.name));
        if (typeof p.model_count === "number") {
            nameWrap.appendChild(el("span", "prov-count-badge", p.model_count + (p.model_count === 1 ? " model" : " models")));
        }
        top.appendChild(nameWrap);

        const minCount = p.usage ? p.usage.minute : 0;
        const dayCount = p.usage ? p.usage.day : 0;
        const usageStr = p.limit_per_min
            ? minCount + "/" + p.limit_per_min + " min · " + dayCount + " today"
            : minCount + " min · " + dayCount + " today";
        top.appendChild(el("span", "prov-usage", usageStr));
        card.appendChild(top);

        const sub = el("div", "prov-sub");
        sub.appendChild(el("span", "", p.quota_label || (p.scope === "model" ? "Limits vary by model" : "Account-wide free tier")));
        if (p.fastest && p.fastest.name) {
            const fSpan = el("span", "prov-fast-tag", "Fastest: " + p.fastest.name + " (" + fmtMs(p.fastest.latency_ms) + ")");
            sub.appendChild(fSpan);
        }
        card.appendChild(sub);

        if (p.scope === "account" && p.limit_per_min) {
            const bar = el("div", "prov-bar");
            const fill = el("i", "");
            const used = p.usage?.free_minute ?? minCount;
            const ratio = used / p.limit_per_min;
            fill.style.width = Math.min(100, Math.max(used > 0 ? 4 : 0, ratio * 100)) + "%";
            if (ratio >= 0.95) fill.className = "hot";
            else if (ratio >= 0.65) fill.className = "warn";
            bar.appendChild(fill);
            card.appendChild(bar);
        }

        providerStatusBox.appendChild(card);
    }
}

function updateLiveStamp() {
    if (live.state === "ready" && live.updatedAt) {
        const rel = ago((Date.now() - live.updatedAt) / 1000);
        liveStamp.textContent = "Synced " + rel;
    }
}

function updateLivePanel() {
    if (live.state !== "ready") {
        liveDot.className = "pulse-dot" + (live.state === "error" ? " err" : "");
        topLiveDot.className = "pulse-dot" + (live.state === "error" ? " err" : "");
        liveStamp.textContent = live.state === "error" ? "Sync failed" : "Syncing…";
        topLiveText.textContent = live.state === "error" ? "Telemetry offline" : "Syncing…";
        if (live.state === "error") {
            liveFastestName.textContent = "Telemetry unavailable";
            liveFastestSub.textContent = "Click refresh to retry live telemetry.";
        }
        return;
    }

    liveDot.className = "pulse-dot on";
    topLiveDot.className = "pulse-dot on";
    updateLiveStamp();

    const totalReqsToday = providerStatus.length
        ? providerStatus.reduce((acc, p) => acc + (p.usage?.day || 0), 0)
        : (live.usage?.day || 0);
    const totalReqsMin = providerStatus.length
        ? providerStatus.reduce((acc, p) => acc + (p.usage?.minute || 0), 0)
        : (live.usage?.minute || 0);
    topLiveText.textContent = (catalog ? catalog.count + " models · " : "") + totalReqsMin + "/min · " + totalReqsToday + " today";

    const best = findFastestModel();
    if (best) {
        const found = catalog && catalog.models.find((m) => m.id === best.id);
        currentFastestId = best.id;
        liveFastestName.textContent = found ? found.name : best.id;
        liveFastestMs.textContent = fmtMs(best.ms);
        liveFastestMs.hidden = false;

        if (found) {
            liveFastestHost.textContent = found.host_label || found.host || "OpenRouter";
            liveFastestHost.dataset.host = found.host || "openrouter";
            liveFastestHost.hidden = false;
            instantFastestLabel.textContent = "⚡ Chat with " + found.name + " (" + fmtMs(best.ms) + ")";
            instantFastestBtn.hidden = false;
        } else {
            liveFastestHost.hidden = true;
            instantFastestBtn.hidden = true;
        }

        liveFastestSub.textContent = best.basis === "measured"
            ? "Verified live TTFT · measured " + ago(best.info.latency_age_s)
            : "OpenRouter 30-min median TTFT (probe any model to verify live)";
        fastestChatBtn.hidden = !found;
    } else {
        currentFastestId = null;
        liveFastestName.textContent = "No speed measurements yet";
        liveFastestMs.hidden = true;
        liveFastestHost.hidden = true;
        liveFastestSub.textContent = "Click Probe on any model or Random Fast Model to measure live.";
        fastestChatBtn.hidden = true;
        instantFastestBtn.hidden = true;
    }

    renderProviderStatus();
}

function updateLive() {
    updateLivePanel();
    if (view === "chat") renderBanner();

    if (catalog) {
        renderMeta();
        if (dash.layout === "table") {
            dashBody.querySelectorAll(".row").forEach((row) => {
                fillLatencyCell(row.querySelector(".cell.latency"), row.dataset.id);
                fillHealthCell(row.querySelector(".cell.limit"), row.dataset.id);
            });
        } else {
            dashBody.querySelectorAll(".mcard").forEach((card) => {
                const id = card.dataset.id;
                const info = live.models[id];
                const speedB = card.querySelector(".mcard-speed b");
                if (speedB) speedB.textContent = info && info.latency_ms != null ? fmtMs(info.latency_ms) : "Unmeasured";
                const pBtn = card.querySelector(".probe-btn");
                if (pBtn) {
                    pBtn.disabled = testing.has(id);
                    pBtn.textContent = testing.has(id) ? "Probing…" : "⚡ Live Probe";
                }
            });
        }

        if ((dash.sort === "latency" || dash.filters.has("fast")) && view === "dashboard") {
            const selector = dash.layout === "cards" ? ".mcard" : ".row";
            const shown = Array.from(dashBody.querySelectorAll(selector)).map((n) => n.dataset.id).join(",");
            const wanted = visibleGroups().map((e) => e.items.map((m) => m.id).join(",")).filter(Boolean).join(",");
            if (shown !== wanted) renderDashboard();
        }
    }
}

async function loadLive() {
    if (live.loading) return;
    live.loading = true;
    liveSyncBtn.classList.add("spinning");

    try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (!res.ok) throw new ApiError(await readError(res));

        const data = await res.json();
        live.models = data.models || {};
        live.usage = data.usage || null;
        live.limits = data.limits || null;
        live.updatedAt = Date.now();
        live.state = "ready";

        if (Array.isArray(data.providers)) {
            providerStatus = data.providers;
        } else {
            try {
                const sRes = await fetch("/api/status", { cache: "no-store" });
                if (sRes.ok) providerStatus = (await sRes.json()).providers || [];
            } catch (_) {}
        }

        // If a model was dynamically hidden (paid/agent-only), silently sync the catalog immediately!
        if (catalog && typeof data.catalog_count === "number" && data.catalog_count !== catalog.count) {
            loadCatalog(false, { silent: true });
        }
    } catch (error) {
        console.warn("Could not load live data:", error);
        if (live.state !== "ready") live.state = "error";
    } finally {
        live.loading = false;
        liveSyncBtn.classList.remove("spinning");
    }

    updateLive();
}

async function testModel(id) {
    if (testing.has(id)) return;
    testing.add(id);
    updateLive();

    let noteText = "Probe failed";
    let removed = false;
    try {
        const res = await fetch("/api/probe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: id })
        });
        if (!res.ok) throw new ApiError(await readError(res));
        const data = await res.json();

        if (data.live) live.models[id] = data.live;
        removed = Boolean(data.removed || data.agent_only || data.paid);

        if (data.ok) {
            noteText = "Live: " + fmtMs(data.ms) + " just now";
            showToast(data.message || ("Responded in " + data.ms + " ms"));
        } else {
            noteText = data.throttled ? "Rate limited just now" : "No response";
            showToast(data.message || "Model did not respond.");
        }
    } catch (error) {
        console.warn(error);
        noteText = error instanceof ApiError ? error.message : NETWORK_ERROR;
        showToast(noteText);
    }

    testNotes.set(id, { text: noteText, until: Date.now() + 7000 });
    testing.delete(id);

    if (removed) {
        await loadCatalog(false, { silent: true });
    }
    await loadLive();
    setTimeout(updateLive, 7200);
}

async function probeBatchVisible() {
    if (batchBusy || !catalog) return;
    const targets = filteredModels().filter((m) => latencyOf(m) === null && !testing.has(m.id)).slice(0, 3);
    if (!targets.length) return;
    batchBusy = true;
    renderMeta();
    try {
        await Promise.all(targets.map((m) => testModel(m.id)));
    } finally {
        batchBusy = false;
        renderMeta();
    }
}

function setRandomUi(state, message) {
    randomButton.classList.toggle("busy", state === "busy");
    randomButton.disabled = state === "busy";
    randomLabel.textContent = state === "busy" ? "Probing fastest pool…" : "Random Fast Model";
    randomHint.classList.toggle("err", state === "error");

    if (state === "busy") {
        randomHint.textContent = "Testing live response speed across the fastest healthy models…";
    } else if (state === "error") {
        randomHint.textContent = message;
    } else {
        randomHint.textContent = RANDOM_HINT;
    }
}

async function pickRandom() {
    if (randomBusy) return;
    randomBusy = true;
    setRandomUi("busy");

    try {
        const body = dash.host !== "all" ? { host: dash.host } : {};
        const res = await fetch("/api/random-model", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new ApiError(await readError(res));

        const data = await res.json();
        setRandomUi("idle");
        startDraft(data.model, "random", data.note || "");
    } catch (error) {
        console.error(error);
        const msg = error instanceof ApiError ? error.message : NETWORK_ERROR;
        setRandomUi("error", msg);
        showToast(msg);
    } finally {
        randomBusy = false;
        loadLive();
    }
}

/* ==========================================================
   Chat Messages, Streaming Stopwatch & Telemetry
   ========================================================== */
function isNearBottom() {
    return chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < 100;
}

function scrollToBottom() {
    chatArea.scrollTop = chatArea.scrollHeight;
}

function imageThumb(ref) {
    const image = document.createElement("img");
    image.className = "bubble-img";
    image.alt = ref.name || "Attached image";
    image.decoding = "async";

    imageStore.get(ref.id).then((url) => {
        if (url) image.src = url;
        else image.replaceWith(el("span", "img-missing", "Image no longer cached"));
    });
    return image;
}

function addUserMessage(text, images, onEdit) {
    const message = el("article", "msg user");
    const bubble = el("div", "bubble");

    if (images && images.length) {
        const row = el("div", "bubble-images");
        images.forEach((ref) => row.appendChild(imageThumb(ref)));
        bubble.appendChild(row);
    }
    if (text) bubble.appendChild(el("span", "bubble-text", text));
    message.appendChild(bubble);

    const tools = el("div", "user-tools");
    if (text) {
        const cp = el("button", "mini-btn");
        cp.type = "button";
        cp.innerHTML = ICONS.copy + " Copy";
        cp.addEventListener("click", () => copyText(text, cp));
        tools.appendChild(cp);

        if (onEdit) {
            const ed = el("button", "mini-btn");
            ed.type = "button";
            ed.innerHTML = ICONS.edit + " Edit & Resend";
            ed.addEventListener("click", onEdit);
            tools.appendChild(ed);
        }
    }
    if (tools.childNodes.length) message.appendChild(tools);
    thread.appendChild(message);
}

function formatStatsBadge(stats) {
    if (!stats) return "";
    const parts = [];
    if (stats.ttftMs != null) parts.push("⚡ " + Math.round(stats.ttftMs) + " ms TTFT");
    if (stats.totalMs != null) parts.push((stats.totalMs / 1000).toFixed(2) + "s total");
    if (stats.tokPerSec != null && stats.tokPerSec > 0) parts.push("~" + Math.round(stats.tokPerSec) + " tok/s");
    return parts.join(" · ");
}

function createAssistantView(modelName, modelId) {
    const message = el("article", "msg assistant");
    message.appendChild(markTile("sm"));

    const body = el("div", "body");
    const who = el("div", "who");
    who.appendChild(el("span", "who-name", modelName || APP_NAME));
    if (modelId) who.appendChild(el("span", "who-model", modelId));
    const streamStatus = el("span", "stream-status", "");
    who.appendChild(streamStatus);
    body.appendChild(who);

    const content = el("div", "content");
    const typing = el("span", "typing");
    typing.setAttribute("role", "status");
    typing.setAttribute("aria-label", APP_NAME + " is generating");
    typing.innerHTML = "<i></i><i></i><i></i>";
    content.appendChild(typing);
    body.appendChild(content);

    const foot = el("div", "msg-foot");
    body.appendChild(foot);
    message.appendChild(body);

    let raw = "";
    let frame = 0;
    let timerId = 0;
    let startedAt = 0;
    let liveTtft = null;

    const paint = () => {
        frame = 0;
        const stick = isNearBottom();
        content.innerHTML = renderMarkdown(raw);
        if (stick) scrollToBottom();
    };

    const stopTimer = () => {
        if (timerId) {
            clearInterval(timerId);
            timerId = 0;
        }
        streamStatus.textContent = "";
    };

    const addNote = (text, onRetry, onSwitch) => {
        const note = el("div", "note");
        note.setAttribute("role", "alert");
        note.appendChild(el("span", "note-text", text));

        const buttons = el("span", "note-actions");
        if (onRetry) {
            const retry = el("button", "mini-btn", "Try Again");
            retry.type = "button";
            retry.addEventListener("click", onRetry);
            buttons.appendChild(retry);
        }
        if (onSwitch) {
            const change = el("button", "mini-btn", "Try Another Model →");
            change.type = "button";
            change.addEventListener("click", onSwitch);
            buttons.appendChild(change);
        }
        if (buttons.childNodes.length) note.appendChild(buttons);
        content.appendChild(note);
    };

    thread.appendChild(message);

    return {
        startClock() {
            startedAt = performance.now();
            streamStatus.textContent = "Connecting… 0.0s";
            timerId = setInterval(() => {
                const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1) + "s";
                streamStatus.textContent = liveTtft != null
                    ? "Streaming · " + liveTtft + " ms TTFT · " + elapsed
                    : "Connecting… " + elapsed;
            }, 100);
        },
        setTtft(ms) {
            if (ms != null && Number.isFinite(ms)) liveTtft = Math.round(ms);
        },
        update(text) {
            raw = text;
            if (!frame) frame = requestAnimationFrame(paint);
        },
        finish(stats, onRegen) {
            stopTimer();
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            if (raw) {
                paint();
                const copy = el("button", "mini-btn");
                copy.type = "button";
                copy.innerHTML = ICONS.copy + " Copy";
                copy.addEventListener("click", () => copyText(raw, copy));
                foot.appendChild(copy);

                if (onRegen) {
                    const rg = el("button", "mini-btn");
                    rg.type = "button";
                    rg.innerHTML = ICONS.regen + " Regenerate";
                    rg.addEventListener("click", onRegen);
                    foot.appendChild(rg);
                }

                const statStr = formatStatsBadge(stats);
                if (statStr) foot.appendChild(el("span", "msg-telemetry", statStr));
            } else {
                content.innerHTML = "";
            }
        },
        fail(text, onRetry, onSwitch) {
            stopTimer();
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            if (raw) paint();
            else content.innerHTML = "";
            addNote(text, onRetry, onSwitch);
            if (isNearBottom()) scrollToBottom();
        },
        remove() {
            stopTimer();
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            message.remove();
        }
    };
}

function renderChat(convo) {
    thread.textContent = "";
    welcome.hidden = convo.messages.length > 0;

    convo.messages.forEach((m, index) => {
        if (m.role === "user") {
            addUserMessage(m.content, m.images, () => editUserMessage(convo, index));
            return;
        }

        const isLast = index === convo.messages.length - 1;
        const bot = createAssistantView(convo.model.name, m.model || convo.model.id);
        if (m.error) {
            bot.fail(
                m.content,
                isLast ? () => retryLast(convo) : null,
                isLast ? () => openSwitchModal({ carryMessages: convo.messages.filter((x) => !x.error) }) : null
            );
        } else {
            bot.update(m.content);
            bot.finish(m.stats || null, isLast ? () => regenerateLast(convo) : null);
        }
    });

    scrollToBottom();
}

function editUserMessage(convo, index) {
    if (busy || convo.id !== activeId) return;
    const target = convo.messages[index];
    if (!target || target.role !== "user") return;

    input.value = target.content || "";
    autosize();
    updateSendState();
    convo.messages = convo.messages.slice(0, index);
    convo.updatedAt = Date.now();
    saveChats();
    renderChat(convo);
    renderSidebar();
    focusInput();
}

function regenerateLast(convo) {
    if (busy || convo.id !== activeId || !convo.messages.length) return;
    const last = convo.messages[convo.messages.length - 1];
    if (last.role === "assistant") {
        convo.messages.pop();
        saveChats();
        renderChat(convo);
        streamReply(convo);
    }
}

async function copyText(text, button) {
    const prevHtml = button.innerHTML;
    try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied!";
    } catch (_) {
        button.textContent = "Failed";
    }
    setTimeout(() => { button.innerHTML = prevHtml; }, 1400);
}

/* ==========================================================
   Composer Attachments & Drag-and-Drop
   ========================================================== */
function modelAcceptsImages() {
    const model = currentModel();
    return !!(model && model.vision);
}

function updateAttachState() {
    const allowed = view === "chat" && modelAcceptsImages();
    attachButton.disabled = !allowed;
    attachWrap.classList.toggle("off", !allowed);
    attachWrap.title = allowed
        ? "Attach or drop images (up to " + MAX_IMAGES_PER_MESSAGE + ")"
        : "This model accepts text only";
    attachButton.setAttribute("aria-label", allowed ? "Attach an image" : "Attach an image (disabled for text-only model)");
    if (!allowed && pending.length) clearPending();
}

function setComposerModel() {
    const model = currentModel();
    input.placeholder = model ? "Message " + model.name + "…" : "Message Afterworld…";
    updateAttachState();
}

function flashHint(text) {
    hintBox.textContent = text;
    hintBox.classList.add("warn");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
        hintBox.textContent = HINT_DEFAULT;
        hintBox.classList.remove("warn");
    }, 4500);
}

function renderPending() {
    attachmentsBox.textContent = "";
    attachmentsBox.hidden = pending.length === 0;

    pending.forEach((item) => {
        const box = el("div", "att");
        const image = document.createElement("img");
        image.src = item.dataUrl;
        image.alt = item.name;

        const remove = el("button", "att-remove", "×");
        remove.type = "button";
        remove.dataset.id = item.id;
        remove.setAttribute("aria-label", "Remove " + item.name);

        box.appendChild(image);
        box.appendChild(remove);
        attachmentsBox.appendChild(box);
    });
}

function clearPending() {
    pending = [];
    attachEpoch++;
    renderPending();
    updateSendState();
}

function resetComposer() {
    input.value = "";
    autosize();
    clearPending();
    charCount.textContent = "";
    clearTimeout(hintTimer);
    hintBox.textContent = HINT_DEFAULT;
    hintBox.classList.remove("warn");
}

async function addFiles(fileList) {
    if (!modelAcceptsImages()) {
        flashHint("This model accepts text only. Switch to a Vision model to attach images.");
        return;
    }

    const epoch = attachEpoch;
    for (const file of Array.from(fileList)) {
        if (pending.length >= MAX_IMAGES_PER_MESSAGE) {
            flashHint("Up to " + MAX_IMAGES_PER_MESSAGE + " images per message.");
            break;
        }
        try {
            const item = await prepareImage(file);
            if (epoch !== attachEpoch) return;
            if (pending.length >= MAX_IMAGES_PER_MESSAGE) break;
            pending.push(item);
            renderPending();
            updateSendState();
        } catch (error) {
            flashHint(error.message);
        }
    }
}

/* ==========================================================
   Navigation & Sending
   ========================================================== */
function stopStreaming() {
    if (controller) controller.abort();
}

function openDashboard() {
    closeDrawer();
    closeModals();
    stopStreaming();
    resetComposer();

    activeId = null;
    draft = null;
    sysDrawerOpen = false;
    saveActive();

    showView("dashboard");
    updateAttachState();
    renderSidebar();
    viewDash.scrollTop = 0;

    if (catalogState === "idle" || catalogState === "error") {
        loadCatalog(false);
    } else {
        renderDashboard();
        if (Date.now() - live.updatedAt > 12000) loadLive();
    }
}

function startDraft(model, origin, note) {
    closeDrawer();
    closeModals();
    stopStreaming();
    resetComposer();

    activeId = null;
    sysDrawerOpen = false;
    saveActive();
    draft = { model: snapshot(model), origin, note: note || "", systemPrompt: "" };

    thread.textContent = "";
    welcome.hidden = false;
    welcomeBadge.textContent = "";
    welcomeBadge.appendChild(providerTile(draft.model.provider, "sm"));
    welcomeBadge.appendChild(hostBadge(draft.model.host, draft.model.host_label));

    welcomeTitle.textContent = "Chat with " + draft.model.name;
    welcomeSub.textContent = draft.model.vision
        ? "Ask anything, paste code, or drag & drop images directly into this chat."
        : "Ask anything to get started. Every reply records live TTFT and generation speed.";

    showView("chat");
    renderBanner();
    setComposerModel();
    renderSidebar();
    chatArea.scrollTop = 0;
    focusInput();
}

function openChat(id) {
    closeDrawer();
    closeModals();
    confirmingDeleteId = null;
    if (id === activeId && view === "chat") return;

    const convo = chats.find((c) => c.id === id);
    if (!convo) return;

    stopStreaming();
    resetComposer();
    activeId = id;
    draft = null;
    sysDrawerOpen = false;
    saveActive();

    showView("chat");
    renderChat(convo);
    renderBanner();
    setComposerModel();
    renderSidebar();
    focusInput();
}

function deleteChat(id) {
    const convo = chats.find((c) => c.id === id);
    if (!convo) return;

    const wasActive = id === activeId;
    if (wasActive) stopStreaming();

    removeChatImages(convo);
    chats = chats.filter((c) => c.id !== id);
    confirmingDeleteId = null;
    saveChats();

    if (wasActive) openDashboard();
    else renderSidebar();
    showToast("Conversation deleted.");
}

function updateSendState() {
    sendButton.classList.toggle("is-stop", busy);
    sendButton.setAttribute("aria-label", busy ? "Stop generating" : "Send message");
    sendButton.disabled = !busy && !input.value.trim() && pending.length === 0;
    const len = input.value.length;
    charCount.textContent = len > 120 ? "~" + Math.ceil(len / 4).toLocaleString("en-US") + " tokens" : "";
}

function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 190) + "px";
}

async function buildPayload(convo) {
    const usable = convo.messages
        .filter((m) => !m.error && ((m.content && m.content.trim()) || (m.images && m.images.length)))
        .slice(-40);

    let budget = MAX_CONTEXT_IMAGES;
    const out = [];

    for (let i = usable.length - 1; i >= 0; i--) {
        const m = usable[i];
        const item = { role: m.role, content: m.content || "" };

        if (m.role === "user" && m.images && m.images.length && budget > 0) {
            const urls = [];
            for (const ref of m.images.slice(0, budget)) {
                const url = await imageStore.get(ref.id);
                if (url) urls.push(url);
            }
            budget -= urls.length;
            if (urls.length) item.images = urls;
        }

        if (item.content.trim() || item.images) out.unshift(item);
    }

    return out;
}

async function readError(response) {
    try {
        const data = await response.json();
        if (data && typeof data.detail === "string") return data.detail;
    } catch (_) {}
    return "The server returned HTTP " + response.status + ". Try again or choose another model.";
}

function sendMessage(text, images) {
    images = images || [];
    if (busy || view !== "chat") return;
    if (images.length && !modelAcceptsImages()) return;

    let convo = getActiveChat();
    if (!convo) {
        if (!draft) {
            openDashboard();
            return;
        }
        convo = {
            id: uid(),
            title: makeTitle(text),
            updatedAt: Date.now(),
            systemPrompt: draft.systemPrompt || "",
            model: draft.model,
            origin: draft.origin,
            note: draft.note,
            messages: []
        };
        chats.unshift(convo);

        if (chats.length > MAX_CHATS) {
            const keep = sortedChats().slice(0, MAX_CHATS);
            chats.filter((c) => !keep.includes(c)).forEach(removeChatImages);
            chats = keep;
        }

        activeId = convo.id;
        draft = null;
        saveActive();
    }

    thread.querySelectorAll(".note .mini-btn").forEach((b) => b.remove());

    const refs = images.map((img) => ({ id: img.id, name: img.name }));
    images.forEach((img) => imageStore.put(img.id, img.dataUrl));

    welcome.hidden = true;
    const msgIndex = convo.messages.length;
    convo.messages.push({ role: "user", content: text, model: null, error: false, images: refs });
    convo.updatedAt = Date.now();
    saveChats();
    renderSidebar();
    renderBanner();

    addUserMessage(text, refs, () => editUserMessage(convo, msgIndex));
    scrollToBottom();
    streamReply(convo);
}

function retryLast(convo) {
    if (busy || convo.id !== activeId) return;
    const last = convo.messages[convo.messages.length - 1];
    if (!last || !last.error) return;

    convo.messages.pop();
    saveChats();

    const lastEl = thread.lastElementChild;
    if (lastEl && lastEl.classList.contains("assistant")) lastEl.remove();

    streamReply(convo);
}

async function streamReply(convo) {
    const myController = new AbortController();
    controller = myController;
    busy = true;
    updateSendState();

    // Disable stale regenerate buttons on older turns
    thread.querySelectorAll(".msg-foot button").forEach((btn) => {
        if (btn.textContent.includes("Regenerate")) btn.remove();
    });

    const modelId = convo.model.id;
    const bot = createAssistantView(convo.model.name, modelId);
    bot.startClock();
    scrollToBottom();

    const reqStarted = performance.now();
    let firstPieceAt = null;
    let headerTtft = null;
    let answer = "";

    try {
        const payload = await buildPayload(convo);
        const reqBody = { model: modelId, messages: payload };
        if (convo.systemPrompt && convo.systemPrompt.trim()) {
            reqBody.system = convo.systemPrompt.trim();
        }

        const response = await fetch("/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reqBody),
            signal: myController.signal
        });

        if (!response.ok) {
            throw new ApiError(await readError(response));
        }
        if (!response.body) {
            throw new ApiError("Streaming is not supported by this response.");
        }

        const rawTtft = response.headers.get("X-TTFT-Ms");
        if (rawTtft && /^\d+$/.test(rawTtft)) {
            headerTtft = Number(rawTtft);
            bot.setTtft(headerTtft);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            if (firstPieceAt === null) {
                firstPieceAt = performance.now();
                if (headerTtft === null) bot.setTtft(Math.round(firstPieceAt - reqStarted));
            }
            answer += decoder.decode(value, { stream: true });
            bot.update(answer);
        }

        answer += decoder.decode();
        if (!answer.trim()) {
            throw new ApiError("The model returned an empty reply. Try again or switch to another model.");
        }

        const totalMs = Math.round(performance.now() - reqStarted);
        const ttftMs = headerTtft ?? Math.round((firstPieceAt || performance.now()) - reqStarted);
        const genWindowS = Math.max(0.15, (totalMs - ttftMs) / 1000);
        const approxTokens = Math.max(1, Math.round(answer.length / 4));
        const tokPerSec = approxTokens >= 6 ? Math.round(approxTokens / genWindowS) : null;

        const stats = { ttftMs, totalMs, tokPerSec };
        convo.messages.push({ role: "assistant", content: answer, model: modelId, error: false, stats, images: [] });
        bot.update(answer);
        bot.finish(stats, () => regenerateLast(convo));

    } catch (error) {
        if (error.name === "AbortError") {
            if (answer.trim()) {
                const totalMs = Math.round(performance.now() - reqStarted);
                const stats = { ttftMs: headerTtft, totalMs, tokPerSec: null };
                convo.messages.push({ role: "assistant", content: answer, model: modelId, error: false, stats, images: [] });
                bot.finish(stats, () => regenerateLast(convo));
            } else {
                bot.remove();
            }
        } else {
            console.error(error);
            const text = error instanceof ApiError ? error.message : NETWORK_ERROR;
            const switchFn = () => openSwitchModal({ carryMessages: convo.messages.filter((x) => !x.error) });

            if (answer.trim()) {
                convo.messages.push({ role: "assistant", content: answer, model: modelId, error: false, images: [] });
                bot.fail(text, null, switchFn);
            } else {
                convo.messages.push({ role: "assistant", content: text, model: null, error: true, images: [] });
                bot.fail(text, () => retryLast(convo), switchFn);
            }

            if (/removed from the (model )?list|paid plan|agentic tool|any more/i.test(text)) {
                loadCatalog(false, { silent: true });
            }
        }
    } finally {
        convo.updatedAt = Date.now();
        saveChats();
        renderSidebar();

        if (controller === myController) {
            controller = null;
            busy = false;
            updateSendState();
            focusInput();
        }

        // Always refresh live telemetry immediately after any chat request finishes!
        loadLive();
    }
}

/* ==========================================================
   Event Listeners & Initialization
   ========================================================== */
sidebarToggle.addEventListener("click", toggleSidebar);
scrim.addEventListener("click", closeDrawer);
lightbox.addEventListener("click", closeLightbox);
inspectorClose.addEventListener("click", closeModals);
switchClose.addEventListener("click", closeModals);

inspectorModal.addEventListener("click", (e) => { if (e.target === inspectorModal) closeModals(); });
switchModal.addEventListener("click", (e) => { if (e.target === switchModal) closeModals(); });
switchSearch.addEventListener("input", renderSwitchList);

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeDrawer();
        closeLightbox();
        closeModals();
        if (confirmingDeleteId) { confirmingDeleteId = null; renderSidebar(); }
    }
    if (event.key === "/" && view === "dashboard" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        searchInput.focus();
    }
});

window.matchMedia("(max-width: 860px)").addEventListener("change", (e) => {
    if (!e.matches) closeDrawer();
    applySidebarState();
});

chatGroups.addEventListener("click", (event) => {
    const confirmDel = event.target.closest("[data-confirm-del]");
    if (confirmDel) {
        deleteChat(confirmDel.dataset.confirmDel);
        return;
    }
    const del = event.target.closest("[data-del]");
    if (del) {
        confirmingDeleteId = del.dataset.del;
        renderSidebar();
        return;
    }
    const ren = event.target.closest("[data-rename]");
    if (ren) {
        renamingChatId = ren.dataset.rename;
        confirmingDeleteId = null;
        renderSidebar();
        return;
    }
    const item = event.target.closest(".chat-item[data-id]");
    if (item) openChat(item.dataset.id);
});

chatSearch.addEventListener("input", renderSidebar);

clearChatsBtn.addEventListener("click", () => {
    if (!chats.length) return;
    if (clearChatsBtn.dataset.arm === "1") {
        stopStreaming();
        chats.forEach(removeChatImages);
        chats = [];
        activeId = null;
        saveChats();
        saveActive();
        clearChatsBtn.dataset.arm = "0";
        clearChatsBtn.textContent = "Clear all";
        openDashboard();
        showToast("Cleared all saved conversations.");
    } else {
        clearChatsBtn.dataset.arm = "1";
        clearChatsBtn.textContent = "Click again to confirm";
        setTimeout(() => {
            clearChatsBtn.dataset.arm = "0";
            clearChatsBtn.textContent = "Clear all";
        }, 3500);
    }
});

dashBody.addEventListener("click", (event) => {
    if (event.target.closest("#retry-catalog")) {
        loadCatalog(false);
        return;
    }
    if (event.target.closest("#clear-empty-filters")) {
        resetAllFilters();
        return;
    }
    const probe = event.target.closest("[data-test]");
    if (probe) {
        event.stopPropagation();
        testModel(probe.dataset.test);
        return;
    }
    const inspect = event.target.closest("[data-inspect]");
    if (inspect) {
        event.stopPropagation();
        openInspector(inspect.dataset.inspect);
        return;
    }
    const cardOrRow = event.target.closest(".row, .mcard");
    if (cardOrRow && catalog) {
        const m = catalog.models.find((x) => x.id === cardOrRow.dataset.id);
        if (m) startDraft(m, "picked", "");
    }
});

dashBody.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && (event.target.classList.contains("row") || event.target.classList.contains("mcard"))) {
        event.preventDefault();
        const m = catalog && catalog.models.find((x) => x.id === event.target.dataset.id);
        if (m) startDraft(m, "picked", "");
    }
});

dashMeta.addEventListener("click", (event) => {
    if (event.target.closest("#refresh-btn") && catalogState !== "loading") {
        loadCatalog(true);
    } else if (event.target.closest("#batch-probe-btn")) {
        probeBatchVisible();
    }
});

hostTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-host-key]");
    if (!tab) return;
    dash.host = tab.dataset.hostKey;
    renderDashboard();
});

groupSeg.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-group]");
    if (!btn) return;
    dash.group = btn.dataset.group;
    writeStore("group", dash.group);
    renderDashboard();
});

sortSelect.addEventListener("change", () => {
    dash.sort = SORT_KEYS.includes(sortSelect.value) ? sortSelect.value : "latency";
    writeStore("sort", dash.sort);
    if (catalog) renderDashboard();
});

viewSwitch.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-layout]");
    if (!btn) return;
    dash.layout = btn.dataset.layout;
    writeStore("layout", dash.layout);
    if (catalog) renderDashboard();
});

filtersBox.addEventListener("click", (event) => {
    const toggle = event.target.closest(".toggle");
    if (!toggle) return;
    const key = toggle.dataset.filter;
    if (dash.filters.has(key)) dash.filters.delete(key);
    else dash.filters.add(key);
    renderDashboard();
});

function resetAllFilters() {
    dash.host = "all";
    dash.query = "";
    dash.filters.clear();
    searchInput.value = "";
    renderDashboard();
}

resetFiltersBtn.addEventListener("click", resetAllFilters);

searchInput.addEventListener("input", () => {
    dash.query = searchInput.value;
    if (catalog) renderDashboard();
});

searchClear.addEventListener("click", () => {
    dash.query = "";
    searchInput.value = "";
    renderDashboard();
    searchInput.focus();
});

$("jump-models").addEventListener("click", () => {
    $("models").scrollIntoView({ behavior: "smooth", block: "start" });
});

liveSyncBtn.addEventListener("click", () => loadLive());
randomButton.addEventListener("click", pickRandom);
$("side-random-btn").addEventListener("click", pickRandom);
topFastBtn.addEventListener("click", () => {
    if (currentFastestId && catalog) {
        const m = catalog.models.find((x) => x.id === currentFastestId);
        if (m) {
            startDraft(m, "picked", "");
            return;
        }
    }
    pickRandom();
});

const launchFastestNow = () => {
    if (!currentFastestId || !catalog) return;
    const m = catalog.models.find((x) => x.id === currentFastestId);
    if (m) startDraft(m, "picked", "");
};
fastestChatBtn.addEventListener("click", launchFastestNow);
instantFastestBtn.addEventListener("click", launchFastestNow);

// Chat events
chatArea.addEventListener("click", (event) => {
    const image = event.target.closest(".bubble-img");
    if (image && image.src) {
        openLightbox(image.src);
        return;
    }
    const copyBtn = event.target.closest(".copy-code");
    if (copyBtn) {
        const code = copyBtn.closest(".code").querySelector("pre").textContent;
        copyText(code, copyBtn);
    }
});

// Drag & Drop images into chat
let dragDepth = 0;
viewChat.addEventListener("dragenter", (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) {
        e.preventDefault();
        dragDepth++;
        dropOverlay.hidden = false;
    }
});
viewChat.addEventListener("dragover", (e) => {
    if (!dropOverlay.hidden) e.preventDefault();
});
viewChat.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.hidden = true;
});
viewChat.addEventListener("drop", (e) => {
    dragDepth = 0;
    dropOverlay.hidden = true;
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
        e.preventDefault();
        addFiles(files);
    }
});

attachButton.addEventListener("click", () => {
    if (!attachButton.disabled) fileInput.click();
});

fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = "";
    if (files.length) addFiles(files);
});

attachmentsBox.addEventListener("click", (event) => {
    const remove = event.target.closest(".att-remove");
    if (remove) {
        pending = pending.filter((item) => item.id !== remove.dataset.id);
        renderPending();
        updateSendState();
        return;
    }
    const image = event.target.closest("img");
    if (image) openLightbox(image.src);
});

input.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
});

form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) {
        stopStreaming();
        return;
    }
    const text = input.value.trim();
    const images = pending.slice();
    if (!text && !images.length) return;

    input.value = "";
    autosize();
    clearPending();
    charCount.textContent = "";
    sendMessage(text, images);
});

input.addEventListener("input", () => {
    autosize();
    updateSendState();
});

input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!busy) form.requestSubmit();
    }
});

document.querySelectorAll(".suggest-card").forEach((button) => {
    button.addEventListener("click", () => {
        if (!busy) sendMessage(button.dataset.prompt);
    });
});

$("new-chat").addEventListener("click", openDashboard);
dashButton.addEventListener("click", openDashboard);
brandLink.addEventListener("click", openDashboard);

// Background live polling across both Dashboard and Chat views
setInterval(() => {
    if (!document.hidden && catalogState === "ready") loadLive();
}, LIVE_REFRESH_MS);

setInterval(() => {
    updateLiveStamp();
}, 1000);

document.addEventListener("visibilitychange", () => {
    if (!document.hidden && catalogState === "ready" && Date.now() - live.updatedAt > 15000) {
        loadLive();
    }
});

// Boot
applySidebarState();
renderSidebar();
const startChat = getActiveChat();

if (startChat) {
    showView("chat");
    renderChat(startChat);
    renderBanner();
    setComposerModel();
    renderSidebar();
} else {
    showView("dashboard");
}

updateLivePanel();
renderDashboard();
loadCatalog(false);
updateSendState();
updateAttachState();
focusInput();

})();
