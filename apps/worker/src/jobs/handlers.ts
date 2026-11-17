// Built-in job types. More are added with `registerJobHandler`.
import { registerJobHandler } from './registry'
import { thankYouHandlers } from './thank-you'
import { checkinEmailJob } from './checkin'
import { domainAlertJob } from './domain-alert'
import { pushAnnouncementJob } from './push-announcement'
import { helpRequestAlertJob } from './help-request-alert'

registerJobHandler('thank_you', thankYouHandlers.thank_you)
registerJobHandler('thank_you_person', thankYouHandlers.thank_you_person)
registerJobHandler('checkin_email', checkinEmailJob)
registerJobHandler('domain_alert', domainAlertJob)
registerJobHandler('push_announcement', pushAnnouncementJob)
registerJobHandler('help_request_alert', helpRequestAlertJob)
