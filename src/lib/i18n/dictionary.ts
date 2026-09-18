import type { Locale } from "@/lib/i18n/locales";

/**
 * Guest-facing copy only.
 *
 * Deliberately small and deliberately plain: dates, a room, a price, a name.
 * Every string here is one a hotel guest would recognise in their own
 * language. Nothing from the staff app belongs in this file — see the note in
 * locales.ts for why that line is drawn where it is.
 *
 * Keys are flat and named for what they say, so a missing one is obvious in a
 * diff. English is the fallback for any key a language has not got.
 */
export interface Dict {
  bookARoom: string;
  arrival: string;
  departure: string;
  adults: string;
  children: string;
  search: string;
  searching: string;
  availableRooms: string;
  night: string;
  nights: string;
  sleeps: string;
  totalForStay: string;
  roomsLeft: string;
  soldOut: string;
  noPriceLoaded: string;
  choose: string;
  nothingAvailable: string;
  nothingAvailableHint: string;
  yourDetails: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  phoneOptional: string;
  requests: string;
  requestsHint: string;
  confirmBooking: string;
  sending: string;
  requestReceived: string;
  yourReference: string;
  weWillEmail: string;
  payAtProperty: string;
  bookAnother: string;
  somethingWentWrong: string;
  pickLaterDeparture: string;
  language: string;
  back: string;
  notBookable: string;
  notBookableHint: string;
}

const en: Dict = {
  bookARoom: "Book a room",
  arrival: "Arrival",
  departure: "Departure",
  adults: "Adults",
  children: "Children",
  search: "See available rooms",
  searching: "Looking…",
  availableRooms: "Available rooms",
  night: "night",
  nights: "nights",
  sleeps: "Sleeps",
  totalForStay: "Total for your stay",
  roomsLeft: "left",
  soldOut: "Sold out for these dates",
  noPriceLoaded: "No price for these dates",
  choose: "Choose",
  nothingAvailable: "Nothing available for those dates",
  nothingAvailableHint: "Try different dates, or a shorter stay.",
  yourDetails: "Your details",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  phoneOptional: "optional",
  requests: "Anything we should know",
  requestsHint: "Arrival time, accessibility, a quiet room — anything at all.",
  confirmBooking: "Request this room",
  sending: "Sending…",
  requestReceived: "Thank you — we have your request",
  yourReference: "Your reference",
  weWillEmail: "The hotel will confirm by email shortly.",
  payAtProperty: "Nothing to pay now. You settle at the hotel.",
  bookAnother: "Book another room",
  somethingWentWrong: "That did not work",
  pickLaterDeparture: "Departure must be after arrival.",
  language: "Language",
  back: "Back",
  notBookable: "Online booking is not open yet",
  notBookableHint: "This hotel is not taking bookings on this page at the moment. Please contact us directly and we will be glad to help.",
};

const de: Dict = {
  bookARoom: "Zimmer buchen", arrival: "Anreise", departure: "Abreise",
  adults: "Erwachsene", children: "Kinder", search: "Freie Zimmer anzeigen",
  searching: "Suche…", availableRooms: "Freie Zimmer", night: "Nacht",
  nights: "Nächte", sleeps: "Für", totalForStay: "Gesamt für Ihren Aufenthalt",
  roomsLeft: "übrig", soldOut: "Für diese Daten ausgebucht",
  noPriceLoaded: "Kein Preis für diese Daten", choose: "Auswählen",
  nothingAvailable: "Für diese Daten ist nichts frei",
  nothingAvailableHint: "Versuchen Sie andere Daten oder einen kürzeren Aufenthalt.",
  yourDetails: "Ihre Angaben", firstName: "Vorname", lastName: "Nachname",
  email: "E-Mail", phone: "Telefon", phoneOptional: "optional",
  requests: "Gibt es etwas, das wir wissen sollten",
  requestsHint: "Ankunftszeit, Barrierefreiheit, ein ruhiges Zimmer — alles.",
  confirmBooking: "Dieses Zimmer anfragen", sending: "Wird gesendet…",
  requestReceived: "Vielen Dank — Ihre Anfrage ist eingegangen",
  yourReference: "Ihre Referenz",
  weWillEmail: "Das Hotel bestätigt in Kürze per E-Mail.",
  payAtProperty: "Jetzt ist nichts zu zahlen. Sie zahlen im Hotel.",
  bookAnother: "Weiteres Zimmer buchen", somethingWentWrong: "Das hat nicht geklappt",
  pickLaterDeparture: "Die Abreise muss nach der Anreise liegen.",
  language: "Sprache", back: "Zurück",
  notBookable: "Online-Buchung ist noch nicht möglich",
  notBookableHint: "Dieses Hotel nimmt auf dieser Seite derzeit keine Buchungen entgegen. Bitte kontaktieren Sie uns direkt — wir helfen Ihnen gern.",
};

const fr: Dict = {
  bookARoom: "Réserver une chambre", arrival: "Arrivée", departure: "Départ",
  adults: "Adultes", children: "Enfants", search: "Voir les chambres disponibles",
  searching: "Recherche…", availableRooms: "Chambres disponibles", night: "nuit",
  nights: "nuits", sleeps: "Pour", totalForStay: "Total du séjour",
  roomsLeft: "restantes", soldOut: "Complet pour ces dates",
  noPriceLoaded: "Aucun tarif pour ces dates", choose: "Choisir",
  nothingAvailable: "Rien de disponible pour ces dates",
  nothingAvailableHint: "Essayez d'autres dates ou un séjour plus court.",
  yourDetails: "Vos coordonnées", firstName: "Prénom", lastName: "Nom",
  email: "E-mail", phone: "Téléphone", phoneOptional: "facultatif",
  requests: "Quelque chose à nous signaler",
  requestsHint: "Heure d'arrivée, accessibilité, une chambre calme — tout.",
  confirmBooking: "Demander cette chambre", sending: "Envoi…",
  requestReceived: "Merci — nous avons votre demande",
  yourReference: "Votre référence",
  weWillEmail: "L'hôtel confirmera par e-mail sous peu.",
  payAtProperty: "Rien à payer maintenant. Vous réglez à l'hôtel.",
  bookAnother: "Réserver une autre chambre", somethingWentWrong: "Cela n'a pas fonctionné",
  pickLaterDeparture: "Le départ doit suivre l'arrivée.",
  language: "Langue", back: "Retour",
  notBookable: "La réservation en ligne n'est pas encore ouverte",
  notBookableHint: "Cet hôtel ne prend pas de réservations sur cette page pour le moment. Contactez-nous directement, nous serons ravis de vous aider.",
};

const es: Dict = {
  bookARoom: "Reservar una habitación", arrival: "Llegada", departure: "Salida",
  adults: "Adultos", children: "Niños", search: "Ver habitaciones disponibles",
  searching: "Buscando…", availableRooms: "Habitaciones disponibles", night: "noche",
  nights: "noches", sleeps: "Para", totalForStay: "Total de su estancia",
  roomsLeft: "quedan", soldOut: "Completo para estas fechas",
  noPriceLoaded: "Sin precio para estas fechas", choose: "Elegir",
  nothingAvailable: "Nada disponible para esas fechas",
  nothingAvailableHint: "Pruebe otras fechas o una estancia más corta.",
  yourDetails: "Sus datos", firstName: "Nombre", lastName: "Apellidos",
  email: "Correo electrónico", phone: "Teléfono", phoneOptional: "opcional",
  requests: "Algo que debamos saber",
  requestsHint: "Hora de llegada, accesibilidad, una habitación tranquila — lo que sea.",
  confirmBooking: "Solicitar esta habitación", sending: "Enviando…",
  requestReceived: "Gracias — hemos recibido su solicitud",
  yourReference: "Su referencia",
  weWillEmail: "El hotel confirmará por correo en breve.",
  payAtProperty: "No hay nada que pagar ahora. Paga en el hotel.",
  bookAnother: "Reservar otra habitación", somethingWentWrong: "Eso no ha funcionado",
  pickLaterDeparture: "La salida debe ser posterior a la llegada.",
  language: "Idioma", back: "Volver",
  notBookable: "La reserva en línea aún no está disponible",
  notBookableHint: "Este hotel no acepta reservas en esta página por ahora. Póngase en contacto con nosotros directamente y le ayudaremos con mucho gusto.",
};

const it: Dict = {
  bookARoom: "Prenota una camera", arrival: "Arrivo", departure: "Partenza",
  adults: "Adulti", children: "Bambini", search: "Vedi camere disponibili",
  searching: "Ricerca…", availableRooms: "Camere disponibili", night: "notte",
  nights: "notti", sleeps: "Per", totalForStay: "Totale del soggiorno",
  roomsLeft: "rimaste", soldOut: "Esaurite per queste date",
  noPriceLoaded: "Nessun prezzo per queste date", choose: "Scegli",
  nothingAvailable: "Nulla di disponibile per quelle date",
  nothingAvailableHint: "Prova date diverse o un soggiorno più breve.",
  yourDetails: "I tuoi dati", firstName: "Nome", lastName: "Cognome",
  email: "Email", phone: "Telefono", phoneOptional: "facoltativo",
  requests: "Qualcosa che dovremmo sapere",
  requestsHint: "Orario di arrivo, accessibilità, una camera tranquilla — qualsiasi cosa.",
  confirmBooking: "Richiedi questa camera", sending: "Invio…",
  requestReceived: "Grazie — abbiamo ricevuto la richiesta",
  yourReference: "Il tuo riferimento",
  weWillEmail: "L'hotel confermerà via email a breve.",
  payAtProperty: "Nulla da pagare ora. Si salda in hotel.",
  bookAnother: "Prenota un'altra camera", somethingWentWrong: "Non ha funzionato",
  pickLaterDeparture: "La partenza deve essere dopo l'arrivo.",
  language: "Lingua", back: "Indietro",
  notBookable: "La prenotazione online non è ancora attiva",
  notBookableHint: "Al momento questo hotel non accetta prenotazioni da questa pagina. Contattaci direttamente, saremo lieti di aiutarti.",
};

const pt: Dict = {
  bookARoom: "Reservar um quarto", arrival: "Chegada", departure: "Partida",
  adults: "Adultos", children: "Crianças", search: "Ver quartos disponíveis",
  searching: "A procurar…", availableRooms: "Quartos disponíveis", night: "noite",
  nights: "noites", sleeps: "Para", totalForStay: "Total da estadia",
  roomsLeft: "restantes", soldOut: "Esgotado nestas datas",
  noPriceLoaded: "Sem preço para estas datas", choose: "Escolher",
  nothingAvailable: "Nada disponível nessas datas",
  nothingAvailableHint: "Tente outras datas ou uma estadia mais curta.",
  yourDetails: "Os seus dados", firstName: "Nome próprio", lastName: "Apelido",
  email: "Email", phone: "Telefone", phoneOptional: "opcional",
  requests: "Algo que devamos saber",
  requestsHint: "Hora de chegada, acessibilidade, um quarto sossegado — qualquer coisa.",
  confirmBooking: "Pedir este quarto", sending: "A enviar…",
  requestReceived: "Obrigado — recebemos o seu pedido",
  yourReference: "A sua referência",
  weWillEmail: "O hotel confirmará por email em breve.",
  payAtProperty: "Nada a pagar agora. Paga no hotel.",
  bookAnother: "Reservar outro quarto", somethingWentWrong: "Isso não resultou",
  pickLaterDeparture: "A partida tem de ser depois da chegada.",
  language: "Idioma", back: "Voltar",
  notBookable: "A reserva online ainda não está disponível",
  notBookableHint: "Este hotel não aceita reservas nesta página de momento. Contacte-nos diretamente e teremos todo o gosto em ajudar.",
};

const nl: Dict = {
  bookARoom: "Een kamer boeken", arrival: "Aankomst", departure: "Vertrek",
  adults: "Volwassenen", children: "Kinderen", search: "Bekijk beschikbare kamers",
  searching: "Zoeken…", availableRooms: "Beschikbare kamers", night: "nacht",
  nights: "nachten", sleeps: "Voor", totalForStay: "Totaal voor uw verblijf",
  roomsLeft: "over", soldOut: "Volgeboekt voor deze data",
  noPriceLoaded: "Geen prijs voor deze data", choose: "Kiezen",
  nothingAvailable: "Niets beschikbaar op die data",
  nothingAvailableHint: "Probeer andere data of een korter verblijf.",
  yourDetails: "Uw gegevens", firstName: "Voornaam", lastName: "Achternaam",
  email: "E-mail", phone: "Telefoon", phoneOptional: "optioneel",
  requests: "Iets dat wij moeten weten",
  requestsHint: "Aankomsttijd, toegankelijkheid, een rustige kamer — wat dan ook.",
  confirmBooking: "Deze kamer aanvragen", sending: "Versturen…",
  requestReceived: "Dank u — wij hebben uw aanvraag",
  yourReference: "Uw referentie",
  weWillEmail: "Het hotel bevestigt binnenkort per e-mail.",
  payAtProperty: "Nu niets te betalen. U rekent af in het hotel.",
  bookAnother: "Nog een kamer boeken", somethingWentWrong: "Dat is niet gelukt",
  pickLaterDeparture: "Vertrek moet na aankomst liggen.",
  language: "Taal", back: "Terug",
  notBookable: "Online boeken is nog niet mogelijk",
  notBookableHint: "Dit hotel neemt op deze pagina momenteel geen boekingen aan. Neem rechtstreeks contact met ons op, wij helpen u graag.",
};

const pl: Dict = {
  bookARoom: "Zarezerwuj pokój", arrival: "Przyjazd", departure: "Wyjazd",
  adults: "Dorośli", children: "Dzieci", search: "Zobacz wolne pokoje",
  searching: "Szukanie…", availableRooms: "Wolne pokoje", night: "noc",
  nights: "nocy", sleeps: "Dla", totalForStay: "Razem za pobyt",
  roomsLeft: "pozostało", soldOut: "Brak miejsc w tych terminach",
  noPriceLoaded: "Brak ceny w tych terminach", choose: "Wybierz",
  nothingAvailable: "Brak dostępności w tych terminach",
  nothingAvailableHint: "Spróbuj innych dat lub krótszego pobytu.",
  yourDetails: "Twoje dane", firstName: "Imię", lastName: "Nazwisko",
  email: "E-mail", phone: "Telefon", phoneOptional: "opcjonalnie",
  requests: "Czy jest coś, o czym powinniśmy wiedzieć",
  requestsHint: "Godzina przyjazdu, dostępność, cichy pokój — cokolwiek.",
  confirmBooking: "Poproś o ten pokój", sending: "Wysyłanie…",
  requestReceived: "Dziękujemy — mamy Twoje zgłoszenie",
  yourReference: "Twój numer",
  weWillEmail: "Hotel wkrótce potwierdzi e-mailem.",
  payAtProperty: "Teraz nic nie płacisz. Płatność w hotelu.",
  bookAnother: "Zarezerwuj kolejny pokój", somethingWentWrong: "To się nie udało",
  pickLaterDeparture: "Wyjazd musi być po przyjeździe.",
  language: "Język", back: "Wstecz",
  notBookable: "Rezerwacja online nie jest jeszcze dostępna",
  notBookableHint: "Ten hotel nie przyjmuje obecnie rezerwacji na tej stronie. Prosimy o bezpośredni kontakt — chętnie pomożemy.",
};

const sv: Dict = {
  bookARoom: "Boka rum", arrival: "Ankomst", departure: "Avresa",
  adults: "Vuxna", children: "Barn", search: "Visa lediga rum",
  searching: "Söker…", availableRooms: "Lediga rum", night: "natt",
  nights: "nätter", sleeps: "För", totalForStay: "Totalt för vistelsen",
  roomsLeft: "kvar", soldOut: "Fullbokat dessa datum",
  noPriceLoaded: "Inget pris för dessa datum", choose: "Välj",
  nothingAvailable: "Inget ledigt de datumen",
  nothingAvailableHint: "Prova andra datum eller en kortare vistelse.",
  yourDetails: "Dina uppgifter", firstName: "Förnamn", lastName: "Efternamn",
  email: "E-post", phone: "Telefon", phoneOptional: "valfritt",
  requests: "Något vi bör veta",
  requestsHint: "Ankomsttid, tillgänglighet, ett tyst rum — vad som helst.",
  confirmBooking: "Begär det här rummet", sending: "Skickar…",
  requestReceived: "Tack — vi har din förfrågan",
  yourReference: "Din referens",
  weWillEmail: "Hotellet bekräftar via e-post inom kort.",
  payAtProperty: "Inget att betala nu. Du betalar på hotellet.",
  bookAnother: "Boka ett rum till", somethingWentWrong: "Det fungerade inte",
  pickLaterDeparture: "Avresan måste vara efter ankomsten.",
  language: "Språk", back: "Tillbaka",
  notBookable: "Onlinebokning är inte öppen än",
  notBookableHint: "Hotellet tar för närvarande inte emot bokningar på den här sidan. Kontakta oss direkt, så hjälper vi dig gärna.",
};

const da: Dict = {
  bookARoom: "Book et værelse", arrival: "Ankomst", departure: "Afrejse",
  adults: "Voksne", children: "Børn", search: "Se ledige værelser",
  searching: "Søger…", availableRooms: "Ledige værelser", night: "nat",
  nights: "nætter", sleeps: "Til", totalForStay: "I alt for opholdet",
  roomsLeft: "tilbage", soldOut: "Udsolgt på disse datoer",
  noPriceLoaded: "Ingen pris på disse datoer", choose: "Vælg",
  nothingAvailable: "Intet ledigt på de datoer",
  nothingAvailableHint: "Prøv andre datoer eller et kortere ophold.",
  yourDetails: "Dine oplysninger", firstName: "Fornavn", lastName: "Efternavn",
  email: "E-mail", phone: "Telefon", phoneOptional: "valgfrit",
  requests: "Noget vi bør vide",
  requestsHint: "Ankomsttid, tilgængelighed, et stille værelse — hvad som helst.",
  confirmBooking: "Anmod om dette værelse", sending: "Sender…",
  requestReceived: "Tak — vi har din anmodning",
  yourReference: "Din reference",
  weWillEmail: "Hotellet bekræfter snarest på e-mail.",
  payAtProperty: "Intet at betale nu. Du betaler på hotellet.",
  bookAnother: "Book et værelse mere", somethingWentWrong: "Det virkede ikke",
  pickLaterDeparture: "Afrejse skal være efter ankomst.",
  language: "Sprog", back: "Tilbage",
  notBookable: "Onlinebooking er ikke åben endnu",
  notBookableHint: "Dette hotel tager i øjeblikket ikke imod bookinger på denne side. Kontakt os direkte, så hjælper vi gerne.",
};

const no: Dict = {
  bookARoom: "Bestill rom", arrival: "Ankomst", departure: "Avreise",
  adults: "Voksne", children: "Barn", search: "Se ledige rom",
  searching: "Søker…", availableRooms: "Ledige rom", night: "natt",
  nights: "netter", sleeps: "For", totalForStay: "Totalt for oppholdet",
  roomsLeft: "igjen", soldOut: "Utsolgt disse datoene",
  noPriceLoaded: "Ingen pris for disse datoene", choose: "Velg",
  nothingAvailable: "Ingenting ledig de datoene",
  nothingAvailableHint: "Prøv andre datoer eller et kortere opphold.",
  yourDetails: "Dine opplysninger", firstName: "Fornavn", lastName: "Etternavn",
  email: "E-post", phone: "Telefon", phoneOptional: "valgfritt",
  requests: "Noe vi bør vite",
  requestsHint: "Ankomsttid, tilgjengelighet, et stille rom — hva som helst.",
  confirmBooking: "Be om dette rommet", sending: "Sender…",
  requestReceived: "Takk — vi har forespørselen din",
  yourReference: "Din referanse",
  weWillEmail: "Hotellet bekrefter på e-post snart.",
  payAtProperty: "Ingenting å betale nå. Du gjør opp på hotellet.",
  bookAnother: "Bestill et rom til", somethingWentWrong: "Det fungerte ikke",
  pickLaterDeparture: "Avreise må være etter ankomst.",
  language: "Språk", back: "Tilbake",
  notBookable: "Nettbestilling er ikke åpen ennå",
  notBookableHint: "Dette hotellet tar foreløpig ikke imot bestillinger på denne siden. Ta kontakt med oss direkte, så hjelper vi deg gjerne.",
};

const fi: Dict = {
  bookARoom: "Varaa huone", arrival: "Saapuminen", departure: "Lähtö",
  adults: "Aikuiset", children: "Lapset", search: "Näytä vapaat huoneet",
  searching: "Haetaan…", availableRooms: "Vapaat huoneet", night: "yö",
  nights: "yötä", sleeps: "Hengelle", totalForStay: "Yhteensä oleskelusta",
  roomsLeft: "jäljellä", soldOut: "Loppuunmyyty näille päiville",
  noPriceLoaded: "Ei hintaa näille päiville", choose: "Valitse",
  nothingAvailable: "Ei vapaata näille päiville",
  nothingAvailableHint: "Kokeile toisia päiviä tai lyhyempää oleskelua.",
  yourDetails: "Tietosi", firstName: "Etunimi", lastName: "Sukunimi",
  email: "Sähköposti", phone: "Puhelin", phoneOptional: "valinnainen",
  requests: "Onko jotain, mitä meidän pitäisi tietää",
  requestsHint: "Saapumisaika, esteettömyys, rauhallinen huone — mitä vain.",
  confirmBooking: "Pyydä tätä huonetta", sending: "Lähetetään…",
  requestReceived: "Kiitos — pyyntösi on vastaanotettu",
  yourReference: "Viitteesi",
  weWillEmail: "Hotelli vahvistaa pian sähköpostitse.",
  payAtProperty: "Nyt ei tarvitse maksaa. Maksat hotellissa.",
  bookAnother: "Varaa toinen huone", somethingWentWrong: "Se ei onnistunut",
  pickLaterDeparture: "Lähdön on oltava saapumisen jälkeen.",
  language: "Kieli", back: "Takaisin",
  notBookable: "Verkkovaraus ei ole vielä avoinna",
  notBookableHint: "Tämä hotelli ei toistaiseksi ota vastaan varauksia tältä sivulta. Ota meihin suoraan yhteyttä, autamme mielellämme.",
};

const cs: Dict = {
  bookARoom: "Rezervovat pokoj", arrival: "Příjezd", departure: "Odjezd",
  adults: "Dospělí", children: "Děti", search: "Zobrazit volné pokoje",
  searching: "Hledám…", availableRooms: "Volné pokoje", night: "noc",
  nights: "nocí", sleeps: "Pro", totalForStay: "Celkem za pobyt",
  roomsLeft: "zbývá", soldOut: "V těchto termínech obsazeno",
  noPriceLoaded: "Pro tyto termíny není cena", choose: "Vybrat",
  nothingAvailable: "V těchto termínech nic volného",
  nothingAvailableHint: "Zkuste jiné termíny nebo kratší pobyt.",
  yourDetails: "Vaše údaje", firstName: "Jméno", lastName: "Příjmení",
  email: "E-mail", phone: "Telefon", phoneOptional: "nepovinné",
  requests: "Máme o něčem vědět",
  requestsHint: "Čas příjezdu, bezbariérovost, tichý pokoj — cokoli.",
  confirmBooking: "Požádat o tento pokoj", sending: "Odesílám…",
  requestReceived: "Děkujeme — vaši žádost máme",
  yourReference: "Vaše značka",
  weWillEmail: "Hotel brzy potvrdí e-mailem.",
  payAtProperty: "Nyní neplatíte nic. Zaplatíte v hotelu.",
  bookAnother: "Rezervovat další pokoj", somethingWentWrong: "To se nepovedlo",
  pickLaterDeparture: "Odjezd musí být po příjezdu.",
  language: "Jazyk", back: "Zpět",
  notBookable: "Online rezervace zatím není spuštěna",
  notBookableHint: "Tento hotel na této stránce momentálně nepřijímá rezervace. Kontaktujte nás prosím přímo, rádi vám pomůžeme.",
};

const el: Dict = {
  bookARoom: "Κράτηση δωματίου", arrival: "Άφιξη", departure: "Αναχώρηση",
  adults: "Ενήλικες", children: "Παιδιά", search: "Δείτε διαθέσιμα δωμάτια",
  searching: "Αναζήτηση…", availableRooms: "Διαθέσιμα δωμάτια", night: "νύχτα",
  nights: "νύχτες", sleeps: "Για", totalForStay: "Σύνολο για τη διαμονή",
  roomsLeft: "απομένουν", soldOut: "Εξαντλήθηκαν για αυτές τις ημερομηνίες",
  noPriceLoaded: "Χωρίς τιμή για αυτές τις ημερομηνίες", choose: "Επιλογή",
  nothingAvailable: "Τίποτα διαθέσιμο για αυτές τις ημερομηνίες",
  nothingAvailableHint: "Δοκιμάστε άλλες ημερομηνίες ή συντομότερη διαμονή.",
  yourDetails: "Τα στοιχεία σας", firstName: "Όνομα", lastName: "Επώνυμο",
  email: "Email", phone: "Τηλέφωνο", phoneOptional: "προαιρετικό",
  requests: "Κάτι που πρέπει να γνωρίζουμε",
  requestsHint: "Ώρα άφιξης, προσβασιμότητα, ήσυχο δωμάτιο — οτιδήποτε.",
  confirmBooking: "Ζητήστε αυτό το δωμάτιο", sending: "Αποστολή…",
  requestReceived: "Ευχαριστούμε — λάβαμε το αίτημά σας",
  yourReference: "Ο κωδικός σας",
  weWillEmail: "Το ξενοδοχείο θα επιβεβαιώσει σύντομα με email.",
  payAtProperty: "Δεν πληρώνετε τώρα. Εξοφλείτε στο ξενοδοχείο.",
  bookAnother: "Κράτηση άλλου δωματίου", somethingWentWrong: "Κάτι πήγε στραβά",
  pickLaterDeparture: "Η αναχώρηση πρέπει να είναι μετά την άφιξη.",
  language: "Γλώσσα", back: "Πίσω",
  notBookable: "Η online κράτηση δεν είναι ακόμη διαθέσιμη",
  notBookableHint: "Αυτό το ξενοδοχείο δεν δέχεται προς το παρόν κρατήσεις από αυτή τη σελίδα. Επικοινωνήστε μαζί μας απευθείας και θα χαρούμε να σας βοηθήσουμε.",
};

const ro: Dict = {
  bookARoom: "Rezervați o cameră", arrival: "Sosire", departure: "Plecare",
  adults: "Adulți", children: "Copii", search: "Vedeți camerele disponibile",
  searching: "Se caută…", availableRooms: "Camere disponibile", night: "noapte",
  nights: "nopți", sleeps: "Pentru", totalForStay: "Total pentru sejur",
  roomsLeft: "rămase", soldOut: "Ocupat pentru aceste date",
  noPriceLoaded: "Fără tarif pentru aceste date", choose: "Alegeți",
  nothingAvailable: "Nimic disponibil pentru acele date",
  nothingAvailableHint: "Încercați alte date sau un sejur mai scurt.",
  yourDetails: "Datele dumneavoastră", firstName: "Prenume", lastName: "Nume",
  email: "E-mail", phone: "Telefon", phoneOptional: "opțional",
  requests: "Ceva ce ar trebui să știm",
  requestsHint: "Ora sosirii, accesibilitate, o cameră liniștită — orice.",
  confirmBooking: "Solicitați această cameră", sending: "Se trimite…",
  requestReceived: "Mulțumim — am primit solicitarea",
  yourReference: "Referința dumneavoastră",
  weWillEmail: "Hotelul va confirma în curând prin e-mail.",
  payAtProperty: "Nu plătiți nimic acum. Achitați la hotel.",
  bookAnother: "Rezervați altă cameră", somethingWentWrong: "Nu a funcționat",
  pickLaterDeparture: "Plecarea trebuie să fie după sosire.",
  language: "Limbă", back: "Înapoi",
  notBookable: "Rezervarea online nu este încă disponibilă",
  notBookableHint: "Acest hotel nu acceptă momentan rezervări pe această pagină. Contactați-ne direct și vă vom ajuta cu plăcere.",
};

const hu: Dict = {
  bookARoom: "Szobafoglalás", arrival: "Érkezés", departure: "Távozás",
  adults: "Felnőttek", children: "Gyermekek", search: "Szabad szobák megtekintése",
  searching: "Keresés…", availableRooms: "Szabad szobák", night: "éjszaka",
  nights: "éjszaka", sleeps: "Fő részére", totalForStay: "A tartózkodás összesen",
  roomsLeft: "maradt", soldOut: "Ezekre a napokra megtelt",
  noPriceLoaded: "Nincs ár ezekre a napokra", choose: "Választás",
  nothingAvailable: "Nincs szabad hely ezekre a napokra",
  nothingAvailableHint: "Próbáljon más dátumot vagy rövidebb tartózkodást.",
  yourDetails: "Az Ön adatai", firstName: "Keresztnév", lastName: "Vezetéknév",
  email: "E-mail", phone: "Telefon", phoneOptional: "nem kötelező",
  requests: "Van bármi, amit tudnunk kellene",
  requestsHint: "Érkezési idő, akadálymentesség, csendes szoba — bármi.",
  confirmBooking: "Szoba igénylése", sending: "Küldés…",
  requestReceived: "Köszönjük — megkaptuk a kérését",
  yourReference: "Az Ön azonosítója",
  weWillEmail: "A szálloda hamarosan e-mailben megerősíti.",
  payAtProperty: "Most nem kell fizetnie. A szállodában rendezi.",
  bookAnother: "Másik szoba foglalása", somethingWentWrong: "Ez nem sikerült",
  pickLaterDeparture: "A távozásnak az érkezés után kell lennie.",
  language: "Nyelv", back: "Vissza",
  notBookable: "Az online foglalás még nem elérhető",
  notBookableHint: "Ez a szálloda jelenleg nem fogad foglalást ezen az oldalon. Kérjük, vegye fel velünk közvetlenül a kapcsolatot, szívesen segítünk.",
};

const uk: Dict = {
  bookARoom: "Забронювати номер", arrival: "Заїзд", departure: "Виїзд",
  adults: "Дорослі", children: "Діти", search: "Показати вільні номери",
  searching: "Пошук…", availableRooms: "Вільні номери", night: "ніч",
  nights: "ночей", sleeps: "Для", totalForStay: "Разом за проживання",
  roomsLeft: "залишилось", soldOut: "На ці дати немає місць",
  noPriceLoaded: "Немає ціни на ці дати", choose: "Обрати",
  nothingAvailable: "На ці дати нічого немає",
  nothingAvailableHint: "Спробуйте інші дати або коротше перебування.",
  yourDetails: "Ваші дані", firstName: "Ім'я", lastName: "Прізвище",
  email: "Електронна пошта", phone: "Телефон", phoneOptional: "необов'язково",
  requests: "Чи є щось, що нам варто знати",
  requestsHint: "Час заїзду, доступність, тихий номер — будь-що.",
  confirmBooking: "Запросити цей номер", sending: "Надсилання…",
  requestReceived: "Дякуємо — ми отримали ваш запит",
  yourReference: "Ваш номер запиту",
  weWillEmail: "Готель невдовзі підтвердить електронною поштою.",
  payAtProperty: "Зараз платити нічого не потрібно. Розрахунок у готелі.",
  bookAnother: "Забронювати ще номер", somethingWentWrong: "Не вдалося",
  pickLaterDeparture: "Виїзд має бути після заїзду.",
  language: "Мова", back: "Назад",
  notBookable: "Онлайн-бронювання ще не відкрите",
  notBookableHint: "Цей готель наразі не приймає бронювання на цій сторінці. Зв’яжіться з нами напряму — ми радо допоможемо.",
};

const ru: Dict = {
  bookARoom: "Забронировать номер", arrival: "Заезд", departure: "Выезд",
  adults: "Взрослые", children: "Дети", search: "Показать свободные номера",
  searching: "Поиск…", availableRooms: "Свободные номера", night: "ночь",
  nights: "ночей", sleeps: "Для", totalForStay: "Итого за проживание",
  roomsLeft: "осталось", soldOut: "На эти даты мест нет",
  noPriceLoaded: "Нет цены на эти даты", choose: "Выбрать",
  nothingAvailable: "На эти даты ничего нет",
  nothingAvailableHint: "Попробуйте другие даты или более короткое проживание.",
  yourDetails: "Ваши данные", firstName: "Имя", lastName: "Фамилия",
  email: "Электронная почта", phone: "Телефон", phoneOptional: "необязательно",
  requests: "Есть ли что-то, что нам следует знать",
  requestsHint: "Время заезда, доступность, тихий номер — что угодно.",
  confirmBooking: "Запросить этот номер", sending: "Отправка…",
  requestReceived: "Спасибо — мы получили ваш запрос",
  yourReference: "Ваш номер запроса",
  weWillEmail: "Отель скоро подтвердит по электронной почте.",
  payAtProperty: "Сейчас платить ничего не нужно. Оплата в отеле.",
  bookAnother: "Забронировать ещё номер", somethingWentWrong: "Не получилось",
  pickLaterDeparture: "Выезд должен быть после заезда.",
  language: "Язык", back: "Назад",
  notBookable: "Онлайн-бронирование пока недоступно",
  notBookableHint: "Этот отель сейчас не принимает бронирования на этой странице. Свяжитесь с нами напрямую — мы будем рады помочь.",
};

const tr: Dict = {
  bookARoom: "Oda rezervasyonu", arrival: "Giriş", departure: "Çıkış",
  adults: "Yetişkin", children: "Çocuk", search: "Uygun odaları gör",
  searching: "Aranıyor…", availableRooms: "Uygun odalar", night: "gece",
  nights: "gece", sleeps: "Kişilik", totalForStay: "Konaklama toplamı",
  roomsLeft: "kaldı", soldOut: "Bu tarihlerde dolu",
  noPriceLoaded: "Bu tarihler için fiyat yok", choose: "Seç",
  nothingAvailable: "Bu tarihlerde uygun oda yok",
  nothingAvailableHint: "Farklı tarihler veya daha kısa bir konaklama deneyin.",
  yourDetails: "Bilgileriniz", firstName: "Ad", lastName: "Soyad",
  email: "E-posta", phone: "Telefon", phoneOptional: "isteğe bağlı",
  requests: "Bilmemiz gereken bir şey",
  requestsHint: "Giriş saati, erişilebilirlik, sessiz bir oda — her şey.",
  confirmBooking: "Bu odayı talep et", sending: "Gönderiliyor…",
  requestReceived: "Teşekkürler — talebinizi aldık",
  yourReference: "Referansınız",
  weWillEmail: "Otel kısa süre içinde e-posta ile onaylayacak.",
  payAtProperty: "Şimdi ödeme yok. Otelde ödersiniz.",
  bookAnother: "Başka bir oda ayırt", somethingWentWrong: "Bu işe yaramadı",
  pickLaterDeparture: "Çıkış, girişten sonra olmalı.",
  language: "Dil", back: "Geri",
  notBookable: "Çevrimiçi rezervasyon henüz açık değil",
  notBookableHint: "Bu otel şu anda bu sayfadan rezervasyon almıyor. Lütfen bizimle doğrudan iletişime geçin, memnuniyetle yardımcı oluruz.",
};

const DICTS: Record<Locale, Dict> = {
  en, de, fr, es, it, pt, nl, pl, sv, da, no, fi, cs, el, ro, hu, uk, ru, tr,
};

export function dictionaryFor(locale: Locale): Dict {
  return DICTS[locale] ?? en;
}
