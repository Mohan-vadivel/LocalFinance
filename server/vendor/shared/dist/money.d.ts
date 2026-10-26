/** All money is stored as integer paise. */
export declare const toPaise: (rupees: number) => number;
export declare const toRupees: (paise: number) => number;
/** Indian grouping: 1,00,000.00 */
export declare function formatINR(paise: number, opts?: {
    symbol?: boolean;
    decimals?: boolean;
}): string;
/**
 * A UPI payment link ("upi://pay", the NPCI deep link). UPI apps open it with the payee, amount and note filled in;
 * the same text in a QR code can be scanned by any UPI app.
 */
export declare function upiPayLink(p: {
    upiId: string;
    name: string;
    amount?: number;
    note?: string;
}): string;
