export function campaignDateError(dates: {
  start_mode: string
  end_mode: string
  start_date: string | null
  end_date: string | null
}): string | undefined {
  if (dates.start_mode !== 'date' || dates.end_mode !== 'date' || !dates.start_date || !dates.end_date) return
  if (dates.end_date < dates.start_date) return 'The end date cannot be before the start date. Choose a later end date or an earlier start date.'
}
