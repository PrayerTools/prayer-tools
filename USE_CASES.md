# prayer.tools use cases

Who prayer.tools is for and what each of them needs to do. Drawn from the plans, the session logs and our design conversations. Items marked *(not built)* are planned but missing; *(open)* are undecided.

## Personas

### Champion
Runs prayer campaigns for a people, a place or an event, usually around a cause or a goal. Not technical. Wants to launch in an afternoon, get people praying, and keep them praying over months and years.

Every champion has two aims:
- **Prayer for the people or place,** so its realities and its access to the gospel change. This is the campaign's goal.
- **Discipling the intercessors.** The campaign informs, teaches and equips people to pray. The champion makes sure the prayer content is both biblical and strategic, so it builds up those who pray it.

Champions come in five kinds.

#### Missionary
Prays for the place they work in or the people group they work among, or raises awareness of a nearby group with little access to the gospel. Already sends a newsletter, and wants a network that prays regularly and works with others.
- Calls for concerted prayer at key times: Ramadan, a short-term team's visit, government actions, elections, a hospital, a school, any event.
- Breaks the area down so people pray for each district or state, or for each kind of people in the place.
- Knows the situation first hand and writes the prayer content themselves.
- Has a global network, so 24/7 coverage is within reach.

#### Mission agency
Looks at a region: every country, city or location in it, both where it has teams and where nobody is yet. Prays for its teams as well as the places.
- Runs many campaigns from common templates, following the organization's own prayer rhythms.
- Mobilizes at large and matches intercessors with places.
- Builds content from many field reports, so it curates more: removing sensitive details and blending reports into content that reads as one voice across the campaign.
- Has a global network, so 24/7 coverage is within reach.

#### Church
Supports a few people in different places. Its people already care about the ones it sends; they just need to sign up.
- Smaller scale than an agency, with a stronger network around a few people.
- Knows least about the issues on the ground, so it is strong on biblical prayer and needs help with strategic prayer.
- Its network is mostly in one time zone, so 24/7 coverage is hard; prayer time or people mobilized fit better.

#### School
Staff or parents who pray for the school, its students and its activities.
- Usually an ongoing campaign with regular content, inviting others to pray for the school.
- Its network is mostly in one time zone, like a church's.

#### Prayer.Tools team
Prayer.Tools is part of Gospel Ambition, which exists to make multiplying disciples. Prayer is a vehicle for discipleship: learning to pray is learning to be a disciple, and helping others learn to pray is multiplying disciples.
- Runs campaigns for strategic places it cares about.
- Leads the yearly Ramadan prayer effort.
- Catalyzes other champions to mobilize their own people to pray.

### Network champion (partner)
Any champion who runs many sites, most often a mission agency: one per country, city or people group, or dozens of Ramadan campaigns. Needs one login that lists every site, reusable email templates and content, and an occasional send across several sites. Grouping sites for partners is deferred.

### Champion's team
- **Owner:** shares full control; a site can have several.
- **Editor:** content, email, settings and intercessor details.
- **Mobilizer:** handles communication. Invites people to the campaign and communicates with intercessors before, during and after it: knows who the intercessors are, answers the inbox, emails the whole list and writes the campaign's messages (share messages, the end-of-campaign thank-you). Leaves the prayer content and site settings to others.
- **Translator:** translates by hand for teams that don't want AI translation.
- **Viewer:** stats only, no personal data. For partners and board members.

### Intercessor (web)
Signs up on a site with an email, gets a reminder at the time they chose, and prays from a link to the day's content. Doesn't think about accounts, time zones or DST. May pray with several campaigns and sites.

### Intercessor (app)
Installs the app and prays at once, with no email. Follows campaigns on several sites with local reminders. May add an email later *(not built)*.

### Prayer group or church leader
Gets a group praying together and reports how many prayed ("praying as a group"). Would like printed or PDF content *(idea)*.

### Prayer.Tools operator
Prayer.Tools staff. Supports champions across sites, curates platform libraries (Ramadan and other holiday content, crisis content), approves directory listings, reassigns owners, reads stories and handles reports.

## Main use cases

### 1. An ongoing site for a country, city or people group
For example Pray for France: a site with one ongoing main campaign and daily or weekly content about that country.

- Create the site and its main campaign with no end date, daily or weekly.
- Write or choose content about the country and keep adding to it, for example praying through each region or each people in it.
- Build a base of intercessors over time. Email check-ins and app inactivity keep the people count to those still praying.
- Launch side campaigns from it (use case 2), so the same intercessors are invited to each event.

### 2. Side campaigns for events, crises and holidays
Run from an ongoing site, alongside its main campaign. Examples:
- religious holidays: Ramadan, Chinese New Year, other religions' festivals
- elections and key government dates
- a short-term team's visit
- natural disasters and other crises

How it works:
- Each side campaign has fixed dates, its own address (`/ramadan-2027`), landing page and content.
- The main landing page shows a card linking to it while it is upcoming or running.
- Existing intercessors join with one confirmation email; their main-campaign reminders continue.
- At the end, its intercessors are invited to join the main campaign, unless the champion sets a different call to action *(not built)*.

### 3. A yearly Ramadan site
A site that exists for Ramadan: a fixed campaign of about 30 days, daily content, relaunched every year. This was the first use case prayer.tools was built for, and it is still common.

- Ramadan has a template because Prayer.Tools has years of Ramadan prayer content; other occasions don't need one. The template is offered within 180 days of Ramadan ("Build your own" comes first). It suggests the start date from the expected first day of Ramadan and fills in 30 days and daily content.
- Ramadan libraries (2023 to 2026 so far) are suggested first, along with a set of Ramadan hero images and default landing text.
- Ramadan campaigns started with 24/7 coverage; 24 hours of prayer every day and people mobilized are now offered too (see Choose a goal).

## What champions do in every campaign

### Set up a campaign
1. Sign up at `app.prayer.tools` (or come in from My prayer) and create a site.
2. Choose a template or build your own: start, end, cadence and goal.
3. Pick a goal:
   - **People mobilized** (default): count people who sign up.
   - **Prayer time:** for example 24 hours of prayer every day; intercessors say how long they pray.
   - **24/7 coverage:** every slot of every day covered; intercessors pick recurring times or specific dates.
4. Pick content from the library catalog, or write your own.
5. Choose languages. Content and champion text are AI-translated with a button and stay editable.
6. Fill in the landing page: text, hero image, sections in order.
7. Preview on phone and desktop, finish the launch checklist, publish at `{slug}.prayer.tools`; add a custom domain any time.

### Choose a goal
- **24/7 coverage** came first. It was inspired by the Moravians, who kept 24/7 prayer for over 100 years: could we cover the calendar and the clock for Ramadan? It motivates, but fewer than 5% of sites reach it, so it also discourages. It needs a network spread across time zones, which missionaries and agencies have and churches and schools rarely do. Time zone changes on different dates in different countries make it harder still.
- **24 hours of prayer every day** is more achievable. It needs the same 96 people praying 15 minutes daily, but at any time of day. It can be misread as falling short of 24/7.
- **People mobilized** is the most intuitive, and fits the mission: it counts people being transformed. It loses how much they pray: someone praying once is not someone praying 15 minutes every day.
- Every goal counts commitments. How much people actually pray against what they committed can't be measured.

### Equip intercessors through the content
- Choose or write content that is biblical and strategic: Scripture to pray, what to pray for the people or place, and why. Churches tend to need help with the strategic side; champions close to the field may need reminding of the biblical side.
- Turn field reports into prayer content, leaving out sensitive details, with AI help to draft, review and remove details *(not built)*.
- Edit a library entry to fit this people or place; the first edit freezes the site's own copy of that library.
- Use the content to teach intercessors how to pray, not only what to pray for.

### Recruit people to pray
The champion or the mobilizer:
- Message intercessors from previous campaigns they've mobilized, on this site or across several of their sites.
- Share the link, QR code and per-language share messages (WhatsApp on phones).
- Intercessors are prompted to share after signing up, after their 3rd and 7th "Amen" and at the end. The champion sees how many joined through shares, never who invited whom.
- Embed the signup or coverage widget on another site *(not built: no embed code in the admin, and the widget only links to signup)*.
- List the site in the Prayer.Tools directory (operator approves).

### Fill 24/7 coverage
- Intercessors choose open times to fill gaps. How they are shown which times need someone is *(open)*.
- The champion sees coverage per day and per slot and emails intercessors to fill gaps.
- Reminders go out some time before the chosen slot *(not built: today they go out at the chosen time; how long before is open)*.
- Coverage is exact across DST.

### Run it day by day
- Reminders go out at each person's chosen time, linking to the day's content (never containing it).
- Watch people signed up, goal progress, prayer activity and "praying now" on the dashboard.
- The mobilizer sends updates to the campaign's intercessors who consented; reminders keep going regardless.
- Answer contact messages and stories in the site inbox.
- Publish allowed stories on the landing page. A main campaign's page shows stories from any earlier campaign on the site. A side campaign's next run (Ramadan 2026 → 2027) carries over the previous run's stories, or at least lets the champion pick from them *(not built: today a side campaign's page shows only its own)*.

### Close a campaign
- Everyone who took part gets a thank-you (email, and push in the app), with the champion's message and a call to action.
- Between campaigns the site shows the final results, the call to action and "Notify me when this campaign runs again". Those people are told when it does *(not built)*.

### Relaunch
- Create the next run (Ramadan 2027) on the same site. The address, team, branding and intercessors stay; the previous run stays reachable with its stats.
- The new campaign copies the previous answers and landing page, and suggests the newest library for the holiday (this year's Ramadan content) in place of last year's.
- The mobilizer invites the previous intercessors and the "notify me" list.

### Run many sites (mission agency or other network)
- Switch between sites from one login; each site's intercessors stay isolated from the others.
- Start each site from common templates and content, following the organization's prayer rhythms *(not built)*.
- Reuse email templates, images and blocks from the personal library on any site.
- Send one email to several sites: each person gets it once, from the most recent site they joined.
- Give partners a Viewer role for stats.

### Move from WordPress
- Existing subsites, intercessors, consent, content and old links (manage links, prayer content links, calendar feeds) move over in one cutover, well clear of Ramadan *(importer not built)*.

## Other campaign kinds

- **Crisis response:** a 4-day campaign started right away, handing people on to a 12-day one through its call to action *(one-step join not built)*.
- **Start anytime:** a devotional where each person starts on day 1 the day they join and finishes at the last entry.
- **School:** ongoing weekly content through the school year.
- **Own content:** write content, publish it as a library for other sites, and ask Prayer.Tools to share it with everyone.

## Intercessor

- Sign up on the web with email or in the app, and pick when to be reminded. Google and Apple sign-in *(planned)*.
- Pray from the reminder link; say "Amen".
- Change, pause or remove prayer times, language and time zone from the manage link in any email.
- Unsubscribe from one campaign and keep the others *(not built)*.
- Unsubscribe from all campaigns on every site at once *(not built)*. Today unsubscribing stops every campaign on one site.
- See every campaign across sites in **My prayer** (`prayer.tools/my`), with past campaigns and their prayer totals.
- Answer "Are you still praying?" check-ins.
- Share the campaign, submit a story, contact the champion.
- Take the next step offered at the end of a campaign.
- Download or delete their data.

## Operator

- Support champions on any site; make another member an owner when one leaves.
- Publish platform libraries, including holiday content (Ramadan, Chinese New Year and others) and crisis content, and review share requests.
- Approve or unlist directory sites; handle "Report this campaign".
- Read stories, handle escalations, retry failed jobs.
