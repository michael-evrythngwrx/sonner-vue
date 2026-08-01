<script setup lang="ts">
// Placeholder playground shell. A later agent replaces this with the real test-contract UI
// (see test-contract.md §3) — ~30 trigger buttons + two <Toaster> instances replicating the
// upstream Next.js test app's DOM contract exactly. Kept trivial here on purpose: this file's
// only job right now is to prove the `sonner-vue` -> ../src/index.ts alias resolves and the dev
// server boots.
import { Toaster, toast } from 'sonner-vue';
</script>

<template>
  <main>
    <h1>sonner-vue playground</h1>
    <button class="button" data-testid="default-button" @click="toast('My Toast')">Render Toast</button>
    <Toaster />
  </main>
</template>
