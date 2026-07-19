import { PDFDocument } from 'pdf-lib';

export async function mergePdfs(files: File[]): Promise<{ bytes: Uint8Array; totalPages: number; perFile: { name: string; pages: number }[] }> {
	const outDoc = await PDFDocument.create();
	let totalPages = 0;
	const perFile: { name: string; pages: number }[] = [];

	for (const file of files) {
		const bytes = await file.arrayBuffer();
		const srcDoc = await PDFDocument.load(bytes);
		const pageIndices = srcDoc.getPageIndices();
		const copiedPages = await outDoc.copyPages(srcDoc, pageIndices);
		copiedPages.forEach((p) => outDoc.addPage(p));
		totalPages += pageIndices.length;
		perFile.push({ name: file.name, pages: pageIndices.length });
	}

	const bytes = await outDoc.save();
	return { bytes, totalPages, perFile };
}
