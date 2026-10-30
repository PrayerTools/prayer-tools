<script setup lang="ts">
import AdminLayout from '#core/app/layouts/default.vue'
</script>

<template>
  <div class="admin-theme">
    <AdminLayout>
      <slot />
    </AdminLayout>
  </div>
</template>

<style scoped>
.admin-theme {
  --ui-primary: #b84c0b;
  --ui-bg: #fffaf5;
  --ui-bg-muted: #f5ede5;
  --ui-bg-elevated: #ffffff;
  --ui-bg-accented: #f1e7dd;
  --ui-text: #202833;
  --ui-text-highlighted: #202833;
  --ui-text-toned: #44403c;
  --ui-text-muted: #57534e;
  --ui-text-dimmed: #78716c;
  --ui-border: #e8ded5;
  --ui-border-accented: #d6c9bd;
  --ui-border-muted: #eee5dc;
  --chrome-bg: #ffffff;
  --ui-radius: 0.75rem;
}
:global(.dark) .admin-theme {
  --ui-primary: #f58220;
  --ui-bg: #18202a;
  --ui-bg-muted: #202833;
  --ui-bg-elevated: #263240;
  --ui-bg-accented: #354353;
  --ui-text: #f1f5f9;
  --ui-text-highlighted: #ffffff;
  --ui-text-toned: #e2e8f0;
  --ui-text-muted: #cbd5e1;
  --ui-text-dimmed: #94a3b8;
  --ui-border: #354353;
  --ui-border-accented: #526174;
  --ui-border-muted: #2b3948;
  --chrome-bg: #202833;
}
.admin-theme :deep(header) {
  --chrome-bg: #202833;
  --ui-bg: #202833;
  --ui-bg-elevated: #263240;
  --ui-bg-accented: #354353;
  --ui-text: #ffffff;
  --ui-text-highlighted: #ffffff;
  --ui-text-toned: #e2e8f0;
  --ui-text-muted: #cbd5e1;
  --ui-text-dimmed: #94a3b8;
  --ui-border: #354353;
  background: #202833;
  color: #ffffff;
}
.admin-theme :deep(h1), .admin-theme :deep(h2) { letter-spacing: -0.025em; }
.admin-theme :deep(aside) {
  --chrome-bg: #202833;
  --ui-bg: #202833;
  --ui-bg-muted: #2b3745;
  --ui-bg-elevated: #354353;
  --ui-bg-accented: #354353;
  --ui-text: #e2e8f0;
  --ui-text-highlighted: #ffffff;
  --ui-text-toned: #e2e8f0;
  --ui-text-muted: #cbd5e1;
  --ui-text-dimmed: #94a3b8;
  --ui-border: #354353;
  --ui-primary: #ffad66;
  background: #202833;
  color: #e2e8f0;
}
.admin-theme :deep(aside a:hover) { background-color: #354353; color: #ffffff; }
.admin-theme :deep(aside a[aria-current='page']),
.admin-theme :deep(aside a[data-active='true']) { background-color: #3f332d; color: #ffad66; }
.admin-theme :deep(label[data-slot='item']) { border-radius: 0.85rem; cursor: pointer; }
.admin-theme :deep(label[data-slot='item']:has([disabled])),
.admin-theme :deep(label[data-slot='item']:has([aria-disabled='true'])) { cursor: not-allowed; }
.admin-theme :deep(label[data-slot='item']:has([data-state='checked'])) { background: #fff0e3; border-color: #f58220; }
.admin-theme :deep(label[data-slot='item']:has([data-state='checked']) [data-slot='label']) { color: #202833; }
.admin-theme :deep(label[data-slot='item']:has([data-state='checked']) [data-slot='description']) { color: #57534e; }
</style>
