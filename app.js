/**
 * NSW Curriculum Explorer — app.js
 *
 * All fetching goes through /api/proxy?url=<encoded> which is a
 * Vercel Edge Function that forwards requests to curriculum.nsw.edu.au
 * and strips CORS restrictions.
 */

const BASE = 'https://curriculum.nsw.edu.au';
const SECTIONS = ['overview', 'rationale-aim', 'outcomes', 'content', 'assessment', 'glossary'];

const AREA_META = {
  english:         { label: 'English',                          icon: 'book-open',          faIcon: 'fa-book',                  color: '#6366f1' },
  mathematics:     { label: 'Mathematics',                      icon: 'calculator',         faIcon: 'fa-square-root-variable',  color: '#f59e0b' },
  science:         { label: 'Science',                          icon: 'flask',              faIcon: 'fa-flask',                 color: '#10b981' },
  tas:             { label: 'Technological & Applied Studies',  icon: 'screwdriver-wrench', faIcon: 'fa-screwdriver-wrench',    color: '#f97316' },
  hsie:            { label: 'HSIE',                             icon: 'globe',              faIcon: 'fa-globe',                 color: '#3b82f6' },
  'creative-arts': { label: 'Creative Arts',                    icon: 'palette',            faIcon: 'fa-palette',               color: '#ec4899' },
  pdhpe:           { label: 'PDHPE',                            icon: 'heart-pulse',        faIcon: 'fa-heart-pulse',           color: '#ef4444' },
  languages:       { label: 'Languages',                        icon: 'language',           faIcon: 'fa-language',              color: '#8b5cf6' },
  vet:             { label: 'VET',                              icon: 'briefcase',          faIcon: 'fa-briefcase',             color: '#64748b' },
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

  // ── NEW: Remove the page title block (syllabus name + download button) ──
  // The NSW site renders an h1 with the full syllabus title at the top of each section
  // page — we don't need it since our app already shows the title
  const h1 = container.querySelector('h1');
  if (h1) {
    // Also remove any immediately following download/link block
    let next = h1.nextElementSibling;
    while (next && (next.tagName === 'P' || next.tagName === 'DIV') && 
           (next.querySelector('a[href*="download"]') || next.querySelector('button') ||
            next.textContent.trim().length < 100)) {
      const toRemove = next;
      next = next.nextElementSibling;
      toRemove.remove();
    }
    h1.remove();
  }

  // ── NEW: Replace black anchor icon boxes with plain anchor links ──
  // The NSW site uses icon-based anchor links that render as dark boxes
  // without their icon font. Convert them to simple # links.
  container.querySelectorAll('a[href^="#"]').forEach(a => {
    const isIconOnly = a.textContent.trim() === '' || 
                       a.querySelector('svg, img, [class*="icon"]');
    if (isIconOnly) {
      // Replace with a visible anchor symbol
      a.textContent = '§';
      a.style.cssText = 'color: var(--wa-color-neutral-text-quiet, #999); text-decoration: none; font-size: 0.85em; margin-left: 0.4em;';
    }
  });

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

  openSyllabus(basePath, title) { openSyllabus(basePath, title); },

  async openSpecialList(type) {
  const SPECIAL_META = {
    cec: {
      title:   'CEC Syllabuses',
      pattern: /\/learning-areas\/[^/]+\/[^/]+-cec[^/]*\/overview/,
      color:   '#7c3aed',
      faIcon:  'fa-building-columns',
      label:   'CEC',
    },
    'life-skills': {
      title:   'Life Skills Syllabuses',
      pattern: /\/learning-areas\/[^/]+\/[^/]+-life-skills[^/]*\/overview/,
      color:   '#0891b2',
      faIcon:  'fa-hand-holding-heart',
      label:   'Life Skills',
    },
  };
  const info = SPECIAL_META[type];
  if (!info) return;

  const listTitle = $('list-title');
  const listCount = $('list-count');
  const grid      = $('syllabus-grid');

  listTitle.textContent = info.title;
  listCount.textContent = 'Loading…';
  grid.innerHTML = '';
  state.currentList    = { type: 'special', title: info.title, syllabuses: [] };
  state.currentSyllabus = null;
  showView('list');

  try {
    const html = await fetchPage(`/search?q=${encodeURIComponent(type)}&perPage=100`);
    const doc  = parseDoc(html);

    let syllabuses = [];

    // Parse the Next.js JSON bundle embedded in the page
    for (const script of doc.querySelectorAll('script:not([src])')) {
      try {
        const data = JSON.parse(script.textContent);
        if (data?.props?.pageProps?.mappings) {
          syllabuses = data.props.pageProps.mappings
            .filter(m => m.params?.slug && info.pattern.test('/' + m.params.slug.join('/')))
            .map(m => ({
              title: m.params.pageTitle,
              href:  '/' + m.params.slug.slice(0, -1).join('/'),  // strip /overview
            }))
            .filter((v, i, arr) => arr.findIndex(x => x.href === v.href) === i);
          break;
        }
      } catch (_) {}
    }

    // Fallback: scan <a> links
    if (!syllabuses.length) {
      syllabuses = extractSyllabusLinks(doc)
        .filter(({ href }) => info.pattern.test(href))
        .map(({ title, href }) => ({ title, href: href.replace('/overview', '') }));
    }

    state.currentList.syllabuses = syllabuses;
    listCount.textContent = `${syllabuses.length} syllabus${syllabuses.length !== 1 ? 'es' : ''}`;

    if (!syllabuses.length) {
      grid.innerHTML = '<p style="color:#9ca3af;padding:1rem">No syllabuses found.</p>';
      return;
    }

    grid.innerHTML = '';
    for (const { title, href } of syllabuses) {
      const card = document.createElement('div');
      card.className = 'syllabus-card';
      card.innerHTML = `
        <div class="syllabus-card-title">${title}</div>
        <div class="syllabus-card-meta">
          <i class="fa-solid ${info.faIcon}" style="color:${info.color};font-size:.7rem"></i>
          ${info.label}
        </div>`;
      card.addEventListener('click', () => openSyllabus(href, title));
      grid.appendChild(card);
    }
  } catch (e) {
    console.error('openSpecialList error:', e);
    listCount.textContent = 'Error loading syllabuses';
    grid.innerHTML = `<div class="error-state">
      <p>Couldn't load syllabuses.
        <a href="https://curriculum.nsw.edu.au/search?q=${type}" target="_blank">
          Search on curriculum.nsw.edu.au ↗
        </a>
      </p></div>`;
  }
},

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

// Stage → allowed URL slug patterns
const STAGE_SLUG_PATTERNS = {
  primary:   [/k-6/, /k-10/],
  secondary: [/7-10/, /7-8/, /k-10/],
  senior:    [/11-12/, /stage-6/, /stage6/],
};

function slugMatchesStage(href, stage) {
  // The slug is the path segment just before /overview
  const slug = href.replace('/overview', '').split('/').pop();
  const patterns = STAGE_SLUG_PATTERNS[stage];
  if (!patterns) return true; // unknown stage → don't filter
  return patterns.some(p => p.test(slug));
}

async function loadStageSyllabuses(treeItem, stage) {
  try {
    const html = await fetchPage(`/stages/${stage}`);
    const doc = parseDoc(html);
    const links = extractSyllabusLinks(doc)
      .filter(({ href }) => slugMatchesStage(href, stage)); // ← filtering fix

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
    // For the combined tab, fetch both pages in parallel
    const paths = section === 'rationale-aim'
      ? [`${basePath}/rationale`, `${basePath}/aim`]
      : [`${basePath}/${section}`];

    const htmlParts = await Promise.all(paths.map(p => fetchPage(p)));
    if (state._loadId !== loadId) return;

    if (section === 'rationale-aim') {
      // Render each part under a divider heading
      const labels = ['Rationale', 'Aim'];
      content.innerHTML = htmlParts.map((html, i) => {
        const doc = parseDoc(html);
        return `<div class="combined-section">
          <h2 class="combined-section-heading">${labels[i]}</h2>
          ${extractMainContent(doc)}
        </div>`;
      }).join('<hr class="combined-section-divider">');
    } else {
      const doc = parseDoc(htmlParts[0]);
      content.innerHTML = extractMainContent(doc);
    }
  } catch (e) {
    if (state._loadId !== loadId) return;
    console.error('loadSection error:', e);
    content.innerHTML = `
      <div class="error-state">
        <p>Couldn't load this section.
          <a href="${BASE}${basePath}/${section}" target="_blank">Open on curriculum.nsw.edu.au ↗</a>
        </p>
      </div>`;
  } finally {
    if (state._loadId === loadId) loading.classList.add('hidden');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function capitalise(str) {
  if (str === 'rationale-aim') return 'Rationale / Aim';
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

const vetCard = document.querySelector('.welcome-card--vet');
if (vetCard) {
  const arrow = vetCard.querySelector('.card-arrow');
  if (arrow) arrow.className = 'fa-solid fa-arrow-up-right-from-square card-arrow';
}

