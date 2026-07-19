/* =============================================================
   merge.js
   Combines multiple PDFs into one, in user-chosen order.
   ============================================================= */

let mrgFiles = []; // ordered array of File

const mrgInput       = document.getElementById('mrg-input');
const mrgCard        = document.getElementById('mrg-card');
const mrgName        = document.getElementById('mrg-name');
const mrgFileList    = document.getElementById('mrg-file-list');
const mrgProcessBtn  = document.getElementById('mrg-process-btn');
const mrgLogSection  = document.getElementById('mrg-log-section');
const mrgLogBody     = document.getElementById('mrg-log-body');
const mrgLogStatus   = document.getElementById('mrg-log-status');
const mrgDownloadRow = document.getElementById('mrg-download-row');
const mrgDownloadBtn = document.getElementById('mrg-download-btn');

let mergedPdfBytes = null;

mrgInput.addEventListener('change', () => {
  mrgFiles = mrgFiles.concat(Array.from(mrgInput.files || []));
  mrgInput.value = ''; // allow re-picking the same file(s) later
  renderMrgFileList();
});

function renderMrgFileList() {
  mrgName.textContent = mrgFiles.length ? `${mrgFiles.length} file(s) queued` : 'No file chosen';
  mrgName.className   = mrgFiles.length ? 'file-name ready' : 'file-name';
  mrgCard.classList.toggle('has-file', !!mrgFiles.length);
  mrgProcessBtn.disabled = mrgFiles.length < 2;

  mrgFileList.innerHTML = '';
  mrgFiles.forEach((file, i) => {
    const li = document.createElement('li');
    li.className = 'mrg-file-item';
    li.innerHTML = `
      <span class="mrg-file-index">${i + 1}</span>
      <span class="mrg-file-info">
        <span class="mrg-file-name">${escHtml(file.name)}</span>
        <span class="mrg-file-meta"> — ${(file.size / 1024).toFixed(0)} KB</span>
      </span>
      <span class="mrg-file-actions">
        <button data-act="up"     ${i === 0 ? 'disabled' : ''} title="Move up">&#8593;</button>
        <button data-act="down"   ${i === mrgFiles.length - 1 ? 'disabled' : ''} title="Move down">&#8595;</button>
        <button data-act="remove" title="Remove">&times;</button>
      </span>
    `;
    li.querySelector('[data-act="up"]').addEventListener('click', () => moveMrgFile(i, -1));
    li.querySelector('[data-act="down"]').addEventListener('click', () => moveMrgFile(i, 1));
    li.querySelector('[data-act="remove"]').addEventListener('click', () => removeMrgFile(i));
    mrgFileList.appendChild(li);
  });
}

function moveMrgFile(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= mrgFiles.length) return;
  [mrgFiles[index], mrgFiles[target]] = [mrgFiles[target], mrgFiles[index]];
  renderMrgFileList();
}

function removeMrgFile(index) {
  mrgFiles.splice(index, 1);
  renderMrgFileList();
}

// ── Logging ──────────────────────────────────────────────────
function mrgLog(type, icon, msg) {
  const div = document.createElement('div');
  div.className = `log-line ${type}`;
  div.innerHTML = `<span class="icon">${icon}</span><span class="msg">${escHtml(msg)}</span>`;
  mrgLogBody.appendChild(div);
  mrgLogBody.scrollTop = mrgLogBody.scrollHeight;
}
const mL = {
  info: m => mrgLog('info', '·', m),
  ok:   m => mrgLog('ok',   '✓', m),
  warn: m => mrgLog('warn', '⚠', m),
  err:  m => mrgLog('err',  '✗', m),
  head: m => mrgLog('head', '▸', m),
};

mrgProcessBtn.addEventListener('click', runMerge);
mrgDownloadBtn.addEventListener('click', downloadMergedPdf);

async function runMerge() {
  mergedPdfBytes = null;
  mrgDownloadRow.style.display = 'none';
  mrgLogBody.innerHTML = '';
  mrgLogSection.style.display = '';
  mrgLogStatus.textContent = '';

  mrgProcessBtn.classList.add('loading');
  mrgProcessBtn.querySelector('.btn-text').textContent = 'Merging…';

  try {
    mL.head(`Merging ${mrgFiles.length} PDFs…`);
    const outDoc = await PDFLib.PDFDocument.create();
    let totalPages = 0;

    for (const file of mrgFiles) {
      const bytes = await readFileAsArrayBuffer(file);
      const srcDoc = await PDFLib.PDFDocument.load(bytes);
      const pageIndices = srcDoc.getPageIndices();
      const copiedPages = await outDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach(p => outDoc.addPage(p));
      totalPages += pageIndices.length;
      mL.ok(`${file.name} — ${pageIndices.length} page(s) added`);
    }

    mergedPdfBytes = await outDoc.save();
    mL.ok(`Done — ${totalPages} pages total across ${mrgFiles.length} file(s)`);
    mrgLogStatus.textContent = `${totalPages} pages merged`;
    mrgDownloadRow.style.display = '';

  } catch (err) {
    mL.err(`Fatal error: ${err.message}`);
    console.error(err);
  } finally {
    mrgProcessBtn.classList.remove('loading');
    mrgProcessBtn.querySelector('.btn-text').textContent = 'Merge PDFs';
  }
}

function downloadMergedPdf() {
  if (!mergedPdfBytes) return;
  const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'Merged.pdf';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
