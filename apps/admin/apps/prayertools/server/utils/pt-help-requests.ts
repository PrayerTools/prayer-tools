import { inboxLogConversationEvent } from '#inbox/server'
import { HelpRequestError, type ConversationEventLogger } from '@prayertools/shared/help-requests'

// Help request events go on the conversation's "Notes & activity" timeline.
export const ptLogOnConversation: ConversationEventLogger = (tx, conversationId, eventType, message, opts) =>
  inboxLogConversationEvent(tx as never, conversationId, eventType, message, opts)

// Runs `fn`, turning a refused help request into its HTTP error.
export async function ptHelpRequestCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof HelpRequestError) throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    throw err
  }
}
