// Standard landing page text a campaign template brings, per language: the
// "why we pray" text, the about text, and the About page's text about praying
// together. A site shows it until it writes its own, and it is never stored.
import type { TiptapDoc } from '../db/schema'
import { isEmptyDoc, textDoc, tiptapToText } from '../tiptap'
import { visionDoc } from './vision'

export type TemplateText = 'why' | 'about' | 'together'

const WHY: Record<string, (lang: string) => TiptapDoc | null> = {
  ramadan: lang => visionDoc(lang)
}

const ABOUT: Record<string, Record<string, string>> = {
  ramadan: {
    en: `Ramadan is one of the five requirements (or pillars) of Islam. During each of its 30 days, Muslims are obligated to fast from dawn until sunset. During this time they are supposed to abstain from food, drinking liquids, smoking, and sexual relations.

Women typically spend the afternoons preparing a big meal. At sunset, families often gather to break the fast. Traditionally the families break the fast with a drink of water, then three dried date fruits, and a multi-course meal. After watching the new Ramadan TV series, men (and some women) go out to coffee shops where they drink coffee, and smoke with friends until late into the night.

Though many have stopped fasting in recent years, and are turned off by the hypocrisy, increased crime rates, and rudeness that is pervasive through the month, others have become more serious about religion during this time. Many attend the evening prayer services and do the other ritual prayers. Some even read the entire Quran (about a tenth the length of the Bible). This sincere seeking makes it a strategic time for us to pray for them.`,
    es: `Ramadán es uno de los cinco requisitos (o pilares) del Islam. Durante cada uno de sus 30 días, los musulmanes están obligados a ayunar desde el amanecer hasta la puesta del sol. Durante este tiempo se supone que deben abstenerse de comer, beber líquidos, fumar y tener relaciones sexuales.

Las mujeres suelen pasar las tardes preparando una gran comida. Al atardecer, las familias suelen reunirse para romper el ayuno. Tradicionalmente, las familias rompen el ayuno con un trago de agua, luego tres dátiles secos y una comida de varios platos. Después de ver la nueva serie de televisión de Ramadán, los hombres (y algunas mujeres) salen a las cafeterías donde toman café y fuman con amigos hasta altas horas de la noche.

Aunque muchos han dejado de ayunar en los últimos años y están desanimados por la hipocresía, el aumento de los índices de criminalidad y la mala educación que prevalece durante el mes, otros se han vuelto más serios acerca de la religión durante este tiempo. Muchos asisten a los servicios de oración vespertinos y hacen otras oraciones rituales. Algunos incluso leen el Corán completo (alrededor de una décima parte de la longitud de la Biblia). Esta búsqueda sincera hace que sea un momento estratégico para que oremos por ellos.`,
    fr: `Le ramadan est l'une des cinq exigences (ou piliers) de l'islam. Pendant chacun de ses 30 jours, les musulmans sont obligés de jeûner de l'aube au coucher du soleil. Pendant cette période, ils sont censés s'abstenir de manger, de boire des liquides, de fumer et d'avoir des relations sexuelles.

Les femmes passent généralement l'après-midi à préparer un gros repas. Au coucher du soleil, les familles se rassemblent souvent pour rompre le jeûne. Traditionnellement, les familles rompent le jeûne avec un verre d'eau, puis trois dattes séchées et un repas composé de plusieurs plats. Après avoir regardé la nouvelle série télévisée Ramadan, les hommes (et certaines femmes) sortent dans des cafés où ils boivent du café et fument avec des amis jusque tard dans la nuit.

Bien que beaucoup aient cessé de jeûner ces dernières années et soient découragés par l'hypocrisie, l'augmentation du taux de criminalité et l'impolitesse omniprésente tout au long du mois, d'autres sont devenus plus sérieux au sujet de la religion pendant cette période. Beaucoup assistent aux services de prière du soir et font les autres prières rituelles. Certains lisent même le Coran en entier (environ un dixième de la longueur de la Bible). Cette recherche sincère en fait un moment stratégique pour nous de prier pour eux.`,
    pt: `O Ramadã é um dos cinco requisitos (ou pilares) do Islã. Durante cada um dos seus 30 dias, os muçulmanos são obrigados a jejuar desde o amanhecer até o pôr do sol. Durante esse período, eles devem se abster de alimentos, de beber líquidos, de fumar e de ter relações sexuais.

As mulheres normalmente passam as tardes preparando uma grande refeição. Ao pôr do sol, as famílias costumam se reunir para quebrar o jejum. Tradicionalmente, as famílias quebram o jejum com um copo de água, depois três tâmaras secas e uma refeição com vários pratos. Depois de assistir à nova série de TV do Ramadã, os homens (e algumas mulheres) vão a cafeterias onde bebem café e fumam com os amigos até tarde da noite.

Embora muitos tenham parado de jejuar nos últimos anos e estejam desanimados com a hipocrisia, o aumento nas taxas de criminalidade e a grosseria generalizados durante o mês do Ramadã, outros se tornaram mais sérios sobre seguir a religião durante esse período. Muitos frequentam os cultos de oração da noite e fazem os outros rituais de oração. Alguns até leem o Alcorão inteiro (cerca de um décimo do tamanho da Bíblia). Essa busca sincera faz com que este seja um momento estratégico para nós orarmos por eles.`,
    de: `Ramadan ist eine der fünf Anforderungen (oder Säulen) des Islam. An jedem seiner 30 Tage sind Muslime verpflichtet, von Sonnenaufgang bis Sonnenuntergang zu fasten. Während dieser Zeit sollen sie auf Essen, Trinken, Rauchen und sexuelle Beziehungen verzichten.

Frauen verbringen normalerweise die Nachmittage damit, eine große Mahlzeit zuzubereiten. Bei Sonnenuntergang versammelt sich oft die ganze Familie, um das Fasten zu brechen. Traditionell wird das Fasten mit einem Schluck Wasser, drei getrockneten Datteln und einem mehrgängigen Menü gebrochen. Nachdem sie die neue Ramadan-Fernsehserie angeschaut haben, gehen die Männer (und manche Frauen) in Cafés, wo sie bis spät in die Nacht mit Freunden Kaffee trinken und rauchen.

Obwohl viele in den letzten Jahren mit dem Fasten aufgehört haben und von der Heuchelei, der erhöhten Kriminalitätsrate und der Unhöflichkeit, die den ganzen Monat über allgegenwärtig sind, abgeschreckt werden, nehmen andere während dieser Zeit die Regeln des Islam noch ernster. Viele besuchen die abendlichen Gebetsgottesdienste und verrichten die anderen rituellen Gebete. Einige lesen sogar den gesamten Koran (etwa ein Zehntel der Länge der Bibel). Dieses aufrichtige Suchen macht es zu einer strategisch wertvollen Zeit für uns, für sie zu beten.`,
    it: `Il Ramadan è uno dei cinque requisiti (o pilastri) dell'Islam. Durante ciascuno dei suoi 30 giorni, i musulmani sono obbligati a digiunare dall'alba al tramonto. Durante questo periodo dovrebbero astenersi dal cibo, dal bere liquidi, dal fumo e dai rapporti sessuali.

Le donne in genere trascorrono i pomeriggi a preparare un pasto abbondante. Al tramonto, le famiglie spesso si riuniscono per rompere il digiuno. Tradizionalmente le famiglie rompono il digiuno con un sorso d'acqua, poi tre datteri secchi e un pasto a più portate. Dopo aver visto la nuova serie TV del Ramadan, gli uomini (e alcune donne) escono nei bar dove bevono caffè e fumano con gli amici fino a tarda notte.

Anche se molti hanno smesso di digiunare negli ultimi anni e sono disgustati dall'ipocrisia, dall'aumento dei tassi di criminalità e dalla maleducazione che pervade tutto il mese, altri sono diventati più seri riguardo alla religione durante questo periodo. Molti partecipano ai servizi di preghiera serali e fanno le altre preghiere rituali. Alcuni addirittura leggono l'intero Corano (circa un decimo della lunghezza della Bibbia). Questa ricerca sincera lo rende un momento strategico per noi di pregare per loro.`,
    nl: `Ramadan is een van de vijf vereisten (of pijlers) van de islam. Tijdens elk van de 30 dagen zijn moslims verplicht om te vasten van zonsopgang tot zonsondergang. Gedurende deze tijd moeten ze zich onthouden van eten, drinken, roken en seksuele relaties.

     Vrouwen brengen meestal de middagen door met het bereiden van een grote maaltijd. Bij zonsondergang komen families vaak samen om het vasten te verbreken. Traditioneel verbreken de families het vasten met een slok water, daarna drie gedroogde dadels en een meergangenmaaltijd. Na het bekijken van de nieuwe Ramadan-tv-serie gaan mannen (en sommige vrouwen) naar coffeeshops waar ze koffie drinken en roken ze tot laat in de nacht met vrienden.

     Hoewel velen de afgelopen jaren zijn gestopt met vasten en zich afkeren van de hypocrisie, de toegenomen misdaadcijfers en de onbeschoftheid die de hele maand door alomtegenwoordig is, zijn anderen in deze tijd serieuzer geworden over religie. Velen wonen de avondgebedsdiensten bij en doen de andere rituele gebeden. Sommigen lazen zelfs de hele Koran (ongeveer een tiende van de lengte van de Bijbel). Dit oprechte zoeken maakt het voor ons een strategisch moment om voor hen te bidden.`,
    ro: `Ramadanul este una dintre cele cinci cerințe (sau piloni) ale islamului. În fiecare dintre cele 30 de zile, musulmanii sunt obligați să postească din zori până la apus. În acest timp, ei ar trebui să se abțină de la mâncare, băuturi, fumat și relații sexuale.

Femeile petrec de obicei după-amiezile pregătind o masă copioasă. La apus, familiile se adună adesea pentru a întrerupe postul. În mod tradițional, familiile întrerup postul cu un pahar de apă, apoi trei curmale uscate și o masă cu mai multe feluri. După ce vizionează noul serial TV de Ramadan, bărbații (și unele femei) ies la cafenele unde beau cafea și fumează cu prietenii până târziu în noapte.

Deși mulți au renunțat la post în ultimii ani și sunt dezamăgiți de ipocrizie, ratele crescute ale criminalității și grosolănia care sunt omniprezente de-a lungul lunii, alții au devenit mai serioși cu privire la religie în acest timp. Mulți participă la slujbele de rugăciune de seară și fac celelalte rugăciuni rituale. Unii chiar citesc întregul Coran (aproximativ o zecime din lungimea Bibliei). Această căutare sinceră face din aceasta un moment strategic pentru noi să ne rugăm pentru ei.`,
    ru: `Рамадан является одним из пяти требований (или столпов) ислама. В течение каждого из его 30 дней мусульмане обязаны поститься от рассвета до заката. В течение этого времени они должны воздерживаться от еды, питья, курения и половых отношений.

Женщины обычно проводят послеполуденное время за приготовлением большого ужина. На закате семьи часто собираются, чтобы прервать пост. Традиционно семьи прерывают пост глотком воды, затем тремя сухофруктами и кушаньем из нескольких блюд. После просмотра нового сериала о Рамадане мужчины (и некоторые женщины) идут в кофейни, где пьют кофе и курят с друзьями до поздней ночи.

Хотя многие перестали поститься в последние годы и их отталкивает лицемерие, рост преступности и грубость, которые распространены в течение месяца, другие за это время стали более серьезно относиться к религии. Многие посещают вечерние молебны и совершают другие ритуальные молитвы. Некоторые даже прочитывают весь Коран (примерно десятая часть длины Библии). Этот искренний поиск делает для нас стратегически важным моментом молиться за них.`,
    uk: `Рамадан є одним із п'яти вимог (або стовпів) ісламу. Протягом кожного з його 30 днів мусульмани зобов'язані постити від світанку до заходу сонця. Протягом цього часу вони повинні утримуватися від їжі, вживання рідини, куріння та статевих стосунків.

     Вдень жінки зазвичай готують велику їжу. На заході сонця сім'ї часто збираються, щоб розговитися. Традиційно сім'ї закінчують піст, випиваючи воду, потім три сушених фінікових фрукта та їжу з кількох страв. Після перегляду нових рамаданських телесеріалів чоловіки (і деякі жінки) йдуть в кав'ярні, де п'ють каву, курять з друзями до пізньої ночі.

     Хоча багато хто припинив постити останніми роками, і їх відлякує лицемірство, зростання рівня злочинності та грубість, яка поширена протягом місяця, інші почали серйозніше ставитися до релігії за цей час. Багато хто відвідує вечірню молитву та виконує інші ритуальні молитви. Деякі навіть читають весь Коран (приблизно десяту частину Біблії). Це щире прагнення робить для нас стратегічний час молитися за них.`,
    tr: `Ramazan, İslam'ın beş şartından (veya sütunundan) biridir. 30 günün her birinde Müslümanlar şafaktan gün batımına kadar oruç tutmakla yükümlüdür. Bu süre zarfında yemekten, sıvı içmekten, sigaradan ve cinsel ilişkilerden uzak durmaları gerekir.

Kadınlar genellikle öğleden sonralarını büyük bir yemek hazırlayarak geçirirler. Gün batımında, aileler genellikle orucunu açmak için toplanırlar. Geleneksel olarak aileler bir bardak su, ardından üç kuru hurma ve çok çeşitli bir yemekle orucunu açarlar. Erkekler (ve bazı kadınlar) yeni Ramazan dizilerini izledikten sonra kahvelerini içtikleri kafelere gidiyorlar ve gece geç saatlere kadar arkadaşlarıyla sigara içiyorlar.

Birçoğu son yıllarda oruç tutmayı bırakmış ve ay boyunca yaygın olan ikiyüzlülük, artan suç oranları ve kabalık nedeniyle uzaklaşmış olsa da, diğerleri bu süre zarfında din konusunda daha ciddi hale geldi. Birçoğu akşam ibadetine katılır ve diğer ritüel duaları yapar. Hatta bazıları Kuran'ın tamamını (İncil'in yaklaşık onda biri kadar) okur. Bu samimi arayış, onlar için dua etmemizi stratejik bir zaman haline getiriyor.`,
    ar: `رمضان هو أحد متطلبات الإسلام الخمسة (أو أركانه). خلال كل يوم من أيامه الثلاثين، يلتزم المسلمون بالصيام من الفجر حتى غروب الشمس. خلال هذا الوقت من المفترض أن يمتنعوا عن الطعام وشرب السوائل والتدخين والعلاقات الجنسية.

تقضي النساء عادة فترة بعد الظهر في إعداد وجبة كبيرة. عند غروب الشمس، تتجمع العائلات غالبًا لتناول الإفطار. تقليديا، تفطر العائلات بشرب الماء، ثم ثلاث فواكه مجففة بالتمر، ووجبة متعددة الأطباق. بعد مشاهدة المسلسل التلفزيوني الرمضاني الجديد، يخرج الرجال (وبعض النساء) إلى المقاهي حيث يشربون القهوة ويدخنون مع الأصدقاء حتى وقت متأخر من الليل.

على الرغم من أن الكثيرين قد توقفوا عن الصيام في السنوات الأخيرة، وأوقفهم النفاق، وازدادت معدلات الجريمة، والفظاظة التي انتشرت خلال الشهر، إلا أن آخرين أصبحوا أكثر جدية في الدين خلال هذا الوقت. يحضر الكثيرون صلاة العشاء ويؤدون صلاة الطقوس الأخرى. حتى أن البعض قرأ القرآن كاملاً (حوالي عُشر طول الكتاب المقدس). هذا البحث الصادق يجعله وقتًا استراتيجيًا لنا للصلاة من أجلهم.`,
    ur: `رمضان المبارک اسلام کے پانچ تقاضوں (یا ستونوں) میں سے ایک ہے۔ اِس کے ۳۰ دنوں میں سے ہر ایک کے دوران، مسلمانوں پر فجر سے مغرب تک روزہ رکھنا فرض ہے۔ اِس وقت کے دوران اُنہیں کھانے، پینے کے مائعات، سگریٹ نوشی اور جنسی تعلقات سے پرہیز کرنا چاہیے۔

خواتین عام طور پر دوپہر کو بڑا کھانا بنانے میں گزارتی ہیں. مغرب کے وقت، خاندان اکثر افطار کرنے کے لیے جمع ہوتے ہیں۔ روایتی طور پر خاندان پانی پینے، پھر تین خشک کھجور کے پھلوں اور ایک کثیر نصابی کھانے سے افطار کرتے ہیں۔ نئی رمضانٹی وی سیریز دیکھنے کے بعد، مرد (اور کچھ خواتین) کافی شاپس پر جاتے ہیں جہاں وہ کافی پیتے ہیں، اور رات گئے تک دوستوں کے ساتھ سگریٹ نوشی کرتے ہیں۔

حالانکہ حالیہ برسوں میں بہت سے لوگوں نے روزہ رکھنا چھوڑ دیا ہے، اور منافقت، جرائم کی بڑھتی ہوئی شرح، اور بدتمیزی جو کہ مہینے بھر میں پھیلی ہوئی ہے، کی وجہ سے بند ہو گئے ہیں، دوسرے لوگ اِس دوران دین کے بارے میں زیادہ سنجیدہ ہو گئے ہیں۔ بہت سے لوگ مغرب کی نماز میں شرکت کرتے ہیں اور دیگر فرضی نمازیں ادا کرتے ہیں۔ کچھ تو پورا قرآن شریف بھی پڑھتے ہیں (بائبل مقدس کی لمبائی کا دسواں حصہ)۔ یہ مخلصانہ تلاش ہمارے لیے اُن کے لیے دعا کرنے کا ایک کلیدی وقت بناتی ہے۔`,
    hi: `रमज़ान इस्लाम की पाँच शर्तों (या स्तम्भों) में से एक है। इसके 30 दिनों में से प्रत्येक दिन में मुस्लमानों को सुबह से लेकर शाम तक रोज़ा यानी उपवास रखना अनिवार्य होता है। इस दौरान उन्हें भोजन, तरल पदार्थ पीने, धूम्रपान और यौन सम्बन्धों से दूर रहना होता है।

महिलाएँ आमतौर पर दोपहर का समय एक साथ बहुत सारा भोजन तैयार करने में बिताती हैं। सूर्यास्त के समय, परिवार अक्सर रोज़ा खोलने के लिए इकट्ठा होते हैं। परम्परागत रूप से परिवार पानी पीकर, फिर तीन सूखे खजूर और कई तरह के भोजन खाकर रोज़ा खोलते हैं। नई रमजान टीवी कार्यक्रम श्रृंखला को देखने के बाद, पुरुष (और कुछ महिलाएँ) कॉफ़ी की दुकान में जाते हैं, जहाँ वे कॉफ़ी पीते हैं और देर रात तक दोस्तों के साथ धूम्रपान करते हैं।

हालाँकि हाल के वर्षों में बहुत से लोगों ने रोज़ा रखना छोड़ दिया है, और पाखण्ड, बढ़ती अपराध दर और महीने भर व्याप्त रहने वाले असभ्य व्यवहार से उनकी रुचि इसमें नहीं रही, अन्य लोग इस समय के दौरान धर्म के प्रति अधिक गम्भीर हो जाते हैं। कई लोग शाम की नमाज़ों में शामिल होते हैं और अन्य विधिवत् रीति से दुआएँ करते हैं। कुछ तो पूरी कुरान को भी पढ़ते हैं (जो बाइबल की लम्बाई का लगभग दसवाँ भाग है)। उनकी यह ईमानदारी से की जाने वाली खोज इस समय को हमारे लिए उनके लिए प्रार्थना करने का एक रणनीतिक समय बना देती है।`,
    ne: `रमजान इस्लामको पाँच आवश्यकता (वा स्तम्भ) मध्ये एक हो। यसको प्रत्येक ३० दिनमा, मुस्लिमहरू बिहानदेखि सूर्यास्तसम्म उपवास बस्न बाध्य छन्। यस अवधिमा उनीहरूले खाना, पिउने तरल पदार्थ, धुम्रपान र यौनसम्पर्कबाट टाढा रहनुपर्छ।

महिलाहरू सामान्यतया दिउँसो ठूलो खाना तयार गर्न बिताउँछन्। सूर्यास्तमा, परिवारहरू प्रायः व्रत तोड्न भेला हुन्छन्। परम्परागत रूपमा परिवारहरूले पानी पिएर, त्यसपछि तीनवटा सुकेको खजूर, र बहु-पाठ्यक्रम भोजनको साथ उपवास तोड्छन्। नयाँ रमजान टिभी शृङ्खला हेरेपछि, पुरुषहरू (र केही महिलाहरू) कफी पसलहरूमा जान्छन् जहाँ उनीहरू कफी पिउँछन्, र साथीहरूसँग राती अबेरसम्म धुम्रपान गर्छन्।

यद्यपि हालैका वर्षहरूमा धेरैले उपवास छोडेका छन्, र कपट, बढ्दो अपराध दर, र महिनाभर व्याप्त हुने असभ्यताले विरक्त भएका छन्, तर अरूहरू यस समयमा धर्मप्रति बढी गम्भीर भएका छन्। धेरैजना साँझको प्रार्थना सेवाहरूमा उपस्थित हुन्छन् र अन्य धार्मिक प्रार्थनाहरू गर्छन्। कसै-कसैले पूरै कुरान (बाइबलको दशौं भाग लम्बाइ) पनि पढ्छन्। यो निष्कपट खोजले हाम्रो लागि तिनीहरूको लागि प्रार्थना गर्ने रणनीतिक समय बनाउँछ।`,
    id: `Ramadhan adalah salah satu dari lima persyaratan (atau rukun) Islam. Dalam setiap 30 harinya, umat Islam wajib berpuasa dari terbit fajar hingga terbenamnya matahari. Selama masa ini mereka seharusnya tidak makan, minum, merokok, dan melakukan hubungan seksual.

Wanita biasanya menghabiskan sore hari untuk menyiapkan makanan besar. Saat matahari terbenam, keluarga sering berkumpul untuk berbuka puasa. Secara tradisional, keluarga berbuka puasa dengan segelas air, kemudian tiga buah kurma kering, dan hidangan multi-hidangan. Setelah menonton serial TV Ramadhan yang baru, para pria (dan beberapa wanita) pergi ke kedai kopi untuk minum kopi, dan merokok bersama teman-temannya hingga larut malam.

Meskipun banyak yang berhenti berpuasa dalam beberapa tahun terakhir, dan merasa tidak suka dengan kemunafikan, meningkatnya angka kejahatan, dan kekasaran yang merajalela sepanjang bulan ini, ada pula yang menjadi lebih serius terhadap agama selama ini. Banyak yang menghadiri ibadah salat magrib dan melaksanakan salat sunnah lainnya. Beberapa bahkan membaca seluruh Al-Quran (kira-kira sepersepuluh panjang Alkitab). Pencarian tulus ini menjadikannya saat yang strategis bagi kita untuk mendoakan mereka.`,
    ko: `라마단은 이슬람의 다섯 가지 요건(또는 기둥) 중 하나입니다. 30일 동안 무슬림은 새벽부터 일몰까지 금식할 의무가 있습니다. 이 기간 동안에는 음식, 음료수, 흡연, 성관계를 삼가야 합니다.

여성들은 보통 오후에 큰 식사를 준비합니다. 해가 지면 가족들은 종종 금식을 깨기 위해 모입니다. 전통적으로 가족들은 물 한 잔과 말린 대추야자 과일 세 개, 코스 요리로 금식을 합니다. 새로운 라마단 TV 시리즈를 시청한 후 남성(및 일부 여성)은 커피숍에 나가 커피를 마시며 밤늦게까지 친구들과 담배를 피웁니다.

최근 몇 년 동안 많은 사람들이 금식을 중단하고 이 기간 동안 만연하는 위선, 범죄율 증가, 무례함에 실망했지만, 이 기간 동안 종교에 대해 더 진지해진 사람들도 있습니다. 많은 사람들이 저녁 기도회에 참석하고 다른 의식 기도를 합니다. 심지어 어떤 사람들은 성경의 10분의 1에 해당하는 꾸란 전체를 읽기도 합니다. 이러한 진지한 구도 덕분에 우리는 그들을 위해 기도할 수 있는 전략적인 시간이 되었습니다.`,
    vi: `Ramadan là một trong năm yêu cầu (hay trụ cột) của đạo Hồi. Trong mỗi 30 ngày của nó, người Hồi giáo có nghĩa vụ nhịn ăn từ bình minh cho đến khi mặt trời lặn. Trong thời gian này, họ phải kiêng ăn, uống chất lỏng, hút thuốc và quan hệ tình dục.

     Phụ nữ thường dành các buổi chiều để chuẩn bị một bữa ăn thịnh soạn. Vào lúc hoàng hôn, các gia đình thường tụ tập để phá cỗ. Theo truyền thống, các gia đình thường ăn chay bằng một ly nước lọc, sau đó là ba quả chà là khô và một bữa ăn nhiều món. Sau khi xem bộ phim truyền hình Ramadan mới, đàn ông (và một số phụ nữ) ra quán cà phê uống cà phê và hút thuốc với bạn bè cho đến tận khuya.

     Mặc dù nhiều người đã ngừng nhịn ăn trong những năm gần đây, và bị tắt bởi thói đạo đức giả, tỷ lệ tội phạm gia tăng và sự thô lỗ lan tràn trong tháng, những người khác đã trở nên nghiêm túc hơn với tôn giáo trong thời gian này. Nhiều người tham dự các buổi cầu nguyện buổi tối và thực hiện các nghi lễ cầu nguyện khác. Một số thậm chí còn đọc toàn bộ Kinh Qur'an (độ dài bằng 1/10 Kinh thánh). Sự tìm kiếm chân thành này khiến chúng ta trở thành thời điểm chiến lược để cầu nguyện cho họ.`,
    'zh-hans': `斋月是伊斯兰教的五个要求（或支柱）之一。在其 30 天的每一天中，穆斯林都有义务从黎明到日落禁食。在此期间，他们应该避免食物、饮用液体、吸烟和性关系。

女性通常会在下午准备一顿大餐。日落时分，家人经常聚在一起开斋。传统上，这些家庭以喝水、然后是三个干枣和一顿多道菜的方式来开斋。看完新的斋月电视剧后，男人（和一些女人）会去咖啡店喝咖啡，和朋友一起抽烟直到深夜。

尽管近年来许多人已经停止禁食，并且被这个月普遍存在的虚伪、犯罪率上升和粗鲁无礼所打动，但其他人在这段时间里对宗教变得更加认真。许多人参加晚间祈祷服务并进行其他仪式祈祷。有些人甚至阅读了整本古兰经（大约是圣经长度的十分之一）。这种真诚的寻求给与我们为他们祈祷的战略时机。`,
    'zh-hant': `齋月是伊斯蘭教的五個要求（或支柱）之一。在其 30 天的每一天中，穆斯林都有義務從黎明到日落禁食。在此期間，他們應該避免食物、飲用液體、吸煙和性關係。

女性通常會在下午準備一頓大餐。日落時分，家人經常聚在一起開齋。傳統上，這些家庭以喝水、然後是三個乾棗和一頓多道菜的方式來開齋。看完新的齋月電視劇後，男人（和一些女人）會去咖啡店喝咖啡，和朋友一起抽煙直到深夜。

儘管近年來許多人已經停止了禁食，並且被這個月普遍存在的虛偽、犯罪率上升和粗魯無禮所打動，但其他人在這段時間裡對宗教變得更加認真。許多人參加晚間祈禱服務並進行其他儀式祈禱。有些人甚至閱讀了整本古蘭經（大約是聖經長度的十分之一）。這種真誠的尋求使我們成為為他們祈禱的戰略時機。`
  }
}

// The text about praying together on every campaign's About page, whatever its template.
const TOGETHER: Record<string, string> = {
  en: "When we pray together, no one carries the burden alone. One person prays in the morning, another late at night, and together we keep praying in a way none of us could on our own.\n\nThe first followers of Jesus devoted themselves to praying together (Acts 1:14), and God answered in ways that changed whole cities. Praying for the same people and places, day after day, keeps us faithful and expectant.\n\nPrayer also changes those who pray. As we pray through the prayer guide, God shapes our hearts toward what he cares about, and we grow as disciples who know how to pray for others.",
  es: "Cuando oramos juntos, nadie lleva la carga solo. Una persona ora por la mañana, otra tarde en la noche, y juntos seguimos orando de una manera que ninguno de nosotros podría sostener por su cuenta.\n\nLos primeros seguidores de Jesús se dedicaban a orar juntos (Hechos 1:14), y Dios respondió de maneras que transformaron ciudades enteras. Orar por las mismas personas y lugares, día tras día, nos mantiene fieles y expectantes.\n\nLa oración también transforma a quienes oran. Al orar con la guía de oración, Dios moldea nuestro corazón hacia lo que a él le importa, y crecemos como discípulos que saben orar por otros.",
  fr: "Quand nous prions ensemble, personne ne porte le fardeau seul. L’un prie le matin, un autre tard le soir, et ensemble nous continuons à prier comme aucun de nous ne le pourrait seul.\n\nLes premiers disciples de Jésus persévéraient ensemble dans la prière (Actes 1.14), et Dieu a répondu d’une manière qui a transformé des villes entières. Prier jour après jour pour les mêmes personnes et les mêmes lieux nous garde fidèles et dans l’attente.\n\nLa prière transforme aussi ceux qui prient. En priant avec le guide de prière, Dieu tourne nos cœurs vers ce qui lui tient à cœur, et nous grandissons comme des disciples qui savent prier pour les autres.",
  pt: "Quando oramos juntos, ninguém carrega o fardo sozinho. Uma pessoa ora de manhã, outra tarde da noite, e juntos continuamos orando de um jeito que nenhum de nós conseguiria sozinho.\n\nOs primeiros seguidores de Jesus se dedicavam a orar juntos (Atos 1:14), e Deus respondeu de maneiras que transformaram cidades inteiras. Orar pelas mesmas pessoas e lugares, dia após dia, nos mantém fiéis e cheios de expectativa.\n\nA oração também transforma quem ora. Ao orar com o guia de oração, Deus molda nosso coração para o que importa a ele, e crescemos como discípulos que sabem orar pelos outros.",
  ar: "عندما نصلي معًا، لا يحمل أحد العبء وحده. يصلي أحدنا في الصباح وآخر في آخر الليل، ومعًا نواصل الصلاة بطريقة لا يقدر عليها أحد منا بمفرده.\n\nكان أتباع يسوع الأوائل يواظبون على الصلاة معًا (أعمال الرسل 1: 14)، فاستجاب الله بطرق غيّرت مدنًا بأكملها. والصلاة يومًا بعد يوم من أجل الأشخاص والأماكن نفسها تحفظنا أمناء ومترقبين.\n\nوالصلاة تغيّر أيضًا من يصلّي. فبينما نصلي مع دليل الصلاة، يوجّه الله قلوبنا نحو ما يهمه، وننمو كتلاميذ يعرفون كيف يصلّون من أجل الآخرين."
}

// The template's text in a language, or in the fallback language when it
// has none in that one; null when the template has none.
export function templateDoc(kind: TemplateText, templateKey: string | null | undefined, lang: string, fallback?: string): TiptapDoc | null {
  const key = templateKey ?? ''
  const one = (l: string): TiptapDoc | null => {
    if (kind === 'why') return WHY[key]?.(l) ?? null
    const text = kind === 'together' ? TOGETHER[l] : ABOUT[key]?.[l]
    return text ? textDoc(text) : null
  }
  return one(lang) ?? (fallback ? one(fallback) : null)
}

// Whether a doc still holds the template's text for that language unchanged.
export function isTemplateDoc(kind: TemplateText, doc: TiptapDoc | null | undefined, templateKey: string | null | undefined, lang: string): boolean {
  const standard = templateDoc(kind, templateKey, lang)
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
  return !!standard && !!doc && squash(tiptapToText(doc)) === squash(tiptapToText(standard))
}

// The text visitors see in a language: the site's own text in that language
// or its default language, else the template's text, else the site's own
// text in any language.
export function landingDoc(kind: TemplateText, own: Record<string, TiptapDoc> | undefined, templateKey: string | null | undefined, lang: string, defaultLang: string): TiptapDoc | null {
  const written = Object.fromEntries(Object.entries(own ?? {}).filter(([, doc]) => !isEmptyDoc(doc)))
  return written[lang] ?? written[defaultLang] ?? templateDoc(kind, templateKey, lang, defaultLang) ?? Object.values(written)[0] ?? null
}
