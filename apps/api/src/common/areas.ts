/** A route's area as loaded with it: the join row's location. */
export interface AreaRow {
  location: { id: string; name: string };
}

/** A route's areas for the apps: the main area (route.locationId) first, then the rest by name. */
export function routeAreas(route: { locationId: string; areas: AreaRow[] }): { id: string; name: string }[] {
  return route.areas
    .map((a) => a.location)
    .sort((a, b) => Number(b.id === route.locationId) - Number(a.id === route.locationId) || a.name.localeCompare(b.name));
}

/** Include clause that loads a route's areas with their ids and names. */
export const withAreas = { areas: { include: { location: { select: { id: true, name: true } } } } } as const;
