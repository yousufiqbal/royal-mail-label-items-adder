/* =========================================================
   LabelFill – app.js
   Reads a shipping-labels PDF + orders CSV, overlays order
   details onto each label page, returns modified PDF.
   ========================================================= */

// ── pdfjsLib worker ──────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── State ────────────────────────────────────────────────
let pdfFile = null;
let csvFile = null;
let modifiedPdfBytes = null;

// ── DOM refs ─────────────────────────────────────────────
const pdfInput    = document.getElementById('pdf-input');
const csvInput    = document.getElementById('csv-input');
const pdfCard     = document.getElementById('pdf-card');
const csvCard     = document.getElementById('csv-card');
const pdfName     = document.getElementById('pdf-name');
const csvName     = document.getElementById('csv-name');
const processBtn  = document.getElementById('process-btn');
const logSection  = document.getElementById('log-section');
const logBody     = document.getElementById('log-body');
const logStatus   = document.getElementById('log-status');
const downloadRow = document.getElementById('download-row');
const downloadBtn = document.getElementById('download-btn');

// ── File inputs ──────────────────────────────────────────
pdfInput.addEventListener('change', () => {
  pdfFile = pdfInput.files[0] || null;
  pdfName.textContent = pdfFile ? pdfFile.name : 'No file chosen';
  pdfName.className   = pdfFile ? 'file-name ready' : 'file-name';
  pdfCard.classList.toggle('has-file', !!pdfFile);
  checkReady();
});

csvInput.addEventListener('change', () => {
  csvFile = csvInput.files[0] || null;
  csvName.textContent = csvFile ? csvFile.name : 'No file chosen';
  csvName.className   = csvFile ? 'file-name ready' : 'file-name';
  csvCard.classList.toggle('has-file', !!csvFile);
  checkReady();
});

function checkReady() {
  processBtn.disabled = !(pdfFile && csvFile);
}

// ── Process button ───────────────────────────────────────
processBtn.addEventListener('click', () => {
  runProcess();
});

downloadBtn.addEventListener('click', () => {
  if (!modifiedPdfBytes) return;
  const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = buildOutputFilename(pdfFile ? pdfFile.name : '');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

// ── Build a human-friendly output filename from the PDF filename ──
// Input:  orders-2026-05-11-07-51-48-label.pdf
// Output: 11 May 2026 Monday Labels.pdf
function buildOutputFilename(originalName) {
  // Strip extension
  const base = originalName.replace(/\.pdf$/i, '');

  // Try to extract YYYY-MM-DD from anywhere in the filename
  const m = base.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 'Labels.pdf';

  const year  = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1; // JS months are 0-indexed
  const day   = parseInt(m[3], 10);

  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) return 'Labels.pdf';

  const dayName   = date.toLocaleDateString('en-GB', { weekday: 'long' });
  const monthName = date.toLocaleDateString('en-GB', { month: 'long' });

  return `${day} ${monthName} ${year} ${dayName} Labels.pdf`;
}

// ── Logging helpers ──────────────────────────────────────
function logLine(type, icon, msg) {
  const div = document.createElement('div');
  div.className = `log-line ${type}`;
  div.innerHTML = `<span class="icon">${icon}</span><span class="msg">${escHtml(msg)}</span>`;
  logBody.appendChild(div);
  logBody.scrollTop = logBody.scrollHeight;
}
const logInfo  = m => logLine('info', '·', m);
const logOk    = m => logLine('ok',   '✓', m);
const logWarn  = m => logLine('warn', '⚠', m);
const logErr   = m => logLine('err',  '✗', m);
const logHead  = m => logLine('head', '▸', m);
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── CSV parsing ──────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]).map(h => h.trim().toLowerCase());

  const idIdx   = headers.findIndex(h => h === 'order-id'           || h === 'order_id');
  const nameIdx = headers.findIndex(h => h === 'product-name'       || h === 'product_name' || h === 'product name');
  const qtyIdx  = headers.findIndex(h => h === 'quantity-purchased' || h === 'quantity_purchased' || h === 'quantity purchased' || h === 'quantity');

  if (idIdx === -1 || nameIdx === -1 || qtyIdx === -1) {
    throw new Error(
      `CSV missing required columns. Found: "${headers.join('", "')}". ` +
      `Need: order-id, product-name, quantity-purchased`
    );
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCSVRow(lines[i]);
    rows.push({
      orderId:  (cols[idIdx]   || '').trim(),
      name:     (cols[nameIdx] || '').trim(),
      qty:      (cols[qtyIdx]  || '1').trim(),
    });
  }
  return rows;
}

function parseCSVRow(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inQ) { inQ = true; continue; }
    if (ch === '"' && inQ) {
      if (line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = false;
      continue;
    }
    if (ch === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

// ── Build order map: orderId → [{ name, qty }] ───────────
function buildOrderMap(rows) {
  const map = {};
  for (const row of rows) {
    if (!row.orderId) continue;
    if (!map[row.orderId]) map[row.orderId] = [];
    map[row.orderId].push({ name: row.name, qty: row.qty });
  }
  return map;
}

// ── Extract order ID from page text ─────────────────────
// Label format (confirmed from image):
//   Customer Ref:
//   723619 / 206-7965794-0399534 / MSF AM
//
// The order ID is the MIDDLE token between the two " / " separators.
// It may contain digits, hyphens, and letters (Amazon-style: 206-7965794-0399534).
// We also do a full-page fallback scan in case PDF.js text order is scrambled.
function extractOrderId(pageText) {
  const lines = pageText.split(/\n/).map(l => l.trim()).filter(Boolean);

  // Try to find  ANYTHING / ORDER-ID / ANYTHING  in a string
  // Order ID must have at least one hyphen or be all digits (to avoid matching "MSF AM" etc.)
  function parseSlashPattern(str) {
    // Split on " / " or "/" with optional spaces
    const parts = str.split(/\s*\/\s*/);
    // We need at least 3 parts; the middle one(s) are the order ID candidates
    for (let i = 1; i < parts.length - 1; i++) {
      const candidate = parts[i].trim();
      // Must look like an order ID: contains digits, may have hyphens
      if (/^[A-Za-z0-9][A-Za-z0-9\-]{4,}$/.test(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  // First pass: look near "Customer Ref" lines
  for (let i = 0; i < lines.length; i++) {
    if (/customer\s*ref/i.test(lines[i])) {
      // Check same line
      const onSame = parseSlashPattern(lines[i]);
      if (onSame) return { orderId: onSame, refLine: lines[i] };
      // Check next 6 lines
      for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
        const found = parseSlashPattern(lines[j]);
        if (found) return { orderId: found, refLine: lines[j] };
      }
    }
  }

  // Second pass: scan every line for the slash pattern (PDF.js may scramble order)
  for (const line of lines) {
    const found = parseSlashPattern(line);
    if (found) return { orderId: found, refLine: line };
  }

  return null;
}

// ── Parse variant from product name  (text inside last ()) ──
function extractVariant(name) {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : null;
}

function stripVariant(name) {
  return name.replace(/\s*\([^)]+\)\s*$/, '').trim();
}

function first8Words(name) {
  return name.split(/\s+/).slice(0, 8).join(' ');
}

// ── Build the text block to overlay ─────────────────────
function buildOverlayText(items) {
  // items = [{ name, qty }]
  if (items.length === 1) {
    // Single row → full name with qty
    return [{ text: `${items[0].qty} x ${items[0].name}`, bold: false }];
  }

  // Multiple rows → group by first-8-word prefix
  const groups = [];
  for (const item of items) {
    const prefix = first8Words(stripVariant(item.name));
    let group = groups.find(g => g.prefix === prefix);
    if (!group) { group = { prefix, variants: [], boldName: first8Words(stripVariant(item.name)) }; groups.push(group); }
    const variant = extractVariant(item.name);
    group.variants.push({ qty: item.qty, variant });
  }

  const lines = [];
  for (const group of groups) {
    lines.push({ text: group.boldName, bold: true });
    for (const v of group.variants) {
      const vtxt = v.variant ? `(${v.variant})` : stripVariant(v.qty);
      lines.push({ text: `${v.qty} x ${vtxt}`, bold: false });
    }
  }
  return lines;
}

// ── Find the Y/X position of the Customer Ref area in the page ──
// We use PDF.js text items with their transform positions.
async function findRefAreaPosition(pdfJsDoc, pageNum) {
  const page = await pdfJsDoc.getPage(pageNum);
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });

  let customerRefY = null;
  let customerRefX = null;
  let refLineY     = null;
  let fontSize     = 8; // fallback

  // PDF.js transforms: item.transform = [sx, b, c, sy, tx, ty]
  // tx = X from left, ty = Y from bottom
  for (const item of textContent.items) {
    const text = (item.str || '').trim();
    const tx   = item.transform[4]; // X from left
    const ty   = item.transform[5]; // Y from bottom
    const h    = item.height;

    if (/customer\s*ref/i.test(text)) {
      customerRefY = ty;
      customerRefX = tx;
      fontSize = h || 8;
    }
    if (customerRefY !== null && /\/[^/]+\/[^/]+\/[^/]+/.test(text)) {
      refLineY = ty;
      if (h) fontSize = h;
      break;
    }
  }

  return { customerRefY, customerRefX, refLineY, fontSize, pageHeight: viewport.height };
}

// ── Main processor ───────────────────────────────────────
async function runProcess() {
  modifiedPdfBytes = null;
  downloadRow.style.display = 'none';
  logBody.innerHTML = '';
  logSection.style.display = '';
  logStatus.textContent = '';

  processBtn.classList.add('loading');
  processBtn.querySelector('.btn-text').textContent = 'Processing…';
  processBtn.querySelector('.btn-icon').innerHTML = '<span class="spinner"></span>';

  try {
    // 1. Read CSV
    logHead('Reading CSV…');
    const csvText = await readFileAsText(csvFile);
    let csvRows;
    try {
      csvRows = parseCSV(csvText);
    } catch (e) {
      logErr(e.message);
      return;
    }
    const orderMap = buildOrderMap(csvRows);
    logOk(`CSV loaded — ${csvRows.length} rows, ${Object.keys(orderMap).length} unique order IDs`);

    // 2. Read PDF bytes
    logHead('Reading PDF…');
    const pdfBytes = await readFileAsArrayBuffer(pdfFile);
    logOk(`PDF loaded — ${(pdfBytes.byteLength / 1024).toFixed(0)} KB`);

    // 3. Load with PDF.js for text extraction
    // Copy the buffer first — PDF.js detaches (transfers) the ArrayBuffer it receives,
    // making it unusable for pdf-lib afterwards.
    const pdfBytesCopy = pdfBytes.slice(0);
    const loadingTask  = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytesCopy) });
    const pdfJsDoc     = await loadingTask.promise;
    logOk(`PDF has ${pdfJsDoc.numPages} pages`);

    // 4. Load with pdf-lib for modification (uses the original buffer)
    logHead('Loading PDF for editing…');
    const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
    const pages  = pdfDoc.getPages();

    // Embed a standard font
    const font     = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);

    // 5. Process each page
    logHead('Processing pages…');
    let matched = 0, notFound = 0, noId = 0;

    for (let i = 0; i < pdfJsDoc.numPages; i++) {
      const pageNum = i + 1;
      const pdfPage = await pdfJsDoc.getPage(pageNum);
      const textContent = await pdfPage.getTextContent();
      const viewport    = pdfPage.getViewport({ scale: 1 });

      // Build full text for order ID extraction
      // Join with newlines; also try space-joined as PDF.js sometimes runs items together
      const fullText = textContent.items.map(it => it.str).join('\n');
      const fullTextSpaced = textContent.items.map(it => it.str).join(' ');

      // Log extracted text for page 1 to help debug
      if (pageNum === 1) {
        console.log('[LabelFill] Page 1 raw text items:', textContent.items.map(it => it.str));
        console.log('[LabelFill] Page 1 joined text:', fullText);
      }

      let extracted = extractOrderId(fullText);
      if (!extracted) extracted = extractOrderId(fullTextSpaced);

      if (!extracted) {
        // Log the raw text so user can see what was found
        const preview = fullText.replace(/\n/g, ' | ').slice(0, 200);
        logWarn(`Page ${pageNum}: No order-id found — text preview: ${preview}`);
        noId++;
        continue;
      }

      const { orderId } = extracted;
      const items = orderMap[orderId];

      if (!items) {
        logWarn(`Page ${pageNum}: Order ID "${orderId}" not found in CSV`);
        notFound++;
        continue;
      }

      // Find positioning for overlay
      const pos = await findRefAreaPosition(pdfJsDoc, pageNum);

      // anchorY = baseline of the slash-line (the order-id line), from bottom
      const anchorY = pos.refLineY !== null ? pos.refLineY : (pos.customerRefY || 100);

      // X: align with the Customer Ref label's left edge (fall back to 28pt if not found)
      const leftX = pos.customerRefX !== null ? pos.customerRefX : 28;

      const fs    = Math.min(Math.max(pos.fontSize || 7, 5), 9); // clamp 5–9pt
      const lineH = fs * 1.55;  // comfortable line spacing

      // Start 1 full line-height below the order-id slash line, giving a clean gap
      const startY = anchorY - lineH * 1.8;

      const overlayLines = buildOverlayText(items);
      const libPage      = pages[i];

      // Draw each line
      for (let li = 0; li < overlayLines.length; li++) {
        const { text, bold } = overlayLines[li];
        const drawY = startY - li * lineH;

        // Clamp so we don't go off-page
        if (drawY < 4) continue;

        libPage.drawText(text, {
          x:          leftX,
          y:          drawY,
          size:       fs,
          font:       bold ? fontBold : font,
          color:      PDFLib.rgb(0, 0, 0),
          maxWidth:   libPage.getWidth() - leftX - 16,
          lineHeight: lineH,
        });
      }

      logOk(`Page ${pageNum}: "${orderId}" → ${items.length} item(s) written`);
      matched++;
    }

    // 6. Save PDF
    logHead('Saving modified PDF…');
    modifiedPdfBytes = await pdfDoc.save();
    logOk(`Done — ${matched} pages updated, ${notFound} order IDs not in CSV, ${noId} pages skipped`);
    logStatus.textContent = `${matched} labels filled`;

    downloadRow.style.display = '';

  } catch (err) {
    logErr(`Fatal error: ${err.message}`);
    console.error(err);
  } finally {
    processBtn.classList.remove('loading');
    processBtn.querySelector('.btn-text').textContent = 'Process Labels';
    processBtn.querySelector('.btn-icon').textContent = '→';
  }
}

// ── File read helpers ────────────────────────────────────
function readFileAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Failed to read CSV file'));
    r.readAsText(file);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Failed to read PDF file'));
    r.readAsArrayBuffer(file);
  });
}
