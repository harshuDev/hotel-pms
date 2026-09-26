import { SettingsScreen } from "@/components/settings/settings-screen";
import {
  DEFAULT_SETTINGS_TAB,
  isSettingsTab,
} from "@/lib/settings-tabs";
import {
  getChannelSettings,
  getCurrentStaffUser,
  getHotelPolicies,
  getExtrasCatalog,
  getFacilities,
  getGuestFields,
  getHotelEmailSettings,
  getHotelFeatures,
  getCalendarSettings,
  getLanguageSettings,
  getInvoiceSettings,
  getPosProfiles,
  getCurrencyProfiles,
  getAccountingSettings,
  getInventorySettings,
  getDiscounts,
  getVirtualRoomTypes,
  getBusinessDate,
  getPaymentGateways,
  getAccountingSystems,
  getEmailSetup,
  getEmailTemplates,
  getIdentificationTypes,
  getRegistrationForm,
  getPaymentMethodSettings,
  getPropertySettings,
  getRoomsForSettings,
  getRoomTypeSettings,
  getRatePlanSettings,
  getCancellationPolicies,
  getSeasonSettings,
  getWeekRates,
  getChannelManagers,
  getBookingEngineSettings,
  getBookingWidgets,
  getApiKeys,
  getStaffSettings,
  getTaxRateSettings,
} from "@/lib/queries";

export const metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string; edit?: string }>;
}) {
  const sp = await searchParams;
  const tab = isSettingsTab(sp.tab) ? sp.tab : DEFAULT_SETTINGS_TAB;
  const roomQuery = sp.q?.trim() ?? "";
  const roomPage = Math.max(1, Number(sp.page) || 1);
  // The calendar rail links here with a room type to rename.
  const editRoomTypeId = sp.edit?.trim() || null;

  const [
    property,
    roomTypes,
    rooms,
    channels,
    taxRates,
    seasons,
    ratePlans,
    cancellationPolicies,
    paymentMethods,
    staff,
    me,
    hotelPolicies,
    extrasCatalog,
    facilities,
    identificationTypes,
    guestFields,
    registrationForm,
    emailSettings,
    emailSetup,
    emailTemplates,
    hotelFeatures,
    calendarSettings,
    languageSettings,
    invoiceSettings,
    posProfiles,
    currencyProfiles,
    accountingSettings,
    paymentGateways,
    accountingSystems,
    inventorySettings,
    businessDate,
    discounts,
    virtualRoomTypes,
    weekRates,
    channelManagers,
    bookingEngine,
    bookingWidgets,
    apiKeys,
  ] = await Promise.all([
    getPropertySettings(),
    getRoomTypeSettings(),
    getRoomsForSettings({ q: roomQuery, page: roomPage }),
    getChannelSettings(),
    getTaxRateSettings(),
    getSeasonSettings(),
    getRatePlanSettings(),
    getCancellationPolicies(),
    getPaymentMethodSettings(),
    getStaffSettings(),
    getCurrentStaffUser(),
    getHotelPolicies(),
    getExtrasCatalog(),
    getFacilities(),
    getIdentificationTypes(),
    getGuestFields(),
    getRegistrationForm(),
    getHotelEmailSettings(),
    getEmailSetup(),
    getEmailTemplates(),
    getHotelFeatures(),
    getCalendarSettings(),
    getLanguageSettings(),
    getInvoiceSettings(),
    getPosProfiles(),
    getCurrencyProfiles(),
    getAccountingSettings(),
    getPaymentGateways(),
    getAccountingSystems(),
    getInventorySettings(),
    getBusinessDate(),
    getDiscounts(),
    getVirtualRoomTypes(),
    tab === "rate-plans" ? getWeekRates() : Promise.resolve([]),
    tab === "channel-manager" ? getChannelManagers() : Promise.resolve([]),
    tab === "booking-engine" ? getBookingEngineSettings() : Promise.resolve(null),
    tab === "booking-widget" ? getBookingWidgets() : Promise.resolve([]),
    tab === "api-key" || tab === "developer-keys" ? getApiKeys() : Promise.resolve(null),
  ]);

  /*
   * The timezone list is worked out here, on the server, and handed down: if
   * the browser built its own, Node's ICU and the browser's can list different
   * zones, and the select would render one way on the server and another in
   * the browser -- a hydration mismatch.
   */
  const timezones = Intl.supportedValuesOf("timeZone");

  return (
    // No page heading: the reference's Settings has none -- its sidebar says
    // where you are and each panel carries its own title.
    <div>
      <SettingsScreen
        tab={tab}
        property={property}
        roomTypes={roomTypes}
        rooms={rooms}
        roomQuery={roomQuery}
        channels={channels}
        taxRates={taxRates}
        seasons={seasons}
        ratePlans={ratePlans}
        cancellationPolicies={cancellationPolicies}
        editRoomTypeId={editRoomTypeId}
        paymentMethods={paymentMethods}
        staff={staff}
        meId={me?.id ?? null}
        canEdit={me !== null && ["admin", "manager"].includes(me.role)}
        isAdmin={me?.role === "admin"}
        timezones={timezones}
        hotelPolicies={hotelPolicies}
        extrasCatalog={extrasCatalog}
        facilities={facilities}
        identificationTypes={identificationTypes}
        guestFields={guestFields}
        registrationForm={registrationForm}
        emailSettings={emailSettings}
        emailSetup={emailSetup}
        emailTemplates={emailTemplates}
        hotelFeatures={hotelFeatures}
        calendarSettings={calendarSettings}
        languageSettings={languageSettings}
        invoiceSettings={invoiceSettings}
        posProfiles={posProfiles}
        currencyProfiles={currencyProfiles}
        accountingSettings={accountingSettings}
        paymentGateways={paymentGateways}
        accountingSystems={accountingSystems}
        inventorySettings={inventorySettings}
        businessDate={businessDate}
        discounts={discounts}
        virtualRoomTypes={virtualRoomTypes}
        weekRates={weekRates}
        channelManagers={channelManagers}
        bookingEngine={bookingEngine}
        bookingWidgets={bookingWidgets}
        apiKeys={apiKeys}
      />
    </div>
  );
}
