export default defineAppConfig({
  ui: {
    button: {
      compoundVariants: [{
        color: 'primary',
        variant: 'solid',
        class: 'bg-[#c45100] text-white hover:bg-[#a94300] active:bg-[#a94300] disabled:bg-[#c45100] aria-disabled:bg-[#c45100]'
      }]
    }
  }
})
