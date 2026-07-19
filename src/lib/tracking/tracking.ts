// Reads shipping-labels PDF + Amazon xlsx template, extracts order-id +
// tracking from each label page, fills the ShippingConfirmation sheet and
// outputs the same template structure with data rows populated.

import * as XLSX from 'xlsx';
import type * as PdfJsLib from 'pdfjs-dist';
import { TEMPLATE_B64 } from './templateB64';

// pdfjs-dist touches browser-only globals (DOMMatrix) at import time, so it
// must be loaded lazily and only in the browser — never during SSR.
let pdfjsLibPromise: Promise<typeof PdfJsLib> | null = null;
async function getPdfJsLib(): Promise<typeof PdfJsLib> {
	if (!pdfjsLibPromise) {
		pdfjsLibPromise = (async () => {
			const lib = await import('pdfjs-dist');
			const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
			lib.GlobalWorkerOptions.workerSrc = workerUrl;
			return lib;
		})();
	}
	return pdfjsLibPromise;
}

function b64ToUint8Array(b64: string): Uint8Array {
	const bin = atob(b64);
	const arr = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
	return arr;
}

// Handles formats:
//   "15 May 2026 Friday Labels.pdf"   → 2026-05-15
//   "orders-2026-05-15-07-51-48.pdf"  → 2026-05-15
export function autoFillShipDate(filename: string): string {
	const MONTHS: Record<string, number> = {
		january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
		july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
	};

	const m1 = filename.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
	if (m1) {
		const day = parseInt(m1[1]);
		const month = MONTHS[m1[2].toLowerCase()];
		const year = parseInt(m1[3]);
		if (month && day >= 1 && day <= 31) {
			return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		}
	}

	const m2 = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
	if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;

	const t = new Date();
	return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export function buildTrackingFilename(name: string): string {
	const base = name.replace(/\.pdf$/i, '');
	const m = base.match(/(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return 'ShippingConfirmation.txt';
	const date = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
	if (isNaN(date.getTime())) return 'ShippingConfirmation.txt';
	const day = date.getDate();
	const month = date.toLocaleDateString('en-GB', { month: 'long' });
	const year = date.getFullYear();
	const wday = date.toLocaleDateString('en-GB', { weekday: 'long' });
	return `${day} ${month} ${year} ${wday} ShippingConfirmation.txt`;
}

function extractOrderId(pageText: string): string | null {
	const lines = pageText.split(/\n/).map((l) => l.trim()).filter(Boolean);
	function parseSlash(str: string): string | null {
		const parts = str.split(/\s*\/\s*/);
		for (let i = 1; i < parts.length - 1; i++) {
			const c = parts[i].trim();
			if (/^[A-Za-z0-9][A-Za-z0-9\-]{4,}$/.test(c)) return c;
		}
		return null;
	}
	for (let i = 0; i < lines.length; i++) {
		if (/customer\s*ref/i.test(lines[i])) {
			const onSame = parseSlash(lines[i]);
			if (onSame) return onSame;
			for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
				const f = parseSlash(lines[j]);
				if (f) return f;
			}
		}
	}
	for (const line of lines) {
		const f = parseSlash(line);
		if (f) return f;
	}
	return null;
}

// Royal Mail tracking appears under barcodes, e.g. "YS 2706 4002 3GB"
function extractTracking(pageText: string): string | null {
	const lines = pageText.split(/\n/).map((l) => l.trim()).filter(Boolean);
	const rmPatterns = [
		/^[A-Z]{2}\s+[\d\s]+[A-Z]{2,3}$/,
		/^[A-Z]{2}\d{8,}[A-Z]{2,3}$/,
		/^[A-Z]{2}[\d\s]{6,20}[A-Z]{2,3}$/
	];
	const candidates: { line: string; compact: string; score: number }[] = [];
	for (const line of lines) {
		if (line.includes('/')) continue;
		if (line.length > 35) continue;
		if (/[a-z]/.test(line)) continue;
		if (line.includes('-')) continue;
		const compact = line.replace(/\s/g, '');
		for (const pat of rmPatterns) {
			if (pat.test(line)) {
				candidates.push({ line, compact, score: 2 });
				break;
			}
		}
		if (!candidates.find((c) => c.line === line)) {
			if (/^[A-Z]{2}[\dA-Z\s]{8,25}$/.test(line) && compact.length >= 10 && compact.length <= 22) {
				candidates.push({ line, compact, score: 1 });
			}
		}
	}
	if (!candidates.length) return null;
	candidates.sort((a, b) => b.score - a.score);
	return candidates[0].compact;
}

export interface ShipFields {
	shipDate: string;
	senderName: string;
	addr1: string;
	city: string;
	county: string;
	postcode: string;
	country: string;
}

// order-id, order-item-id, quantity, ship-date, carrier-code, carrier-name,
// tracking-number, ship-method, transparency_code, ship_from_address_name,
// ship_from_address_line1/2/3, ship_from_address_city/county/state,
// ship_from_address_postalcode, ship_from_address_countrycode
function buildDataRow(orderId: string, tracking: string, fields: ShipFields): (string | number)[] {
	return [
		orderId,
		'',
		'',
		fields.shipDate,
		'Royal Mail',
		'',
		tracking,
		'Royal Mail Tracked 48',
		'',
		fields.senderName,
		fields.addr1,
		'',
		'',
		fields.city,
		fields.county,
		'',
		fields.postcode,
		fields.country
	];
}

export interface RunTrackingResult {
	outputBytes: Uint8Array;
	okCount: number;
	warnCount: number;
}

export async function runTracking(
	pdfBytes: ArrayBuffer,
	fields: ShipFields,
	log: (type: 'info' | 'ok' | 'warn' | 'err' | 'head', msg: string) => void
): Promise<RunTrackingResult> {
	log('head', 'Loading Amazon template…');
	const wb = XLSX.read(b64ToUint8Array(TEMPLATE_B64), { type: 'array', cellStyles: true });
	log('ok', `Template loaded — sheets: ${wb.SheetNames.join(', ')}`);

	const sheetName = wb.SheetNames.find((n) => /shipping.*confirm/i.test(n)) || wb.SheetNames[0];
	const ws = wb.Sheets[sheetName];
	log('ok', `Using sheet: "${sheetName}"`);

	const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:R1');
	let headerRow = 0;
	for (let r = range.s.r; r <= Math.min(range.e.r, 5); r++) {
		const cellA = ws[XLSX.utils.encode_cell({ r, c: 0 })];
		if (cellA && /order.?id/i.test(String(cellA.v || ''))) {
			headerRow = r;
			break;
		}
	}
	log('ok', `Header row found at row ${headerRow + 1}`);

	log('head', 'Reading PDF…');
	const pdfCopy = pdfBytes.slice(0);
	log('ok', `PDF loaded — ${(pdfBytes.byteLength / 1024).toFixed(0)} KB`);

	const pdfjsLib = await getPdfJsLib();
	const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfCopy) }).promise;
	log('ok', `${pdfDoc.numPages} pages found`);

	log('head', 'Extracting order IDs and tracking numbers…');
	const dataRows: (string | number)[][] = [];
	let okCount = 0,
		warnCount = 0;

	for (let i = 1; i <= pdfDoc.numPages; i++) {
		const page = await pdfDoc.getPage(i);
		const textContent = await page.getTextContent();
		const fullText = textContent.items.map((it) => (it as { str: string }).str).join('\n');
		const spacedText = textContent.items.map((it) => (it as { str: string }).str).join(' ');

		const orderId = extractOrderId(fullText) || extractOrderId(spacedText);
		const tracking = extractTracking(fullText);

		if (!orderId || !tracking) {
			const missing = !orderId && !tracking ? 'order ID and tracking' : !orderId ? 'order ID' : 'tracking number';
			log('warn', `Page ${i}: Could not extract ${missing} — skipped`);
			warnCount++;
			continue;
		}

		dataRows.push(buildDataRow(orderId, tracking, fields));
		log('ok', `Page ${i}: ${orderId}  →  ${tracking}`);
		okCount++;
	}

	if (dataRows.length === 0) {
		throw new Error('No rows could be extracted. Check the PDF format.');
	}

	log('head', 'Writing data into template…');
	const firstDataRow = headerRow + 1;

	dataRows.forEach((row, ri) => {
		row.forEach((val, ci) => {
			if (val === '' || val === null || val === undefined) return;
			const cellAddr = XLSX.utils.encode_cell({ r: firstDataRow + ri, c: ci });
			ws[cellAddr] = { v: val, t: 's' };
		});
	});

	const newEndRow = firstDataRow + dataRows.length - 1;
	const newEndCol = 17;
	ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: newEndRow, c: newEndCol } });

	const headerCells: string[] = [];
	for (let c = 0; c <= 17; c++) {
		const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
		headerCells.push(cell ? String(cell.v) : '');
	}
	const tsvLines = [headerCells.join('\t')];
	dataRows.forEach((row) => tsvLines.push(row.join('\t')));
	const outputBytes = new TextEncoder().encode(tsvLines.join('\n'));

	log('ok', `Done — ${okCount} rows written${warnCount ? `, ${warnCount} pages skipped` : ''}`);

	return { outputBytes, okCount, warnCount };
}
