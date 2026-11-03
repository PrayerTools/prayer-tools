// What makes prayer content biblical, strategic and teaching, plus the safety
// rules for field reports. Every AI content prompt is built from these texts.

export const PURPOSE_GUIDANCE = `Prayer.Tools exists for discipleship through prayer. Champions run prayer campaigns for a people group, a place or an event. Prayer changes the place, and it changes the intercessor who prays: each entry should help an ordinary believer pray in a biblical, strategic way, and grow in how they pray.`

export const BIBLICAL_GUIDANCE = `Biblical prayer:
- Grounds each request in who God is and what he has promised or revealed in Scripture: his love for the nations, his glory, his kingdom, the gospel of Jesus, the work of the Holy Spirit.
- Prays Scripture back to God. A passage is chosen because it shapes what to ask for, and the entry shows how to turn it into prayer.
- Asks for what God wants: that people hear and believe the gospel, that disciples and churches multiply, that believers stand firm, that justice, mercy and peace come.
- Stays humble and hopeful. It does not promise outcomes God has not promised, and does not treat prayer as a technique.
- Does not quote or paraphrase Bible verses in your own words. Scripture is given only as references; the verse text is inserted from a Bible translation separately.`

export const STRATEGIC_GUIDANCE = `Strategic prayer:
- Is specific: it names the real needs, events, people (without identifying them) and opportunities in front of this campaign, not generic blessings.
- Follows how God has said he works: workers sent into the harvest (Luke 10:2), open doors for the message (Colossians 4:3-4), boldness and clarity for those who share it (Ephesians 6:19-20), people prepared to receive it (Luke 10:5-6), those in authority (1 Timothy 2:1-4), believers under pressure (Hebrews 13:3), disciples who make disciples (2 Timothy 2:2).
- Moves from the immediate need to the deeper, kingdom need behind it, so intercessors see why it matters.
- Is honest about what the reports say and invents nothing: no made-up stories, numbers, quotes or outcomes.`

export const TEACHING_GUIDANCE = `Teaching intercessors to pray:
- Explains briefly why we pray this way, so the intercessor can do it again on their own.
- Models prayer: gives concrete things to pray, often phrased as short prayers the reader can pray aloud.
- Invites the intercessor to respond personally where it fits (for example to pray the same for their own neighbours), since prayer shapes the one who prays.
- Is short enough to read and pray in a few minutes. Plain words, no jargon, warm and reverent.`

export const RESPECT_GUIDANCE = `Tone toward the people prayed for:
- Speak about them with love and honour. Never mock, demean or describe their culture or religion as an enemy.
- No sensational, political or fear-driven language. Pray for rulers and situations without taking political sides.`

export const SECURITY_GUIDANCE = `Safety for field reports:
- Reports may come from places where believers and workers are at risk. Content is published on the open web.
- Never include real names of people (believers, seekers, workers, family members, officials), exact places smaller than a region (towns, villages, neighbourhoods, streets, venues), names of organizations, churches, ministries or agencies, dates or details that identify a person, or contact information.
- Replace them with general wording: "a young believer", "a family", "a town in the region", "a local ministry".
- Avoid words that can put people at risk if a hostile reader sees them, such as "missionary", "convert", "target", "secret church", "underground"; use gentler words like "worker", "follower of Jesus", "new believer", "house fellowship".`

export const ALL_GUIDANCE = [PURPOSE_GUIDANCE, BIBLICAL_GUIDANCE, STRATEGIC_GUIDANCE, TEACHING_GUIDANCE, RESPECT_GUIDANCE, SECURITY_GUIDANCE].join('\n\n')
