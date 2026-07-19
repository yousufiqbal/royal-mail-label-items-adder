// Reads a shipping-labels PDF + orders TSV/CSV, overlays order details onto
// each label page, returns the modified PDF bytes.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type * as PdfJsLib from 'pdfjs-dist';
import { buildOrderMap, extractVariant, stripVariant, type OrderRow } from './csv';

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

export interface OverlayLine {
	text: string;
	bold: boolean;
}

// Input:  orders-2026-05-11-07-51-48-label.pdf
// Output: 11 May 2026 Monday Labels.pdf
export function buildOutputFilename(originalName: string): string {
	const base = originalName.replace(/\.pdf$/i, '');
	const m = base.match(/(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return 'Labels.pdf';

	const year = parseInt(m[1], 10);
	const month = parseInt(m[2], 10) - 1;
	const day = parseInt(m[3], 10);

	const date = new Date(year, month, day);
	if (isNaN(date.getTime())) return 'Labels.pdf';

	const dayName = date.toLocaleDateString('en-GB', { weekday: 'long' });
	const monthName = date.toLocaleDateString('en-GB', { month: 'long' });
	return `${day} ${monthName} ${year} ${dayName} Labels.pdf`;
}

// Label format:
//   Customer Ref:
//   723619 / 206-7965794-0399534 / MSF AM
// The order ID is the MIDDLE token between the two " / " separators.
export function extractOrderId(pageText: string): { orderId: string; refLine: string } | null {
	const lines = pageText
		.split(/\n/)
		.map((l) => l.trim())
		.filter(Boolean);

	function parseSlashPattern(str: string): string | null {
		const parts = str.split(/\s*\/\s*/);
		for (let i = 1; i < parts.length - 1; i++) {
			const candidate = parts[i].trim();
			if (/^[A-Za-z0-9][A-Za-z0-9\-]{4,}$/.test(candidate)) return candidate;
		}
		return null;
	}

	for (let i = 0; i < lines.length; i++) {
		if (/customer\s*ref/i.test(lines[i])) {
			const onSame = parseSlashPattern(lines[i]);
			if (onSame) return { orderId: onSame, refLine: lines[i] };
			for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
				const found = parseSlashPattern(lines[j]);
				if (found) return { orderId: found, refLine: lines[j] };
			}
		}
	}

	for (const line of lines) {
		const found = parseSlashPattern(line);
		if (found) return { orderId: found, refLine: line };
	}

	return null;
}

function first8Words(name: string): string {
	return name.split(/\s+/).slice(0, 8).join(' ');
}

export function buildOverlayText(items: { name: string; qty: string }[]): OverlayLine[] {
	if (items.length === 1) {
		return [{ text: `${items[0].qty} x ${items[0].name}`, bold: false }];
	}

	const groups: { prefix: string; boldName: string; variants: { qty: string; variant: string | null }[] }[] =
		[];
	for (const item of items) {
		const prefix = first8Words(stripVariant(item.name));
		let group = groups.find((g) => g.prefix === prefix);
		if (!group) {
			group = { prefix, variants: [], boldName: first8Words(stripVariant(item.name)) };
			groups.push(group);
		}
		const variant = extractVariant(item.name);
		group.variants.push({ qty: item.qty, variant });
	}

	const lines: OverlayLine[] = [];
	for (const group of groups) {
		lines.push({ text: group.boldName, bold: true });
		for (const v of group.variants) {
			const vtxt = v.variant ? `(${v.variant})` : stripVariant(v.qty);
			lines.push({ text: `${v.qty} x ${vtxt}`, bold: false });
		}
	}
	return lines;
}

async function findRefAreaPosition(pdfJsDoc: PdfJsLib.PDFDocumentProxy, pageNum: number) {
	const page = await pdfJsDoc.getPage(pageNum);
	const textContent = await page.getTextContent();
	const viewport = page.getViewport({ scale: 1 });

	let customerRefY: number | null = null;
	let customerRefX: number | null = null;
	let refLineY: number | null = null;
	let fontSize = 8;

	for (const item of textContent.items as { str: string; transform: number[]; height: number }[]) {
		const text = (item.str || '').trim();
		const tx = item.transform[4];
		const ty = item.transform[5];
		const h = item.height;

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

export interface RunLabelFillerResult {
	pdfBytes: Uint8Array;
	matched: number;
	notFound: number;
	noId: number;
}

export async function runLabelFiller(
	pdfBytes: ArrayBuffer,
	orderRows: OrderRow[],
	log: (type: 'info' | 'ok' | 'warn' | 'err' | 'head', msg: string) => void
): Promise<RunLabelFillerResult> {
	const pdfjsLib = await getPdfJsLib();

	const orderMap = buildOrderMap(orderRows);
	log('ok', `File loaded — ${orderRows.length} rows, ${Object.keys(orderMap).length} unique order IDs`);

	const pdfBytesCopy = pdfBytes.slice(0);
	const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytesCopy) });
	const pdfJsDoc = await loadingTask.promise;
	log('ok', `PDF has ${pdfJsDoc.numPages} pages`);

	const pdfDoc = await PDFDocument.load(pdfBytes);
	const pages = pdfDoc.getPages();

	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

	let matched = 0,
		notFound = 0,
		noId = 0;

	for (let i = 0; i < pdfJsDoc.numPages; i++) {
		const pageNum = i + 1;
		const pdfPage = await pdfJsDoc.getPage(pageNum);
		const textContent = await pdfPage.getTextContent();

		const fullText = textContent.items.map((it) => (it as { str: string }).str).join('\n');
		const fullTextSpaced = textContent.items.map((it) => (it as { str: string }).str).join(' ');

		let extracted = extractOrderId(fullText);
		if (!extracted) extracted = extractOrderId(fullTextSpaced);

		if (!extracted) {
			const preview = fullText.replace(/\n/g, ' | ').slice(0, 200);
			log('warn', `Page ${pageNum}: No order-id found — text preview: ${preview}`);
			noId++;
			continue;
		}

		const { orderId } = extracted;
		const items = orderMap[orderId];

		if (!items) {
			log('warn', `Page ${pageNum}: Order ID "${orderId}" not found in file`);
			notFound++;
			continue;
		}

		const pos = await findRefAreaPosition(pdfJsDoc, pageNum);
		const anchorY = pos.refLineY !== null ? pos.refLineY : (pos.customerRefY ?? 100);
		const leftX = pos.customerRefX !== null ? pos.customerRefX : 28;
		const fs = Math.min(Math.max(pos.fontSize || 7, 5), 9);
		const lineH = fs * 1.55;
		const startY = anchorY - lineH * 1.8;

		const overlayLines = buildOverlayText(items);
		const libPage = pages[i];

		for (let li = 0; li < overlayLines.length; li++) {
			const { text, bold } = overlayLines[li];
			const drawY = startY - li * lineH;
			if (drawY < 4) continue;

			libPage.drawText(text, {
				x: leftX,
				y: drawY,
				size: fs,
				font: bold ? fontBold : font,
				color: rgb(0, 0, 0),
				maxWidth: libPage.getWidth() - leftX - 16,
				lineHeight: lineH
			});
		}

		log('ok', `Page ${pageNum}: "${orderId}" → ${items.length} item(s) written`);
		matched++;
	}

	const outBytes = await pdfDoc.save();
	return { pdfBytes: outBytes, matched, notFound, noId };
}
