// Shared parsing helpers used by both the Restock Report and FBM Stock Check pages.

export function stripBom(text: string): string {
	if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
	if (text.startsWith('ï»¿')) return text.slice(3);
	return text;
}

export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	const s = stripBom(text);
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (inQuotes) {
			if (c === '"') {
				if (s[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += c;
			}
		} else {
			if (c === '"') {
				inQuotes = true;
			} else if (c === ',') {
				row.push(field);
				field = '';
			} else if (c === '\r') {
				// skip, handled by \n
			} else if (c === '\n') {
				row.push(field);
				rows.push(row);
				row = [];
				field = '';
			} else {
				field += c;
			}
		}
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

export function parseTsv(text: string): string[][] {
	const s = stripBom(text);
	return s
		.split(/\r?\n/)
		.filter((line) => line.length > 0)
		.map((line) => line.split('\t'));
}

export function toHeaderMap(headerRow: string[]): Record<string, number> {
	const map: Record<string, number> = {};
	headerRow.forEach((h, idx) => {
		map[h.trim()] = idx;
	});
	return map;
}

export function toHeaderMapLower(headerRow: string[]): Record<string, number> {
	const map: Record<string, number> = {};
	headerRow.forEach((h, idx) => {
		map[h.trim().toLowerCase()] = idx;
	});
	return map;
}

export function findHeaderIdx(
	headerMap: Record<string, number>,
	candidates: string[]
): number | undefined {
	for (const c of candidates) {
		if (headerMap[c] !== undefined) return headerMap[c];
	}
	return undefined;
}

export function parseNumber(raw: unknown): number {
	if (raw === undefined || raw === null) return 0;
	const cleaned = String(raw).replace(/[£$,]/g, '').trim();
	const n = parseFloat(cleaned);
	return isNaN(n) ? 0 : n;
}

export function splitTitle(rawTitle: string | undefined): { name: string; description: string } {
	const trimmed = (rawTitle || '').trim();
	if (trimmed.endsWith(')')) {
		const openIdx = trimmed.lastIndexOf('(');
		if (openIdx > -1) {
			return {
				name: trimmed.slice(0, openIdx).trim(),
				description: trimmed.slice(openIdx + 1, -1).trim()
			};
		}
	}
	return { name: trimmed, description: '' };
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function csvEscape(value: unknown): string {
	const s = String(value);
	if (/[",\n\r]/.test(s)) {
		return '"' + s.replace(/"/g, '""') + '"';
	}
	return s;
}
