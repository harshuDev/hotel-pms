/**
 * THE STAFF APP'S LANGUAGE SWITCHER, and how far it reaches.
 *
 * The client's reference system carries a grid of language codes in its user
 * menu, and the client asked for our menu to match it. That same grid was
 * removed from here twice before, because both times it changed nothing: a
 * silent disabled row, then a row that said "English". A third dead control
 * would have been the one thing worse than leaving it out.
 *
 * So this one does something real, and the boundary of what it does is drawn
 * on purpose:
 *
 *   - TRANSLATED: the frame every screen sits in — the nine section names in
 *     the top bar and the phone drawer, the user menu, and "Business date".
 *     Navigation words, not accounting ones.
 *   - NOT TRANSLATED: the screens themselves, and the entries inside the
 *     Inventory, Bookings and Reports menus. A screen's name is translated
 *     together with the screen it names, and those are thirty-odd screens of
 *     hotel and accounting terms — blind close, close out, paid-out, folio —
 *     where a wrong word in a cash screen is an operational risk. They want a
 *     translator rather than a best guess (see `locales.ts`).
 *
 * The frame is the foundation rather than the finish: every screen translated
 * later adds its keys to this same dictionary.
 *
 * The codes and their order are the reference's exactly, which is why this is
 * a separate list from the guest page's nineteen. `sl-SI` is written as they
 * write it.
 */

export const STAFF_LOCALES = [
  "en", "de", "el", "es",
  "fr", "id", "it", "pt",
  "ro", "sl-SI", "th", "is",
] as const;

export type StaffLocale = (typeof STAFF_LOCALES)[number];

export const DEFAULT_STAFF_LOCALE: StaffLocale = "en";

/**
 * Per browser rather than per account. A front desk terminal is shared, and
 * the reference behaves the same way; a per-user setting would be a column
 * and a migration for no difference anybody at a desk would notice.
 */
export const STAFF_LANG_COOKIE = "staff_lang";

export function isStaffLocale(value: string | undefined): value is StaffLocale {
  return STAFF_LOCALES.some((l) => l === value);
}

export type StaffKey =
  | "dashboard"
  | "calendar"
  | "inventory"
  | "bookings"
  | "offers"
  | "reports"
  | "customers"
  | "cashier"
  | "meetingRooms"
  | "profile"
  | "guestBookingPage"
  | "settings"
  | "clearCache"
  | "clearing"
  | "logOut"
  | "businessDate";

type Dictionary = Record<StaffKey, string>;

/*
 * English is the reference's wording and casing exactly — "Guest Booking Page"
 * and "Log Out" in Title Case beside "Clear cache" in sentence case. That is
 * inconsistent because theirs is, and the same rule applies here as to the
 * Inventory menu: tidying it is the one thing that would make ours look unlike
 * the screenshot.
 */
const en: Dictionary = {
  dashboard: "Dashboard",
  calendar: "Calendar",
  inventory: "Inventory",
  bookings: "Bookings",
  offers: "Offers",
  reports: "Reports",
  customers: "Customers",
  cashier: "Cashier",
  meetingRooms: "Meeting Rooms",
  profile: "Profile",
  guestBookingPage: "Guest Booking Page",
  settings: "Settings",
  clearCache: "Clear cache",
  clearing: "Clearing…",
  logOut: "Log Out",
  businessDate: "Business date",
};

const DICTIONARY: Record<StaffLocale, Dictionary> = {
  en,
  de: {
    dashboard: "Dashboard",
    calendar: "Kalender",
    inventory: "Inventar",
    bookings: "Buchungen",
    offers: "Angebote",
    reports: "Berichte",
    customers: "Kunden",
    cashier: "Kasse",
    meetingRooms: "Tagungsräume",
    profile: "Profil",
    guestBookingPage: "Buchungsseite für Gäste",
    settings: "Einstellungen",
    clearCache: "Cache leeren",
    clearing: "Wird geleert…",
    logOut: "Abmelden",
    businessDate: "Geschäftsdatum",
  },
  el: {
    dashboard: "Πίνακας ελέγχου",
    calendar: "Ημερολόγιο",
    inventory: "Διαθεσιμότητα",
    bookings: "Κρατήσεις",
    offers: "Προσφορές",
    reports: "Αναφορές",
    customers: "Πελάτες",
    cashier: "Ταμείο",
    meetingRooms: "Αίθουσες συσκέψεων",
    profile: "Προφίλ",
    guestBookingPage: "Σελίδα κρατήσεων επισκεπτών",
    settings: "Ρυθμίσεις",
    clearCache: "Εκκαθάριση cache",
    clearing: "Εκκαθάριση…",
    logOut: "Αποσύνδεση",
    businessDate: "Ημερομηνία λειτουργίας",
  },
  es: {
    dashboard: "Panel",
    calendar: "Calendario",
    inventory: "Inventario",
    bookings: "Reservas",
    offers: "Ofertas",
    reports: "Informes",
    customers: "Clientes",
    cashier: "Caja",
    meetingRooms: "Salas de reuniones",
    profile: "Perfil",
    guestBookingPage: "Página de reservas para huéspedes",
    settings: "Configuración",
    clearCache: "Borrar caché",
    clearing: "Borrando…",
    logOut: "Cerrar sesión",
    businessDate: "Fecha operativa",
  },
  fr: {
    dashboard: "Tableau de bord",
    calendar: "Calendrier",
    inventory: "Inventaire",
    bookings: "Réservations",
    offers: "Offres",
    reports: "Rapports",
    customers: "Clients",
    cashier: "Caisse",
    meetingRooms: "Salles de réunion",
    profile: "Profil",
    guestBookingPage: "Page de réservation clients",
    settings: "Paramètres",
    clearCache: "Vider le cache",
    clearing: "Vidage…",
    logOut: "Déconnexion",
    businessDate: "Date d’exploitation",
  },
  id: {
    dashboard: "Dasbor",
    calendar: "Kalender",
    inventory: "Inventaris",
    bookings: "Pemesanan",
    offers: "Penawaran",
    reports: "Laporan",
    customers: "Pelanggan",
    cashier: "Kasir",
    meetingRooms: "Ruang Rapat",
    profile: "Profil",
    guestBookingPage: "Halaman Pemesanan Tamu",
    settings: "Pengaturan",
    clearCache: "Hapus cache",
    clearing: "Menghapus…",
    logOut: "Keluar",
    businessDate: "Tanggal operasional",
  },
  it: {
    dashboard: "Dashboard",
    calendar: "Calendario",
    inventory: "Inventario",
    bookings: "Prenotazioni",
    offers: "Offerte",
    reports: "Report",
    customers: "Clienti",
    cashier: "Cassa",
    meetingRooms: "Sale riunioni",
    profile: "Profilo",
    guestBookingPage: "Pagina prenotazioni ospiti",
    settings: "Impostazioni",
    clearCache: "Svuota cache",
    clearing: "Svuotamento…",
    logOut: "Esci",
    businessDate: "Data operativa",
  },
  pt: {
    dashboard: "Painel",
    calendar: "Calendário",
    inventory: "Inventário",
    bookings: "Reservas",
    offers: "Ofertas",
    reports: "Relatórios",
    customers: "Clientes",
    cashier: "Caixa",
    meetingRooms: "Salas de reunião",
    profile: "Perfil",
    guestBookingPage: "Página de reservas para hóspedes",
    settings: "Configurações",
    clearCache: "Limpar cache",
    clearing: "Limpando…",
    logOut: "Sair",
    businessDate: "Data operacional",
  },
  ro: {
    dashboard: "Panou de control",
    calendar: "Calendar",
    inventory: "Inventar",
    bookings: "Rezervări",
    offers: "Oferte",
    reports: "Rapoarte",
    customers: "Clienți",
    cashier: "Casierie",
    meetingRooms: "Săli de conferință",
    profile: "Profil",
    guestBookingPage: "Pagina de rezervări pentru oaspeți",
    settings: "Setări",
    clearCache: "Golește cache-ul",
    clearing: "Se golește…",
    logOut: "Deconectare",
    businessDate: "Data operațională",
  },
  "sl-SI": {
    dashboard: "Nadzorna plošča",
    calendar: "Koledar",
    inventory: "Inventar",
    bookings: "Rezervacije",
    offers: "Ponudbe",
    reports: "Poročila",
    customers: "Stranke",
    cashier: "Blagajna",
    meetingRooms: "Sejne sobe",
    profile: "Profil",
    guestBookingPage: "Stran za rezervacije gostov",
    settings: "Nastavitve",
    clearCache: "Počisti predpomnilnik",
    clearing: "Čiščenje…",
    logOut: "Odjava",
    businessDate: "Poslovni datum",
  },
  th: {
    dashboard: "แดชบอร์ด",
    calendar: "ปฏิทิน",
    inventory: "ห้องพักคงเหลือ",
    bookings: "การจอง",
    offers: "ข้อเสนอ",
    reports: "รายงาน",
    customers: "ลูกค้า",
    cashier: "แคชเชียร์",
    meetingRooms: "ห้องประชุม",
    profile: "โปรไฟล์",
    guestBookingPage: "หน้าจองสำหรับแขก",
    settings: "การตั้งค่า",
    clearCache: "ล้างแคช",
    clearing: "กำลังล้าง…",
    logOut: "ออกจากระบบ",
    businessDate: "วันทำการ",
  },
  is: {
    dashboard: "Stjórnborð",
    calendar: "Dagatal",
    inventory: "Framboð",
    bookings: "Bókanir",
    offers: "Tilboð",
    reports: "Skýrslur",
    customers: "Viðskiptavinir",
    cashier: "Kassi",
    meetingRooms: "Fundarherbergi",
    profile: "Prófíll",
    guestBookingPage: "Bókunarsíða fyrir gesti",
    settings: "Stillingar",
    clearCache: "Hreinsa skyndiminni",
    clearing: "Hreinsa…",
    logOut: "Skrá út",
    businessDate: "Rekstrardagur",
  },
};

/** The word for `key` in `lang`, falling back to English for anything missing. */
export function staffT(lang: StaffLocale, key: StaffKey): string {
  return DICTIONARY[lang]?.[key] ?? en[key];
}

/**
 * The `<html lang>` value for a staff locale. The same except for `sl-SI`,
 * which the reference writes with a region; the tag is valid either way, and
 * this keeps the displayed code theirs and the attribute conventional.
 */
export function staffHtmlLang(lang: StaffLocale): string {
  return lang === "sl-SI" ? "sl" : lang;
}
