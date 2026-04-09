/**
 * NSW Curriculum Explorer — app.js
 *
 * All fetching goes through /api/proxy?url=<encoded> which is a
 * Vercel Edge Function that forwards requests to curriculum.nsw.edu.au
 * and strips CORS restrictions.
 */

const BASE = 'https://curriculum.nsw.edu.au';
const SECTIONS = ['overview', 'rationale', 'aim', 'outcomes', 'content', 'assessment', 'glossary'];

const AREA_META = {
  english:         { label: 'English',                      icon: 'book-open',          faIcon: 'fa-book',                 color: '#6366f1' },
  mathematics:     { label: 'Mathematics',                  icon: 'calculator',         faIcon: 'fa-square-root-variable', color: '#f59e0b' },
  science:         { label: 'Science',                      icon: 'flask',              faIcon: 'fa-flask',                color: '#10b981' },
  tas:             { label: 'Technological & Applied Studies', icon: 'screwdriver-wrench', faIcon: 'fa-screwdriver-wrench', color: '#f97316' },
  hsie:            { label: 'HSIE',                         icon: 'globe',              faIcon: 'fa-globe',                color: '#3b82f6' },
  'creative-arts': { label: 'Creative Arts',                icon: 'palette',            faIcon: 'fa-palette',              color: '#ec4899' },
  pdhpe:           { label: 'PDHPE',                        icon: 'heart-pulse',        faIcon: 'fa-heart-pulse',          color: '#ef4444' },
  languages:       { label: 'Languages',                    icon: 'language',           faIcon: 'fa-language',             color: '#8b5cf6' },
  vet:             { label: 'VET',                          icon: 'briefcase',          faIcon: 'fa-briefcase',            color: '#64748b' },
};
const STAGE_META = {
  primary:   { label: 'Primary (K–6)',    icon: 'child',          faIcon: 'fa-child',          color: '#f59e0b' },
  secondary: { label: 'Secondary (7–10)', icon: 'school',         faIcon: 'fa-school',         color: '#3b82f6' },
  senior:    { label: 'Senior (11–12)',   icon: 'graduation-cap', faIcon: 'fa-graduation-cap', color: '#8b5cf6' },
};

// ── Proxy fetch ──────────────────────────────────────────────────────────────

async function fetchPage(path) {
  const url = `${BASE}${path}`;
  console.log('Fetching:', url);
  const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
  console.log('Response status:', res.status, 'ok:', res.ok);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  const text = await res.text();
  console.log('Response length:', text.length, 'preview:', text.slice(0, 200));
  return text;
}

function parseDoc(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

// ── Syllabus link extraction ─────────────────────────────────────────────────

function extractSyllabusLinks(doc) {
  return [...doc.querySelectorAll('a[href]')]
    .filter(a => {
      const href = a.getAttribute('href');
      return (
        href &&
        href.match(/\/learning-areas\/[^/]+\/[^/]+\/overview/) &&
        !href.includes('nsw.gov.au') &&
        a.textContent.trim().length > 0
      );
    })
    .map(a => ({
      title: a.textContent.trim(),
      href: a.getAttribute('href').startsWith('http')
        ? new URL(a.getAttribute('href')).pathname
        : a.getAttribute('href'),
    }))
    .filter((v, i, arr) => arr.findIndex(x => x.href === v.href) === i);
}

// ── Content sanitisation ─────────────────────────────────────────────────────

function extractMainContent(doc) {
  // Try main content selectors in order of preference
  const selectors = ['main', '[role="main"]', '#content', '.content-area', 'article'];
  let container = null;
  for (const sel of selectors) {
    container = doc.querySelector(sel);
    if (container) break;
  }
  if (!container) container = doc.body;

  // Remove noise
  const remove = ['nav', 'header', 'footer', '.breadcrumb', '.sidebar', 'script', 'style',
                   '[class*="nav"]', '[class*="footer"]', '[class*="header"]'];
  remove.forEach(sel => container.querySelectorAll(sel).forEach(el => el.remove()));

  // Fix relative links
  container.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href && href.startsWith('/')) a.setAttribute('href', `${BASE}${href}`);
    if (href && href.startsWith('http')) a.setAttribute('target', '_blank');
  });

  // Remove broken lazy-load placeholder images
  container.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('data:image/gif') || src.startsWith('data:image/svg')) {
      const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-lazy');
      if (dataSrc) {
        img.setAttribute('src', dataSrc.startsWith('/') ? `${BASE}${dataSrc}` : dataSrc);
      } else {
        img.remove();
      }
    }
  });

  return container.innerHTML;
}

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  browseMode: 'area',   // 'area' | 'stage'
  currentList: null,    // { type, slug, title, syllabuses[] }
  currentSyllabus: null, // { title, basePath, section }
};

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const views = {
  welcome: $('view-welcome'),
  list:    $('view-list'),
  syllabus: $('view-syllabus'),
};

function showView(name) {
  Object.entries(views).forEach(([k, el]) => {
    el.classList.toggle('hidden', k !== name);
  });
}

// ── Browse mode ──────────────────────────────────────────────────────────────

window.App = {

  setBrowseMode(mode) {
    state.browseMode = mode;
    $('nav-area').classList.toggle('hidden', mode !== 'area');
    $('nav-stage').classList.toggle('hidden', mode !== 'stage');
    $('btn-by-area').setAttribute('appearance', mode === 'area' ? 'filled' : 'outlined');
    $('btn-by-stage').setAttribute('appearance', mode === 'stage' ? 'filled' : 'outlined');
    showView('welcome');
  },

  goBack() {
    if (state.currentList) {
      showView('list');
    } else {
      showView('welcome');
    }
  },
};

// ── Tree lazy loading ────────────────────────────────────────────────────────

async function loadAreaSyllabuses(treeItem, area) {
  try {
    const html = await fetchPage(`/learning-areas/${area}`);
    const doc = parseDoc(html);
    const links = extractSyllabusLinks(doc);

    links.forEach(({ title, href }) => {
      const child = document.createElement('wa-tree-item');
      child.textContent = title;
      child.dataset.syllabusPath = href.replace('/overview', '');
      child.dataset.syllabusTitle = title;
      treeItem.appendChild(child);
    });

    if (!links.length) {
      const empty = document.createElement('wa-tree-item');
      empty.textContent = 'No syllabuses found';
      empty.setAttribute('disabled', '');
      treeItem.appendChild(empty);
    }
  } catch (e) {
    console.error('Failed to load area:', area, e);
  } finally {
    treeItem.lazy = false;
  }
}

async function loadStageSyllabuses(treeItem, stage) {
  try {
    const html = await fetchPage(`/stages/${stage}`);
    const doc = parseDoc(html);
    const links = extractSyllabusLinks(doc);

    links.forEach(({ title, href }) => {
      const child = document.createElement('wa-tree-item');
      child.textContent = title;
      child.dataset.syllabusPath = href.replace('/overview', '');
      child.dataset.syllabusTitle = title;
      treeItem.appendChild(child);
    });

    if (!links.length) {
      const empty = document.createElement('wa-tree-item');
      empty.textContent = 'No syllabuses found';
      empty.setAttribute('disabled', '');
      treeItem.appendChild(empty);
    }
  } catch (e) {
    console.error('Failed to load stage:', stage, e);
  } finally {
    treeItem.lazy = false;
  }
}

// ── Tree event wiring ────────────────────────────────────────────────────────

function wireTree(treeId) {
  const tree = $(treeId);

  // Lazy load
  tree.addEventListener('wa-lazy-load', e => {
    const item = e.target;
    if (item.dataset.area)  loadAreaSyllabuses(item, item.dataset.area);
    if (item.dataset.stage) loadStageSyllabuses(item, item.dataset.stage);
  });

  // Selection → open syllabus
  tree.addEventListener('wa-selection-change', e => {
    const selected = e.detail.selection[0];
    if (!selected) return;
    const path = selected.dataset.syllabusPath;
    const title = selected.dataset.syllabusTitle;
    if (path && title) openSyllabus(path, title);
  });
}


// ── Syllabus view ────────────────────────────────────────────────────────────

function openSyllabus(basePath, title) {
  state.currentSyllabus = { basePath, title, section: 'overview' };

  $('syllabus-title').textContent = title;

  // Build tabs — this also destroys the old element, killing old listeners
  const tabGroup = $('section-tabs');
  const newTabGroup = tabGroup.cloneNode(false); // clone without children or listeners
  tabGroup.parentNode.replaceChild(newTabGroup, tabGroup);

  newTabGroup.innerHTML = SECTIONS.map(s => `
    <wa-tab slot="nav" panel="${s}">${capitalise(s)}</wa-tab>
    <wa-tab-panel name="${s}"></wa-tab-panel>
  `).join('');

  newTabGroup.addEventListener('wa-tab-show', e => {
    loadSection(basePath, e.detail.name);
  });

  showView('syllabus');
  loadSection(basePath, 'overview');
}

async function loadSection(basePath, section) {
  state.currentSyllabus.section = section;
  const loadId = Symbol();
  state._loadId = loadId;

  const loading = $('section-loading');
  const content = $('section-content');

  loading.classList.remove('hidden');
  content.innerHTML = '';

  try {
    const html = await fetchPage(`${basePath}/${section}`);
    if (state._loadId !== loadId) return;
    const doc = parseDoc(html);
    console.log('Parsed doc body length:', doc.body.innerHTML.length);
    console.log('extractMainContent result:', extractMainContent(doc).slice(0, 300));
    content.innerHTML = extractMainContent(doc);
  } catch (e) {
    if (state._loadId !== loadId) return;
    console.error('loadSection error:', e);
    content.innerHTML = `
      <div class="error-state">
        <p>Couldn't load this section. <a href="${BASE}${basePath}/${section}" target="_blank">Open on curriculum.nsw.edu.au ↗</a></p>
      </div>`;
  } finally {
    if (state._loadId === loadId) loading.classList.add('hidden');
  }
}


// ── Helpers ──────────────────────────────────────────────────────────────────

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Init ─────────────────────────────────────────────────────────────────────


function buildTreeItemLabel(text, faIcon, color) {
  const wrapper = document.createElement('span');
  wrapper.className = 'tree-item-label';
  const iconEl = document.createElement('i');
  iconEl.className = `fa-solid ${faIcon} fa-item-icon`;
  iconEl.style.color = color;
  const textEl = document.createElement('span');
  textEl.textContent = text;
  wrapper.appendChild(iconEl);
  wrapper.appendChild(textEl);
  return wrapper;
}


// Wait for Web Awesome components to be ready before wiring events
await Promise.allSettled([
  customElements.whenDefined('wa-tree'),
  customElements.whenDefined('wa-tree-item'),
  customElements.whenDefined('wa-tab-group'),
  customElements.whenDefined('wa-tab'),
]);

wireTree('tree-area');
wireTree('tree-stage');
showView('welcome');

// Decorate tree items with FA icons
Object.entries(AREA_META).forEach(([area, meta]) => {
  const item = document.querySelector(`#tree-area > wa-tree-item[data-area="${area}"]`);
  if (!item) return;
  item.textContent = '';
  item.appendChild(buildTreeItemLabel(meta.label, meta.faIcon, meta.color));
});
Object.entries(STAGE_META).forEach(([stage, meta]) => {
  const item = document.querySelector(`#tree-stage > wa-tree-item[data-stage="${stage}"]`);
  if (!item) return;
  item.textContent = '';
  item.appendChild(buildTreeItemLabel(meta.label, meta.faIcon, meta.color));
});

// Add arrow to welcome cards
document.querySelectorAll('.welcome-card').forEach(card => {
  const arrow = document.createElement('i');
  arrow.className = 'fa-solid fa-arrow-right card-arrow';
  card.appendChild(arrow);
});

