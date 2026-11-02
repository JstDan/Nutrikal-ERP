# Onboarding videos — storyboard

The text of every caption and card. Edit the Bulgarian (and English) text here
and run `npm run onboarding:record` again; the scripts in `videos/` refer to the
rows by their `id` only.

- One `## <video>` section per video; the `id` column must not be changed
  (the script looks the row up by it).
- Cards: the text before ` — ` is the title, the rest is the subtitle.
  On the recap card the items after ` — ` are separated by `;`.
- Bulgarian is burned into the video and saved as `<video>.bg.srt`; English is
  saved as `<video>.en.srt`. Both are in `<video>.captions.json` for a later voiceover.
- Do not use `|` inside a cell.

## sales

Търговец (sales), ~3–4 минути.

| id | Български | English |
|---|---|---|
| title | Търговец — Клиенти, калкулатор, оферти и поръчки в Nutrikal ERP | Sales — Clients, calculator, offers and orders in Nutrikal ERP |
| ch-start | Първи стъпки — Менюто, езикът и търсенето | First steps — The menu, language and search |
| home | Таблото: отворени поръчки, производство и вашите задачи на едно място. | The dashboard: open orders, production and your tasks in one place. |
| menu | Вляво е менюто: Клиенти, Калкулатор, Оферти, Поръчки и Фактури. | The menu on the left: Clients, Calculator, Offers, Orders and Invoices. |
| lang | Езикът се сменя с БГ / EN горе вдясно и се запомня за вас. | Switch the language with БГ / EN at the top right; it is remembered for you. |
| search | Търсенето горе намира клиенти по име или код. | The search at the top finds clients by name or code. |
| ch-clients | Клиенти — Нов клиент и картата на клиента | Clients — A new client and the client card |
| clients | Списъкът с клиенти. Нов клиент се добавя с бутона горе. | The client list. Add a new client with the button at the top. |
| client-new | Задължителни са само името и имейлът на лицето за контакт; останалото може да се попълни по-късно. | Only the contact's name and e-mail are required; the rest can be filled in later. |
| client-save | „Създай клиент“ записва клиента и отваря картата му. | “Create client” saves the client and opens its card. |
| client-card | В картата: фирмени данни и условия, контакти, поръчки и активност. | The card: company data and terms, contacts, orders and activity. |
| ch-calc | Калкулатор — Къстъм формула | Calculator — A custom formula |
| calc-mode | Къстъм формула: рецепта от суровините в ценовата листа. | Custom formula: a recipe from the raw materials of the price list. |
| calc-client | Изберете клиента и дайте работно име на продукта. | Pick the client and give the product a working name. |
| calc-type | Вид продукт: капсули в стъклен или пластмасов буркан, или прах в дойпак. | Product type: capsules in a glass or plastic jar, or powder in a doypack. |
| calc-lid | За капсулите изберете капачката: пластмасова или алуминиева. | For capsules choose the lid: plastic or aluminium. |
| calc-materials | Суровините се търсят по част от името; цената за кг идва от ценовата листа. | Search raw materials by part of the name; the price per kg comes from the price list. |
| calc-caps | Капсули в доза — колко капсули прави една доза (капсула размер 00). | Capsules per dose — how many capsules make one dose (size 00 capsule). |
| calc-qty | Капсули в буркан и брой буркани за поръчката. | Capsules per jar and the number of jars for the order. |
| calc-markup | Надценката по подразбиране е 30 %; може да се промени. | The default markup is 30 %; you can change it. |
| calc-tiers | Ценовите нива дават цена и за други количества, всяко със своя надценка. | Price tiers give a price for other quantities, each with its own markup. |
| calc-results | Вътрешната разбивка показва разходите — тя не излиза в офертата към клиента. | The internal breakdown shows the costs — it never goes on the client's offer. |
| calc-summary | Това вижда клиентът: продукт, опаковка и цена за брой. | This is what the client sees: product, packaging and unit price. |
| calc-save | „Създай оферта“ записва офертата с пореден номер. | “Create offer” saves the offer with the next number. |
| ch-offer | Офертата — PDF и рецепта | The offer — PDF and recipe |
| offer-page | Офертата е записана. От нея се изтегля PDF за клиента. | The offer is saved. Download the PDF for the client from here. |
| offer-pdf | PDF-ът е на английски и е готов за изпращане. | The PDF is in English and ready to send. |
| offer-recipe | От офертата автоматично се създава чернова на рецепта за производството. | A draft recipe for production is created from the offer automatically. |
| offer-list | Всички оферти от калкулатора са в „Оферти“: редакция, PDF и изтриване. | All calculator offers are under “Offers”: edit, PDF and delete. |
| ch-catalog | Калкулатор — Каталожна формула | Calculator — A catalog formula |
| cat-mode | Каталожна формула: готов продукт от каталога с цена за брой според количеството. | Catalog formula: a ready product from the catalog, priced per unit by quantity. |
| cat-product | Търсете продукта по код, име или категория. | Search the product by code, name or category. |
| cat-caps | Броят капсули в бурканче променя цената; таблицата показва цените по количество. | The number of capsules per jar changes the price; the table shows prices by quantity. |
| cat-edit | „Промени съставките“ прехвърля състава в къстъм формула, за да го промените. | “Change ingredients” copies the composition into a custom formula for editing. |
| ch-order | Поръчка — От оферта до проформа | Order — From offer to proforma |
| order-client | Нова поръчка: изберете клиент, който има оферта. | New order: pick a client that has an offer. |
| order-offer | Отметнете офертите, които влизат в поръчката. | Tick the offers that go into the order. |
| order-services | Допълнителните услуги се добавят с отметка — например Free Sale Certificate. | Add extra services with a tick — for example a Free Sale Certificate. |
| order-create | „Създай поръчка“ — поръчката започва като неплатена. | “Create order” — the order starts as unpaid. |
| order-page | Следващата стъпка: клиентът плаща проформата, администраторът потвърждава плащането. | Next step: the client pays the proforma, the admin confirms the payment. |
| order-tasks | След потвърждаването на плащането тук се появява таблото със задачите по поръчката. | Once payment is confirmed, the order's task board appears here. |
| order-proforma | „Експорт проформа“ дава проформа фактура за изтегляне или печат. | “Export proforma” gives a proforma invoice to download or print. |
| ch-limits | Какво не вижда търговецът — Покупни цени и доставчици | What sales does not see — Purchase prices and suppliers |
| limits-deliveries | Доставките показват доставчици и покупни цени, затова са скрити за търговеца. | Deliveries show suppliers and purchase prices, so they are hidden from sales. |
| limits-stock | В склада търговецът вижда наличностите, но не и себестойността. | In the stock, sales sees quantities but not the cost. |
| recap | Обобщение — Клиент се създава от „Клиенти“; Офертата се прави в калкулатора; PDF-ът е готов за клиента; Поръчката идва от офертата; Проформата се изтегля от поръчката | Recap — Create clients under “Clients”; Make the offer in the calculator; The PDF is ready for the client; The order comes from the offer; Download the proforma from the order |

## admin

Администратор (admin), ~4 минути. Продължава от поръчката, създадена във видеото за търговеца.

| id | Български | English |
|---|---|---|
| title | Администратор — Плащания, рецепти, производство, покупки и склад | Admin — Payments, recipes, production, purchasing and stock |
| ch-payment | Плащане — Потвърждаване и какво отключва | Payment — Confirming it and what it unlocks |
| orders | Неплатените поръчки чакат администратора да потвърди плащането. | Unpaid orders wait for the admin to confirm the payment. |
| pay-confirm | Когато клиентът плати проформата: „Потвърди първо плащане“. | When the client has paid the proforma: “Confirm first payment”. |
| pay-dialog | Изберете аванс (със сумата) или плащане 100 % и шаблона за задачи на поръчката. | Choose a deposit (with the amount) or 100 % payment, and the order's task template. |
| pay-unlocked | Поръчката е потвърдена: отключват се фактурите, рецептата и планирането на производството. | The order is confirmed: invoices, the recipe and production planning are unlocked. |
| tasks | Таблото със задачи по поръчката; много от тях се отмятат сами, когато стъпката е направена. | The order's task board; many tasks tick themselves when the step is done. |
| ch-recipe | Рецепта — От черновата до одобрена версия | Recipe — From the draft to an approved version |
| recipes | Рецептата е създадена автоматично от офертата като чернова. | The recipe was created from the offer automatically, as a draft. |
| recipe-draft | Съставките на порция идват от офертата. | The ingredients per serving come from the offer. |
| recipe-link | Свържете всяка суровина от офертата с артикул в склада; връзката се запомня за следващите оферти. | Link each raw material of the offer to a stock item; the link is remembered for next offers. |
| recipe-overage | Всяка съставка започва с 5 % брак; той се променя с „Промени“ на реда. | Each ingredient starts with 5 % overage; change it with “Edit” on the line. |
| recipe-capsule | Капсулата идва от офертата — размер 00. | The capsule comes from the offer — size 00. |
| recipe-packaging | Бурканчето и капачката от офертата са в „Опаковка на брой продукт“. | The jar and lid of the offer are under “Packaging per unit”. |
| recipe-stock | „Наличност за N бр.“ показва дали суровините стигат за поръчката. | “Stock for N units” shows whether the raw materials are enough for the order. |
| recipe-checks | Проверките: Novel Food статус, пълнеж на капсулата, алергени. Неразрешена съставка спира одобрението. | The checks: Novel Food status, capsule fill, allergens. A not-authorised ingredient blocks approval. |
| recipe-approve | Само администраторът одобрява версията; одобрената версия вече не се променя. | Only the admin approves the version; an approved version no longer changes. |
| ch-plan | Планиране — Производствена поръчка и резервиране | Planning — Manufacturing order and reservations |
| plan-link | В поръчката изберете одобрената рецепта и я свържете. | In the order, pick the approved recipe and link it. |
| plan-mo | „Планирай производство“ създава производствена поръчка като симулация. | “Plan production” creates a manufacturing order as a simulation. |
| mo-materials | Материалите: какво е нужно, какво има и какво липсва. | The materials: what is needed, what is in stock and what is missing. |
| mo-reserve | „Резервирай свободното“ запазва наличните суровини за тази поръчка. | “Reserve available” sets the available stock aside for this order. |
| mo-request | „Заяви покупка на липсващото“ създава заявки за покупка на това, което не стига. | “Request purchase of shortages” creates purchase requests for what is missing. |
| ch-buy | Покупки — От липсващото до заявка към доставчик | Purchasing — From shortages to a purchase order |
| buy-shortages | В „Доставки“ са всички липсващи суровини: заявки от производството и под минимума. | Under “Deliveries” are all shortages: production requests and items below minimum. |
| buy-tick | Отметнете какво да се поръча и изберете доставчика и цената. | Tick what to order and choose the supplier and price. |
| buy-generate | „Генерирай заявки“ прави по една чернова заявка за всеки доставчик. | “Generate orders” makes one draft purchase order per supplier. |
| po-draft | Черновата заявка може да се промени, преди да се изпрати. | The draft purchase order can be changed before it is sent. |
| po-pdf | PDF на заявката — на английски или на български — за изпращане на доставчика. | The purchase order PDF — in English or Bulgarian — to send to the supplier. |
| po-send | „Изпрати“ заключва заявката и създава очакваните доставки. | “Send” locks the order and creates the expected deliveries. |
| po-new | Празна заявка към доставчик се прави и ръчно с „Нова заявка за доставка“. | An empty purchase order can also be made by hand with “New purchase order”. |
| ch-receive | Приемане — Очаквана доставка става партида | Receiving — An expected delivery becomes a lot |
| receive-list | Очакваните доставки са в „Доставки“; отворете доставката, която е пристигнала. | Expected deliveries are under “Deliveries”; open the one that has arrived. |
| receive-form | Въведете количеството, мястото, партидата на доставчика и срока на годност. | Enter the quantity, location, the supplier's lot and the expiry date. |
| receive-photo | Снимка на товарителницата е задължителна; „Получи“ създава новата партида. | A photo of the waybill is required; “Receive” creates the new lot. |
| ch-release | Към производството — Резервирано, в графика, изпратено | To production — Reserved, scheduled, sent |
| release-reserve | След доставката резервирайте отново — сега всичко е налично. | After the delivery, reserve again — now everything is available. |
| release-schedule | Изберете дата на производство и „Включи в графика“. | Choose the production date and “Add to schedule”. |
| release-send | „Изпрати към производството“ става само когато всичко е резервирано; производството получава известие. | “Send to production” works only when everything is reserved; production is notified. |
| ch-reports | Склад и справки — Наличности, история, счетоводство | Stock and reports — Stock, history, accounting |
| stock | Складът по видове: суровини, опаковки и готова продукция, с партидите. | Stock by type: raw materials, packaging and finished goods, with their lots. |
| stock-count | Инвентаризация: въведете преброеното количество и причината. | Stock count: enter the counted quantity and the reason. |
| corrections | Корекциите на наличност от производството идват тук за преглед. | Stock corrections from production come here for review. |
| history | Историята на промените: кой какво е променил и кога. | The change history: who changed what and when. |
| accounting | Експорт за счетоводството за избран период — в Excel. | The accounting export for a chosen period — in Excel. |
| invoices | Фактурите: авансови и финални, издадени от поръчките. | Invoices: deposit and final invoices, issued from the orders. |
| dashboard | Админ таблото: пари, продажби, склад, покупки и производствени разходи. | The admin dashboard: money, sales, stock, purchasing and production costs. |
| recap | Обобщение — Потвърдете плащането; Одобрете рецептата; Планирайте и резервирайте; Поръчайте липсващото; Приемете доставката със снимка; Изпратете към производството | Recap — Confirm the payment; Approve the recipe; Plan and reserve; Order the shortages; Receive the delivery with a photo; Send to production |

## production

Производство (production), ~3 минути.

| id | Български | English |
|---|---|---|
| title | Производство — Поръчки, отчет, доставки и наличност в портала на цеха | Production — Orders, report, deliveries and stock in the facility portal |
| ch-today | Днес — Какво чака цеха | Today — What is waiting for the facility |
| today | Порталът на производството има само пет страници: Днес, Поръчки, Наличност, Доставки и Известия. | The production portal has only five pages: Today, Orders, Stock, Deliveries and Notifications. |
| today-orders | Поръчките за изпълнение. Проектите се виждат само с код — без клиенти и продажни цени. | Orders to make. Projects show by code only — no clients and no sales prices. |
| today-deliveries | Доставките на път към вашите складове, с доставчика и очакваната дата. | Deliveries on their way to your stores, with the supplier and the expected date. |
| ch-order | Производствена поръчка — Материали и старт | Production order — Materials and start |
| orders | Всички поръчки от Нутрикал. Отворете поръчката в статус „Изчакване“. | All orders from Nutrikal. Open the order with status “Waiting”. |
| order-materials | Материалите: колко е нужно, колко е резервирано и колко вече е при вас. | The materials: how much is needed, how much is reserved and how much is already with you. |
| order-sources | За информация: доставчик, количество, цена и дата на материалите на поръчката. | For information: supplier, quantity, price and date of the order's materials. |
| order-picklist | „Лист за изписване“ — за печат, с партидите за вземане от склада. | “Pick list” — for printing, with the lots to take from the store. |
| order-start | Когато започнете, натиснете „Започни производството“. | When you start, press “Start production”. |
| ch-report | Отчет — Използвано, партида, готово | Report — Used, batch, ready |
| report-intro | За всеки материал: резервираното за справка и реално използваното по партиди, предложени по най-ранен срок. | For each material: the reserved quantity for reference and what was really used, by lot, first expiry first. |
| report-diff | Разлика над 5 % изисква причина. | A difference over 5 % needs a reason. |
| report-batch | Вашият номер на партида, произведените опаковки и датата на производство. | Your batch number, the packs produced and the production date. |
| report-submit | „Готово за изпращане“: материалите се изписват, готовият продукт влиза в PF-QUAR. | “Ready to ship”: the materials are booked out and the finished product goes into PF-QUAR. |
| report-usage | Резервирано срещу използвано — Нутрикал вижда същата справка. | Reserved versus used — Nutrikal sees the same report. |
| invoice | Тук въвеждате вашата фактура за партидата: номер, дата и сума. | Here you enter your invoice for the batch: number, date and amount. |
| ch-deliveries | Доставки — Приемане със снимка | Deliveries — Receiving with a photo |
| deliveries | Всички доставки към вас: поръчано, получено и статус. | All deliveries to you: ordered, received and status. |
| delivery-form | Отворете доставката и попълнете „Маркирай като получена“. | Open the delivery and fill in “Mark as received”. |
| delivery-photo | Снимка на товарителницата е задължителна — от телефона или файл. | A photo of the waybill is required — from the phone or a file. |
| delivery-details | Количеството е попълнено; добавете партидата на доставчика и срока на годност. | The quantity is filled in; add the supplier's lot and the expiry date. |
| delivery-submit | „Получено“ създава нова партида в PF-QUAR и Нутрикал получава известие. | “Received” creates a new lot in PF-QUAR and Nutrikal is notified. |
| ch-stock | Наличност — Търсене и корекция | Stock — Search and correction |
| stock | Всичко във вашите складове, с партидите, сроковете и контрола. | Everything in your stores, with lots, expiry dates and QC status. |
| stock-search | Търсете по партида, партида на доставчика или артикул. | Search by lot, supplier's lot or item. |
| stock-correct | Корекция: изберете партидата, въведете количеството на рафта сега и причината. | Correction: choose the lot, enter the quantity on the shelf now and the reason. |
| stock-save | Разликата се записва в складовия дневник и Нутрикал получава известие. | The difference is written to the stock ledger and Nutrikal is notified. |
| notifications | Известия: нови поръчки и доставки от Нутрикал идват тук и в камбанката горе. | Notifications: new orders and deliveries from Nutrikal arrive here and in the bell at the top. |
| recap | Обобщение — Приемете доставката със снимка; Започнете поръчката; Отчетете използваното по партиди; Причина при разлика над 5 %; Коригирайте наличността с причина | Recap — Receive the delivery with a photo; Start the order; Report what was used by lot; Give a reason for a difference over 5 %; Correct stock with a reason |

## developer

Developer, ~1 минута.

| id | Български | English |
|---|---|---|
| title | Developer — Работа като друг потребител | Developer — Acting as another user |
| switch | Горе вдясно Developer избира потребителя, като когото действа. Всяка страница тогава работи с неговите права. | At the top right the developer picks the user to act as. Every page then runs with that user's rights. |
| as-admin | Като администратор: цялото меню — поръчки, производство, доставки, склад и фактури. | As admin: the whole menu — orders, production, deliveries, stock and invoices. |
| as-sales | Като търговец: клиенти, калкулатор, оферти, поръчки и фактури. | As sales: clients, calculator, offers, orders and invoices. |
| as-production | Като производство: само порталът на цеха, без клиенти и продажни цени. | As production: only the facility portal, without clients and sales prices. |
| logged | Всяка смяна се записва в дневник в базата; правата се проверяват в базата, не в екрана. | Every switch is written to a log in the database; rights are checked in the database, not on the screen. |
| recap | Обобщение — Изберете потребител горе вдясно; Проверете какво вижда всяка роля; Смяната се записва | Recap — Pick a user at the top right; Check what each role sees; The switch is logged |

## overview

Обзор, до 90 секунди.

| id | Български | English |
|---|---|---|
| title | Nutrikal ERP — Как ролите си предават работата | Nutrikal ERP — How the roles hand work to each other |
| sales | Търговецът прави офертата в калкулатора и от нея — поръчката. | Sales makes the offer in the calculator and the order from it. |
| admin | Администраторът потвърждава плащането, одобрява рецептата и планира производството. | The admin confirms the payment, approves the recipe and plans production. |
| admin-buy | Липсващото се поръчва от доставчика; доставката се приема със снимка. | Shortages are ordered from the supplier; the delivery is received with a photo. |
| production | Производството вижда поръчката само по код, произвежда и отчита използваното. | Production sees the order by code only, makes it and reports what was used. |
| back | Готовата партида се връща при администратора за фактура и изпращане. | The finished batch goes back to the admin for invoicing and dispatch. |
| recap | Обобщение — Търговец: оферта и поръчка; Администратор: плащане, рецепта, покупки, план; Производство: производство и отчет; Администратор: фактура и изпращане | Recap — Sales: offer and order; Admin: payment, recipe, purchasing, plan; Production: making and report; Admin: invoice and dispatch |
