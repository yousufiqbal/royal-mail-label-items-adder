<script lang="ts">
	import { mergePdfs } from '$lib/mergePdf';

	let files: File[] = $state([]);
	let logLines: { type: string; icon: string; msg: string }[] = $state([]);
	let logStatus = $state('');
	let showLog = $state(false);
	let showDownload = $state(false);
	let processing = $state(false);
	let mergedBytes: Uint8Array | null = $state(null);

	function log(type: 'info' | 'ok' | 'warn' | 'err' | 'head', msg: string) {
		const icons = { info: '·', ok: '✓', warn: '⚠', err: '✗', head: '▸' };
		logLines = [...logLines, { type, icon: icons[type], msg }];
	}

	function onFilesChange(e: Event) {
		const picked = Array.from((e.target as HTMLInputElement).files ?? []);
		files = [...files, ...picked];
		(e.target as HTMLInputElement).value = '';
	}

	function moveFile(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= files.length) return;
		const next = files.slice();
		[next[index], next[target]] = [next[target], next[index]];
		files = next;
	}
	function removeFile(index: number) {
		files = files.filter((_, i) => i !== index);
	}

	async function runMerge() {
		mergedBytes = null;
		showDownload = false;
		logLines = [];
		showLog = true;
		logStatus = '';
		processing = true;

		try {
			log('head', `Merging ${files.length} PDFs…`);
			const result = await mergePdfs(files);
			result.perFile.forEach((f) => log('ok', `${f.name} — ${f.pages} page(s) added`));
			mergedBytes = result.bytes;
			log('ok', `Done — ${result.totalPages} pages total across ${files.length} file(s)`);
			logStatus = `${result.totalPages} pages merged`;
			showDownload = true;
		} catch (err) {
			log('err', `Fatal error: ${err instanceof Error ? err.message : String(err)}`);
			console.error(err);
		} finally {
			processing = false;
		}
	}

	function download() {
		if (!mergedBytes) return;
		const blob = new Blob([mergedBytes as BlobPart], { type: 'application/pdf' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'Merged.pdf';
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	}
</script>

<svelte:head><title>Merge PDF — Amazon Tools</title></svelte:head>

<main class="main">
	<div class="page-intro">
		<h2>Merge PDF</h2>
		<p>Upload multiple PDFs — the app combines them into one file, in the order listed below, ready to download.</p>
	</div>

	<section class="upload-grid single">
		<div class="upload-card" class:has-file={!!files.length}>
			<h3>PDFs to merge</h3>
			<p class="upload-hint">Pick 2 or more PDFs — merged in the order they appear below. Use ↑/↓ to reorder.</p>
			<label class="file-btn" for="mrg-input">
				Choose PDFs
				<input type="file" id="mrg-input" accept=".pdf" multiple hidden onchange={onFilesChange} />
			</label>
			<div class="file-name" class:ready={!!files.length}>
				{files.length ? `${files.length} file(s) queued` : 'No file chosen'}
			</div>
		</div>
	</section>

	<ol class="mrg-file-list">
		{#each files as file, i (file.name + file.lastModified + i)}
			<li class="mrg-file-item">
				<span class="mrg-file-index">{i + 1}</span>
				<span class="mrg-file-info">
					<span class="mrg-file-name">{file.name}</span>
					<span class="mrg-file-meta"> — {(file.size / 1024).toFixed(0)} KB</span>
				</span>
				<span class="mrg-file-actions">
					<button disabled={i === 0} title="Move up" onclick={() => moveFile(i, -1)}>&#8593;</button>
					<button disabled={i === files.length - 1} title="Move down" onclick={() => moveFile(i, 1)}>&#8595;</button>
					<button title="Remove" onclick={() => removeFile(i)}>&times;</button>
				</span>
			</li>
		{/each}
	</ol>

	<div class="action-row">
		<button class="process-btn" class:loading={processing} disabled={files.length < 2 || processing} onclick={runMerge}>
			<span class="btn-text">{processing ? 'Merging…' : 'Merge PDFs'}</span>
			<span class="btn-icon">{processing ? '' : '→'}</span>
		</button>
	</div>

	{#if showLog}
		<section class="log-section">
			<div class="log-header">
				<h3>Processing Log</h3>
				<div class="log-status">{logStatus}</div>
			</div>
			<div class="log-body">
				{#each logLines as line, i (i)}
					<div class="log-line {line.type}">
						<span class="icon">{line.icon}</span><span class="msg">{line.msg}</span>
					</div>
				{/each}
			</div>
			{#if showDownload}
				<div class="download-row">
					<button class="download-btn" onclick={download}>↓ Download Merged PDF</button>
				</div>
			{/if}
		</section>
	{/if}
</main>
