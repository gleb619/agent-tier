<script lang="ts">
export let id: string;
export let label: string;
export let value: string;
export let type = "text";
export let placeholder = "";
export let disabled = false;
</script>

<div class="flex flex-col gap-1">
  <label for={id} class="text-sm font-medium text-gray-700">{label}</label>
  <input
    {id}
    {type}
    {placeholder}
    {disabled}
    {value}
    on:input={(e) => (value = e.currentTarget.value)}
    class="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-50"
  />
</div>
