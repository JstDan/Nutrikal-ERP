import { getDict, isLocale, type AnyLocale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

// The customer panel speaks the languages of the open catalog. Bulgarian and English sit in bg.ts and en.ts.
// Invoices stay in their own language (Bulgarian or English), as they were issued.

type Status = Dict["enums"]["orderStatus"];
export type PortalText = Omit<Dict["portal"], "staff"> & { status: Status };
export type PortalDict = { portal: PortalText };

export const PORTAL_LOCALE_COOKIE = "nk_portal_locale";
export const isPortalLocale = (v: unknown): v is AnyLocale => isLocale(v) || v === "de" || v === "fr" || v === "it" || v === "ro" || v === "el";

const de: PortalText = {
  title: "Kundenbereich",
  noAccess: "Dieses Konto hat keinen Zugang zum Kundenbereich. Bitte kontaktieren Sie Nutrikal.",
  signOut: "Abmelden",
  welcome: "Willkommen, {name}",
  lead: "Alles zu Ihren Bestellungen an einem Ort.",
  language: "Sprache",
  tiles: { orders: "Aktive Bestellungen", balance: "Offener Betrag", documents: "Dokumente", messages: "Neue Nachrichten", onOrders: "{amount} offen aus Bestellungen" },
  trust: { gmp: "GMP- und HACCP-zertifizierte Produktion", trace: "Jede Charge rückverfolgbar", team: "Ein echtes Team hinter Ihrer Marke" },
  next: {
    title: "Wie es weitergeht",
    confirmed: "Wir bereiten die Materialien vor und planen Ihre Produktion.",
    in_production: "Ihre Charge wird hergestellt. Danach folgt die Qualitätsprüfung.",
    ready: "Ihre Charge ist fertig und wird für den Versand vorbereitet.",
    dispatched: "Ihre Bestellung ist unterwegs.",
    closed: "Diese Bestellung ist abgeschlossen. Vielen Dank.",
  },
  help: { title: "Brauchen Sie Hilfe?", text: "Unser Team ist für Sie da.", write: "Schreiben Sie uns" },
  nav: { home: "Übersicht", orders: "Bestellungen", documents: "Dokumente", invoices: "Rechnungen", support: "Support", account: "Konto" },
  home: { openBalance: "Offener Betrag", viewAll: "Alle ansehen", activeOrders: "Aktive Bestellungen", noOrders: "Noch keine Bestellungen.", unread: "{n} neu", recentDocuments: "Neueste Dokumente" },
  order: {
    window: "Voraussichtlich fertig: Woche {from}–{to}",
    due: "Noch zu zahlen (inkl. MwSt.)",
    proforma: "Proforma-Rechnung", finalProforma: "Endgültige Proforma-Rechnung", deliveryNote: "Lieferschein",
    ref: "Ihre Referenz: {ref}", value: "Bestellwert (ohne MwSt.)", requested: "Wunschtermin", progress: "Fortschritt", products: "Produkte",
    batches: "Chargen", units: "Stück", produced: "Hergestellt", expires: "Mindestens haltbar bis", coa: "Analysenzertifikat", released: "Freigegeben", inReview: "In der Qualitätsprüfung",
    shipments: "Sendungen", tracking: "Sendungsverfolgung", noTracking: "Noch keine Sendungsnummer", documents: "Dokumente", invoices: "Rechnungen", messages: "Nachrichten zu dieser Bestellung",
  },
  steps: { confirmed: "Bestellung bestätigt", deposit: "Anzahlung erhalten", production: "In Produktion", ready: "Versandbereit", dispatched: "Versendet" },
  docs: {
    title: "Dokumente", intro: "Produktdokumente, die unser Team mit Ihnen geteilt hat.", empty: "Noch keine Dokumente.",
    coa: "Analysenzertifikat, Charge {lot}", order: "Bestellung {code}", general: "Allgemein",
  },
  invoices: {
    title: "Rechnungen", empty: "Noch keine Rechnungen.", due: "Fällig", open: "Offen", paid: "Bezahlt",
    pdf: "PDF herunterladen", print: "Drucken", pdfFailed: "Das PDF konnte nicht erstellt werden.",
    kinds: { invoice: "Rechnung", credit_note: "Gutschrift", debit_note: "Belastungsanzeige" },
  },
  support: {
    conversations: "Ihre Unterhaltungen", states: { open: "Wir kümmern uns darum", waiting: "Beantwortet", solved: "Gelöst" },
    title: "Support", intro: "Schreiben Sie unserem Team. Zu einer bestimmten Bestellung nutzen Sie bitte die Nachrichten in dieser Bestellung.", empty: "Noch keine Nachrichten.",
    placeholder: "Ihre Nachricht", send: "Senden", you: "Sie", team: "Nutrikal", busy: "Zu viele Nachrichten. Bitte versuchen Sie es später erneut.",
    failed: "Die Nachricht konnte nicht gesendet werden.", other: "Sie erreichen uns auch über",
  },
  account: {
    title: "Konto", newPassword: "Neues Passwort", repeat: "Passwort wiederholen", save: "Passwort ändern", saved: "Passwort geändert.",
    short: "Mindestens 10 Zeichen verwenden.", mismatch: "Die Passwörter stimmen nicht überein.", failed: "Das Passwort konnte nicht geändert werden.", liveOnly: "Nur auf der Live-Website verfügbar.",
  },
  status: { draft: "Entwurf", unpaid: "Unbezahlt", confirmed: "Bestätigt", in_production: "In Produktion", ready: "Bereit", dispatched: "Versendet", closed: "Abgeschlossen", cancelled: "Storniert" },
};

const fr: PortalText = {
  title: "Espace client",
  noAccess: "Ce compte n'a pas accès à l'espace client. Veuillez contacter Nutrikal.",
  signOut: "Se déconnecter",
  welcome: "Bienvenue, {name}",
  lead: "Tout sur vos commandes, au même endroit.",
  language: "Langue",
  tiles: { orders: "Commandes en cours", balance: "Montant dû", documents: "Documents", messages: "Nouveaux messages", onOrders: "{amount} à payer sur commandes" },
  trust: { gmp: "Site de production certifié GMP et HACCP", trace: "Chaque lot est traçable", team: "Une vraie équipe derrière votre marque" },
  next: {
    title: "La suite",
    confirmed: "Nous préparons les matières et planifions votre production.",
    in_production: "Votre lot est en fabrication. Il passera ensuite le contrôle qualité.",
    ready: "Votre lot est prêt et préparé pour l'expédition.",
    dispatched: "Votre commande est en route.",
    closed: "Cette commande est terminée. Merci.",
  },
  help: { title: "Besoin d'aide ?", text: "Notre équipe est là pour vous.", write: "Écrivez-nous" },
  nav: { home: "Aperçu", orders: "Commandes", documents: "Documents", invoices: "Factures", support: "Assistance", account: "Compte" },
  home: { openBalance: "Montant dû", viewAll: "Tout voir", activeOrders: "Commandes en cours", noOrders: "Aucune commande pour le moment.", unread: "{n} nouveau(x)", recentDocuments: "Derniers documents" },
  order: {
    window: "Prêt prévu : semaine {from}–{to}",
    due: "Reste à payer (TTC)",
    proforma: "Facture proforma", finalProforma: "Facture proforma finale", deliveryNote: "Bon de livraison",
    ref: "Votre référence : {ref}", value: "Valeur de la commande (HT)", requested: "Date souhaitée", progress: "Avancement", products: "Produits",
    batches: "Lots", units: "unités", produced: "Fabriqué le", expires: "À consommer de préférence avant", coa: "Certificat d'analyse", released: "Libéré", inReview: "En contrôle qualité",
    shipments: "Expéditions", tracking: "Suivi", noTracking: "Pas encore de numéro de suivi", documents: "Documents", invoices: "Factures", messages: "Messages sur cette commande",
  },
  steps: { confirmed: "Commande confirmée", deposit: "Acompte reçu", production: "En production", ready: "Prête à expédier", dispatched: "Expédiée" },
  docs: {
    title: "Documents", intro: "Les documents produits partagés par notre équipe.", empty: "Aucun document pour le moment.",
    coa: "Certificat d'analyse, lot {lot}", order: "Commande {code}", general: "Général",
  },
  invoices: {
    title: "Factures", empty: "Aucune facture pour le moment.", due: "Échéance", open: "Dû", paid: "Payée",
    pdf: "Télécharger le PDF", print: "Imprimer", pdfFailed: "Le PDF n'a pas pu être créé.",
    kinds: { invoice: "Facture", credit_note: "Avoir", debit_note: "Note de débit" },
  },
  support: {
    conversations: "Vos conversations", states: { open: "Nous nous en occupons", waiting: "Répondu", solved: "Résolu" },
    title: "Assistance", intro: "Écrivez à notre équipe. Pour une commande précise, utilisez les messages de cette commande.", empty: "Aucun message pour le moment.",
    placeholder: "Votre message", send: "Envoyer", you: "Vous", team: "Nutrikal", busy: "Trop de messages pour le moment. Veuillez réessayer plus tard.",
    failed: "Le message n'a pas pu être envoyé.", other: "Vous pouvez aussi nous joindre via",
  },
  account: {
    title: "Compte", newPassword: "Nouveau mot de passe", repeat: "Répéter le mot de passe", save: "Changer le mot de passe", saved: "Mot de passe changé.",
    short: "Utilisez au moins 10 caractères.", mismatch: "Les deux mots de passe diffèrent.", failed: "Le mot de passe n'a pas pu être changé.", liveOnly: "Disponible uniquement sur le site en ligne.",
  },
  status: { draft: "Brouillon", unpaid: "Impayée", confirmed: "Confirmée", in_production: "En production", ready: "Prête", dispatched: "Expédiée", closed: "Clôturée", cancelled: "Annulée" },
};

const it: PortalText = {
  title: "Area clienti",
  noAccess: "Questo account non ha accesso all'area clienti. Contatta Nutrikal.",
  signOut: "Esci",
  welcome: "Benvenuto, {name}",
  lead: "Tutto sui tuoi ordini, in un unico posto.",
  language: "Lingua",
  tiles: { orders: "Ordini attivi", balance: "Importo da pagare", documents: "Documenti", messages: "Nuovi messaggi", onOrders: "{amount} da pagare sugli ordini" },
  trust: { gmp: "Stabilimento certificato GMP e HACCP", trace: "Ogni lotto è tracciabile", team: "Un vero team dietro il tuo marchio" },
  next: {
    title: "Cosa succede ora",
    confirmed: "Stiamo preparando i materiali e pianificando la produzione.",
    in_production: "Il tuo lotto è in produzione. Poi passerà il controllo qualità.",
    ready: "Il tuo lotto è pronto e in preparazione per la spedizione.",
    dispatched: "Il tuo ordine è in viaggio.",
    closed: "Questo ordine è completato. Grazie.",
  },
  help: { title: "Serve aiuto?", text: "Il nostro team è qui per te.", write: "Scrivici" },
  nav: { home: "Panoramica", orders: "Ordini", documents: "Documenti", invoices: "Fatture", support: "Assistenza", account: "Account" },
  home: { openBalance: "Importo da pagare", viewAll: "Vedi tutti", activeOrders: "Ordini attivi", noOrders: "Ancora nessun ordine.", unread: "{n} nuovi", recentDocuments: "Ultimi documenti" },
  order: {
    window: "Pronto previsto: settimana {from}–{to}",
    due: "Ancora da pagare (IVA inclusa)",
    proforma: "Fattura proforma", finalProforma: "Fattura proforma finale", deliveryNote: "Documento di trasporto",
    ref: "Il tuo riferimento: {ref}", value: "Valore dell'ordine (IVA esclusa)", requested: "Data richiesta", progress: "Avanzamento", products: "Prodotti",
    batches: "Lotti", units: "pezzi", produced: "Prodotto il", expires: "Da consumarsi preferibilmente entro", coa: "Certificato di analisi", released: "Rilasciato", inReview: "In controllo qualità",
    shipments: "Spedizioni", tracking: "Tracciamento", noTracking: "Ancora nessun numero di tracciamento", documents: "Documenti", invoices: "Fatture", messages: "Messaggi su questo ordine",
  },
  steps: { confirmed: "Ordine confermato", deposit: "Acconto ricevuto", production: "In produzione", ready: "Pronto per la spedizione", dispatched: "Spedito" },
  docs: {
    title: "Documenti", intro: "I documenti di prodotto condivisi dal nostro team.", empty: "Ancora nessun documento.",
    coa: "Certificato di analisi, lotto {lot}", order: "Ordine {code}", general: "Generale",
  },
  invoices: {
    title: "Fatture", empty: "Ancora nessuna fattura.", due: "Scadenza", open: "Da pagare", paid: "Pagata",
    pdf: "Scarica il PDF", print: "Stampa", pdfFailed: "Non è stato possibile creare il PDF.",
    kinds: { invoice: "Fattura", credit_note: "Nota di credito", debit_note: "Nota di debito" },
  },
  support: {
    conversations: "Le tue conversazioni", states: { open: "Ce ne stiamo occupando", waiting: "Risposto", solved: "Risolto" },
    title: "Assistenza", intro: "Scrivi al nostro team. Per un ordine specifico usa i messaggi di quell'ordine.", empty: "Ancora nessun messaggio.",
    placeholder: "Scrivi il tuo messaggio", send: "Invia", you: "Tu", team: "Nutrikal", busy: "Troppi messaggi al momento. Riprova più tardi.",
    failed: "Non è stato possibile inviare il messaggio.", other: "Puoi contattarci anche su",
  },
  account: {
    title: "Account", newPassword: "Nuova password", repeat: "Ripeti la password", save: "Cambia password", saved: "Password cambiata.",
    short: "Usa almeno 10 caratteri.", mismatch: "Le due password sono diverse.", failed: "Non è stato possibile cambiare la password.", liveOnly: "Disponibile solo sul sito online.",
  },
  status: { draft: "Bozza", unpaid: "Non pagato", confirmed: "Confermato", in_production: "In produzione", ready: "Pronto", dispatched: "Spedito", closed: "Chiuso", cancelled: "Annullato" },
};

const ro: PortalText = {
  title: "Portal clienți",
  noAccess: "Acest cont nu are acces la portalul clienților. Vă rugăm să contactați Nutrikal.",
  signOut: "Deconectare",
  welcome: "Bun venit, {name}",
  lead: "Totul despre comenzile dvs., într-un singur loc.",
  language: "Limbă",
  tiles: { orders: "Comenzi active", balance: "Sumă de plată", documents: "Documente", messages: "Mesaje noi", onOrders: "{amount} de plată pe comenzi" },
  trust: { gmp: "Unitate de producție certificată GMP și HACCP", trace: "Fiecare lot este trasabil", team: "O echipă reală în spatele mărcii dvs." },
  next: {
    title: "Ce urmează",
    confirmed: "Pregătim materialele și planificăm producția.",
    in_production: "Lotul dvs. este în producție. Apoi urmează controlul calității.",
    ready: "Lotul dvs. este gata și se pregătește pentru expediere.",
    dispatched: "Comanda dvs. este pe drum.",
    closed: "Această comandă este finalizată. Vă mulțumim.",
  },
  help: { title: "Aveți nevoie de ajutor?", text: "Echipa noastră este aici pentru dvs.", write: "Scrieți-ne" },
  nav: { home: "Prezentare", orders: "Comenzi", documents: "Documente", invoices: "Facturi", support: "Asistență", account: "Cont" },
  home: { openBalance: "Sumă de plată", viewAll: "Vezi tot", activeOrders: "Comenzi active", noOrders: "Încă nu există comenzi.", unread: "{n} noi", recentDocuments: "Ultimele documente" },
  order: {
    window: "Gata estimat: săptămâna {from}–{to}",
    due: "Rămas de plată (cu TVA)",
    proforma: "Factură proformă", finalProforma: "Factură proformă finală", deliveryNote: "Aviz de livrare",
    ref: "Referința dvs.: {ref}", value: "Valoarea comenzii (fără TVA)", requested: "Data solicitată", progress: "Progres", products: "Produse",
    batches: "Loturi", units: "buc.", produced: "Produs la", expires: "A se consuma de preferință înainte de", coa: "Certificat de analiză", released: "Eliberat", inReview: "În controlul calității",
    shipments: "Expedieri", tracking: "Urmărire", noTracking: "Încă nu există număr de urmărire", documents: "Documente", invoices: "Facturi", messages: "Mesaje despre această comandă",
  },
  steps: { confirmed: "Comandă confirmată", deposit: "Avans primit", production: "În producție", ready: "Gata de expediere", dispatched: "Expediată" },
  docs: {
    title: "Documente", intro: "Documentele de produs partajate de echipa noastră.", empty: "Încă nu există documente.",
    coa: "Certificat de analiză, lot {lot}", order: "Comanda {code}", general: "General",
  },
  invoices: {
    title: "Facturi", empty: "Încă nu există facturi.", due: "Scadență", open: "De plată", paid: "Plătită",
    pdf: "Descarcă PDF", print: "Tipărește", pdfFailed: "PDF-ul nu a putut fi creat.",
    kinds: { invoice: "Factură", credit_note: "Notă de credit", debit_note: "Notă de debit" },
  },
  support: {
    conversations: "Conversațiile dvs.", states: { open: "Ne ocupăm", waiting: "Răspuns", solved: "Rezolvat" },
    title: "Asistență", intro: "Scrieți echipei noastre. Pentru o anumită comandă, folosiți mesajele din acea comandă.", empty: "Încă nu există mesaje.",
    placeholder: "Scrieți mesajul dvs.", send: "Trimite", you: "Dvs.", team: "Nutrikal", busy: "Prea multe mesaje momentan. Încercați din nou mai târziu.",
    failed: "Mesajul nu a putut fi trimis.", other: "Ne puteți contacta și prin",
  },
  account: {
    title: "Cont", newPassword: "Parolă nouă", repeat: "Repetați parola", save: "Schimbă parola", saved: "Parola a fost schimbată.",
    short: "Folosiți cel puțin 10 caractere.", mismatch: "Cele două parole diferă.", failed: "Parola nu a putut fi schimbată.", liveOnly: "Disponibil doar pe site-ul live.",
  },
  status: { draft: "Ciornă", unpaid: "Neplătită", confirmed: "Confirmată", in_production: "În producție", ready: "Gata", dispatched: "Expediată", closed: "Închisă", cancelled: "Anulată" },
};

const el: PortalText = {
  title: "Πύλη πελατών",
  noAccess: "Αυτός ο λογαριασμός δεν έχει πρόσβαση στην πύλη πελατών. Επικοινωνήστε με τη Nutrikal.",
  signOut: "Αποσύνδεση",
  welcome: "Καλώς ήρθατε, {name}",
  lead: "Όλα για τις παραγγελίες σας, σε ένα σημείο.",
  language: "Γλώσσα",
  tiles: { orders: "Ενεργές παραγγελίες", balance: "Ποσό προς πληρωμή", documents: "Έγγραφα", messages: "Νέα μηνύματα", onOrders: "{amount} προς πληρωμή σε παραγγελίες" },
  trust: { gmp: "Μονάδα παραγωγής με πιστοποίηση GMP και HACCP", trace: "Κάθε παρτίδα είναι ιχνηλάσιμη", team: "Μια πραγματική ομάδα πίσω από το brand σας" },
  next: {
    title: "Τι ακολουθεί",
    confirmed: "Ετοιμάζουμε τα υλικά και προγραμματίζουμε την παραγωγή σας.",
    in_production: "Η παρτίδα σας παράγεται. Στη συνέχεια περνά από έλεγχο ποιότητας.",
    ready: "Η παρτίδα σας είναι έτοιμη και προετοιμάζεται για αποστολή.",
    dispatched: "Η παραγγελία σας είναι καθ' οδόν.",
    closed: "Αυτή η παραγγελία ολοκληρώθηκε. Ευχαριστούμε.",
  },
  help: { title: "Χρειάζεστε βοήθεια;", text: "Η ομάδα μας είναι εδώ για εσάς.", write: "Γράψτε μας" },
  nav: { home: "Επισκόπηση", orders: "Παραγγελίες", documents: "Έγγραφα", invoices: "Τιμολόγια", support: "Υποστήριξη", account: "Λογαριασμός" },
  home: { openBalance: "Ποσό προς πληρωμή", viewAll: "Προβολή όλων", activeOrders: "Ενεργές παραγγελίες", noOrders: "Δεν υπάρχουν ακόμη παραγγελίες.", unread: "{n} νέα", recentDocuments: "Τελευταία έγγραφα" },
  order: {
    window: "Εκτιμώμενη ετοιμότητα: εβδομάδα {from}–{to}",
    due: "Υπόλοιπο πληρωμής (με ΦΠΑ)",
    proforma: "Προτιμολόγιο", finalProforma: "Τελικό προτιμολόγιο", deliveryNote: "Δελτίο αποστολής",
    ref: "Η αναφορά σας: {ref}", value: "Αξία παραγγελίας (χωρίς ΦΠΑ)", requested: "Επιθυμητή ημερομηνία", progress: "Πρόοδος", products: "Προϊόντα",
    batches: "Παρτίδες", units: "τεμ.", produced: "Παραγωγή", expires: "Ανάλωση κατά προτίμηση πριν από", coa: "Πιστοποιητικό ανάλυσης", released: "Εγκρίθηκε", inReview: "Σε έλεγχο ποιότητας",
    shipments: "Αποστολές", tracking: "Παρακολούθηση", noTracking: "Δεν υπάρχει ακόμη αριθμός παρακολούθησης", documents: "Έγγραφα", invoices: "Τιμολόγια", messages: "Μηνύματα για αυτή την παραγγελία",
  },
  steps: { confirmed: "Η παραγγελία επιβεβαιώθηκε", deposit: "Η προκαταβολή ελήφθη", production: "Σε παραγωγή", ready: "Έτοιμη για αποστολή", dispatched: "Απεστάλη" },
  docs: {
    title: "Έγγραφα", intro: "Τα έγγραφα προϊόντων που μοιράστηκε μαζί σας η ομάδα μας.", empty: "Δεν υπάρχουν ακόμη έγγραφα.",
    coa: "Πιστοποιητικό ανάλυσης, παρτίδα {lot}", order: "Παραγγελία {code}", general: "Γενικά",
  },
  invoices: {
    title: "Τιμολόγια", empty: "Δεν υπάρχουν ακόμη τιμολόγια.", due: "Λήξη", open: "Οφειλόμενο", paid: "Πληρώθηκε",
    pdf: "Λήψη PDF", print: "Εκτύπωση", pdfFailed: "Δεν ήταν δυνατή η δημιουργία του PDF.",
    kinds: { invoice: "Τιμολόγιο", credit_note: "Πιστωτικό σημείωμα", debit_note: "Χρεωστικό σημείωμα" },
  },
  support: {
    conversations: "Οι συνομιλίες σας", states: { open: "Το φροντίζουμε", waiting: "Απαντήθηκε", solved: "Επιλύθηκε" },
    title: "Υποστήριξη", intro: "Γράψτε στην ομάδα μας. Για συγκεκριμένη παραγγελία, χρησιμοποιήστε τα μηνύματα της παραγγελίας.", empty: "Δεν υπάρχουν ακόμη μηνύματα.",
    placeholder: "Γράψτε το μήνυμά σας", send: "Αποστολή", you: "Εσείς", team: "Nutrikal", busy: "Πάρα πολλά μηνύματα προς το παρόν. Δοκιμάστε ξανά αργότερα.",
    failed: "Δεν ήταν δυνατή η αποστολή του μηνύματος.", other: "Μπορείτε να επικοινωνήσετε μαζί μας και μέσω",
  },
  account: {
    title: "Λογαριασμός", newPassword: "Νέος κωδικός", repeat: "Επαναλάβετε τον κωδικό", save: "Αλλαγή κωδικού", saved: "Ο κωδικός άλλαξε.",
    short: "Χρησιμοποιήστε τουλάχιστον 10 χαρακτήρες.", mismatch: "Οι δύο κωδικοί διαφέρουν.", failed: "Δεν ήταν δυνατή η αλλαγή του κωδικού.", liveOnly: "Διαθέσιμο μόνο στον ζωντανό ιστότοπο.",
  },
  status: { draft: "Πρόχειρη", unpaid: "Απλήρωτη", confirmed: "Επιβεβαιωμένη", in_production: "Σε παραγωγή", ready: "Έτοιμη", dispatched: "Απεστάλη", closed: "Ολοκληρώθηκε", cancelled: "Ακυρώθηκε" },
};

const others = { de, fr, it, ro, el };

export function portalDict(locale: AnyLocale): PortalDict {
  if (isLocale(locale)) {
    const t = getDict(locale);
    return { portal: { ...t.portal, status: t.enums.orderStatus } };
  }
  return { portal: others[locale] };
}
