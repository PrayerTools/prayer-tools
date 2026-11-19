// Whether AI translate buttons should show in this site: the user may translate and AI is set up.
export default definePtHandler(null, async (_event, tx, ctx) => {
  return { available: ctx.perms.has('pt.content.translate' as never) && await ptTranslateAvailable(tx) }
})
