/* ==========================================================================
   AI, Explained — script.js
   No frameworks, no build step. Sections:
   1. Config & state
   2. Utilities
   3. Front matter + Markdown parser
   4. Data loading (manifest -> posts)
   5. Rendering: home / archive / categories / about / article
   6. Router (hash based)
   7. Table of contents + scrollspy
   8. Reading progress
   9. Highlighting (localStorage)
   10. Search
   11. Theme + mobile nav
   12. Init
   ========================================================================== */

/* ---------- 1. Config & state ---------- */
const MANIFEST_URL = 'blogs/manifest.json';
const HL_STORAGE_KEY = 'aiexplained_highlights_v1';
const THEME_STORAGE_KEY = 'aiexplained_theme';
const SITE_TAGLINE = "We write short, honest explanations of how artificial intelligence actually works, for people who are curious rather than technical. Start wherever you like.";

let posts = [];                 // loaded + parsed blog posts, newest first
let currentArticleBlogId = null; // id of the article currently rendered, or null
let scrollSpyObserver = null;

/* ---------- 2. Utilities ---------- */

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function slugify(text) {
  const slug = String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

// Parses a "YYYY-MM-DD" string as a *local* date to avoid the classic
// off-by-one-day bug that happens when the browser's timezone is behind UTC.
function parseLocalDate(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const parts = dateStr.trim().split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatDate(dateStr) {
  const dt = parseLocalDate(dateStr);
  if (!dt) return dateStr || 'Undated';
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// Strips markdown syntax down to roughly-plain text, for search indexing
// and reading-time estimation.
function toPlainText(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function announce(message) {
  const el = document.getElementById('status-region');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = message; });
}

/* ---------- 3. Front matter + Markdown parser ---------- */

function parseFrontMatter(raw) {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { meta: {}, body: raw };
  const yaml = match[1];
  const body = raw.slice(match[0].length);
  const meta = {};
  yaml.split('\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    val = val.replace(/^["']|["']$/g, '');
    if (key) meta[key] = val;
  });
  return { meta, body };
}

function splitTableRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((s) => s.trim());
}

// Converts a markdown string into HTML, and separately collects a table of
// contents from H2/H3 headings and standalone-bold "pseudo headings".
// This is a small, line-oriented parser: it covers the standard subset of
// markdown this site needs, not the entire spec (no nested lists, for
// example) - keeping it dependency-free and easy to read/extend.
function renderMarkdown(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const headings = [];
  const usedIds = new Set();
  let html = '';
  let i = 0;

  function makeId(text) {
    const base = slugify(text);
    let id = base;
    let n = 2;
    while (usedIds.has(id)) { id = `${base}-${n}`; n += 1; }
    usedIds.add(id);
    return id;
  }

  function inline(text) {
    let t = escapeHtml(text);
    // inline code first, so its contents are immune to further formatting
    t = t.replace(/`([^`]+)`/g, (m, code) => `<code>${code}</code>`);
    // images
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
      (m, alt, url, title) => `<img src="${url}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy">`);
    // links
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, txt, url, title) => {
      const external = /^https?:\/\//.test(url);
      return `<a href="${url}"${title ? ` title="${title}"` : ''}${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${txt}</a>`;
    });
    // bold
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    // italic (avoid matching the ** already consumed above)
    t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    t = t.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
    return t;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i += 1; continue; }

    // fenced code block
    if (/^```/.test(line.trim())) {
      const lang = (line.trim().match(/^```(\w*)/) || [])[1] || '';
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { code.push(lines[i]); i += 1; }
      i += 1;
      html += `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>\n`;
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) { html += '<hr>\n'; i += 1; continue; }

    // ATX headings
    const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const text = hMatch[2].trim();
      const id = makeId(text);
      html += `<h${level} id="${id}">${inline(text)}</h${level}>\n`;
      if (level === 2 || level === 3) headings.push({ id, text, level });
      i += 1; continue;
    }

    // standalone bold line, e.g. "**How AI Learns**" used as a sub-heading
    const boldMatch = line.trim().match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) {
      const text = boldMatch[1].trim();
      const id = makeId(text);
      html += `<h3 class="bold-heading" id="${id}">${inline(text)}</h3>\n`;
      headings.push({ id, text, level: 3 });
      i += 1; continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quoteLines.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      html += `<blockquote>${renderMarkdown(quoteLines.join('\n')).html}</blockquote>\n`;
      continue;
    }

    // table: a row containing "|" immediately followed by a separator row
    if (line.includes('|') && lines[i + 1] && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const headerCells = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') { rows.push(splitTableRow(lines[i])); i += 1; }
      html += '<div class="table-scroll"><table><thead><tr>'
        + headerCells.map((c) => `<th>${inline(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
        + '</tbody></table></div>\n';
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i += 1; }
      html += `<ul>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ul>\n`;
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i += 1; }
      html += `<ol>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ol>\n`;
      continue;
    }

    // paragraph: consume consecutive plain lines
    const paraLines = [];
    while (
      i < lines.length && lines[i].trim() !== ''
      && !/^```/.test(lines[i].trim())
      && !/^#{1,6}\s+/.test(lines[i])
      && !/^\*\*([^*]+)\*\*$/.test(lines[i].trim())
      && !/^>\s?/.test(lines[i])
      && !/^\s*[-*+]\s+/.test(lines[i])
      && !/^\s*\d+\.\s+/.test(lines[i])
      && !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())
    ) { paraLines.push(lines[i]); i += 1; }

    if (paraLines.length) html += `<p>${inline(paraLines.join(' '))}</p>\n`;
    else i += 1; // safety valve, should not normally trigger
  }

  return { html, headings };
}

/* ---------- 4. Data loading ---------- */

async function loadManifestAndPosts() {
  const manifestRes = await fetch(MANIFEST_URL);
  if (!manifestRes.ok) throw new Error(`Could not load ${MANIFEST_URL} (${manifestRes.status})`);
  const filenames = await manifestRes.json();
  if (!Array.isArray(filenames)) throw new Error('manifest.json must contain a list of filenames');

  const loaded = [];
  for (const filename of filenames) {
    try {
      const res = await fetch(`blogs/${filename}`);
      if (!res.ok) { console.warn(`Missing blog file: ${filename}`); continue; }
      const raw = await res.text();
      const { meta, body } = parseFrontMatter(raw);
      const id = filename.replace(/\.md$/i, '');

      if (!meta.title || !meta.date) { console.warn(`Blog "${filename}" is missing required title/date metadata; skipping.`); continue; }
      const dateObj = parseLocalDate(meta.date);
      if (!dateObj) { console.warn(`Blog "${filename}" has an invalid date; skipping.`); continue; }

      const plainText = toPlainText(body);
      const words = plainText.split(/\s+/).filter(Boolean).length;
      const readingTime = Math.max(1, Math.round(words / 200));

      loaded.push({ id, meta, body, plainText, readingTime, dateObj });
    } catch (err) {
      console.warn(`Failed to load blog "${filename}":`, err);
    }
  }

  loaded.sort((a, b) => b.dateObj - a.dateObj);
  return loaded;
}

function getCategoryCounts() {
  const map = new Map();
  posts.forEach((p) => {
    const cat = p.meta.category || 'General';
    map.set(cat, (map.get(cat) || 0) + 1);
  });
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

/* ---------- 5. Rendering ---------- */

function el(id) { return document.getElementById(id); }

function setActiveNav(name) {
  document.querySelectorAll('.main-nav a').forEach((a) => {
    if (name && a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function postEyebrowHTML(post) {
  return `<span class="post-eyebrow">
    <a class="category-tag" href="#/category/${encodeURIComponent(post.meta.category || 'General')}" data-route-link>${escapeHtml(post.meta.category || 'General')}</a>
    <span>${formatDate(post.meta.date)}</span> · <span>${post.readingTime} min read</span>
  </span>`;
}

function featuredPostHTML(post) {
  return `<article class="featured-post">
    ${postEyebrowHTML(post)}
    <h3><a href="#/blog/${post.id}" data-route-link>${escapeHtml(post.meta.title)}</a></h3>
    <p>${escapeHtml(post.meta.description || '')}</p>
    <a class="btn btn-primary" href="#/blog/${post.id}" data-route-link>Read the article</a>
  </article>`;
}

function postCardHTML(post) {
  return `<article class="post-card">
    ${postEyebrowHTML(post)}
    <h3><a href="#/blog/${post.id}" data-route-link>${escapeHtml(post.meta.title)}</a></h3>
    <p>${escapeHtml(post.meta.description || '')}</p>
  </article>`;
}

function emptyStateHTML(message) {
  return `<div class="page-header"><h1>Nothing here yet</h1><p>${escapeHtml(message)}</p></div>`;
}

function articleErrorHTML(title, message) {
  return `<div class="article-wrap"><div class="article article-error">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
    <p><a class="btn btn-secondary" href="#/archive" data-route-link>Browse all posts</a></p>
  </div></div>`;
}

function hideArticleSidebarUI() {
  el('toc-section').hidden = true;
  el('highlights-section').hidden = true;
  el('reading-progress').hidden = true;
  if (scrollSpyObserver) { scrollSpyObserver.disconnect(); scrollSpyObserver = null; }
}

function renderArchiveSidebar() {
  const container = el('archive-list');
  if (!posts.length) { container.innerHTML = '<p class="muted">No posts published yet.</p>'; return; }
  container.innerHTML = posts.map((p, idx) => `
    <a class="archive-item" href="#/blog/${p.id}" data-route-link>
      <span class="archive-title">${escapeHtml(p.meta.title)}</span>
      <span class="archive-meta">${idx === 0 ? '<span class="badge-latest">Latest</span>' : ''}<span class="muted" style="font-family:var(--font-mono);font-size:0.72rem;">${formatDate(p.meta.date)}</span></span>
    </a>
  `).join('');
}

function renderHome() {
  hideArticleSidebarUI();
  const root = el('view-root');
  if (!posts.length) { root.innerHTML = emptyStateHTML('No blog posts have been published yet. Check back soon.'); return; }

  const latest = posts[0];
  const recent = posts.slice(1, 4);
  const cats = getCategoryCounts();

  root.innerHTML = `
    <section class="hero">
      <span class="hero-eyebrow">A calm corner of the internet</span>
      <h1>AI, Explained.<br><span class="hero-dim">No hype. No nonsense. Just understanding.</span></h1>
      <p class="hero-sub">${escapeHtml(SITE_TAGLINE)}</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="#/latest" data-route-link>Start Learning</a>
        <a class="btn btn-secondary" href="#/archive" data-route-link>Browse all posts</a>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Latest post</h2></div>
      ${featuredPostHTML(latest)}
    </section>

    ${recent.length ? `
    <section class="section">
      <div class="section-head"><h2>Recently published</h2><a class="section-link" href="#/archive" data-route-link>View archive →</a></div>
      <div class="post-grid">${recent.map(postCardHTML).join('')}</div>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>Categories</h2></div>
      <div class="category-grid">${cats.map(([cat, count]) => `<a class="category-pill" href="#/category/${encodeURIComponent(cat)}" data-route-link>${escapeHtml(cat)}<span class="count">${count}</span></a>`).join('')}</div>
    </section>
  `;
}

function archiveRowsHTML(list) {
  return list.map((p) => `
    <a class="archive-row" href="#/blog/${p.id}" data-route-link>
      <span class="archive-row-title">${escapeHtml(p.meta.title)}</span>
      <span class="archive-row-meta">${p === posts[0] ? 'Latest · ' : ''}${formatDate(p.meta.date)}</span>
    </a>
  `).join('');
}

function renderArchivePage() {
  hideArticleSidebarUI();
  const root = el('view-root');
  if (!posts.length) { root.innerHTML = emptyStateHTML('No blog posts have been published yet. Check back soon.'); return; }
  root.innerHTML = `
    <div class="page-header"><h1>Blog archive</h1><p>Every article, newest first.</p></div>
    <div class="archive-full">${archiveRowsHTML(posts)}</div>
  `;
}

function renderCategoriesPage() {
  hideArticleSidebarUI();
  const root = el('view-root');
  const cats = getCategoryCounts();
  if (!cats.length) { root.innerHTML = emptyStateHTML('No categories yet.'); return; }
  root.innerHTML = `
    <div class="page-header"><h1>Categories</h1><p>Browse articles by topic.</p></div>
    <div class="section"><div class="category-grid">
      ${cats.map(([cat, count]) => `<a class="category-pill" href="#/category/${encodeURIComponent(cat)}" data-route-link>${escapeHtml(cat)}<span class="count">${count}</span></a>`).join('')}
    </div></div>
  `;
}

function renderCategoryPage(category) {
  hideArticleSidebarUI();
  const root = el('view-root');
  const matches = posts.filter((p) => (p.meta.category || 'General').toLowerCase() === category.toLowerCase());
  root.innerHTML = `
    <div class="page-header"><h1>${escapeHtml(category)}</h1><p>${matches.length} article${matches.length === 1 ? '' : 's'} in this category.</p></div>
    <div class="archive-full">${matches.length ? archiveRowsHTML(matches) : '<p class="muted" style="padding:1rem 0;">No articles in this category yet.</p>'}</div>
  `;
}

function renderAboutPage() {
  hideArticleSidebarUI();
  const root = el('view-root');
  root.innerHTML = `
    <div class="page-header"><h1>About this site</h1></div>
    <div class="article-wrap" style="padding-top:0;"><div class="article article-body">
      <p><strong>AI, Explained</strong> is a small, independent blog written to help friends (and friends-of-friends) understand artificial intelligence without the hype, the jargon, or the sales pitch.</p>
      <p>Every article is written for someone who is curious but not necessarily technical. If you finish a post and understand one more thing about how AI actually works, it's done its job.</p>
      <p>This site is a static page, built with plain HTML, CSS and JavaScript, and hosted on GitHub Pages. There is no backend, no account system, and no tracking. The only thing stored about you is, optionally, your reading preferences and highlights, kept entirely in your own browser.</p>
      <h2 id="how-to-add-a-post">How new posts get added</h2>
      <p>New articles are written as Markdown files and added to the <code>blogs/</code> folder, then listed in <code>blogs/manifest.json</code>. The site picks up everything else automatically: the newest post becomes the featured article, older posts move into the archive, and categories update on their own.</p>
    </div></div>
  `;
}

async function renderArticlePage(id, section) {
  hideArticleSidebarUI();
  const root = el('view-root');
  currentArticleBlogId = null;

  const post = posts.find((p) => p.id === id);
  if (!post) {
    root.innerHTML = articleErrorHTML('Post not found', `We couldn't find a blog post at "${id}". It may have been removed, or the link might be incorrect.`);
    setActiveNav(null);
    return;
  }

  let rendered;
  try {
    rendered = renderMarkdown(post.body);
  } catch (err) {
    console.error('Markdown rendering failed for', id, err);
    root.innerHTML = articleErrorHTML('This post could not be displayed', 'Something went wrong while rendering this article. Please try refreshing the page.');
    setActiveNav(null);
    return;
  }

  root.innerHTML = `
    <div class="article-wrap"><article class="article">
      <header class="article-header">
        <a class="category-tag" href="#/category/${encodeURIComponent(post.meta.category || 'General')}" data-route-link>${escapeHtml(post.meta.category || 'General')}</a>
        <h1>${escapeHtml(post.meta.title)}</h1>
        <div class="article-meta">
          <span>${formatDate(post.meta.date)}</span>
          <span aria-hidden="true">·</span>
          <span>${escapeHtml(post.meta.author || 'Unknown author')}</span>
          <span aria-hidden="true">·</span>
          <span>${post.readingTime} min read</span>
        </div>
      </header>
      <div class="article-body">${rendered.html}</div>
    </article></div>
  `;

  // Broken-image fallback
  root.querySelectorAll('.article-body img').forEach((img) => {
    img.addEventListener('error', function onError() {
      img.removeEventListener('error', onError);
      const span = document.createElement('span');
      span.className = 'muted';
      span.style.cssText = 'display:block;padding:0.5rem 0;';
      span.textContent = '⚠ This image could not be loaded.';
      img.replaceWith(span);
    });
  });

  document.title = `${post.meta.title} — AI, Explained`;
  currentArticleBlogId = id;

  renderTOC(rendered.headings);
  const container = document.querySelector('.article-body');
  restoreHighlights(container, id);
  renderHighlightsSidebar(id);

  el('reading-progress').hidden = false;
  updateReadingProgress();

  setActiveNav(null);

  if (section) requestAnimationFrame(() => scrollToSection(section));
  else window.scrollTo(0, 0);
}

function renderNotFound() {
  hideArticleSidebarUI();
  el('view-root').innerHTML = articleErrorHTML('Page not found', "That page doesn't exist. Try the navigation on the left, or head back home.");
}

function renderFatalError(err) {
  el('view-root').innerHTML = `
    <div class="page-header">
      <h1>We couldn't load the blog</h1>
      <p>${escapeHtml(err && err.message ? err.message : 'An unknown error occurred while loading blog posts.')} Please try refreshing the page.</p>
    </div>`;
}

/* ---------- 6. Router ---------- */

function parseHash() {
  let hash = window.location.hash || '#/';
  hash = hash.replace(/^#/, '');
  if (!hash.startsWith('/')) hash = `/${hash}`;
  return hash.split('/').filter(Boolean);
}

function scrollToSection(id) {
  const target = document.getElementById(id);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleRoute() {
  const [first, second, third] = parseHash();

  // If we're already showing this exact blog post, just jump to the
  // requested section instead of a full re-render (keeps scroll position
  // sane when clicking table-of-contents links).
  if (first === 'blog' && second && currentArticleBlogId === second) {
    if (third) scrollToSection(third); else window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  closeSidebarIfMobile();

  if (!first) { renderHome(); setActiveNav('home'); window.scrollTo(0, 0); return; }
  if (first === 'latest') {
    if (posts.length) window.location.hash = `#/blog/${posts[0].id}`;
    else { hideArticleSidebarUI(); renderHome(); }
    return;
  }
  if (first === 'archive') { renderArchivePage(); setActiveNav('archive'); window.scrollTo(0, 0); return; }
  if (first === 'categories') { renderCategoriesPage(); setActiveNav('categories'); window.scrollTo(0, 0); return; }
  if (first === 'category' && second) { renderCategoryPage(decodeURIComponent(second)); setActiveNav(null); window.scrollTo(0, 0); return; }
  if (first === 'about') { renderAboutPage(); setActiveNav('about'); window.scrollTo(0, 0); return; }
  if (first === 'blog' && second) { await renderArticlePage(second, third); return; }

  renderNotFound(); setActiveNav(null); window.scrollTo(0, 0);
}

/* ---------- 7. Table of contents + scrollspy ---------- */

function renderTOC(headings) {
  const section = el('toc-section');
  const nav = el('toc-nav');
  if (!headings.length) { section.hidden = true; nav.innerHTML = ''; return; }

  section.hidden = false;
  nav.innerHTML = `<ul>${headings.map((h) => `<li><a href="#" data-target="${h.id}" style="padding-left:${(h.level - 2) * 0.8}rem">${escapeHtml(h.text)}</a></li>`).join('')}</ul>`;

  nav.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const id = a.dataset.target;
      scrollToSection(id);
      // Update the URL so the section is bookmarkable, without re-triggering the router.
      history.replaceState(null, '', `#/blog/${currentArticleBlogId}/${id}`);
    });
  });

  setupScrollSpy(headings.map((h) => h.id));
}

function setupScrollSpy(ids) {
  if (scrollSpyObserver) scrollSpyObserver.disconnect();
  if (!('IntersectionObserver' in window) || !ids.length) return;

  scrollSpyObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      document.querySelectorAll('#toc-nav a').forEach((a) => a.classList.remove('active'));
      const link = document.querySelector(`#toc-nav a[data-target="${entry.target.id}"]`);
      if (link) link.classList.add('active');
    });
  }, { root: null, rootMargin: '-96px 0px -70% 0px', threshold: 0 });

  ids.forEach((id) => {
    const target = document.getElementById(id);
    if (target) scrollSpyObserver.observe(target);
  });
}

/* ---------- 8. Reading progress ---------- */

function updateReadingProgress() {
  const body = document.querySelector('.article-body');
  const bar = el('reading-progress-bar');
  const wrap = el('reading-progress');
  if (!body || !bar || !wrap || wrap.hidden) return;
  const rect = body.getBoundingClientRect();
  const total = rect.height - window.innerHeight;
  const scrolled = -rect.top;
  const pct = total > 0 ? Math.min(100, Math.max(0, (scrolled / total) * 100)) : 100;
  bar.style.width = `${pct}%`;
}

/* ---------- 9. Highlighting ---------- */

function getAllHighlights() {
  try { return JSON.parse(localStorage.getItem(HL_STORAGE_KEY)) || {}; }
  catch (e) { return {}; }
}
function saveAllHighlights(data) {
  try { localStorage.setItem(HL_STORAGE_KEY, JSON.stringify(data)); }
  catch (e) { console.warn('Could not save highlights to localStorage', e); }
}
function getHighlightsForBlog(blogId) { return getAllHighlights()[blogId] || []; }
function addHighlightRecord(blogId, record) {
  const all = getAllHighlights();
  if (!all[blogId]) all[blogId] = [];
  all[blogId].push(record);
  saveAllHighlights(all);
}
function removeHighlightRecord(blogId, highlightId) {
  const all = getAllHighlights();
  if (all[blogId]) {
    all[blogId] = all[blogId].filter((h) => h.id !== highlightId);
    if (!all[blogId].length) delete all[blogId];
    saveAllHighlights(all);
  }
}
function clearHighlightsForBlog(blogId) {
  const all = getAllHighlights();
  delete all[blogId];
  saveAllHighlights(all);
}

// Builds a flat text representation of every text node inside a container,
// which lets us translate between "character offset in the article" and
// an actual DOM position - the basis for robust highlight save/restore.
function getTextNodesFlat(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  let text = '';
  let n = walker.nextNode();
  while (n) {
    nodes.push({ node: n, start: text.length, end: text.length + n.nodeValue.length });
    text += n.nodeValue;
    n = walker.nextNode();
  }
  return { nodes, text };
}

function getOffsetWithin(container, node, offset) {
  const preRange = document.createRange();
  preRange.selectNodeContents(container);
  preRange.setEnd(node, offset);
  return preRange.toString().length;
}

// Wraps the text between [startOffset, endOffset) (as measured against the
// container's flattened text) in <mark class="user-highlight"> elements.
// Handles selections that span multiple inline elements (e.g. bold text).
function applyHighlightByOffsets(container, startOffset, endOffset, highlightId) {
  const { nodes } = getTextNodesFlat(container);
  const targets = nodes.filter((info) => info.start < endOffset && info.end > startOffset);

  for (let idx = targets.length - 1; idx >= 0; idx -= 1) {
    const info = targets[idx];
    const { node } = info;
    const localStart = Math.max(0, startOffset - info.start);
    const localEnd = Math.min(node.nodeValue.length, endOffset - info.start);
    if (localStart >= localEnd) continue;

    const parent = node.parentNode;
    if (!parent) continue;
    const before = node.nodeValue.slice(0, localStart);
    const middle = node.nodeValue.slice(localStart, localEnd);
    const after = node.nodeValue.slice(localEnd);

    const mark = document.createElement('mark');
    mark.className = 'user-highlight';
    mark.dataset.highlightId = highlightId;
    mark.title = 'Click to remove this highlight';
    mark.textContent = middle;

    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    frag.appendChild(mark);
    if (after) frag.appendChild(document.createTextNode(after));
    parent.replaceChild(frag, node);
  }
}

function unwrapHighlightMark(mark) {
  const parent = mark.parentNode;
  if (!parent) return;
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
  parent.removeChild(mark);
  parent.normalize();
}

// Attempts to relocate each saved highlight inside the freshly-rendered
// article. Uses the stored prefix/suffix context for a precise match, and
// falls back to a unique plain-text match. If neither works (article
// content changed), the highlight is silently skipped rather than
// breaking the page.
function restoreHighlights(container, blogId) {
  const records = getHighlightsForBlog(blogId);
  records.forEach((rec) => {
    const { text: flatText } = getTextNodesFlat(container);
    let start = null;
    let end = null;

    const combined = `${rec.prefix}${rec.text}${rec.suffix}`;
    const idx = flatText.indexOf(combined);
    if (idx !== -1) {
      start = idx + rec.prefix.length;
      end = start + rec.text.length;
    } else {
      const positions = [];
      let searchFrom = 0;
      let found = flatText.indexOf(rec.text, searchFrom);
      while (found !== -1) { positions.push(found); searchFrom = found + 1; found = flatText.indexOf(rec.text, searchFrom); }
      if (positions.length === 1) { start = positions[0]; end = start + rec.text.length; }
    }

    if (start !== null) applyHighlightByOffsets(container, start, end, rec.id);
  });
}

function renderHighlightsSidebar(blogId) {
  const section = el('highlights-section');
  const list = el('highlights-list');
  section.hidden = false;
  const records = getHighlightsForBlog(blogId);

  if (!records.length) {
    list.innerHTML = '<p class="muted" style="font-size:0.85rem;">You haven\'t highlighted anything yet. Select text in the article to save a highlight — it\'s stored locally in your browser.</p>';
    return;
  }

  list.innerHTML = records.map((rec) => `
    <div class="highlight-card">
      <blockquote>${escapeHtml(rec.text.length > 140 ? `${rec.text.slice(0, 140)}…` : rec.text)}</blockquote>
      <div class="highlight-card-actions">
        <button type="button" class="link-btn" data-jump="${rec.id}">Jump to highlight</button>
        <button type="button" class="link-btn danger" data-remove="${rec.id}">Remove</button>
      </div>
    </div>
  `).join('') + (records.length > 1 ? '<button type="button" class="link-btn danger" id="clear-highlights-btn" style="margin-top:0.4rem;">Clear all highlights</button>' : '');

  list.querySelectorAll('[data-jump]').forEach((btn) => {
    btn.addEventListener('click', () => jumpToHighlight(btn.dataset.jump));
  });
  list.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hid = btn.dataset.remove;
      const mark = document.querySelector(`mark.user-highlight[data-highlight-id="${hid}"]`);
      if (mark) unwrapHighlightMark(mark);
      removeHighlightRecord(blogId, hid);
      renderHighlightsSidebar(blogId);
      announce('Highlight removed.');
    });
  });
  const clearBtn = el('clear-highlights-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      document.querySelectorAll('mark.user-highlight').forEach(unwrapHighlightMark);
      clearHighlightsForBlog(blogId);
      renderHighlightsSidebar(blogId);
      announce('All highlights cleared for this article.');
    });
  }
}

function jumpToHighlight(highlightId) {
  const mark = document.querySelector(`mark.user-highlight[data-highlight-id="${highlightId}"]`);
  if (!mark) return;
  mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  mark.classList.add('flash');
  setTimeout(() => mark.classList.remove('flash'), 1400);
}

function setupHighlightUI() {
  const toolbar = el('highlight-toolbar');

  const positionToolbar = debounce(() => {
    const sel = window.getSelection();
    const container = document.querySelector('.article-body');
    if (!container || !sel || sel.isCollapsed || sel.rangeCount === 0 || sel.toString().trim() === '') { toolbar.hidden = true; return; }
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) { toolbar.hidden = true; return; }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) { toolbar.hidden = true; return; }
    toolbar.hidden = false;
    const top = window.scrollY + rect.top - toolbar.offsetHeight - 10;
    const left = window.scrollX + rect.left + (rect.width / 2) - (toolbar.offsetWidth / 2);
    toolbar.style.top = `${Math.max(8, top)}px`;
    toolbar.style.left = `${Math.max(8, left)}px`;
  }, 150);

  document.addEventListener('selectionchange', positionToolbar);

  // Prevent the mousedown on the toolbar button from collapsing the selection.
  toolbar.addEventListener('mousedown', (e) => e.preventDefault());

  toolbar.addEventListener('click', () => {
    const container = document.querySelector('.article-body');
    const sel = window.getSelection();
    if (!container || !currentArticleBlogId || !sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;

    const startOffset = getOffsetWithin(container, range.startContainer, range.startOffset);
    const endOffset = getOffsetWithin(container, range.endContainer, range.endOffset);
    const { text: flatText } = getTextNodesFlat(container);
    const text = flatText.slice(startOffset, endOffset);
    if (!text.trim()) { toolbar.hidden = true; return; }

    const prefix = flatText.slice(Math.max(0, startOffset - 40), startOffset);
    const suffix = flatText.slice(endOffset, endOffset + 40);
    const id = `hl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    addHighlightRecord(currentArticleBlogId, { id, text, prefix, suffix, createdAt: Date.now() });
    applyHighlightByOffsets(container, startOffset, endOffset, id);
    sel.removeAllRanges();
    toolbar.hidden = true;
    renderHighlightsSidebar(currentArticleBlogId);
    announce('Highlight saved.');
  });

  // Clicking an existing highlight removes it (with the sidebar buttons as
  // the more discoverable alternative for the same action).
  document.addEventListener('click', (e) => {
    const mark = e.target.closest && e.target.closest('mark.user-highlight');
    if (!mark || !currentArticleBlogId) return;
    const hid = mark.dataset.highlightId;
    unwrapHighlightMark(mark);
    removeHighlightRecord(currentArticleBlogId, hid);
    renderHighlightsSidebar(currentArticleBlogId);
    announce('Highlight removed.');
  });
}

/* ---------- 10. Search ---------- */

function performSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];
  posts.forEach((p) => {
    const haystack = `${p.meta.title} ${p.meta.description || ''} ${p.meta.category || ''} ${p.plainText}`.toLowerCase();
    if (!haystack.includes(q)) return;

    let source = p.plainText;
    let idx = p.plainText.toLowerCase().indexOf(q);
    if (idx === -1) { source = p.meta.description || p.meta.title; idx = source.toLowerCase().indexOf(q); }

    let excerpt = p.meta.description || '';
    if (idx !== -1) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(source.length, idx + q.length + 60);
      excerpt = `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
    }
    results.push({ post: p, excerpt });
  });
  return results.slice(0, 20);
}

function highlightMatch(text, query) {
  const escaped = escapeHtml(text);
  const escQuery = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escQuery) return escaped;
  return escaped.replace(new RegExp(`(${escQuery})`, 'ig'), '<mark>$1</mark>');
}

function setupSearchUI() {
  const input = el('search-input');
  const resultsEl = el('search-results');

  const runSearch = debounce(() => {
    const q = input.value;
    if (!q.trim()) { resultsEl.hidden = true; resultsEl.innerHTML = ''; return; }
    const results = performSearch(q);
    if (!results.length) {
      resultsEl.innerHTML = '<p class="search-empty">No matching articles found.</p>';
      resultsEl.hidden = false;
      return;
    }
    resultsEl.innerHTML = results.map((r) => `
      <a class="search-result-item" href="#/blog/${r.post.id}" data-route-link role="option">
        <span class="sr-title">${highlightMatch(r.post.meta.title, q)}</span>
        <span class="sr-meta">${formatDate(r.post.meta.date)} · ${escapeHtml(r.post.meta.category || 'General')}</span>
        <span class="sr-excerpt">${highlightMatch(r.excerpt, q)}</span>
      </a>
    `).join('');
    resultsEl.hidden = false;
  }, 180);

  input.addEventListener('input', runSearch);
  input.addEventListener('focus', () => { if (input.value.trim()) resultsEl.hidden = false; });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) resultsEl.hidden = true;
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('.search-result-item')) { input.value = ''; resultsEl.hidden = true; }
  });
}

/* ---------- 11. Theme + mobile nav ---------- */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  el('theme-toggle').setAttribute('aria-pressed', String(theme === 'dark'));
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) { /* ignore */ }
}

function initTheme() {
  let theme;
  try { theme = localStorage.getItem(THEME_STORAGE_KEY); } catch (e) { theme = null; }
  if (!theme) theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(theme);
}

function setupThemeToggle() {
  el('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}

function closeSidebarIfMobile() {
  if (window.innerWidth > 900) return;
  el('sidebar').classList.remove('open');
  el('sidebar-overlay').hidden = true;
  el('mobile-nav-toggle').setAttribute('aria-expanded', 'false');
}

function setupMobileNav() {
  const sidebar = el('sidebar');
  const overlay = el('sidebar-overlay');
  const toggle = el('mobile-nav-toggle');

  function open() { sidebar.classList.add('open'); overlay.hidden = false; toggle.setAttribute('aria-expanded', 'true'); }
  function close() { sidebar.classList.remove('open'); overlay.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }

  toggle.addEventListener('click', () => (sidebar.classList.contains('open') ? close() : open()));
  overlay.addEventListener('click', close);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-route-link]') && window.innerWidth <= 900) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) close();
  });
}

/* ---------- 12. Init ---------- */

function setupScrollListener() {
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { updateReadingProgress(); ticking = false; });
  }, { passive: true });
}

async function init() {
  initTheme();
  setupThemeToggle();
  setupMobileNav();
  setupSearchUI();
  setupHighlightUI();
  setupScrollListener();

  try {
    posts = await loadManifestAndPosts();
  } catch (err) {
    console.error('Failed to load blog manifest/posts:', err);
    renderFatalError(err);
    return;
  }

  renderArchiveSidebar();

  // Support the alternate "?blog=id" link format by converting it to our
  // hash route once, on first load.
  if (!window.location.hash && window.location.search) {
    const params = new URLSearchParams(window.location.search);
    const blogParam = params.get('blog');
    if (blogParam) window.location.hash = `#/blog/${blogParam}`;
  }

  window.addEventListener('hashchange', handleRoute);
  await handleRoute();
}

document.addEventListener('DOMContentLoaded', init);
