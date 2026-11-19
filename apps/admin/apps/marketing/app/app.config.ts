export default defineAppConfig({
  marketing: {
    // Host endpoint for AI translation: POST { doc | texts, from, to } → { doc | texts }; 409 when AI isn't set up.
    // GET → { available } says whether to show the AI translate button.
    translateEndpoint: '/api/pt/translate'
  }
})
