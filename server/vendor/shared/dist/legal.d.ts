/**
 * The terms and privacy pages shown in the phone app and on the website (public /terms and /privacy). Their text is
 * in the language files under legal.terms.* and legal.privacy.*, one title and body per section, in this order.
 *
 * DRAFT: both texts were written as a starting point and still need review by a lawyer before launch.
 */
export declare const LEGAL_SECTIONS: {
    readonly terms: readonly ["about", "accounts", "use", "data", "messages", "ai", "availability", "plans", "responsibility", "changes"];
    readonly privacy: readonly ["what", "location", "photos", "sms", "ai", "storage", "sharing", "deletion", "phone", "contact"];
};
export type LegalPage = keyof typeof LEGAL_SECTIONS;
