// Help screen ka static guide — topic-wise, teeno languages (en / hi / hinglish).
// `roles`: kaunse roles ko dikhe ('all' = sabko). `gt(obj, lang)` se text nikalta hai.
// AI system-prompt hamesha English version use karta hai (guideText).

export const gt = (obj, lang) => (obj && (obj[lang] || obj.en)) || '';

export const GUIDE = [
  {
    id: 'basics', roles: ['all'], icon: 'fa-circle-info',
    q: {
      en: 'What is this CRM — in one line',
      hi: 'यह CRM है क्या — एक लाइन में',
      hinglish: 'Ye CRM hai kya — ek line mein',
    },
    a: {
      en: 'A lead system for Paris Fashion. **LDR** talks to new leads and checks if they are a real buyer — if yes, marks **Qualified** and hands to Sales. **Sales** takes it forward (hot lead / visit / video call / follow-up) and closes the order. Admin / TL / MD only view.',
      hi: 'Paris Fashion का लीड सिस्टम। **LDR** नई लीड से बात करके चेक करता है कि असली buyer है या नहीं — सही लगे तो **Qualified** करके Sales को दे देता है। **Sales** आगे बढ़ाता है (hot lead / visit / video call / follow-up) और ऑर्डर close करता है। Admin / TL / MD सिर्फ़ देखते हैं।',
      hinglish: 'Paris Fashion ka lead system. **LDR** nayi leads se baat karke check karta hai ki asli buyer hai ya nahi — sahi lage to **Qualified** karke Sales ko de deta hai. **Sales** aage badhata hai (hot lead / visit / video call / follow-up) aur order close karta hai. Admin / TL / MD sirf dekhte hain.',
    },
  },
  {
    id: 'two-status', roles: ['all'], icon: 'fa-diagram-project',
    q: {
      en: 'Why a lead has two status fields (status vs sales_status)',
      hi: 'लीड के दो status क्यों होते हैं (status vs sales_status)',
      hinglish: 'Lead ke do status kyun hote hain (status vs sales_status)',
    },
    a: {
      en: '**LDR status**: fresh → call back → qualified / dead / lost. It never changes after "qualified".\n**Sales status**: empty until Sales starts, then hot lead → visit → video call → follow-up → order done / lost.\nIf sales_status is set the lead is with Sales, otherwise with LDR. "Qualified" is the hand-off point.',
      hi: '**LDR status**: fresh → call back → qualified / dead / lost. "qualified" के बाद यह कभी नहीं बदलता।\n**Sales status**: Sales के शुरू करने तक खाली, फिर hot lead → visit → video call → follow-up → order done / lost.\nअगर sales_status सेट है तो लीड Sales के पास है, वरना LDR के पास। "Qualified" hand-off point है।',
      hinglish: '**LDR status**: fresh → call back → qualified / dead / lost. "qualified" ke baad ye kabhi nahi badalta.\n**Sales status**: Sales ke shuru karne tak khaali, phir hot lead → visit → video call → follow-up → order done / lost.\nAgar sales_status set hai to lead Sales ke paas hai, warna LDR ke paas. "Qualified" hand-off point hai.',
    },
  },
  {
    id: 'ldr-flow', roles: ['ldr', 'admin'], icon: 'fa-leaf',
    q: {
      en: 'LDR: how to work a new lead start to finish',
      hi: 'LDR: एक नई लीड का पूरा काम कैसे करूँ',
      hinglish: 'LDR: ek nayi lead ka pura kaam kaise karun',
    },
    a: {
      en: '1. Open **Fresh Leads Pool** → tap a lead → Call / WhatsApp.\n2. Pick the next stage: **Call Back** (set a next-call date), **Qualified** (fill the form → goes to Sales), or **Lost**.\n3. Always write a remark.\n7 "no answer / call back" attempts auto-mark the lead Lost.',
      hi: '1. **Fresh Leads Pool** खोलो → लीड पर टैप → Call / WhatsApp।\n2. अगला स्टेज चुनो: **Call Back** (अगली कॉल की तारीख़ डालो), **Qualified** (फ़ॉर्म भरो → Sales को जाएगी), या **Lost**।\n3. Remark ज़रूर लिखो।\n7 बार "no answer / call back" पर लीड अपने आप Lost हो जाती है।',
      hinglish: '1. **Fresh Leads Pool** kholo → lead par tap → Call / WhatsApp.\n2. Agla stage chuno: **Call Back** (agli call ki date daalo), **Qualified** (form bharo → Sales ko jaayegi), ya **Lost**.\n3. Remark zaroor likho.\n7 baar "no answer / call back" par lead apne aap Lost ho jaati hai.',
    },
  },
  {
    id: 'qualify-form', roles: ['ldr', 'admin'], icon: 'fa-clipboard-list',
    q: {
      en: 'Why the form appears when qualifying, and how Sales sees it',
      hi: 'Qualify करते वक़्त फ़ॉर्म क्यों आता है, और वह Sales को कैसे दिखता है',
      hinglish: 'Qualify karte waqt form kyun aata hai, aur woh Sales ko kaise dikhta hai',
    },
    a: {
      en: 'Picking a stage that has "Show qualification form" ON (default: the stage named "qualified") opens the form — Customer Type, Bulk?, Quantity, Budget, etc. What you fill shows to Sales as a small chip strip on top of the lead + in the Details tab. Fill it properly — Sales calls from this.',
      hi: 'जिस स्टेज पर "Qualification form दिखाएँ" ON है (डिफ़ॉल्ट: "qualified" नाम वाला स्टेज) उसे चुनने पर फ़ॉर्म खुलता है — Customer Type, Bulk?, Quantity, Budget वग़ैरह। जो भरोगे वह Sales को लीड के ऊपर एक चिप-पट्टी में + Details टैब में दिखता है। ठीक से भरो — Sales इसी से कॉल करता है।',
      hinglish: 'Jis stage par "Qualification form dikhayein" ON hai (default: "qualified" naam wala stage) usko chunne par form khulta hai — Customer Type, Bulk?, Quantity, Budget waghairah. Jo bharoge woh Sales ko lead ke upar ek chip-patti mein + Details tab mein dikhta hai. Theek se bharo — Sales isi se call karta hai.',
    },
  },
  {
    id: 'assign', roles: ['ldr', 'admin'], icon: 'fa-user-check',
    q: {
      en: 'What "Auto" means in "Assign to sales person" after qualifying',
      hi: 'Qualify के बाद "Assign to sales person" में "Auto" का मतलब',
      hinglish: 'Qualify ke baad "Assign to sales person" mein "Auto" ka matlab',
    },
    a: {
      en: 'Leave it blank (Auto) → the moment you qualify, the system assigns the salesperson with the fewest open leads (must be active + present) and notifies them. Only if nobody is available does the lead stay unassigned and you get a reminder. Or pick a name → all go to that person.',
      hi: 'खाली छोड़ दो (Auto) → जैसे ही qualify करोगे, system उस salesperson को लीड दे देगा जिसके पास सबसे कम खुली लीड्स हैं (active + present होना चाहिए) और उसे notify करता है। सिर्फ़ कोई उपलब्ध न हो तो लीड बिना-assign रहती है और आपको reminder आता है। या नाम चुन लो → सब उसी को।',
      hinglish: 'Khaali chhod do (Auto) → jaise hi qualify karoge, system us salesperson ko lead de dega jiske paas sabse kam khuli leads hain (active + present hona chahiye) aur usko notify karta hai. Sirf koi available na ho to lead bina-assign rehti hai aur aapko reminder aata hai. Ya naam chun lo → sab usi ko.',
    },
  },
  {
    id: 'sales-flow', roles: ['sales', 'admin'], icon: 'fa-star',
    q: {
      en: 'Sales: what to do after a qualified lead arrives',
      hi: 'Sales: qualified लीड आने के बाद क्या करूँ',
      hinglish: 'Sales: qualified lead aane ke baad kya karun',
    },
    a: {
      en: '1. Open **New Qualified Leads** → open the lead → read the LDR\'s answers on top.\n2. Call and update the stage: Hot Lead / Video Call / Visit Customer / Follow-up.\n3. Order done → **Order Done** + amount. Not happening → **Lost**.\n**My Follow-ups** shows leads whose next call is due.',
      hi: '1. **New Qualified Leads** खोलो → लीड खोलो → ऊपर LDR के जवाब पढ़ो।\n2. कॉल करके स्टेज अपडेट करो: Hot Lead / Video Call / Visit Customer / Follow-up।\n3. ऑर्डर हुआ → **Order Done** + amount। नहीं हुआ → **Lost**।\n**My Follow-ups** में वे लीड आती हैं जिनकी अगली कॉल due है।',
      hinglish: '1. **New Qualified Leads** kholo → lead kholo → upar LDR ke jawab padho.\n2. Call karke stage update karo: Hot Lead / Video Call / Visit Customer / Follow-up.\n3. Order hua → **Order Done** + amount. Nahi hua → **Lost**.\n**My Follow-ups** mein woh leads aati hain jinki agli call due hai.',
    },
  },
  {
    id: 'followups', roles: ['ldr', 'sales', 'admin'], icon: 'fa-clock',
    q: {
      en: 'Difference between Pending Calls and My Follow-ups',
      hi: 'Pending Calls और My Follow-ups में फ़र्क',
      hinglish: 'Pending Calls / My Follow-ups mein farak',
    },
    a: {
      en: '**Pending Calls (LDR)** — leads still with you (LDR) whose call-back date is due. Leaves the list once you qualify.\n**My Follow-ups (Sales)** — leads Sales is working whose follow-up is due.\nBoth have Overdue / Today / All-due filters.',
      hi: '**Pending Calls (LDR)** — वे लीड जो अब भी आपके (LDR) पास हैं और जिनकी call-back date due है। Qualify करते ही list से हट जाती है।\n**My Follow-ups (Sales)** — वे लीड जिन पर Sales काम कर रहा है और जिनका follow-up due है।\nदोनों में Overdue / Today / All-due फ़िल्टर हैं।',
      hinglish: '**Pending Calls (LDR)** — woh leads jo ab bhi aapke (LDR) paas hain aur jinki call-back date due hai. Qualify karte hi list se hat jaati hai.\n**My Follow-ups (Sales)** — woh leads jinpe Sales kaam kar raha hai aur jinka follow-up due hai.\nDono mein Overdue / Today / All-due filter hain.',
    },
  },
  {
    id: 'notifications', roles: ['all'], icon: 'fa-bell',
    q: {
      en: 'How to turn on notifications (the bell icon)',
      hi: 'Notifications on कैसे करूँ (घंटी वाला icon)',
      hinglish: 'Notifications on kaise karun (ghanti wala icon)',
    },
    a: {
      en: 'Top-right bell icon → "Turn on notifications" → allow on your phone. You then get lock-screen alerts for new leads, SLA misses and overdue follow-ups.\n**iPhone:** first "Add to Home Screen", only then notifications work.',
      hi: 'ऊपर दाएँ घंटी icon → "Turn on notifications" → फ़ोन पर allow करो। फिर नई लीड, SLA miss और overdue follow-up का lock-screen alert आता है।\n**iPhone:** पहले "Add to Home Screen" करो, तभी notifications काम करते हैं।',
      hinglish: 'Upar dayein ghanti icon → "Turn on notifications" → phone par allow karo. Phir nayi lead, SLA miss aur overdue follow-up ka lock-screen alert aata hai.\n**iPhone:** pehle "Add to Home Screen" karo, tabhi notifications kaam karte hain.',
    },
  },
  {
    id: 'stale', roles: ['all'], icon: 'fa-rotate',
    q: {
      en: 'Old data showing / something is not updating',
      hi: 'पुराना डेटा दिख रहा है / कुछ अपडेट नहीं हो रहा',
      hinglish: 'Purana data dikh raha hai / kuch update nahi ho raha',
    },
    a: {
      en: 'The app caches data offline. Pull down to refresh, or tap the Refresh button. On the Settings screen check "Build time" — if it looks old, hard-refresh the browser (Ctrl+Shift+R) or close and reopen the app.',
      hi: 'ऐप डेटा offline cache करता है। ऊपर से नीचे खींचो, या Refresh button दबाओ। Settings स्क्रीन पर "Build time" देखो — पुराना लगे तो browser hard-refresh (Ctrl+Shift+R) करो या ऐप बंद करके दोबारा खोलो।',
      hinglish: 'App data offline cache karta hai. Upar se neeche kheencho, ya Refresh button dabao. Settings screen par "Build time" dekho — purana lage to browser hard-refresh (Ctrl+Shift+R) karo ya app band karke dobara kholo.',
    },
  },
  {
    id: 'reports', roles: ['admin'], icon: 'fa-file-export',
    q: {
      en: 'How to pull reports',
      hi: 'Reports कैसे निकालूँ',
      hinglish: 'Reports kaise nikaalun',
    },
    a: {
      en: '**Reports & Export** → pick a report + date range → "Download CSV" (opens in Excel). Detail reports are capped at 90 days per download — split big pulls into a few ranges. "Leads Worked (analyst)" is for data analysis — every lead talked to in the range, new/old, who talked, last remark, status, LDR, Sales.',
      hi: '**Reports & Export** → report + तारीख़ रेंज चुनो → "Download CSV" (Excel में खुलती है)। Detail reports एक बार में 90 दिन तक — बड़ा डेटा कई रेंज में निकालो। "Leads Worked (analyst)" data-analysis के लिए — रेंज में जिन लीड्स पर बात हुई, new/old, किसने बात की, last remark, status, LDR, Sales।',
      hinglish: '**Reports & Export** → report + date range chuno → "Download CSV" (Excel mein khulti hai). Detail reports ek baar mein 90 din tak — bada data kai range mein nikaalo. "Leads Worked (analyst)" data-analysis ke liye — range mein jin leads pe baat hui, new/old, kisne baat ki, last remark, status, LDR, Sales.',
    },
  },
];

/** AI system-prompt ke liye — hamesha English */
export const guideText = () => GUIDE.map((g) => `### ${g.q.en}\n${g.a.en}`).join('\n\n');
