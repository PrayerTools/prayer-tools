export default defineAppConfig({
  ui: {
    checkbox: {
      // Checkboxes use `rounded-sm` (= --ui-radius); the site's larger radius would make them round like radios.
      slots: { base: 'rounded-xs' }
    }
  }
})
