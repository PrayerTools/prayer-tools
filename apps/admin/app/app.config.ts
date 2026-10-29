// Host-level app config: it outranks the layers' own (core declares `rail`
// defaults and loads before prayer.tools' layers).
export default defineAppConfig({
  ui: {
    colors: { primary: 'orange' },
    radioGroup: {
      compoundVariants: [{
        variant: 'card',
        class: {
          fieldset: 'gap-3',
          item: 'rounded-xl p-4 has-data-[state=checked]:border-[#f58220] has-data-[state=checked]:bg-[#fff0e3]',
          label: 'font-semibold',
          description: 'mt-1 leading-relaxed'
        }
      }]
    },
    button: {
      compoundVariants: [{
        color: 'primary',
        variant: 'solid',
        class: 'bg-[#c45100] text-white hover:bg-[#a94300] active:bg-[#a94300] disabled:bg-[#c45100] aria-disabled:bg-[#c45100]'
      }]
    }
  },
  // The rail lists the current site's sections; switching sites is the header
  // switcher's job, and org settings are not offered to site owners.
  rail: {
    launcher: false,
    orgSettings: false
  }
})
