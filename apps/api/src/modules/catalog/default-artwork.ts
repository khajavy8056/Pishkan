/** Individually commissioned default artwork, served by the web application. */
export const INDIVIDUAL_SERVICE_ARTWORK: Record<string, { image: string; previous: string }> = {
  'social-security-receipt': { image: '/images/services/individual/social-security-receipt.webp', previous: '/images/services/insurance.png' },
  'fuel-card-registration': { image: '/images/services/individual/fuel-card.webp', previous: '/images/services/vehicle.png' },
  'marriage-loan-registration': { image: '/images/services/individual/marriage-loan.webp', previous: '/images/services/banking.png' },
};

/** Only replace the exact uncustomised old default, never an administrator edit. */
export function resolveServiceArtwork(slug: string, image: string | null): string | null {
  const individual = INDIVIDUAL_SERVICE_ARTWORK[slug];
  return individual && image === individual.previous ? individual.image : image;
}
