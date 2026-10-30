// Merges prayer.tools' tables into core's global schema registry. The table
// types live in @prayertools/shared so the public server and worker use the
// same definitions.
import type { PtTables } from '@prayertools/shared/db/schema'

declare global {
  interface NuxtinatorDatabaseTables {
    pt_user_device: PtTables['pt_user_device']
    pt_auth_code: PtTables['pt_auth_code']
    pt_suppression: PtTables['pt_suppression']
    pt_job: PtTables['pt_job']
    pt_site_domain: PtTables['pt_site_domain']
    pt_directory_entry: PtTables['pt_directory_entry']
    pt_site_report: PtTables['pt_site_report']
    pt_library: PtTables['pt_library']
    pt_library_entry: PtTables['pt_library_entry']
    pt_personal_asset: PtTables['pt_personal_asset']
    pt_personal_block: PtTables['pt_personal_block']
    pt_legacy_key: PtTables['pt_legacy_key']
    pt_site: PtTables['pt_site']
    pt_campaign: PtTables['pt_campaign']
    pt_site_library: PtTables['pt_site_library']
    pt_site_entry: PtTables['pt_site_entry']
    pt_campaign_library: PtTables['pt_campaign_library']
    pt_subscription: PtTables['pt_subscription']
    pt_commitment: PtTables['pt_commitment']
    pt_reminder_sent: PtTables['pt_reminder_sent']
    pt_checkin: PtTables['pt_checkin']
    pt_prayer_session: PtTables['pt_prayer_session']
    pt_person_total: PtTables['pt_person_total']
    pt_stat_daily: PtTables['pt_stat_daily']
    pt_stat_dim_daily: PtTables['pt_stat_dim_daily']
    pt_stat_visitor_day: PtTables['pt_stat_visitor_day']
    pt_event: PtTables['pt_event']
    pt_story: PtTables['pt_story']
    pt_consent_option: PtTables['pt_consent_option']
    pt_signup_field: PtTables['pt_signup_field']
    pt_site_string: PtTables['pt_site_string']
    pt_export_log: PtTables['pt_export_log']
    pt_coverage_cache: PtTables['pt_coverage_cache']
  }
}
