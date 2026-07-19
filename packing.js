/* =============================================================
   packing.js
   Reads the same orders TXT used by the Label Filler, totals
   quantity per product + variant across every row, and exports
   a purchase/packing list as PDF (primary) or CSV.
   Reuses parseCSV / readFileAsText / stripVariant / extractVariant
   from app.js — same file format, no need to re-parse.
   ============================================================= */

let pkgFiles  = []; // FileList → array
let pkgGroups = null; // [{ product, total, variants: [{ variant, qty }] }]

const pkgInput       = document.getElementById('pkg-input');
const pkgCard        = document.getElementById('pkg-card');
const pkgName        = document.getElementById('pkg-name');
const pkgDateInput   = document.getElementById('pkg-date');
const pkgCleanCheck  = document.getElementById('pkg-clean-variant');
const pkgProcessBtn  = document.getElementById('pkg-process-btn');
const pkgLogSection  = document.getElementById('pkg-log-section');
const pkgLogBody     = document.getElementById('pkg-log-body');
const pkgLogStatus   = document.getElementById('pkg-log-status');
const pkgDownloadRow = document.getElementById('pkg-download-row');
const pkgCsvBtn      = document.getElementById('pkg-csv-btn');
const pkgPdfBtn      = document.getElementById('pkg-pdf-btn');

const pkgPreviewSection = document.getElementById('pkg-preview-section');
const pkgPreviewList    = document.getElementById('pkg-preview-list');
const pkgAddParentBtn   = document.getElementById('pkg-add-parent-btn');

// Default the list date to today.
(function () {
  const t = new Date();
  const yyyy = t.getFullYear();
  const mm   = String(t.getMonth() + 1).padStart(2, '0');
  const dd   = String(t.getDate()).padStart(2, '0');
  pkgDateInput.value = `${yyyy}-${mm}-${dd}`;
})();

// Browsers only expose a file's last-modified time, not a true creation date.
function formatFileDate(file) {
  const d = new Date(file.lastModified);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) +
    ' ' + d.toLocaleDateString('en-GB', { weekday: 'long' });
}

pkgInput.addEventListener('change', () => {
  pkgFiles = Array.from(pkgInput.files || []);

  if (!pkgFiles.length) {
    pkgName.textContent = 'No file chosen';
    pkgName.className   = 'file-name';
  } else {
    pkgName.innerHTML = pkgFiles
      .map(f => `<div class="file-name-row"><span class="file-name-file">${escHtml(f.name)}</span><span class="file-name-date">${escHtml(formatFileDate(f))}</span></div>`)
      .join('');
    pkgName.className = 'file-name ready';
  }

  pkgCard.classList.toggle('has-file', !!pkgFiles.length);
  pkgProcessBtn.disabled = !pkgFiles.length;
});

pkgProcessBtn.addEventListener('click', runPacking);
pkgCsvBtn.addEventListener('click', downloadPkgCsv);
pkgPdfBtn.addEventListener('click', downloadPkgPdf);

// ── Logging ──────────────────────────────────────────────────
function pkgLog(type, icon, msg) {
  const div = document.createElement('div');
  div.className = `log-line ${type}`;
  div.innerHTML = `<span class="icon">${icon}</span><span class="msg">${escHtml(msg)}</span>`;
  pkgLogBody.appendChild(div);
  pkgLogBody.scrollTop = pkgLogBody.scrollHeight;
}
const pL = {
  info: m => pkgLog('info', '·', m),
  ok:   m => pkgLog('ok',   '✓', m),
  warn: m => pkgLog('warn', '⚠', m),
  err:  m => pkgLog('err',  '✗', m),
  head: m => pkgLog('head', '▸', m),
};

// ── Date formatting ───────────────────────────────────────────
// "2026-07-18" -> "18 July, 2026 - Saturday"
function formatListDate(dateStr) {
  let date;
  if (dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    date = new Date(y, m - 1, d);
  }
  if (!date || isNaN(date.getTime())) date = new Date();

  const day   = date.getDate();
  const month = date.toLocaleDateString('en-GB', { month: 'long' });
  const year  = date.getFullYear();
  const wday  = date.toLocaleDateString('en-GB', { weekday: 'long' });
  return `${day} ${month}, ${year} - ${wday}`;
}

// Amazon variant strings carry noise the purchaser doesn't need: the fixed
// "UK, Numeric" size-system tokens -- drop those. The Length/Fit pair always
// puts "Regular" (Length's default) right before the real Fit value
// (Regular/Short/Long), e.g. "Regular, Short" or "Regular, Regular" -- drop
// that leading "Regular" and keep the Fit value that follows it.
const FIT_VALUES = ['regular', 'short', 'long'];

function dedupeVariantTokens(variant) {
  const dropped = ['uk', 'numeric'];
  const tokens = variant.split(',').map(t => t.trim()).filter(t => !dropped.includes(t.toLowerCase()));

  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (t.toLowerCase() === 'regular' && next && FIT_VALUES.includes(next.toLowerCase())) continue;
    out.push(t);
  }
  return out.join(', ');
}

// ── Aggregate rows into product groups, each holding its variant totals ──
// So the parent product name is written once, with every variant nested
// under it -- no repeating the same product name row after row.
function aggregatePacking(rows, cleanVariants) {
  const groups = {}; // product -> { variant -> qty }
  for (const row of rows) {
    const product = stripVariant(row.name);
    const rawVariant = extractVariant(row.name) || '';
    const variant = cleanVariants ? dedupeVariantTokens(rawVariant) : rawVariant;
    const qty     = parseInt(row.qty, 10) || 1;
    if (!groups[product]) groups[product] = {};
    groups[product][variant] = (groups[product][variant] || 0) + qty;
  }

  return Object.keys(groups).sort((a, b) => a.localeCompare(b)).map(product => {
    const variants = Object.keys(groups[product])
      .sort((a, b) => a.localeCompare(b))
      .map(variant => ({ variant, qty: groups[product][variant] }));
    const total = variants.reduce((s, v) => s + v.qty, 0);
    return { product, total, variants };
  });
}

// ── Main runner ──────────────────────────────────────────────
async function runPacking() {
  pkgGroups = null;
  pkgDownloadRow.style.display = 'none';
  pkgLogBody.innerHTML = '';
  pkgLogSection.style.display = '';
  pkgLogStatus.textContent = '';

  pkgProcessBtn.classList.add('loading');
  pkgProcessBtn.querySelector('.btn-text').textContent = 'Processing…';

  try {
    pL.head(pkgFiles.length > 1 ? `Reading ${pkgFiles.length} orders files…` : 'Reading orders file…');
    let rows = [];
    for (const file of pkgFiles) {
      const text = await readFileAsText(file);
      let fileRows;
      try {
        fileRows = parseCSV(text);
      } catch (e) {
        pL.err(`${file.name}: ${e.message}`);
        return;
      }
      pL.ok(`${file.name} — ${fileRows.length} rows`);
      rows = rows.concat(fileRows);
    }
    pL.ok(`${rows.length} rows total across ${pkgFiles.length} file(s)`);

    pL.head('Grouping by product + variant…');
    pkgGroups = aggregatePacking(rows, pkgCleanCheck.checked);

    const totalQty = pkgGroups.reduce((s, g) => s + g.total, 0);
    const lineCount = pkgGroups.reduce((s, g) => s + g.variants.length, 0);

    // Summary first, before the per-product breakdown.
    pL.ok(`${pkgGroups.length} products, ${lineCount} variant lines, ${totalQty} units total`);

    for (const group of pkgGroups) {
      pL.ok(`${group.total} x ${group.product}`);
      for (const v of group.variants) {
        pL.info(`   ${v.qty} x ${v.variant || '-'}`);
      }
    }

    pkgLogStatus.textContent = `${pkgGroups.length} products, ${totalQty} units`;
    pkgPreviewSection.style.display = '';
    pkgDownloadRow.style.display = '';
    renderPkgPreview();

  } catch (err) {
    pL.err(`Fatal error: ${err.message}`);
    console.error(err);
  } finally {
    pkgProcessBtn.classList.remove('loading');
    pkgProcessBtn.querySelector('.btn-text').textContent = 'Generate List';
  }
}

// ── Editable preview ───────────────────────────────────────────
pkgAddParentBtn.addEventListener('click', () => {
  if (!pkgGroups) return;
  pkgGroups.push({ product: 'New Product', total: 0, variants: [{ variant: '', qty: 1 }] });
  renderPkgPreview();
});

function recalcPkgStatus() {
  const totalQty = pkgGroups.reduce((s, g) => s + g.total, 0);
  pkgLogStatus.textContent = `${pkgGroups.length} products, ${totalQty} units`;
}

function renderPkgPreview() {
  pkgPreviewList.innerHTML = '';

  if (!pkgGroups.length) {
    const hint = document.createElement('div');
    hint.className = 'pkg-empty-hint';
    hint.textContent = 'No products — use "Add Product" to start one.';
    pkgPreviewList.appendChild(hint);
    recalcPkgStatus();
    return;
  }

  pkgGroups.forEach((group, gi) => {
    const parentEl = document.createElement('div');
    parentEl.className = 'pkg-parent';
    parentEl.innerHTML = `
      <div class="pkg-parent-header">
        <input class="pkg-parent-name" value="${escAttr(group.product)}" />
        <span class="pkg-parent-total">${group.total} total</span>
        <button class="pkg-icon-btn" data-act="add-child" title="Add variant">+</button>
        <button class="pkg-icon-btn danger" data-act="remove-parent" title="Remove product">&times;</button>
      </div>
      <div class="pkg-children"></div>
    `;

    parentEl.querySelector('.pkg-parent-name').addEventListener('input', e => {
      group.product = e.target.value;
    });
    parentEl.querySelector('[data-act="add-child"]').addEventListener('click', () => {
      group.variants.push({ variant: '', qty: 1 });
      renderPkgPreview();
    });
    parentEl.querySelector('[data-act="remove-parent"]').addEventListener('click', () => {
      pkgGroups.splice(gi, 1);
      renderPkgPreview();
    });

    const childrenEl = parentEl.querySelector('.pkg-children');
    group.variants.forEach((v, vi) => {
      const childEl = document.createElement('div');
      childEl.className = 'pkg-child';
      childEl.innerHTML = `
        <input class="pkg-child-variant" placeholder="variant" value="${escAttr(v.variant)}" />
        <div class="pkg-qty-stepper">
          <button class="pkg-icon-btn" data-act="dec" title="Decrease">&minus;</button>
          <span class="pkg-qty-value">${v.qty}</span>
          <button class="pkg-icon-btn" data-act="inc" title="Increase">+</button>
        </div>
        <button class="pkg-icon-btn danger" data-act="remove-child" title="Remove variant">&times;</button>
      `;

      childEl.querySelector('.pkg-child-variant').addEventListener('input', e => {
        v.variant = e.target.value;
      });
      childEl.querySelector('[data-act="dec"]').addEventListener('click', () => {
        v.qty = Math.max(1, v.qty - 1);
        group.total = group.variants.reduce((s, x) => s + x.qty, 0);
        childEl.querySelector('.pkg-qty-value').textContent = v.qty;
        parentEl.querySelector('.pkg-parent-total').textContent = `${group.total} total`;
        recalcPkgStatus();
      });
      childEl.querySelector('[data-act="inc"]').addEventListener('click', () => {
        v.qty += 1;
        group.total = group.variants.reduce((s, x) => s + x.qty, 0);
        childEl.querySelector('.pkg-qty-value').textContent = v.qty;
        parentEl.querySelector('.pkg-parent-total').textContent = `${group.total} total`;
        recalcPkgStatus();
      });
      childEl.querySelector('[data-act="remove-child"]').addEventListener('click', () => {
        group.variants.splice(vi, 1);
        group.total = group.variants.reduce((s, x) => s + x.qty, 0);
        renderPkgPreview();
      });

      childrenEl.appendChild(childEl);
    });

    pkgPreviewList.appendChild(parentEl);
  });

  recalcPkgStatus();
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ── Filename ─────────────────────────────────────────────────
function buildPackingFilename(ext) {
  let date;
  const dateStr = pkgDateInput.value;
  if (dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    date = new Date(y, m - 1, d);
  }
  if (!date || isNaN(date.getTime())) date = new Date();

  const day   = date.getDate();
  const month = date.toLocaleDateString('en-GB', { month: 'long' });
  const year  = date.getFullYear();
  const wday  = date.toLocaleDateString('en-GB', { weekday: 'long' });
  return `${day} ${month} ${year} ${wday} Purchase List.${ext}`;
}

// ── CSV export ───────────────────────────────────────────────
function csvField(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadPkgCsv() {
  if (!pkgGroups) return;

  const totalQty = pkgGroups.reduce((s, g) => s + g.total, 0);
  const listDate = formatListDate(pkgDateInput.value);

  // Summary lines first, then the table. Product name is written once per
  // group, blank on the variant rows below it — same "don't repeat the
  // parent" shape as the PDF.
  const lines = [
    `Date,${csvField(listDate)}`,
    `Total Products,${pkgGroups.length}`,
    `Total Quantity,${totalQty}`,
    '',
    'product-name,variant,quantity',
  ];
  for (const group of pkgGroups) {
    group.variants.forEach((v, i) => {
      const productCell = i === 0 ? csvField(group.product) : '';
      lines.push([productCell, csvField(v.variant), v.qty].join(','));
    });
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = buildPackingFilename('csv');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── PDF export ───────────────────────────────────────────────
// Wrap text into lines that fit maxWidth at the given font/size.
function pkgWrapText(font, text, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (cur && font.widthOfTextAtSize(test, size) > maxWidth) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Rounded-rectangle path. pdf-lib's drawSvgPath flips the Y axis internally
// (SVG is Y-down, pdf-lib is Y-up), so the Y values passed in here are
// negated to land back at the intended page coordinates.
function roundedRectPath(x, yTop, width, height, radius) {
  const yBot = yTop - height;
  const r    = Math.min(radius, height / 2, width / 2);
  const ny   = v => -v;
  return `M ${x + r},${ny(yTop)} L ${x + width - r},${ny(yTop)} ` +
    `Q ${x + width},${ny(yTop)} ${x + width},${ny(yTop - r)} ` +
    `L ${x + width},${ny(yBot + r)} ` +
    `Q ${x + width},${ny(yBot)} ${x + width - r},${ny(yBot)} ` +
    `L ${x + r},${ny(yBot)} ` +
    `Q ${x},${ny(yBot)} ${x},${ny(yBot + r)} ` +
    `L ${x},${ny(yTop - r)} ` +
    `Q ${x},${ny(yTop)} ${x + r},${ny(yTop)} Z`;
}

async function downloadPkgPdf() {
  if (!pkgGroups) return;

  const pdfDoc   = await PDFLib.PDFDocument.create();
  const font     = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);

  const pageW = 595.28, pageH = 841.89; // A4
  const margin      = 40;
  const boxPadding  = 10;
  const boxGap      = 10;
  const fullW       = pageW - margin * 2;
  const innerW      = fullW - boxPadding * 2;
  const lineH       = 12;
  const productSize = 10;
  const variantSize = 9;

  const totalQty  = pkgGroups.reduce((s, g) => s + g.total, 0);
  const listDate  = formatListDate(pkgDateInput.value);

  let page, y;

  function newPage() {
    page = pdfDoc.addPage([pageW, pageH]);
    y = pageH - margin;
    page.drawText('Purchase List', { x: margin, y, size: 16, font: fontBold });
    const dateSize = 11;
    const dateW = font.widthOfTextAtSize(listDate, dateSize);
    page.drawText(listDate, { x: pageW - margin - dateW, y, size: dateSize, font, color: PDFLib.rgb(0, 0, 0) });
    y -= 15;
    return page;
  }

  function drawSummary() {
    page.drawText(`${pkgGroups.length} products  ·  ${totalQty} units total`, {
      x: margin, y, size: 10, font, color: PDFLib.rgb(0.4, 0.4, 0.4),
    });
    y -= 20;
  }

  newPage();
  drawSummary();

  // Space from the box's top/bottom edge to the first/last baseline — text
  // sits on a baseline, not its visual top, so the top inset needs extra
  // room to look even with the bottom. Same reasoning for the gaps around
  // each divider line: more room above (line to baseline) than below
  // (baseline to line), so a row reads as sitting evenly inside its cell.
  const topInset       = 16;
  const bottomInset    = 8;
  const dividerAfter   = 6;  // last baseline of a cell -> the divider below it
  const dividerBefore  = 12; // divider line -> first baseline of the next cell

  for (const group of pkgGroups) {
    const productLines = pkgWrapText(fontBold, group.product, productSize, innerW);
    const variantWraps  = group.variants.map(v =>
      pkgWrapText(font, `${v.variant || '-'} x ${v.qty}`, variantSize, innerW)
    );

    const dividerCount = variantWraps.length; // one after the title row, one between each pair of variants except after the last
    // Height only needs the span *between* baselines within a wrapped block
    // (length - 1 steps of lineH) — the insets above already cover the room
    // a baseline needs above/below it, so counting a full lineH per line
    // here would double up and leave a big gap at the bottom of the box.
    const boxHeight = topInset
      + (productLines.length - 1) * lineH
      + variantWraps.reduce((s, lines) => s + (lines.length - 1) * lineH, 0)
      + dividerCount * (dividerAfter + dividerBefore)
      + bottomInset;

    // Keep each group's box on one page rather than splitting it across a break.
    if (y - boxHeight < margin) newPage();

    roundedBox(boxHeight);

    let cy = y - topInset;
    for (let li = 0; li < productLines.length; li++) {
      page.drawText(productLines[li], { x: margin + boxPadding, y: cy - li * lineH, size: productSize, font: fontBold });
    }
    cy -= (productLines.length - 1) * lineH;

    group.variants.forEach((v, idx) => {
      // Divider line touching the box's own left/right edges, so the row
      // reads as a bordered cell that's seamlessly part of the box.
      const dividerY = cy - dividerAfter;
      page.drawLine({ start: { x: margin, y: dividerY }, end: { x: margin + fullW, y: dividerY }, thickness: 0.75, color: PDFLib.rgb(0.8, 0.8, 0.8) });
      cy = dividerY - dividerBefore;

      const variantLines = variantWraps[idx];
      const qtySuffix    = ` x ${v.qty}`;
      const lastLi       = variantLines.length - 1;

      // Variant text lines up at the same left indent as the product name,
      // quantity tacked on right after it as "variant x qty" -- bold just
      // the "x qty" part, which always lands on the last wrapped line.
      for (let li = 0; li < variantLines.length; li++) {
        const ly = cy - li * lineH;
        const lineText = variantLines[li];
        if (li === lastLi && lineText.endsWith(qtySuffix)) {
          const head = lineText.slice(0, -qtySuffix.length);
          page.drawText(head, { x: margin + boxPadding, y: ly, size: variantSize, font });
          // pkgWrapText collapses runs of whitespace to one space, so the extra
          // spacebar gap is added here as a draw offset instead of in the text.
          const headW  = font.widthOfTextAtSize(head, variantSize);
          const extraGap = font.widthOfTextAtSize(' ', variantSize);
          page.drawText(qtySuffix, { x: margin + boxPadding + headW + extraGap, y: ly, size: variantSize, font: fontBold });
        } else {
          page.drawText(lineText, { x: margin + boxPadding, y: ly, size: variantSize, font });
        }
      }

      cy -= (variantLines.length - 1) * lineH;
    });

    y -= boxHeight + boxGap;
  }

  function roundedBox(height) {
    const path = roundedRectPath(margin, y, fullW, height, 6);
    page.drawSvgPath(path, { borderColor: PDFLib.rgb(0.7, 0.7, 0.7), borderWidth: 1 });
  }

  const bytes = await pdfDoc.save();
  const blob  = new Blob([bytes], { type: 'application/pdf' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = buildPackingFilename('pdf');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
