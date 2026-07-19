// Shared TSV/CSV parsing + file-read helpers used across the Labels tools.
// Auto-detects delimiter: tab (TXT/TSV) or comma (CSV).

export interface OrderRow {
	orderId: string;
	name: string;
	qty: string;
}

export function parseCSV(text: string): OrderRow[] {
	const lines = text.trim().split(/\r?\n/);
	if (lines.length < 2) return [];

	const firstLine = lines[0];
	const delimiter = firstLine.includes('\t') ? '\t' : ',';
	const headers = parseCSVRow(firstLine, delimiter).map((h) => h.trim().toLowerCase());

	const idIdx = headers.findIndex((h) => h === 'order-id' || h === 'order_id');
	const nameIdx = headers.findIndex(
		(h) => h === 'product-name' || h === 'product_name' || h === 'product name'
	);
	const qtyIdx = headers.findIndex(
		(h) =>
			h === 'quantity-purchased' ||
			h === 'quantity_purchased' ||
			h === 'quantity purchased' ||
			h === 'quantity'
	);

	if (idIdx === -1 || nameIdx === -1 || qtyIdx === -1) {
		throw new Error(
			`File missing required columns. Found: "${headers.join('", "')}". ` +
				`Need: order-id, product-name, quantity-purchased`
		);
	}

	const rows: OrderRow[] = [];
	for (let i = 1; i < lines.length; i++) {
		if (!lines[i].trim()) continue;
		const cols = parseCSVRow(lines[i], delimiter);
		rows.push({
			orderId: (cols[idIdx] || '').trim(),
			name: (cols[nameIdx] || '').trim(),
			qty: (cols[qtyIdx] || '1').trim()
		});
	}
	return rows;
}

export function parseCSVRow(line: string, delimiter: string = ','): string[] {
	if (delimiter === '\t') return line.split('\t');

	const result: string[] = [];
	let cur = '',
		inQ = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"' && !inQ) {
			inQ = true;
			continue;
		}
		if (ch === '"' && inQ) {
			if (line[i + 1] === '"') {
				cur += '"';
				i++;
			} else {
				inQ = false;
			}
			continue;
		}
		if (ch === ',' && !inQ) {
			result.push(cur);
			cur = '';
			continue;
		}
		cur += ch;
	}
	result.push(cur);
	return result;
}

export function buildOrderMap(rows: OrderRow[]): Record<string, { name: string; qty: string }[]> {
	const map: Record<string, { name: string; qty: string }[]> = {};
	for (const row of rows) {
		if (!row.orderId) continue;
		if (!map[row.orderId]) map[row.orderId] = [];
		map[row.orderId].push({ name: row.name, qty: row.qty });
	}
	return map;
}

export function readFileAsText(file: File): Promise<string> {
	return new Promise((res, rej) => {
		const r = new FileReader();
		r.onload = () => res(r.result as string);
		r.onerror = () => rej(new Error(`Failed to read ${file.name}`));
		r.readAsText(file);
	});
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
	return new Promise((res, rej) => {
		const r = new FileReader();
		r.onload = () => res(r.result as ArrayBuffer);
		r.onerror = () => rej(new Error(`Failed to read ${file.name}`));
		r.readAsArrayBuffer(file);
	});
}

// Browsers only expose a file's last-modified time, not a true creation date.
export function formatFileDate(file: File): string {
	const d = new Date(file.lastModified);
	if (isNaN(d.getTime())) return '';
	return (
		d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
		' ' +
		d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) +
		' ' +
		d.toLocaleDateString('en-GB', { weekday: 'long' })
	);
}

export function extractVariant(name: string): string | null {
	const m = name.match(/\(([^)]+)\)\s*$/);
	return m ? m[1].trim() : null;
}

export function stripVariant(name: string): string {
	return name.replace(/\s*\([^)]+\)\s*$/, '').trim();
}
