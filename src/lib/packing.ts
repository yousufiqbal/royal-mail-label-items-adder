// Totals quantity per product + variant across every row of the orders
// file, for the Purchasing List tool.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { extractVariant, stripVariant, type OrderRow } from './csv';

export interface PkgVariant {
	variant: string;
	qty: number;
}
export interface PkgGroup {
	product: string;
	total: number;
	variants: PkgVariant[];
}

// "18 July, 2026 - Saturday"
export function formatListDate(dateStr: string): string {
	let date: Date | undefined;
	if (dateStr) {
		const [y, m, d] = dateStr.split('-').map(Number);
		date = new Date(y, m - 1, d);
	}
	if (!date || isNaN(date.getTime())) date = new Date();

	const day = date.getDate();
	const month = date.toLocaleDateString('en-GB', { month: 'long' });
	const year = date.getFullYear();
	const wday = date.toLocaleDateString('en-GB', { weekday: 'long' });
	return `${day} ${month}, ${year} - ${wday}`;
}

// Amazon variant strings carry noise the purchaser doesn't need: the fixed
// "UK, Numeric" size-system tokens -- drop those. The Length/Fit pair always
// puts "Regular" (Length's default) right before the real Fit value
// (Regular/Short/Long), e.g. "Regular, Short" -- drop that leading "Regular"
// and keep the Fit value that follows it.
const FIT_VALUES = ['regular', 'short', 'long'];

export function dedupeVariantTokens(variant: string): string {
	const dropped = ['uk', 'numeric'];
	const tokens = variant
		.split(',')
		.map((t) => t.trim())
		.filter((t) => !dropped.includes(t.toLowerCase()));

	const out: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		const next = tokens[i + 1];
		if (t.toLowerCase() === 'regular' && next && FIT_VALUES.includes(next.toLowerCase())) continue;
		out.push(t);
	}
	return out.join(', ');
}

// Aggregate rows into product groups, each holding its variant totals -- the
// parent product name is written once, with every variant nested under it.
export function aggregatePacking(rows: OrderRow[], cleanVariants: boolean): PkgGroup[] {
	const groups: Record<string, Record<string, number>> = {};
	for (const row of rows) {
		const product = stripVariant(row.name);
		const rawVariant = extractVariant(row.name) || '';
		const variant = cleanVariants ? dedupeVariantTokens(rawVariant) : rawVariant;
		const qty = parseInt(row.qty, 10) || 1;
		if (!groups[product]) groups[product] = {};
		groups[product][variant] = (groups[product][variant] || 0) + qty;
	}

	return Object.keys(groups)
		.sort((a, b) => a.localeCompare(b))
		.map((product) => {
			const variants = Object.keys(groups[product])
				.sort((a, b) => a.localeCompare(b))
				.map((variant) => ({ variant, qty: groups[product][variant] }));
			const total = variants.reduce((s, v) => s + v.qty, 0);
			return { product, total, variants };
		});
}

export function buildPackingFilename(dateStr: string, ext: string): string {
	let date: Date | undefined;
	if (dateStr) {
		const [y, m, d] = dateStr.split('-').map(Number);
		date = new Date(y, m - 1, d);
	}
	if (!date || isNaN(date.getTime())) date = new Date();

	const day = date.getDate();
	const month = date.toLocaleDateString('en-GB', { month: 'long' });
	const year = date.getFullYear();
	const wday = date.toLocaleDateString('en-GB', { weekday: 'long' });
	return `Purchase List ${day} ${month} ${year} ${wday}.${ext}`;
}

function csvField(v: unknown): string {
	const s = String(v);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildPackingCsv(groups: PkgGroup[], dateStr: string): string {
	const totalQty = groups.reduce((s, g) => s + g.total, 0);
	const listDate = formatListDate(dateStr);

	const lines = [
		`Date,${csvField(listDate)}`,
		`Total Products,${groups.length}`,
		`Total Quantity,${totalQty}`,
		'',
		'product-name,variant,quantity'
	];
	for (const group of groups) {
		group.variants.forEach((v, i) => {
			const productCell = i === 0 ? csvField(group.product) : '';
			lines.push([productCell, csvField(v.variant), v.qty].join(','));
		});
	}
	return lines.join('\n');
}

function wrapText(font: import('pdf-lib').PDFFont, text: string, size: number, maxWidth: number): string[] {
	const words = String(text).split(/\s+/).filter(Boolean);
	if (!words.length) return [''];
	const lines: string[] = [];
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

// pdf-lib's drawSvgPath flips the Y axis internally (SVG is Y-down, pdf-lib
// is Y-up), so the Y values passed in here are negated to land back at the
// intended page coordinates.
function roundedRectPath(x: number, yTop: number, width: number, height: number, radius: number): string {
	const yBot = yTop - height;
	const r = Math.min(radius, height / 2, width / 2);
	const ny = (v: number) => -v;
	return (
		`M ${x + r},${ny(yTop)} L ${x + width - r},${ny(yTop)} ` +
		`Q ${x + width},${ny(yTop)} ${x + width},${ny(yTop - r)} ` +
		`L ${x + width},${ny(yBot + r)} ` +
		`Q ${x + width},${ny(yBot)} ${x + width - r},${ny(yBot)} ` +
		`L ${x + r},${ny(yBot)} ` +
		`Q ${x},${ny(yBot)} ${x},${ny(yBot + r)} ` +
		`L ${x},${ny(yTop - r)} ` +
		`Q ${x},${ny(yTop)} ${x + r},${ny(yTop)} Z`
	);
}

export async function buildPackingPdf(groups: PkgGroup[], dateStr: string): Promise<Uint8Array> {
	const pdfDoc = await PDFDocument.create();
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

	const pageW = 595.28,
		pageH = 841.89; // A4
	const margin = 40;
	const boxPadding = 10;
	const boxGap = 10;
	const fullW = pageW - margin * 2;
	const innerW = fullW - boxPadding * 2;
	const lineH = 12;
	const productSize = 10;
	const variantSize = 9;

	const totalQty = groups.reduce((s, g) => s + g.total, 0);
	const listDate = formatListDate(dateStr);

	let page = pdfDoc.addPage([pageW, pageH]);
	let y = pageH - margin;

	function newPage() {
		page = pdfDoc.addPage([pageW, pageH]);
		y = pageH - margin;
		page.drawText('Purchase List', { x: margin, y, size: 16, font: fontBold });
		const dateSize = 11;
		const dateW = font.widthOfTextAtSize(listDate, dateSize);
		page.drawText(listDate, { x: pageW - margin - dateW, y, size: dateSize, font, color: rgb(0, 0, 0) });
		y -= 15;
	}

	// draw the header on the already-added first page instead of adding another
	page.drawText('Purchase List', { x: margin, y, size: 16, font: fontBold });
	{
		const dateSize = 11;
		const dateW = font.widthOfTextAtSize(listDate, dateSize);
		page.drawText(listDate, { x: pageW - margin - dateW, y, size: dateSize, font, color: rgb(0, 0, 0) });
	}
	y -= 15;

	page.drawText(`${groups.length} products  ·  ${totalQty} units total`, {
		x: margin,
		y,
		size: 10,
		font,
		color: rgb(0.4, 0.4, 0.4)
	});
	y -= 20;

	const topInset = 16;
	const bottomInset = 8;
	const dividerAfter = 6;
	const dividerBefore = 12;

	function roundedBox(height: number) {
		const path = roundedRectPath(margin, y, fullW, height, 6);
		page.drawSvgPath(path, { borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });
	}

	for (const group of groups) {
		const productLines = wrapText(fontBold, group.product, productSize, innerW);
		const variantWraps = group.variants.map((v) => wrapText(font, `${v.variant || '-'} x ${v.qty}`, variantSize, innerW));

		const dividerCount = variantWraps.length;
		const boxHeight =
			topInset +
			(productLines.length - 1) * lineH +
			variantWraps.reduce((s, lines) => s + (lines.length - 1) * lineH, 0) +
			dividerCount * (dividerAfter + dividerBefore) +
			bottomInset;

		if (y - boxHeight < margin) newPage();

		roundedBox(boxHeight);

		let cy = y - topInset;
		for (let li = 0; li < productLines.length; li++) {
			page.drawText(productLines[li], { x: margin + boxPadding, y: cy - li * lineH, size: productSize, font: fontBold });
		}
		cy -= (productLines.length - 1) * lineH;

		group.variants.forEach((v, idx) => {
			const dividerY = cy - dividerAfter;
			page.drawLine({
				start: { x: margin, y: dividerY },
				end: { x: margin + fullW, y: dividerY },
				thickness: 0.75,
				color: rgb(0.8, 0.8, 0.8)
			});
			cy = dividerY - dividerBefore;

			const variantLines = variantWraps[idx];
			const qtySuffix = ` x ${v.qty}`;
			const lastLi = variantLines.length - 1;

			for (let li = 0; li < variantLines.length; li++) {
				const ly = cy - li * lineH;
				const lineText = variantLines[li];
				if (li === lastLi && lineText.endsWith(qtySuffix)) {
					const head = lineText.slice(0, -qtySuffix.length);
					page.drawText(head, { x: margin + boxPadding, y: ly, size: variantSize, font });
					const headW = font.widthOfTextAtSize(head, variantSize);
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

	return pdfDoc.save();
}
