<script lang="ts">
	interface Props {
		id: string;
		label: string;
		accept: string;
		fileName: string;
		onchange: (e: Event) => void;
	}

	let { id, label, accept, fileName, onchange }: Props = $props();
</script>

<div class="upload-card">
	<label for={id}>{label}</label>
	<input type="file" {id} {accept} {onchange} />
	<span class="file-status">{fileName}</span>
</div>
