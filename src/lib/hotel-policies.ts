/**
 * Hotel Content -> Hotel Policy (0068), cloned from the client's reference.
 *
 * The five sections, their options and their wording, in the reference's
 * order. A plain module rather than part of the settings component, so the
 * server can read the same list -- and so the guest booking page can show the
 * same sentences if it is ever asked to, rather than a second copy of them.
 *
 * The option ids are the values Postgres checks, so adding one here means
 * adding it to the matching check constraint in a migration too.
 *
 * Labels are the reference's exactly, including "Free Wifi" beside "Free
 * WiFi" -- the same rule as the Inventory menu's mixed casing. The one change
 * is "Let you guests know about the Internet access", which is a typo rather
 * than a decision, like the lower-case "reservations Report" was.
 */

export const HOTEL_POLICY_SECTIONS = [
  {
    key: "children",
    title: "Children",
    prompt: "Let your guests know if children are allowed in your accommodation",
    options: [
      { id: "all_ages", label: "All ages welcome" },
      { id: "no_children_or_infants", label: "Sorry, no children and infants" },
      { id: "no_infants", label: "Sorry, no infants" },
    ],
  },
  {
    key: "pets",
    title: "Pets",
    prompt: "Let your guests know if pets are allowed in your accommodation",
    options: [
      { id: "no_pets", label: "Sorry, no pets" },
      { id: "pets_surcharge", label: "Pets welcome, but may incur surcharge" },
    ],
  },
  {
    key: "smoking",
    title: "Smoking",
    prompt: "Let your guests know if smoking is allowed",
    options: [
      { id: "no_smoking", label: "Strictly no smoking" },
      { id: "permitted_areas", label: "Smoking in permitted areas only" },
    ],
  },
  {
    key: "internet",
    title: "Internet Access",
    prompt: "Let your guests know about the Internet access",
    options: [
      { id: "free_wifi_all", label: "Free Wifi in all areas" },
      { id: "free_wifi_most", label: "Free WiFi in most areas depending on signal" },
    ],
  },
  {
    key: "parking",
    title: "Parking",
    // The reference's Parking section carries no prompt line.
    prompt: null,
    options: [
      { id: "free_on_site", label: "Free On-Site Parking" },
      { id: "limited_on_site", label: "Limited On-Site Parking Available" },
    ],
  },
] as const;

export type HotelPolicyKey = (typeof HOTEL_POLICY_SECTIONS)[number]["key"];

/** Every section ends with these two, as the reference's does. */
export const CUSTOM_POLICY = "custom";
export const OMIT_POLICY = "omit";

export interface HotelPolicies {
  children: string;
  childrenCustom: string | null;
  pets: string;
  petsCustom: string | null;
  smoking: string;
  smokingCustom: string | null;
  internet: string;
  internetCustom: string | null;
  parking: string;
  parkingCustom: string | null;
  otherPolicies: string | null;
}

/**
 * A property that has never saved a policy says nothing, rather than having
 * words put in its mouth. Same as the row's own column defaults.
 */
export const EMPTY_HOTEL_POLICIES: HotelPolicies = {
  children: OMIT_POLICY,
  childrenCustom: null,
  pets: OMIT_POLICY,
  petsCustom: null,
  smoking: OMIT_POLICY,
  smokingCustom: null,
  internet: OMIT_POLICY,
  internetCustom: null,
  parking: OMIT_POLICY,
  parkingCustom: null,
  otherPolicies: null,
};

function withStop(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * The line under the form in the reference: each chosen policy as a sentence,
 * omitted ones left out, the hotel's own "Other Policies" last. It is what a
 * guest would read, assembled from what is on the page -- so it follows the
 * form as it is edited rather than what was last saved.
 */
export function hotelPolicySummary(p: {
  choice: (key: HotelPolicyKey) => string;
  custom: (key: HotelPolicyKey) => string | null;
  other: string | null;
}): string {
  const parts: string[] = [];
  for (const section of HOTEL_POLICY_SECTIONS) {
    const choice = p.choice(section.key);
    if (choice === OMIT_POLICY) continue;
    if (choice === CUSTOM_POLICY) {
      const text = p.custom(section.key)?.trim();
      if (text) parts.push(withStop(text));
      continue;
    }
    const option = section.options.find((o) => o.id === choice);
    if (option) parts.push(withStop(option.label));
  }
  const other = p.other?.trim();
  if (other) parts.push(withStop(other));
  return parts.join(" ");
}
